import { isDeepStrictEqual } from "node:util";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import {
  getCoursePath,
  validateTrustedCourseDocument,
} from "../tooling/courseCreation.js";

export const COURSE_PUBLICATION_CONFIRMATION = "PUBLISH COURSE";

export type ReviewedCourseState = Readonly<{
  slug: string;
  title: string;
  shortDescription: string;
  status: "draft";
}>;

export type CoursePublicationReview = Readonly<{
  courseId: string;
  coursePath: string;
  course: ReviewedCourseState;
  revisionMillis: number;
}>;

export type CoursePublicationReviewSummary = Readonly<{
  courseId: string;
  title: string;
  currentStatus: "draft";
  proposedStatus: "published";
  confirmationPhrase: typeof COURSE_PUBLICATION_CONFIRMATION;
}>;

function exactReviewedState(data: DocumentData): ReviewedCourseState {
  if (data.status !== "draft") throw new Error("Course is not eligible for publication.");
  return {
    slug: data.slug,
    title: data.title,
    shortDescription: data.shortDescription,
    status: "draft",
  };
}

export async function reviewCoursePublication(
  db: Firestore,
  courseIdValue: unknown,
): Promise<CoursePublicationReview> {
  const courseId = validateCourseId(courseIdValue);
  const coursePath = getCoursePath(courseId);
  const snapshot = await db.doc(coursePath).get();
  if (!snapshot.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(snapshot.data(), courseId);
  const revisionMillis = snapshot.updateTime?.toMillis();
  if (revisionMillis === undefined) throw new Error("Course revision is unavailable.");
  return {
    courseId,
    coursePath,
    course: exactReviewedState(snapshot.data()!),
    revisionMillis,
  };
}

export function safeCoursePublicationReview(
  review: CoursePublicationReview,
): CoursePublicationReviewSummary {
  return {
    courseId: review.courseId,
    title: review.course.title,
    currentStatus: "draft",
    proposedStatus: "published",
    confirmationPhrase: COURSE_PUBLICATION_CONFIRMATION,
  };
}

export async function applyCoursePublication(
  db: Firestore,
  review: CoursePublicationReview,
): Promise<Readonly<{
  courseId: string;
  title: string;
  status: "published";
  verified: true;
}>> {
  const courseId = validateCourseId(review.courseId);
  const reference = db.doc(getCoursePath(courseId));
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error("Course was not found.");
    validateTrustedCourseDocument(snapshot.data(), courseId);
    if (
      snapshot.updateTime?.toMillis() !== review.revisionMillis ||
      !isDeepStrictEqual(snapshot.data(), review.course)
    ) {
      throw new Error("Course changed after publication review.");
    }
    if (snapshot.data()!.status !== "draft")
      throw new Error("Course is not eligible for publication.");
    transaction.update(reference, { status: "published" });
  });

  const verified = await reference.get();
  if (!verified.exists) throw new Error("Course publication verification failed.");
  validateTrustedCourseDocument(verified.data(), courseId);
  const expected = { ...review.course, status: "published" };
  if (!isDeepStrictEqual(verified.data(), expected))
    throw new Error("Course publication verification failed.");
  return {
    courseId,
    title: review.course.title,
    status: "published",
    verified: true,
  };
}
