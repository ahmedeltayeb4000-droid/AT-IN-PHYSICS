const MANUAL_GRANT_FIELDS = new Set([
  "targetUserId",
  "courseId",
  "expiresAt",
]);
const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

declare const validatedManualGrantInput: unique symbol;

export type ValidatedManualGrantInput = {
  readonly targetUserId: string;
  readonly courseId: string;
  readonly expiresAt: string | null;
  readonly [validatedManualGrantInput]: true;
};

export type ManualEnrollmentPayload<TInstant> = {
  readonly userId: string;
  readonly courseId: string;
  readonly status: "active";
  readonly grantedAt: TInstant;
  readonly expiresAt: TInstant | null;
  readonly source: "manual";
  readonly grantedBy: string;
};

export type ExistingEnrollment = {
  readonly status: "active" | "revoked";
};

export type ManualGrantDecision =
  | { readonly action: "create" }
  | { readonly action: "no-op" }
  | { readonly action: "reject"; readonly reason: "reactivation-required" };

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Manual grant input must be an object.");
  }
  return value as Record<string, unknown>;
}

function hasUnsafeUidCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      character === "/" ||
      /\s/.test(character) ||
      codePoint < 32 ||
      codePoint === 127
    );
  });
}

export function validateTargetUserId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("targetUserId must be a non-empty string.");
  }
  if (value.length > 128 || hasUnsafeUidCharacter(value)) {
    throw new Error("targetUserId contains invalid characters.");
  }
  return value;
}

export function validateCourseId(value: unknown): string {
  if (typeof value !== "string" || !COURSE_ID_PATTERN.test(value)) {
    throw new Error(
      "courseId must contain lowercase letters, numbers, and single hyphens only.",
    );
  }
  if (value.length > 128) {
    throw new Error("courseId must not exceed 128 characters.");
  }
  return value;
}

export function parseExpiresAt(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("expiresAt must be null or a canonical ISO timestamp.");
  }
  return value;
}

export function requireFutureExpiry(
  expiresAt: string | null,
  trustedNow: Date,
): void {
  if (Number.isNaN(trustedNow.getTime())) {
    throw new Error("Trusted current time is invalid.");
  }
  if (expiresAt !== null && Date.parse(expiresAt) <= trustedNow.getTime()) {
    throw new Error("expiresAt must be in the future.");
  }
}

export function parseManualGrantInput(value: unknown): ValidatedManualGrantInput {
  const input = requireRecord(value);
  const unknownFields = Object.keys(input).filter(
    (field) => !MANUAL_GRANT_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    throw new Error(`Unknown manual grant field: ${unknownFields[0]}`);
  }

  return {
    targetUserId: validateTargetUserId(input.targetUserId),
    courseId: validateCourseId(input.courseId),
    expiresAt: parseExpiresAt(input.expiresAt),
  } as ValidatedManualGrantInput;
}

export function getEnrollmentDocumentId(
  targetUserId: string,
  courseId: string,
): string {
  return `${validateTargetUserId(targetUserId)}_${validateCourseId(courseId)}`;
}

export function buildManualEnrollmentPayload<TInstant>(values: {
  readonly input: ValidatedManualGrantInput;
  readonly trustedActorUserId: string;
  readonly trustedGrantedAt: TInstant;
  readonly trustedExpiresAt: TInstant | null;
}): ManualEnrollmentPayload<TInstant> {
  return {
    userId: validateTargetUserId(values.input.targetUserId),
    courseId: validateCourseId(values.input.courseId),
    status: "active",
    grantedAt: values.trustedGrantedAt,
    expiresAt: values.trustedExpiresAt,
    source: "manual",
    grantedBy: validateTargetUserId(values.trustedActorUserId),
  };
}

export function decideManualGrant(
  existingEnrollment: ExistingEnrollment | null,
): ManualGrantDecision {
  if (existingEnrollment === null) return { action: "create" };
  if (existingEnrollment.status === "active") return { action: "no-op" };
  return { action: "reject", reason: "reactivation-required" };
}

export function isCourseEligibleForEnrollment(status: unknown): boolean {
  return status === "published";
}

export function hasDecodedOwnerClaim(
  decodedTokenClaims: Readonly<Record<string, unknown>>,
): boolean {
  return decodedTokenClaims.owner === true;
}
