import type { Firestore } from "firebase-admin/firestore";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import { validateSessionForVideoPublication } from "../videoPublication/publishVideoMetadata.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";
import { validateTrustedModuleDocument } from "../tooling/moduleCreation.js";

export type OwnerCourseDto = Readonly<{
  courseId: string;
  title: string;
  publicationStatus: "draft" | "published";
}>;
export type OwnerModuleDto = Readonly<{
  courseId: string;
  moduleId: string;
  title: string;
  order: number;
}>;
export type OwnerSessionDto = Readonly<{
  courseId: string;
  moduleId: string;
  sessionId: string;
  title: string;
  order: number;
  publicationStatus: "draft" | "published";
  releaseState: "immediate" | "released" | "scheduled";
  releaseAt: string | null;
  closeAt: string | null;
  lifecycleState: "draft" | "scheduled" | "available" | "closed";
  accessState: "opened" | "enrollment-required";
  hasLesson: boolean;
  hasDeclaredVideo: boolean;
}>;
export type TrustedRecord = Readonly<{ id: string; data: unknown }>;
export type OwnerInventoryEnvelope<T> = Readonly<{
  items: readonly T[];
  limit: number;
  truncated: boolean;
  malformedCount: 0;
}>;

export const OWNER_COURSE_INVENTORY_LIMIT = 100;
export const OWNER_MODULE_INVENTORY_LIMIT = 100;
export const OWNER_SESSION_INVENTORY_LIMIT = 250;

const compareId = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export function buildOwnerCourseInventory(
  records: readonly TrustedRecord[],
  limit = OWNER_COURSE_INVENTORY_LIMIT,
): OwnerCourseDto[] {
  return records
    .slice(0, limit)
    .map(({ id: rawId, data }) => {
      const courseId = validateCourseId(rawId);
      validateTrustedCourseDocument(data, courseId);
      return { courseId, title: data.title, publicationStatus: data.status };
    })
    .sort(
      (a, b) =>
        compareId(a.title, b.title) || compareId(a.courseId, b.courseId),
    );
}

export function buildOwnerModuleInventory(
  records: readonly TrustedRecord[],
  courseId: string,
  limit = OWNER_MODULE_INVENTORY_LIMIT,
): OwnerModuleDto[] {
  const course = validateCourseId(courseId);
  return records
    .slice(0, limit)
    .map(({ id: rawId, data }) => {
      const moduleId = validateCourseId(rawId);
      validateTrustedModuleDocument(data);
      return {
        courseId: course,
        moduleId,
        title: data.title,
        order: data.order,
      };
    })
    .sort((a, b) => a.order - b.order || compareId(a.moduleId, b.moduleId));
}

export function buildOwnerSessionInventory(
  records: readonly TrustedRecord[],
  courseId: string,
  moduleId: string,
  coursePublicationStatus: "draft" | "published",
  trustedNow = new Date(),
  limit = OWNER_SESSION_INVENTORY_LIMIT,
): OwnerSessionDto[] {
  if (Number.isNaN(trustedNow.getTime()))
    throw new Error("Trusted inventory time is invalid.");
  if (
    coursePublicationStatus !== "draft" &&
    coursePublicationStatus !== "published"
  )
    throw new Error("Trusted Course publication status is invalid.");
  const course = validateCourseId(courseId);
  const module = validateCourseId(moduleId);
  return records
    .slice(0, limit)
    .map(({ id: rawId, data }) => {
      const sessionId = validateCourseId(rawId);
      const session = validateSessionForVideoPublication(data);
      const hasRelease = Object.prototype.hasOwnProperty.call(
        session,
        "releaseAt",
      );
      const releaseState: OwnerSessionDto["releaseState"] = !hasRelease
        ? "immediate"
        : (session.releaseAt as Timestamp).toMillis() <= trustedNow.getTime()
          ? "released"
          : "scheduled";
      const hasClose = Object.prototype.hasOwnProperty.call(session, "closeAt");
      const closed =
        hasClose &&
        (session.closeAt as Timestamp).toMillis() <= trustedNow.getTime();
      const lifecycleState: OwnerSessionDto["lifecycleState"] =
        session.publicationStatus === "draft"
          ? "draft"
          : releaseState === "scheduled"
            ? "scheduled"
            : closed
              ? "closed"
              : "available";
      return {
        courseId: course,
        moduleId: module,
        sessionId,
        title: session.title,
        order: session.order,
        publicationStatus: session.publicationStatus,
        releaseState,
        releaseAt: hasRelease
          ? (session.releaseAt as Timestamp).toDate().toISOString()
          : null,
        closeAt: hasClose
          ? (session.closeAt as Timestamp).toDate().toISOString()
          : null,
        lifecycleState,
        accessState:
          coursePublicationStatus === "published" &&
          session.publicationStatus === "published" &&
          releaseState !== "scheduled" &&
          !closed &&
          session.isFree === true
            ? ("opened" as const)
            : ("enrollment-required" as const),
        hasLesson: Object.prototype.hasOwnProperty.call(session, "lessonText"),
        hasDeclaredVideo: Object.prototype.hasOwnProperty.call(
          session,
          "videoAssetId",
        ),
      };
    })
    .sort((a, b) => a.order - b.order || compareId(a.sessionId, b.sessionId));
}

