import type { Auth } from "firebase-admin/auth";
import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {
  validateCourseId,
  validateTargetUserId,
} from "../enrollments/validation.js";
import {
  SESSION_DISCOVERY_DOCUMENT_ID,
  FREE_SESSION_DISCOVERY_DOCUMENT_ID,
  buildFreeSessionDiscoveryManifest,
  freeSessionDiscoveryManifestsEqual,
  buildSessionDiscoveryManifest,
  sessionDiscoveryManifestsEqual,
  validateSessionDiscoveryManifest,
  type SessionDiscoveryManifest,
  type TrustedSessionRecord,
} from "../sessionDiscovery/manifest.js";
import {
  validateExistingVideoAccess,
  validateSessionForVideoPublication,
} from "../videoPublication/publishVideoMetadata.js";
import { validateTrustedCourseDocument } from "./courseCreation.js";
import {
  requireOwnerAuthority,
  resolveEnrollmentGrantProject,
  resolveTrustedOwnerUid,
  type EnrollmentGrantEnvironment,
} from "./enrollmentGrant.js";
import { validateTrustedModuleDocument } from "./moduleCreation.js";
import { getSessionPath } from "./sessionCreation.js";

export type SessionPublicationOptions = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly sessionId: string;
  readonly apply: boolean;
};

export type ContentReadiness =
  "EMPTY_SUPPORTED" | "LESSON" | "VIDEO" | "LESSON_AND_VIDEO";
export type ReleaseState = "IMMEDIATE" | "RELEASED" | "SCHEDULED";

export type SessionPublicationInspection = {
  readonly sessionPath: string;
  readonly currentPublicationState: "draft" | "published";
  readonly proposedPublicationState: "published";
  readonly releaseState: ReleaseState;
  readonly contentReadiness: ContentReadiness;
  readonly currentDiscoveryState: "MISSING" | "CURRENT" | "STALE";
  readonly proposedSessionIds: readonly string[];
  readonly sessionChangeRequired: boolean;
  readonly discoveryChangeRequired: boolean;
  readonly changeRequired: boolean;
};

export type SessionPublicationResult = SessionPublicationInspection & {
  readonly applyStatus: "published" | "reconciled" | "already-current" | null;
  readonly postApplyVerified: boolean;
};

function optionValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`The ${option} option requires a value.`);
  return value;
}

export function parseSessionPublicationArgs(
  args: readonly string[],
): SessionPublicationOptions {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let sessionId: string | undefined;
  let apply = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      !["--course-id", "--module-id", "--session-id", "--apply"].includes(
        argument,
      )
    )
      throw new Error(`Unknown option: ${argument}`);
    if (seen.has(argument))
      throw new Error(`${argument} may be provided only once.`);
    seen.add(argument);
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    const value = optionValue(args, index, argument);
    index += 1;
    if (argument === "--course-id") courseId = value;
    if (argument === "--module-id") moduleId = value;
    if (argument === "--session-id") sessionId = value;
  }
  return {
    courseId: validateCourseId(courseId),
    moduleId: validateCourseId(moduleId),
    sessionId: validateCourseId(sessionId),
    apply,
  };
}

export function classifyContentReadiness(
  session: DocumentData,
): ContentReadiness {
  const lesson = Object.prototype.hasOwnProperty.call(session, "lessonText");
  const video = Object.prototype.hasOwnProperty.call(session, "videoAssetId");
  if (lesson && video) return "LESSON_AND_VIDEO";
  if (lesson) return "LESSON";
  if (video) return "VIDEO";
  return "EMPTY_SUPPORTED";
}

export function classifyReleaseState(
  session: DocumentData,
  trustedNow: Date,
): ReleaseState {
  if (Number.isNaN(trustedNow.getTime()))
    throw new Error("Trusted publication time is invalid.");
  if (!Object.prototype.hasOwnProperty.call(session, "releaseAt"))
    return "IMMEDIATE";
  if (!(session.releaseAt instanceof Timestamp))
    throw new Error("Existing Session is malformed.");
  return session.releaseAt.toMillis() <= trustedNow.getTime()
    ? "RELEASED"
    : "SCHEDULED";
}

export function proposePublishedSession(value: unknown): DocumentData {
  const session = validateSessionForVideoPublication(value);
  return { ...session, publicationStatus: "published" };
}

