import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import { validateSessionForVideoPublication } from "../videoPublication/publishVideoMetadata.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";
import { validateTrustedModuleDocument } from "../tooling/moduleCreation.js";

export type OwnerCourseDto = Readonly<{
  id: string;
  title: string;
  status: "draft" | "published";
}>;
export type OwnerModuleDto = Readonly<{
  id: string;
  title: string;
  order: number;
}>;
export type OwnerSessionDto = Readonly<{
  id: string;
  title: string;
  order: number;
  publicationStatus: "draft" | "published";
  release: "immediate" | "released" | "scheduled";
  hasLesson: boolean;
  hasVideo: boolean;
}>;
export type TrustedRecord = Readonly<{ id: string; data: unknown }>;

const compareId = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

export function buildOwnerCourseInventory(
  records: readonly TrustedRecord[],
): OwnerCourseDto[] {
  return records
    .map(({ id: rawId, data }) => {
      const id = validateCourseId(rawId);
      validateTrustedCourseDocument(data, id);
      return { id, title: data.title, status: data.status };
    })
    .sort((a, b) => compareId(a.title, b.title) || compareId(a.id, b.id));
}

export function buildOwnerModuleInventory(
  records: readonly TrustedRecord[],
): OwnerModuleDto[] {
  return records
    .map(({ id: rawId, data }) => {
      const id = validateCourseId(rawId);
      validateTrustedModuleDocument(data);
      return { id, title: data.title, order: data.order };
    })
    .sort((a, b) => a.order - b.order || compareId(a.id, b.id));
}

export function buildOwnerSessionInventory(
  records: readonly TrustedRecord[],
  trustedNow = new Date(),
): OwnerSessionDto[] {
  if (Number.isNaN(trustedNow.getTime()))
    throw new Error("Trusted inventory time is invalid.");
  return records
    .map(({ id: rawId, data }) => {
      const id = validateCourseId(rawId);
      const session = validateSessionForVideoPublication(data);
      const hasRelease = Object.prototype.hasOwnProperty.call(
        session,
        "releaseAt",
      );
      const release: OwnerSessionDto["release"] = !hasRelease
        ? "immediate"
        : (session.releaseAt as Timestamp).toMillis() <= trustedNow.getTime()
          ? "released"
          : "scheduled";
      return {
        id,
        title: session.title,
        order: session.order,
        publicationStatus: session.publicationStatus,
        release,
        hasLesson: Object.prototype.hasOwnProperty.call(session, "lessonText"),
        hasVideo: Object.prototype.hasOwnProperty.call(session, "videoAssetId"),
      };
    })
    .sort((a, b) => a.order - b.order || compareId(a.id, b.id));
}

export async function readOwnerCourses(db: Firestore) {
  const snap = await db.collection("courses").get();
  return buildOwnerCourseInventory(
    snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  );
}

export async function readOwnerModules(db: Firestore, courseId: string) {
  const id = validateCourseId(courseId);
  const course = await db.doc(`courses/${id}`).get();
  if (!course.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(course.data(), id);
  const snap = await course.ref.collection("modules").get();
  return buildOwnerModuleInventory(
    snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
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
  const snap = await moduleSnap.ref.collection("sessions").get();
  return buildOwnerSessionInventory(
    snap.docs.map((doc) => ({ id: doc.id, data: doc.data() })),
  );
}
