import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import {
  FREE_SESSION_DISCOVERY_DOCUMENT_ID,
  SESSION_DISCOVERY_DOCUMENT_ID,
  buildFreeSessionDiscoveryManifest,
  buildSessionDiscoveryManifest,
  freeSessionDiscoveryManifestsEqual,
  sessionDiscoveryManifestsEqual,
  type TrustedSessionRecord,
} from "../sessionDiscovery/manifest.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";
import { validateTrustedModuleDocument } from "../tooling/moduleCreation.js";
import { validateSessionForVideoPublication } from "../videoPublication/publishVideoMetadata.js";

export const SESSION_EMERGENCY_CONFIRMATION = "WITHDRAW SESSION NOW";
export const SESSION_EMERGENCY_RESOURCE_LIMIT = 100;

export type SessionEmergencyTarget = Readonly<{
  courseId: string;
  moduleId: string;
  sessionId: string;
}>;

export type SessionEmergencyReview = Readonly<{
  operation: "session-emergency-withdrawal";
  target: SessionEmergencyTarget;
  sessionRevisionMillis: number;
  safe: Readonly<{
    courseId: string;
    courseTitle: string;
    moduleId: string;
    moduleTitle: string;
    sessionId: string;
    sessionTitle: string;
    currentPublicationStatus: "published";
    releaseState: "immediate" | "released" | "scheduled";
    isFree: boolean;
    hasVideo: boolean;
    protectedResourceCount: number;
    bindingsPreserved: true;
    warning: string;
  }>;
}>;

type DiscoveryState = Readonly<{
  visible: ReturnType<typeof buildSessionDiscoveryManifest>;
  free: ReturnType<typeof buildFreeSessionDiscoveryManifest>;
}>;

function canonicalTarget(raw: SessionEmergencyTarget): SessionEmergencyTarget {
  return {
    courseId: validateCourseId(raw.courseId),
    moduleId: validateCourseId(raw.moduleId),
    sessionId: validateCourseId(raw.sessionId),
  };
}

function paths(target: SessionEmergencyTarget) {
  const modulePath = `courses/${target.courseId}/modules/${target.moduleId}`;
  return {
    course: `courses/${target.courseId}`,
    module: modulePath,
    session: `${modulePath}/sessions/${target.sessionId}`,
    visible: `${modulePath}/sessionDiscovery/${SESSION_DISCOVERY_DOCUMENT_ID}`,
    free: `${modulePath}/sessionDiscovery/${FREE_SESSION_DISCOVERY_DOCUMENT_ID}`,
  };
}

function trustedRecord(id: string, value: unknown, withdrawnSessionId: string): TrustedSessionRecord {
  const data = validateSessionForVideoPublication(value);
  return {
    id: validateCourseId(id),
    title: data.title,
    order: data.order,
    publicationStatus: id === withdrawnSessionId ? "draft" : data.publicationStatus,
    isFree: data.isFree === true,
    ...(Object.prototype.hasOwnProperty.call(data, "releaseAt")
      ? { releaseAt: (data.releaseAt as Timestamp).toDate() }
      : {}),
  };
}

function deriveDiscovery(
  sessions: readonly { readonly id: string; data(): DocumentData }[],
  withdrawnSessionId: string,
  trustedNow: Date,
): DiscoveryState {
  if (Number.isNaN(trustedNow.getTime())) throw new Error("Trusted emergency time is invalid.");
  const records = sessions.map((snapshot) => trustedRecord(snapshot.id, snapshot.data(), withdrawnSessionId));
  if (!records.some((record) => record.id === withdrawnSessionId)) throw new Error("Session was not found.");
  return {
    visible: buildSessionDiscoveryManifest(records, trustedNow),
    free: buildFreeSessionDiscoveryManifest(records, trustedNow),
  };
}

function releaseState(session: DocumentData, trustedNow: Date): "immediate" | "released" | "scheduled" {
  if (!Object.prototype.hasOwnProperty.call(session, "releaseAt")) return "immediate";
  return (session.releaseAt as Timestamp).toMillis() <= trustedNow.getTime() ? "released" : "scheduled";
}