export function derivePublicationManifest(
  sessions: readonly { readonly id: string; readonly data: unknown }[],
  targetSessionId: string,
  trustedNow: Date,
): SessionDiscoveryManifest {
  const targetId = validateCourseId(targetSessionId);
  let targetFound = false;
  const records: TrustedSessionRecord[] = sessions.map(({ id, data }) => {
    const session = validateSessionForVideoPublication(data);
    const record: TrustedSessionRecord = {
      id: validateCourseId(id),
      order: session.order,
      publicationStatus:
        id === targetId ? "published" : session.publicationStatus,
      ...(Object.prototype.hasOwnProperty.call(session, "releaseAt")
        ? { releaseAt: (session.releaseAt as Timestamp).toDate() }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(session, "closeAt")
        ? { closeAt: (session.closeAt as Timestamp).toDate() }
        : {}),
      title: session.title,
      isFree: session.isFree === true,
    };
    if (id === targetId) targetFound = true;
    return record;
  });
  if (!targetFound) throw new Error("Session was not found.");
  return buildSessionDiscoveryManifest(records, trustedNow);
}

function validateVideoBinding(
  session: DocumentData,
  accessData: unknown,
  accessExists: boolean,
): void {
  if (!Object.prototype.hasOwnProperty.call(session, "videoAssetId")) return;
  if (!accessExists) throw new Error("Session video binding is incomplete.");
  const access = validateExistingVideoAccess(accessData);
  if (access.videoAssetId !== session.videoAssetId)
    throw new Error("Session video binding is inconsistent.");
}

export async function runSessionPublicationService(
  auth: Auth,
  db: Firestore,
  options: SessionPublicationOptions,
  trustedOwnerUid: string,
  trustedNow = new Date(),
): Promise<SessionPublicationResult> {
  const ownerUid = validateTargetUserId(trustedOwnerUid);
  await requireOwnerAuthority(auth, ownerUid);
  const ids = {
    courseId: validateCourseId(options.courseId),
    moduleId: validateCourseId(options.moduleId),
    sessionId: validateCourseId(options.sessionId),
  };
  const courseRef = db.doc(`courses/${ids.courseId}`);
  const moduleRef = db.doc(`courses/${ids.courseId}/modules/${ids.moduleId}`);
  const sessionPath = getSessionPath(ids.courseId, ids.moduleId, ids.sessionId);
  const sessionRef = db.doc(sessionPath);
  const accessRef = sessionRef.collection("videoAccess").doc("primary");
  const sessionsQuery = moduleRef.collection("sessions");
  const manifestRef = moduleRef
    .collection("sessionDiscovery")
    .doc(SESSION_DISCOVERY_DOCUMENT_ID);
  const freeManifestRef = moduleRef
    .collection("sessionDiscovery")
    .doc(FREE_SESSION_DISCOVERY_DOCUMENT_ID);

  const inspect = async (): Promise<SessionPublicationInspection> => {
    const [course, module, session, access, sessions, manifest, freeManifest] =
      await Promise.all([
        courseRef.get(),
        moduleRef.get(),
        sessionRef.get(),
        accessRef.get(),
        sessionsQuery.get(),
        manifestRef.get(),
        freeManifestRef.get(),
      ]);
    validateHierarchy(
      course.exists,
      course.data(),
      module.exists,
      module.data(),
      session.exists,
      session.data(),
      ids.courseId,
    );
    const current = validateSessionForVideoPublication(session.data());
    validateVideoBinding(current, access.data(), access.exists);
    const proposed = derivePublicationManifest(
      sessions.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      ids.sessionId,
      trustedNow,
    );
    const proposedFree = buildFreeSessionDiscoveryManifest(
      sessions.docs.map((doc) => {
        const data = validateSessionForVideoPublication(doc.data());
        return {
          id: doc.id,
          title: data.title,
          order: data.order,
          publicationStatus:
            doc.id === ids.sessionId ? "published" : data.publicationStatus,
          isFree: data.isFree === true,
          ...(Object.prototype.hasOwnProperty.call(data, "releaseAt")
            ? { releaseAt: (data.releaseAt as Timestamp).toDate() }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(data, "closeAt")
            ? { closeAt: (data.closeAt as Timestamp).toDate() }
            : {}),
        };
      }),
      trustedNow,
    );
    const currentManifest = manifest.exists
      ? validateSessionDiscoveryManifest(manifest.data())
      : null;
    return inspection(
      sessionPath,
      current,
      currentManifest,
      proposed,
      trustedNow,
      freeManifest.exists ? freeManifest.data() : null,
      proposedFree,
    );
  };

  const initial = await inspect();
  if (!options.apply)
    return { ...initial, applyStatus: null, postApplyVerified: false };

  const applyStatus = await db.runTransaction(async (transaction) => {
    const course = await transaction.get(courseRef);
    const module = await transaction.get(moduleRef);
    const session = await transaction.get(sessionRef);
    const access = await transaction.get(accessRef);
    const sessions = await transaction.get(sessionsQuery);
    const manifest = await transaction.get(manifestRef);
    const freeManifest = await transaction.get(freeManifestRef);
    validateHierarchy(
      course.exists,
      course.data(),
      module.exists,
      module.data(),
      session.exists,
      session.data(),
      ids.courseId,
    );
    const current = validateSessionForVideoPublication(session.data());
    validateVideoBinding(current, access.data(), access.exists);
    const proposed = derivePublicationManifest(
      sessions.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      ids.sessionId,
      trustedNow,
    );
    const proposedFree = buildFreeSessionDiscoveryManifest(
      sessions.docs.map((doc) => {
        const data = validateSessionForVideoPublication(doc.data());
        return {
          id: doc.id,
          title: data.title,
          order: data.order,
          publicationStatus:
            doc.id === ids.sessionId ? "published" : data.publicationStatus,
          isFree: data.isFree === true,
          ...(Object.prototype.hasOwnProperty.call(data, "releaseAt")
            ? { releaseAt: (data.releaseAt as Timestamp).toDate() }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(data, "closeAt")
            ? { closeAt: (data.closeAt as Timestamp).toDate() }
            : {}),
        };
      }),
      trustedNow,
    );
    const existingManifest = manifest.exists
      ? validateSessionDiscoveryManifest(manifest.data())
      : null;
    const sessionChange = current.publicationStatus === "draft";
    const manifestChange =
      existingManifest === null ||
      !sessionDiscoveryManifestsEqual(existingManifest, proposed);
    const freeManifestChange =
      !freeManifest.exists ||
      !freeSessionDiscoveryManifestsEqual(freeManifest.data(), proposedFree);
    if (sessionChange)
      transaction.update(sessionRef, { publicationStatus: "published" });
    if (manifestChange)
      transaction.set(manifestRef, { sessionIds: [...proposed.sessionIds] });
    if (freeManifestChange)
      transaction.set(freeManifestRef, {
        sessions: proposedFree.sessions.map((item) => ({ ...item })),
      });
    return sessionChange
      ? ("published" as const)
      : manifestChange || freeManifestChange
        ? ("reconciled" as const)
        : ("already-current" as const);
  });

  const verified = await inspect();
  if (
    verified.currentPublicationState !== "published" ||
    verified.discoveryChangeRequired
  )
    throw new Error("Session publication verification failed after apply.");
  return { ...verified, applyStatus, postApplyVerified: true };
}

