import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import {
  buildManualEnrollmentPayload,
  decideManualGrant,
  getEnrollmentDocumentId,
  hasDecodedOwnerClaim,
  isCourseEligibleForEnrollment,
  parseManualGrantInput,
  requireFutureExpiry,
} from "./validation.js";

type GrantEnrollmentResponse = {
  readonly status: "created" | "already-active";
  readonly enrollmentId: string;
};

function invalidArgument(error: unknown): never {
  throw new HttpsError(
    "invalid-argument",
    error instanceof Error ? error.message : "Invalid grant request.",
  );
}

function isAuthUserNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String(error.code) === "auth/user-not-found"
  );
}

async function handleGrantEnrollment(
  request: CallableRequest<unknown>,
): Promise<GrantEnrollmentResponse> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  if (!hasDecodedOwnerClaim(request.auth.token)) {
    throw new HttpsError("permission-denied", "Owner authority is required.");
  }
  const actorUserId = request.auth.uid;

  let input;
  try {
    input = parseManualGrantInput(request.data);
    requireFutureExpiry(input.expiresAt, new Date());
  } catch (error) {
    invalidArgument(error);
  }

  try {
    await getAuth().getUser(input.targetUserId);
  } catch (error) {
    if (isAuthUserNotFound(error)) {
      throw new HttpsError("not-found", "Target user was not found.");
    }
    throw error;
  }

  const db = getFirestore();
  const enrollmentId = getEnrollmentDocumentId(
    input.targetUserId,
    input.courseId,
  );
  const courseReference = db.doc(`courses/${input.courseId}`);
  const enrollmentReference = db.doc(`enrollments/${enrollmentId}`);
  const grantedAt = Timestamp.now();
  const expiresAt =
    input.expiresAt === null
      ? null
      : Timestamp.fromDate(new Date(input.expiresAt));

  const status = await db.runTransaction(async (transaction) => {
    const courseSnapshot = await transaction.get(courseReference);
    if (!courseSnapshot.exists) {
      throw new HttpsError("not-found", "Course was not found.");
    }
    if (!isCourseEligibleForEnrollment(courseSnapshot.get("status"))) {
      throw new HttpsError(
        "failed-precondition",
        "Course is not eligible for enrollment.",
      );
    }

    const enrollmentSnapshot = await transaction.get(enrollmentReference);
    if (!enrollmentSnapshot.exists) {
      transaction.create(
        enrollmentReference,
        buildManualEnrollmentPayload({
          input,
          trustedActorUserId: actorUserId,
          trustedGrantedAt: grantedAt,
          trustedExpiresAt: expiresAt,
        }),
      );
      return "created" as const;
    }

    const existing = enrollmentSnapshot.data();
    if (
      !existing ||
      existing.userId !== input.targetUserId ||
      existing.courseId !== input.courseId ||
      (existing.status !== "active" && existing.status !== "revoked")
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Existing enrollment data is inconsistent.",
      );
    }

    const decision = decideManualGrant({ status: existing.status });
    if (decision.action === "reject") {
      throw new HttpsError(
        "failed-precondition",
        "Enrollment requires explicit reactivation.",
      );
    }
    return "already-active" as const;
  });

  return { status, enrollmentId };
}

export const grantEnrollment = onCall(async (request) => {
  try {
    return await handleGrantEnrollment(request);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("grantEnrollment failed unexpectedly.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpsError("internal", "Unable to grant enrollment.");
  }
});