export async function reviewSessionEmergencyWithdrawal(
  db: Firestore,
  rawTarget: SessionEmergencyTarget,
  trustedNow: Date,
): Promise<SessionEmergencyReview> {
  const target = canonicalTarget(rawTarget);
  if (Number.isNaN(trustedNow.getTime())) throw new Error("Trusted emergency time is invalid.");
  const selected = paths(target);
  const courseRef = db.doc(selected.course);
  const moduleRef = db.doc(selected.module);
  const sessionRef = db.doc(selected.session);
  const sessionsQuery = moduleRef.collection("sessions");
  const resourcesQuery = sessionRef.collection("resources").limit(SESSION_EMERGENCY_RESOURCE_LIMIT + 1);
  const [course, module, session, sessions, visible, free, resources] = await Promise.all([
    courseRef.get(), moduleRef.get(), sessionRef.get(), sessionsQuery.get(),
    db.doc(selected.visible).get(), db.doc(selected.free).get(), resourcesQuery.get(),
  ]);
  if (!course.exists || !module.exists || !session.exists) throw new Error("Session hierarchy was not found.");
  validateTrustedCourseDocument(course.data(), target.courseId);
  validateTrustedModuleDocument(module.data());
  const current = validateSessionForVideoPublication(session.data());
  if (current.publicationStatus !== "published") throw new Error("Only a published Session can be withdrawn.");
  const revision = session.updateTime?.toMillis();
  if (revision === undefined) throw new Error("Session revision is unavailable.");
  if (resources.docs.length > SESSION_EMERGENCY_RESOURCE_LIMIT)
    throw new Error("Protected resource count exceeds the supported limit.");
  const proposed = deriveDiscovery(sessions.docs, target.sessionId, trustedNow);
  if (visible.exists && typeof visible.data() !== "object") throw new Error("Visible discovery is malformed.");
  if (free.exists && typeof free.data() !== "object") throw new Error("Free discovery is malformed.");
  void proposed;
  return {
    operation: "session-emergency-withdrawal",
    target,
    sessionRevisionMillis: revision,
    safe: {
      ...target,
      courseTitle: course.data()!.title as string,
      moduleTitle: module.data()!.title as string,
      sessionTitle: current.title as string,
      currentPublicationStatus: "published",
      releaseState: releaseState(current, trustedNow),
      isFree: current.isFree === true,
      hasVideo: Object.prototype.hasOwnProperty.call(current, "videoAssetId"),
      protectedResourceCount: resources.docs.length,
      bindingsPreserved: true,
      warning: "This removes the Session from student access and discovery. Video/PDF bindings and encrypted files remain for recovery. Already acquired content cannot be revoked.",
    },
  };
}

async function verifyCommittedState(db: Firestore, target: SessionEmergencyTarget, trustedNow: Date) {
  const selected = paths(target);
  const moduleRef = db.doc(selected.module);
  const [session, sessions, visible, free] = await Promise.all([
    db.doc(selected.session).get(), moduleRef.collection("sessions").get(),
    db.doc(selected.visible).get(), db.doc(selected.free).get(),
  ]);
  if (!session.exists || !visible.exists || !free.exists) throw new Error("Emergency withdrawal verification failed.");
  const current = validateSessionForVideoPublication(session.data());
  if (current.publicationStatus !== "draft") throw new Error("Emergency withdrawal verification failed.");
  const expected = deriveDiscovery(sessions.docs, target.sessionId, trustedNow);
  if (!sessionDiscoveryManifestsEqual(visible.data(), expected.visible) ||
      !freeSessionDiscoveryManifestsEqual(free.data(), expected.free))
    throw new Error("Emergency withdrawal verification failed.");
}

export async function applySessionEmergencyWithdrawal(
  db: Firestore,
  review: SessionEmergencyReview,
  trustedNow: Date,
  dependencies: Readonly<{ verifyCommitted?: () => Promise<void> }> = {},
) {
  if (review.operation !== "session-emergency-withdrawal") throw new Error("Emergency review operation is invalid.");
  const target = canonicalTarget(review.target);
  const selected = paths(target);
  const courseRef = db.doc(selected.course);
  const moduleRef = db.doc(selected.module);
  const sessionRef = db.doc(selected.session);
  const visibleRef = db.doc(selected.visible);
  const freeRef = db.doc(selected.free);
  await db.runTransaction(async (transaction) => {
    const [course, module, session, sessions, visible, free] = await Promise.all([
      transaction.get(courseRef), transaction.get(moduleRef), transaction.get(sessionRef),
      transaction.get(moduleRef.collection("sessions")), transaction.get(visibleRef), transaction.get(freeRef),
    ]);
    if (!course.exists || !module.exists || !session.exists) throw new Error("Session hierarchy was not found.");
    validateTrustedCourseDocument(course.data(), target.courseId);
    validateTrustedModuleDocument(module.data());
    const current = validateSessionForVideoPublication(session.data());
    if (session.updateTime?.toMillis() !== review.sessionRevisionMillis || current.publicationStatus !== "published")
      throw new Error("Emergency withdrawal review became stale.");
    const proposed = deriveDiscovery(sessions.docs, target.sessionId, trustedNow);
    transaction.update(sessionRef, { publicationStatus: "draft" });
    if (!visible.exists || !sessionDiscoveryManifestsEqual(visible.data(), proposed.visible))
      transaction.set(visibleRef, { sessionIds: [...proposed.visible.sessionIds] });
    if (!free.exists || !freeSessionDiscoveryManifestsEqual(free.data(), proposed.free))
      transaction.set(freeRef, { sessions: proposed.free.sessions.map((item) => ({ ...item })) });
  });
  try {
    await (dependencies.verifyCommitted ?? (() => verifyCommittedState(db, target, trustedNow)))();
    return { status: "COMMITTED_AND_VERIFIED" as const, postApplyVerified: true };
  } catch {
    return { status: "COMMITTED_VERIFICATION_UNCERTAIN" as const, postApplyVerified: false };
  }
}