function validateHierarchy(
  courseExists: boolean,
  course: DocumentData | undefined,
  moduleExists: boolean,
  module: DocumentData | undefined,
  sessionExists: boolean,
  session: DocumentData | undefined,
  courseId: string,
): void {
  if (!courseExists) throw new Error("Parent Course was not found.");
  validateTrustedCourseDocument(course, courseId);
  if (!moduleExists) throw new Error("Parent Module was not found.");
  validateTrustedModuleDocument(module);
  if (!sessionExists) throw new Error("Session was not found.");
  validateSessionForVideoPublication(session);
}

function inspection(
  sessionPath: string,
  current: DocumentData,
  currentManifest: SessionDiscoveryManifest | null,
  proposed: SessionDiscoveryManifest,
  trustedNow: Date,
  currentFreeManifest: unknown,
  proposedFreeManifest: ReturnType<typeof buildFreeSessionDiscoveryManifest>,
): SessionPublicationInspection {
  const sessionChangeRequired = current.publicationStatus === "draft";
  const discoveryChangeRequired =
    currentManifest === null ||
    !sessionDiscoveryManifestsEqual(currentManifest, proposed) ||
    !freeSessionDiscoveryManifestsEqual(
      currentFreeManifest,
      proposedFreeManifest,
    );
  return {
    sessionPath,
    currentPublicationState: current.publicationStatus as "draft" | "published",
    proposedPublicationState: "published",
    releaseState: classifyReleaseState(current, trustedNow),
    contentReadiness: classifyContentReadiness(current),
    currentDiscoveryState:
      currentManifest === null
        ? "MISSING"
        : discoveryChangeRequired
          ? "STALE"
          : "CURRENT",
    proposedSessionIds: [...proposed.sessionIds],
    sessionChangeRequired,
    discoveryChangeRequired,
    changeRequired: sessionChangeRequired || discoveryChangeRequired,
  };
}

export function resolveSessionPublicationProject(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveEnrollmentGrantProject(environment);
}

export function resolveSessionPublicationOwnerUid(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveTrustedOwnerUid(environment);
}

export function safeSessionPublicationSummary(
  result: SessionPublicationResult,
) {
  return {
    sessionPath: result.sessionPath,
    currentPublicationState: result.currentPublicationState,
    proposedPublicationState: result.proposedPublicationState,
    releaseState: result.releaseState,
    contentReadiness: result.contentReadiness,
    currentDiscoveryState: result.currentDiscoveryState,
    proposedSessionIds: [...result.proposedSessionIds],
    changeRequired: result.changeRequired,
    applyStatus: result.applyStatus,
    postApplyVerified: result.postApplyVerified,
  };
}
