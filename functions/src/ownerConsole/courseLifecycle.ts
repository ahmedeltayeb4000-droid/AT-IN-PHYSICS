import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";

export const ARCHIVE_COURSE_CONFIRMATION = "ARCHIVE COURSE";
export const RESTORE_COURSE_CONFIRMATION = "RESTORE COURSE";
const CHILD_LIMIT = 100;

type LifecycleOperation = "archive" | "restore";
type CourseStatus = "draft" | "published" | "archived";

export type CourseLifecycleReview = Readonly<{
  operation: LifecycleOperation;
  courseId: string;
  title: string;
  currentStatus: CourseStatus;
  revisionMillis: number;
  dependencies: Readonly<{ moduleCount: number; sessionCount: number; protectedResourceCount: number; declaredVideoCount: number; enrollmentCount: number; accessCodeCount: number; complete: boolean }>;
}>;

export type DeletionEligibility = Readonly<{
  target: "course" | "session";
  eligible: false;
  reason: "DEFERRED_RETENTION_SAFETY";
  dependencies: CourseLifecycleReview["dependencies"];
  warning: string;
}>;

async function dependencies(db: Firestore, courseId: string): Promise<CourseLifecycleReview["dependencies"]> {
  const course = db.doc(`courses/${courseId}`);
  const modules = await course.collection("modules").limit(CHILD_LIMIT + 1).get();
  if (modules.size > CHILD_LIMIT) throw new Error("Course dependency inventory exceeds the safe review limit.");
  let sessions = 0, resources = 0, videos = 0;
  for (const module of modules.docs) {
    const sessionDocs = await module.ref.collection("sessions").limit(CHILD_LIMIT + 1).get();
    if (sessionDocs.size > CHILD_LIMIT) throw new Error("Session dependency inventory exceeds the safe review limit.");
    sessions += sessionDocs.size;
    for (const session of sessionDocs.docs) {
      const resourceDocs = await session.ref.collection("resources").limit(CHILD_LIMIT + 1).get();
      if (resourceDocs.size > CHILD_LIMIT) throw new Error("Protected-resource inventory exceeds the safe review limit.");
      resources += resourceDocs.size;
      if (Object.prototype.hasOwnProperty.call(session.data(), "videoAssetId")) videos += 1;
    }
  }
  const [enrollments, accessCodes] = await Promise.all([
    db.collection("enrollments").where("courseId", "==", courseId).limit(CHILD_LIMIT + 1).get(),
    db.collection("accessCodes").where("courseId", "==", courseId).limit(CHILD_LIMIT + 1).get(),
  ]);
  if (enrollments.size > CHILD_LIMIT || accessCodes.size > CHILD_LIMIT) throw new Error("Retained-record inventory exceeds the safe review limit.");
  return { moduleCount: modules.size, sessionCount: sessions, protectedResourceCount: resources, declaredVideoCount: videos, enrollmentCount: enrollments.size, accessCodeCount: accessCodes.size, complete: true };
}

export async function reviewCourseLifecycle(db: Firestore, rawCourseId: unknown, operation: LifecycleOperation): Promise<CourseLifecycleReview> {
  const courseId = validateCourseId(rawCourseId);
  const snap = await db.doc(`courses/${courseId}`).get();
  if (!snap.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(snap.data(), courseId);
  const currentStatus = snap.data()!.status;
  if ((operation === "archive" && currentStatus !== "published") || (operation === "restore" && currentStatus !== "archived")) throw new Error("Course is not eligible for this lifecycle operation.");
  const revisionMillis = snap.updateTime?.toMillis();
  if (revisionMillis === undefined) throw new Error("Course revision is unavailable.");
  return { operation, courseId, title: snap.data()!.title, currentStatus, revisionMillis, dependencies: await dependencies(db, courseId) };
}

export async function applyCourseLifecycle(db: Firestore, review: CourseLifecycleReview, now: Date) {
  const ref = db.doc(`courses/${review.courseId}`);
  const nextStatus: CourseStatus = review.operation === "archive" ? "archived" : "published";
  const audit = db.doc(`courseLifecycleAudits/${randomBytes(24).toString("base64url")}`);
  await db.runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error("Course was not found.");
    validateTrustedCourseDocument(snap.data(), review.courseId);
    if (snap.updateTime?.toMillis() !== review.revisionMillis || snap.data()!.status !== review.currentStatus || !isDeepStrictEqual(await dependencies(db, review.courseId), review.dependencies)) throw new Error("Course changed after lifecycle review.");
    if ((review.operation === "archive" && snap.data()!.status !== "published") || (review.operation === "restore" && snap.data()!.status !== "archived")) throw new Error("Course is not eligible for this lifecycle operation.");
    transaction.update(ref, { status: nextStatus });
    transaction.create(audit, { version: 1, courseId: review.courseId, operation: review.operation, occurredAt: Timestamp.fromDate(now), dependencies: review.dependencies });
  });
  const verified = await ref.get();
  if (!verified.exists) throw new Error("Course lifecycle verification failed.");
  validateTrustedCourseDocument(verified.data(), review.courseId);
  if (verified.data()!.status !== nextStatus) throw new Error("Course lifecycle verification failed.");
  return { courseId: review.courseId, status: nextStatus, verified: true as const };
}

export async function reviewCourseDeletionEligibility(db: Firestore, rawCourseId: unknown): Promise<DeletionEligibility> {
  const courseId = validateCourseId(rawCourseId);
  const snap = await db.doc(`courses/${courseId}`).get();
  if (!snap.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(snap.data(), courseId);
  return { target: "course", eligible: false, reason: "DEFERRED_RETENTION_SAFETY", dependencies: await dependencies(db, courseId), warning: "Permanent Course deletion is deferred. Retained student records, audit policy, and encrypted Hosting artifact retention require a separate reviewed migration." };
}

export async function reviewSessionDeletionEligibility(db: Firestore, raw: Readonly<{ courseId: unknown; moduleId: unknown; sessionId: unknown }>): Promise<DeletionEligibility> {
  const courseId = validateCourseId(raw.courseId);
  const moduleId = validateCourseId(raw.moduleId);
  const sessionId = validateCourseId(raw.sessionId);
  const session = await db.doc(`courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`).get();
  if (!session.exists) throw new Error("Session was not found.");
  return { target: "session", eligible: false, reason: "DEFERRED_RETENTION_SAFETY", dependencies: await dependencies(db, courseId), warning: "Permanent Session deletion is deferred. Discovery, protected-content bindings, lifecycle audit retention, and encrypted Hosting artifact retention require a separate reviewed migration." };
}