function envelope<T>(
  items: readonly T[],
  limit: number,
  observed: number,
): OwnerInventoryEnvelope<T> {
  return { items, limit, truncated: observed > limit, malformedCount: 0 };
}

export async function readOwnerCourses(db: Firestore) {
  const snap = await db
    .collection("courses")
    .orderBy(FieldPath.documentId())
    .limit(OWNER_COURSE_INVENTORY_LIMIT + 1)
    .get();
  return envelope(
    buildOwnerCourseInventory(
      snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
    ),
    OWNER_COURSE_INVENTORY_LIMIT,
    snap.size,
  );
}

export async function readOwnerModules(db: Firestore, courseId: string) {
  const id = validateCourseId(courseId);
  const course = await db.doc(`courses/${id}`).get();
  if (!course.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(course.data(), id);
  const snap = await course.ref
    .collection("modules")
    .orderBy(FieldPath.documentId())
    .limit(OWNER_MODULE_INVENTORY_LIMIT + 1)
    .get();
  return envelope(
    buildOwnerModuleInventory(
      snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      id,
    ),
    OWNER_MODULE_INVENTORY_LIMIT,
    snap.size,
  );
}

export async function readOwnerSessions(
  db: Firestore,
  courseId: string,
  moduleId: string,
) {
  const course = validateCourseId(courseId);
  const module = validateCourseId(moduleId);
  const courseRef = db.doc(`courses/${course}`);
  const moduleRef = db.doc(`courses/${course}/modules/${module}`);
  const [courseSnap, moduleSnap] = await db.getAll(courseRef, moduleRef);
  if (!courseSnap.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(courseSnap.data(), course);
  if (!moduleSnap.exists) throw new Error("Module was not found.");
  validateTrustedModuleDocument(moduleSnap.data());
  const snap = await moduleSnap.ref
    .collection("sessions")
    .orderBy(FieldPath.documentId())
    .limit(OWNER_SESSION_INVENTORY_LIMIT + 1)
    .get();
  return envelope(
    buildOwnerSessionInventory(
      snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
      course,
      module,
      courseSnap.data()!.status,
    ),
    OWNER_SESSION_INVENTORY_LIMIT,
    snap.size,
  );
}

export type OwnerLessonContent = Readonly<{
  courseId: string;
  moduleId: string;
  sessionId: string;
  sessionTitle: string;
  publicationStatus: "draft" | "published";
  lessonText: string | null;
  revisionMillis: number;
}>;

export async function readOwnerLessonContent(
  db: Firestore,
  courseId: string,
  moduleId: string,
  sessionId: string,
): Promise<OwnerLessonContent> {
  const course = validateCourseId(courseId);
  const module = validateCourseId(moduleId);
  const session = validateCourseId(sessionId);
  const courseRef = db.doc(`courses/${course}`);
  const moduleRef = db.doc(`courses/${course}/modules/${module}`);
  const sessionRef = db.doc(
    `courses/${course}/modules/${module}/sessions/${session}`,
  );
  const [courseSnap, moduleSnap, sessionSnap] = await db.getAll(
    courseRef,
    moduleRef,
    sessionRef,
  );
  if (!courseSnap.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(courseSnap.data(), course);
  if (!moduleSnap.exists) throw new Error("Module was not found.");
  validateTrustedModuleDocument(moduleSnap.data());
  if (!sessionSnap.exists) throw new Error("Session was not found.");
  const data = validateSessionForVideoPublication(sessionSnap.data());
  const revisionMillis = sessionSnap.updateTime?.toMillis();
  if (revisionMillis === undefined)
    throw new Error("Session revision is unavailable.");
  return {
    courseId: course,
    moduleId: module,
    sessionId: session,
    sessionTitle: data.title,
    publicationStatus: data.publicationStatus,
    lessonText: Object.prototype.hasOwnProperty.call(data, "lessonText")
      ? (data.lessonText as string)
      : null,
    revisionMillis,
  };
}
