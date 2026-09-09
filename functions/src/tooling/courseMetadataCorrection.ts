import { isDeepStrictEqual } from "node:util";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { requireOwnerAuthority } from "./enrollmentGrant.js";
import { validateTrustedCourseDocument } from "./courseCreation.js";
import type { TrustedCourseTextRequest } from "./courseRequestFile.js";

export type CourseMetadataCorrectionReview = Readonly<{
  request: TrustedCourseTextRequest;
  current: Readonly<{
    title: string;
    shortDescription: string;
    status: "draft";
  }>;
  revisionMillis: number;
  changeRequired: boolean;
}>;

export async function reviewCourseMetadataCorrection(
  auth: Auth,
  db: Firestore,
  ownerUid: string,
  request: TrustedCourseTextRequest,
): Promise<CourseMetadataCorrectionReview> {
  await requireOwnerAuthority(auth, ownerUid);
  const snapshot = await db.doc(`courses/${request.courseId}`).get();
  if (!snapshot.exists) throw new Error("Course was not found.");
  validateTrustedCourseDocument(snapshot.data(), request.courseId);
  const data = snapshot.data()!;
  if (data.status !== "draft")
    throw new Error("Only a draft Course can be corrected.");
  const revisionMillis = snapshot.updateTime?.toMillis();
  if (revisionMillis === undefined)
    throw new Error("Course revision is unavailable.");
  return {
    request,
    current: {
      title: data.title,
      shortDescription: data.shortDescription,
      status: "draft",
    },
    revisionMillis,
    changeRequired:
      data.title !== request.title ||
      data.shortDescription !== request.shortDescription,
  };
}

export async function applyCourseMetadataCorrection(
  db: Firestore,
  review: CourseMetadataCorrectionReview,
) {
  if (!review.changeRequired)
    return { status: "already-current" as const, verified: true as const };
  const reference = db.doc(`courses/${review.request.courseId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error("Course was not found.");
    validateTrustedCourseDocument(snapshot.data(), review.request.courseId);
    const data = snapshot.data()!;
    if (
      data.status !== "draft" ||
      snapshot.updateTime?.toMillis() !== review.revisionMillis ||
      data.title !== review.current.title ||
      data.shortDescription !== review.current.shortDescription
    ) {
      throw new Error("Course changed after review.");
    }
    transaction.update(reference, {
      title: review.request.title,
      shortDescription: review.request.shortDescription,
    });
  });
  const persisted = await reference.get();
  validateTrustedCourseDocument(persisted.data(), review.request.courseId);
  const expected = {
    slug: review.request.courseId,
    title: review.request.title,
    shortDescription: review.request.shortDescription,
    status: "draft",
  };
  if (!isDeepStrictEqual(persisted.data(), expected)) {
    throw new Error("Course correction verification failed after apply.");
  }
  return { status: "corrected" as const, verified: true as const };
}
