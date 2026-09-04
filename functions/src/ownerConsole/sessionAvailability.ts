import {
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import {
  buildFreeSessionDiscoveryManifest,
  buildSessionDiscoveryManifest,
  freeSessionDiscoveryManifestsEqual,
  sessionDiscoveryManifestsEqual,
  type TrustedSessionRecord,
} from "../sessionDiscovery/manifest.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";
import { validateTrustedModuleDocument } from "../tooling/moduleCreation.js";
import { validateSessionForVideoPublication } from "../videoPublication/publishVideoMetadata.js";

export const SESSION_AVAILABILITY_CONFIRMATION =
  "CHANGE PUBLISHED SESSION AVAILABILITY";

export type SessionAvailabilityTarget = Readonly<{
  courseId: string;
  moduleId: string;
  sessionId: string;
}>;

export type SessionAvailabilityReview = Readonly<{
  target: SessionAvailabilityTarget;
  publicationStatus: "draft" | "published";
  currentReleaseAt: Timestamp | null;
  currentCloseAt: Timestamp | null;
  proposedReleaseAt: Timestamp | null;
  proposedCloseAt: Timestamp | null;
  revisionMillis: number;
}>;

function parseInstant(value: unknown, field: string): Timestamp | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new Error(`${field} must be null or a canonical ISO timestamp.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${field} must be null or a canonical ISO timestamp.`);
  }
  return Timestamp.fromDate(date);
}

function validateWindow(
  releaseAt: Timestamp | null,
  closeAt: Timestamp | null,
) {
  if (releaseAt && closeAt && closeAt.toMillis() <= releaseAt.toMillis()) {
    throw new Error("closeAt must be later than releaseAt.");
  }
}

export function deriveSessionLifecycleState(
  publicationStatus: "draft" | "published",
  releaseAt: Timestamp | null,
  closeAt: Timestamp | null,
  trustedNow: Date,
) {
  if (Number.isNaN(trustedNow.getTime()))
    throw new Error("Trusted time is invalid.");
  validateWindow(releaseAt, closeAt);
  if (publicationStatus === "draft") return "draft" as const;
  if (releaseAt && trustedNow.getTime() < releaseAt.toMillis())
    return "scheduled" as const;
  if (closeAt && trustedNow.getTime() >= closeAt.toMillis())
    return "closed" as const;
  return "available" as const;
}

function target(raw: SessionAvailabilityTarget): SessionAvailabilityTarget {
  return {
    courseId: validateCourseId(raw.courseId),
    moduleId: validateCourseId(raw.moduleId),
    sessionId: validateCourseId(raw.sessionId),
  };
}

function instant(data: DocumentData, field: "releaseAt" | "closeAt") {
  if (!Object.prototype.hasOwnProperty.call(data, field)) return null;
  if (!(data[field] instanceof Timestamp))
    throw new Error("Existing Session is malformed.");
  return data[field] as Timestamp;
}

function record(id: string, data: DocumentData): TrustedSessionRecord {
  const session = validateSessionForVideoPublication(data);
  return {
    id: validateCourseId(id),
    title: session.title,
    order: session.order,
    publicationStatus: session.publicationStatus,
    isFree: session.isFree === true,
    ...(Object.prototype.hasOwnProperty.call(session, "releaseAt")
      ? { releaseAt: (session.releaseAt as Timestamp).toDate() }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(session, "closeAt")
      ? { closeAt: (session.closeAt as Timestamp).toDate() }
      : {}),
  };
}

export async function reviewSessionAvailability(
  db: Firestore,
  rawTarget: SessionAvailabilityTarget,
  releaseAtValue: unknown,
  closeAtValue: unknown,
): Promise<SessionAvailabilityReview> {
  const selected = target(rawTarget);
  const course = db.doc(`courses/${selected.courseId}`);
  const module = course.collection("modules").doc(selected.moduleId);
  const session = module.collection("sessions").doc(selected.sessionId);
  const [courseSnap, moduleSnap, sessionSnap] = await db.getAll(
    course,
    module,
    session,
  );
  if (!courseSnap.exists || !moduleSnap.exists || !sessionSnap.exists)
    throw new Error("Session was not found.");
  validateTrustedCourseDocument(courseSnap.data(), selected.courseId);
  validateTrustedModuleDocument(moduleSnap.data());
  const current = validateSessionForVideoPublication(sessionSnap.data());
  const proposedReleaseAt = parseInstant(releaseAtValue, "releaseAt");
  const proposedCloseAt = parseInstant(closeAtValue, "closeAt");
  validateWindow(proposedReleaseAt, proposedCloseAt);
  const revisionMillis = sessionSnap.updateTime?.toMillis();
  if (revisionMillis === undefined)
    throw new Error("Session revision is unavailable.");
  return {
    target: selected,
    publicationStatus: current.publicationStatus,
    currentReleaseAt: instant(current, "releaseAt"),
    currentCloseAt: instant(current, "closeAt"),
    proposedReleaseAt,
    proposedCloseAt,
    revisionMillis,
  };
}

