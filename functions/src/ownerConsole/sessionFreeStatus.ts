import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import { buildFreeSessionDiscoveryManifest } from "../sessionDiscovery/manifest.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";
import { validateTrustedModuleDocument } from "../tooling/moduleCreation.js";
import { validateSessionForVideoPublication } from "../videoPublication/publishVideoMetadata.js";

export const FREE_STATUS_PUBLISHED_CONFIRMATION =
  "CHANGE PUBLISHED SESSION ACCESS";

export type SessionFreeStatusTarget = Readonly<{
  courseId: string;
  moduleId: string;
  sessionId: string;
}>;

export type SessionFreeStatusReview = Readonly<{
  target: SessionFreeStatusTarget;
  currentIsFree: boolean;
  proposedIsFree: boolean;
  publicationStatus: "draft" | "published";
  revisionMillis: number;
}>;

function trustedRecord(snapshot: { id: string; data(): DocumentData }) {
  const data = validateSessionForVideoPublication(snapshot.data());
  return {
    id: snapshot.id,
    title: data.title,
    order: data.order,
    publicationStatus: data.publicationStatus,
    isFree: data.isFree === true,
    ...(Object.prototype.hasOwnProperty.call(data, "releaseAt")
      ? {
          releaseAt:
            data.releaseAt instanceof Timestamp
              ? data.releaseAt.toDate()
              : null,
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(data, "closeAt")
      ? {
          closeAt:
            data.closeAt instanceof Timestamp ? data.closeAt.toDate() : null,
        }
      : {}),
  };
}

export async function reviewSessionFreeStatus(
  db: Firestore,
  rawTarget: SessionFreeStatusTarget,
  proposedIsFree: unknown,
): Promise<SessionFreeStatusReview> {
  if (typeof proposedIsFree !== "boolean")
    throw new Error("Free status is invalid.");
  const target = {
    courseId: validateCourseId(rawTarget.courseId),
    moduleId: validateCourseId(rawTarget.moduleId),
    sessionId: validateCourseId(rawTarget.sessionId),
  };
  const courseRef = db.doc(`courses/${target.courseId}`);
  const moduleRef = db.doc(
    `courses/${target.courseId}/modules/${target.moduleId}`,
  );
  const sessionRef = moduleRef.collection("sessions").doc(target.sessionId);
  const [course, module, session] = await db.getAll(
    courseRef,
    moduleRef,
    sessionRef,
  );
  if (!course.exists || !module.exists || !session.exists)
    throw new Error("Session was not found.");
  validateTrustedCourseDocument(course.data(), target.courseId);
  validateTrustedModuleDocument(module.data());
  const data = validateSessionForVideoPublication(session.data());
  const revisionMillis = session.updateTime?.toMillis();
  if (revisionMillis === undefined)
    throw new Error("Session revision is unavailable.");
  return {
    target,
    currentIsFree: data.isFree === true,
    proposedIsFree,
    publicationStatus: data.publicationStatus,
    revisionMillis,
  };
}

export async function applySessionFreeStatus(
  db: Firestore,
  review: SessionFreeStatusReview,
  trustedNow: Date,
): Promise<{ isFree: boolean; verified: true }> {
  if (Number.isNaN(trustedNow.getTime()))
    throw new Error("Trusted time is invalid.");
  const { courseId, moduleId, sessionId } = review.target;
  const courseRef = db.doc(`courses/${courseId}`);
  const moduleRef = db.doc(`courses/${courseId}/modules/${moduleId}`);
  const sessionRef = moduleRef.collection("sessions").doc(sessionId);
  const freeRef = moduleRef.collection("sessionDiscovery").doc("free");
  await db.runTransaction(async (transaction) => {
    const [course, module, session, sessions] = await Promise.all([
      transaction.get(courseRef),
      transaction.get(moduleRef),
      transaction.get(sessionRef),
      transaction.get(moduleRef.collection("sessions")),
    ]);
    if (!course.exists || !module.exists || !session.exists)
      throw new Error("Session was not found.");
    validateTrustedCourseDocument(course.data(), courseId);
    validateTrustedModuleDocument(module.data());
    const current = validateSessionForVideoPublication(session.data());
    if (
      session.updateTime?.toMillis() !== review.revisionMillis ||
      (current.isFree === true) !== review.currentIsFree
    ) {
      throw new Error("Session changed after review.");
    }
    if (review.currentIsFree !== review.proposedIsFree) {
      transaction.update(sessionRef, { isFree: review.proposedIsFree });
    }
    const records = sessions.docs.map((item) => {
      const record = trustedRecord(item);
      return item.id === sessionId
        ? { ...record, isFree: review.proposedIsFree }
        : record;
    });
    const manifest = buildFreeSessionDiscoveryManifest(records, trustedNow);
    transaction.set(freeRef, {
      sessions: manifest.sessions.map((item) => ({ ...item })),
    });
  });
  const verified = validateSessionForVideoPublication(
    (await sessionRef.get()).data(),
  );
  if ((verified.isFree === true) !== review.proposedIsFree)
    throw new Error("Free status verification failed.");
  return { isFree: review.proposedIsFree, verified: true };
}
