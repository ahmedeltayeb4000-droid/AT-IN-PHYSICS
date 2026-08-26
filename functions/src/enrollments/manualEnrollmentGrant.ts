import { isDeepStrictEqual } from "node:util";
import type { Auth } from "firebase-admin/auth";
import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {
  buildManualEnrollmentPayload,
  decideManualGrant,
  getEnrollmentDocumentId,
  isCourseEligibleForEnrollment,
  parseManualGrantInput,
  requireFutureExpiry,
  validateTargetUserId,
  type ValidatedManualGrantInput,
} from "./validation.js";

export type ManualEnrollmentGrantOptions = {
  readonly targetUserId: string;
  readonly courseId: string;
  readonly expiresAt: string | null;
  readonly apply: boolean;
};

export type ManualEnrollmentGrantResult = {
  readonly enrollmentId: string;
  readonly enrollmentPath: string;
  readonly currentEnrollment: "MISSING" | "ACTIVE";
  readonly proposedStatus: "active";
  readonly changeRequired: boolean;
  readonly applyStatus: "created" | "already-active" | null;
  readonly effectiveExpiresAt: string | null;
  readonly postApplyVerified: boolean;
};

export class ManualEnrollmentGrantError extends Error {
  constructor(
    readonly code: "not-found" | "failed-precondition",
    message: string,
  ) {
    super(message);
    this.name = "ManualEnrollmentGrantError";
  }
}

function authUserNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    String(error.code) === "auth/user-not-found"
  );
}

async function requireTargetAuthUser(auth: Auth, uid: string): Promise<void> {
  try {
    await auth.getUser(uid);
  } catch (error) {
    if (authUserNotFound(error)) {
      throw new ManualEnrollmentGrantError(
        "not-found",
        "Target Auth user was not found.",
      );
    }
    throw error;
  }
}

function requireTimestamp(value: unknown, field: string): Timestamp {
  if (!(value instanceof Timestamp)) {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      `Existing Enrollment ${field} is malformed.`,
    );
  }
  return value;
}

function validateExistingEnrollment(
  data: DocumentData | undefined,
  input: ValidatedManualGrantInput,
): DocumentData {
  if (
    !data ||
    data.userId !== input.targetUserId ||
    data.courseId !== input.courseId
  ) {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      "Existing Enrollment authority binding is inconsistent.",
    );
  }
  if (data.status !== "active" && data.status !== "revoked") {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      "Existing Enrollment status is malformed.",
    );
  }
  if (
    data.source !== "manual" &&
    data.source !== "payment" &&
    data.source !== "access_code"
  ) {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      "Existing Enrollment source is malformed.",
    );
  }
  validateTargetUserId(data.grantedBy);
  requireTimestamp(data.grantedAt, "grantedAt");
  if (data.expiresAt !== null) requireTimestamp(data.expiresAt, "expiresAt");
  if (data.sourceId !== undefined && typeof data.sourceId !== "string") {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      "Existing Enrollment sourceId is malformed.",
    );
  }
  return data;
}

function expiryIso(data: DocumentData): string | null {
  return data.expiresAt === null
    ? null
    : requireTimestamp(data.expiresAt, "expiresAt").toDate().toISOString();
}

function requireEligibleCourse(data: DocumentData | undefined): void {
  if (!data) {
    throw new ManualEnrollmentGrantError("not-found", "Course was not found.");
  }
  if (!isCourseEligibleForEnrollment(data.status)) {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      "Course is not eligible for enrollment.",
    );
  }
}

export async function runTrustedManualEnrollmentGrant(
  auth: Auth,
  db: Firestore,
  options: ManualEnrollmentGrantOptions,
  trustedActorUserId: string,
  trustedNow: Date,
): Promise<ManualEnrollmentGrantResult> {
  const actorUserId = validateTargetUserId(trustedActorUserId);
  const input = parseManualGrantInput({
    targetUserId: options.targetUserId,
    courseId: options.courseId,
    expiresAt: options.expiresAt,
  });
  requireFutureExpiry(input.expiresAt, trustedNow);
  await requireTargetAuthUser(auth, input.targetUserId);

  const enrollmentId = getEnrollmentDocumentId(
    input.targetUserId,
    input.courseId,
  );
  const enrollmentPath = `enrollments/${enrollmentId}`;
  const courseReference = db.doc(`courses/${input.courseId}`);
  const enrollmentReference = db.doc(enrollmentPath);
  const proposedExpiry =
    input.expiresAt === null
      ? null
      : Timestamp.fromDate(new Date(input.expiresAt));

  if (!options.apply) {
    const [courseSnapshot, enrollmentSnapshot] = await db.getAll(
      courseReference,
      enrollmentReference,
    );
    requireEligibleCourse(courseSnapshot.data());
    if (!enrollmentSnapshot.exists) {
      return {
        enrollmentId,
        enrollmentPath,
        currentEnrollment: "MISSING",
        proposedStatus: "active",
        changeRequired: true,
        applyStatus: null,
        effectiveExpiresAt: input.expiresAt,
        postApplyVerified: false,
      };
    }
    const existing = validateExistingEnrollment(
      enrollmentSnapshot.data(),
      input,
    );
    const decision = decideManualGrant({ status: existing.status });
    if (decision.action === "reject") {
      throw new ManualEnrollmentGrantError(
        "failed-precondition",
        "Enrollment requires explicit reactivation.",
      );
    }
    return {
      enrollmentId,
      enrollmentPath,
      currentEnrollment: "ACTIVE",
      proposedStatus: "active",
      changeRequired: false,
      applyStatus: null,
      effectiveExpiresAt: expiryIso(existing),
      postApplyVerified: false,
    };
  }

  const grantedAt = Timestamp.fromDate(trustedNow);
  let expected: DocumentData | undefined;
  const applyStatus = await db.runTransaction(async (transaction) => {
    const courseSnapshot = await transaction.get(courseReference);
    requireEligibleCourse(courseSnapshot.data());
    const enrollmentSnapshot = await transaction.get(enrollmentReference);
    if (!enrollmentSnapshot.exists) {
      expected = buildManualEnrollmentPayload({
        input,
        trustedActorUserId: actorUserId,
        trustedGrantedAt: grantedAt,
        trustedExpiresAt: proposedExpiry,
      });
      transaction.create(enrollmentReference, expected);
      return "created" as const;
    }
    const existing = validateExistingEnrollment(
      enrollmentSnapshot.data(),
      input,
    );
    const decision = decideManualGrant({ status: existing.status });
    if (decision.action === "reject") {
      throw new ManualEnrollmentGrantError(
        "failed-precondition",
        "Enrollment requires explicit reactivation.",
      );
    }
    expected = existing;
    return "already-active" as const;
  });

  const verifiedSnapshot = await enrollmentReference.get();
  if (!verifiedSnapshot.exists || !expected) {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      "Enrollment post-apply verification failed.",
    );
  }
  const verified = validateExistingEnrollment(verifiedSnapshot.data(), input);
  if (!isDeepStrictEqual(verified, expected)) {
    throw new ManualEnrollmentGrantError(
      "failed-precondition",
      "Enrollment post-apply verification failed.",
    );
  }
  return {
    enrollmentId,
    enrollmentPath,
    currentEnrollment: applyStatus === "created" ? "MISSING" : "ACTIVE",
    proposedStatus: "active",
    changeRequired: applyStatus === "created",
    applyStatus,
    effectiveExpiresAt: expiryIso(verified),
    postApplyVerified: true,
  };
}