export function safeSessionAvailabilityReview(
  review: SessionAvailabilityReview,
  trustedNow: Date,
) {
  return {
    ...review.target,
    publicationStatus: review.publicationStatus,
    currentReleaseAt: review.currentReleaseAt?.toDate().toISOString() ?? null,
    currentCloseAt: review.currentCloseAt?.toDate().toISOString() ?? null,
    proposedReleaseAt: review.proposedReleaseAt?.toDate().toISOString() ?? null,
    proposedCloseAt: review.proposedCloseAt?.toDate().toISOString() ?? null,
    proposedState: deriveSessionLifecycleState(
      review.publicationStatus,
      review.proposedReleaseAt,
      review.proposedCloseAt,
      trustedNow,
    ),
    requiresConfirmation: review.publicationStatus === "published",
  };
}

export async function applySessionAvailability(
  db: Firestore,
  review: SessionAvailabilityReview,
  trustedNow: Date,
) {
  const selected = target(review.target);
  const course = db.doc(`courses/${selected.courseId}`);
  const module = course.collection("modules").doc(selected.moduleId);
  const session = module.collection("sessions").doc(selected.sessionId);
  const visible = module.collection("sessionDiscovery").doc("visible");
  const free = module.collection("sessionDiscovery").doc("free");
  await db.runTransaction(async (transaction) => {
    const [courseSnap, moduleSnap, sessionSnap, sessions] = await Promise.all([
      transaction.get(course),
      transaction.get(module),
      transaction.get(session),
      transaction.get(module.collection("sessions")),
    ]);
    if (!courseSnap.exists || !moduleSnap.exists || !sessionSnap.exists)
      throw new Error("Session was not found.");
    validateTrustedCourseDocument(courseSnap.data(), selected.courseId);
    validateTrustedModuleDocument(moduleSnap.data());
    const current = validateSessionForVideoPublication(sessionSnap.data());
    if (sessionSnap.updateTime?.toMillis() !== review.revisionMillis)
      throw new Error("Session changed after review.");
    const records = sessions.docs.map((item) => {
      const data =
        item.id === selected.sessionId
          ? {
              ...current,
              releaseAt: review.proposedReleaseAt ?? undefined,
              closeAt: review.proposedCloseAt ?? undefined,
            }
          : item.data();
      if (item.id === selected.sessionId) {
        if (review.proposedReleaseAt === null) delete data.releaseAt;
        if (review.proposedCloseAt === null) delete data.closeAt;
      }
      return record(item.id, data);
    });
    const proposedVisible = buildSessionDiscoveryManifest(records, trustedNow);
    const proposedFree = buildFreeSessionDiscoveryManifest(records, trustedNow);
    transaction.update(session, {
      releaseAt: review.proposedReleaseAt ?? FieldValue.delete(),
      closeAt: review.proposedCloseAt ?? FieldValue.delete(),
    });
    transaction.set(visible, { sessionIds: [...proposedVisible.sessionIds] });
    transaction.set(free, {
      sessions: proposedFree.sessions.map((item) => ({ ...item })),
    });
  });
  const [sessionSnap, visibleSnap, freeSnap, sessions] = await Promise.all([
    session.get(),
    visible.get(),
    free.get(),
    module.collection("sessions").get(),
  ]);
  if (!sessionSnap.exists || !visibleSnap.exists || !freeSnap.exists)
    throw new Error("Session availability verification failed.");
  const current = validateSessionForVideoPublication(sessionSnap.data());
  const records = sessions.docs.map((item) => record(item.id, item.data()));
  if (
    instant(current, "releaseAt")?.toMillis() !==
      review.proposedReleaseAt?.toMillis() ||
    instant(current, "closeAt")?.toMillis() !==
      review.proposedCloseAt?.toMillis() ||
    !sessionDiscoveryManifestsEqual(
      visibleSnap.data(),
      buildSessionDiscoveryManifest(records, trustedNow),
    ) ||
    !freeSessionDiscoveryManifestsEqual(
      freeSnap.data(),
      buildFreeSessionDiscoveryManifest(records, trustedNow),
    )
  )
    throw new Error("Session availability verification failed.");
  return {
    state: deriveSessionLifecycleState(
      review.publicationStatus,
      review.proposedReleaseAt,
      review.proposedCloseAt,
      trustedNow,
    ),
    verified: true as const,
  };
}
