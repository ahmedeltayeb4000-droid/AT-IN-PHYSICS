import { isDeepStrictEqual } from "node:util";
import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {
  getEnrollmentDocumentId,
  parseExpiresAt,
  requireFutureExpiry,
  validateCourseId,
  validateTargetUserId,
} from "../enrollments/validation.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";

export const ENROLLMENT_INVENTORY_LIMIT = 250;
export const REVOKE_ENROLLMENT_CONFIRMATION = "REVOKE ENROLLMENT";
export const REACTIVATE_ENROLLMENT_CONFIRMATION = "REACTIVATE ENROLLMENT";
export const EXTEND_ENROLLMENT_CONFIRMATION = "EXTEND ENROLLMENT";

type EnrollmentStatus = "active" | "revoked";
type EnrollmentSource = "access_code" | "manual" | "payment";
export type TrustedEnrollment = Readonly<{
  userId: string;
  courseId: string;
  status: EnrollmentStatus;
  grantedAt: Timestamp;
  expiresAt: Timestamp | null;
  source: EnrollmentSource;
  grantedBy: string;
  sourceId?: string;
}>;
export type EnrollmentTarget = Readonly<{ userId: string; courseId: string }>;
export type EnrollmentOperation = "revoke" | "reactivate" | "extend";
export type EnrollmentReview = Readonly<{
  operation: EnrollmentOperation;
  target: EnrollmentTarget;
  current: TrustedEnrollment;
  proposedStatus: EnrollmentStatus;
  proposedExpiresAt: Timestamp | null;
  revisionMillis: number;
}>;

const COMMON_FIELDS = ["courseId", "expiresAt", "grantedAt", "grantedBy", "source", "status", "userId"];
const ACCESS_CODE_ID = /^[a-f0-9]{64}$/;

function exactKeys(data: DocumentData, expected: readonly string[]) {
  const actual = Object.keys(data).sort();
  const fields = [...expected].sort();
  return actual.length === fields.length && actual.every((field, index) => field === fields[index]);
}

function trustedNow(value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new Error("Trusted time is invalid.");
  return value;
}

function target(value: EnrollmentTarget): EnrollmentTarget {
  return {
    userId: validateTargetUserId(value.userId),
    courseId: validateCourseId(value.courseId),
  };
}

export function validateManagedEnrollment(
  documentId: string,
  value: unknown,
  expectedTarget?: EnrollmentTarget,
): TrustedEnrollment {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enrollment is malformed.");
  const data = value as DocumentData;
  const bound = target({ userId: data.userId, courseId: data.courseId });
  if (documentId !== getEnrollmentDocumentId(bound.userId, bound.courseId)) throw new Error("Enrollment is malformed.");
  if (expectedTarget) {
    const expected = target(expectedTarget);
    if (bound.userId !== expected.userId || bound.courseId !== expected.courseId) throw new Error("Enrollment is malformed.");
  }
  if (data.status !== "active" && data.status !== "revoked") throw new Error("Enrollment is malformed.");
  if (!(data.grantedAt instanceof Timestamp) || (data.expiresAt !== null && !(data.expiresAt instanceof Timestamp))) throw new Error("Enrollment is malformed.");
  if (data.source !== "access_code" && data.source !== "manual" && data.source !== "payment") throw new Error("Enrollment is malformed.");
  validateTargetUserId(data.grantedBy);
  const hasSourceId = Object.prototype.hasOwnProperty.call(data, "sourceId");
  if (!exactKeys(data, hasSourceId ? [...COMMON_FIELDS, "sourceId"] : COMMON_FIELDS)) throw new Error("Enrollment is malformed.");
  if (data.source === "access_code") {
    if (!hasSourceId || typeof data.sourceId !== "string" || !ACCESS_CODE_ID.test(data.sourceId) || data.grantedBy !== "access-code-service") throw new Error("Enrollment is malformed.");
  } else if (data.source === "manual" && hasSourceId) {
    throw new Error("Enrollment is malformed.");
  } else if (hasSourceId && (typeof data.sourceId !== "string" || !data.sourceId)) {
    throw new Error("Enrollment is malformed.");
  }
  return {
    userId: bound.userId,
    courseId: bound.courseId,
    status: data.status,
    grantedAt: data.grantedAt,
    expiresAt: data.expiresAt,
    source: data.source,
    grantedBy: data.grantedBy,
    ...(hasSourceId ? { sourceId: data.sourceId } : {}),
  };
}

function accessState(enrollment: TrustedEnrollment, now: Date) {
  if (enrollment.status === "revoked") return "revoked" as const;
  if (enrollment.expiresAt !== null && enrollment.expiresAt.toMillis() <= now.getTime()) return "expired" as const;
  return "active" as const;
}

function safeEnrollment(enrollment: TrustedEnrollment, courseTitle: string | null, now: Date) {
  return {
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    courseTitle,
    status: enrollment.status,
    accessState: accessState(enrollment, now),
    grantedAt: enrollment.grantedAt.toDate().toISOString(),
    expiresAt: enrollment.expiresAt?.toDate().toISOString() ?? null,
    source: enrollment.source,
  };
}

async function courseTitle(db: Firestore, courseId: string): Promise<string | null> {
  const snapshot = await db.doc(`courses/${courseId}`).get();
  if (!snapshot.exists) return null;
  try {
    validateTrustedCourseDocument(snapshot.data(), courseId);
    return snapshot.data()!.title;
  } catch {
    return null;
  }
}

export async function readEnrollmentInventory(db: Firestore, nowValue: Date) {
  const now = trustedNow(nowValue);
  const snapshot = await db.collection("enrollments").orderBy(FieldPath.documentId()).limit(ENROLLMENT_INVENTORY_LIMIT).get();
  const valid: TrustedEnrollment[] = [];
  let malformedCount = 0;
  for (const item of snapshot.docs) {
    try { valid.push(validateManagedEnrollment(item.id, item.data())); } catch { malformedCount += 1; }
  }
  const titles = new Map<string, string | null>();
  await Promise.all([...new Set(valid.map((item) => item.courseId))].map(async (courseId) => titles.set(courseId, await courseTitle(db, courseId))));
  return {
    enrollments: valid.map((item) => safeEnrollment(item, titles.get(item.courseId) ?? null, now)),
    limit: ENROLLMENT_INVENTORY_LIMIT,
    limitReached: snapshot.size === ENROLLMENT_INVENTORY_LIMIT,
    malformedCount,
  };
}

async function exactSnapshot(db: Firestore, rawTarget: EnrollmentTarget) {
  const selected = target(rawTarget);
  const id = getEnrollmentDocumentId(selected.userId, selected.courseId);
  const snapshot = await db.doc(`enrollments/${id}`).get();
  if (!snapshot.exists) throw new Error("Enrollment was not found.");
  return { selected, snapshot, enrollment: validateManagedEnrollment(id, snapshot.data(), selected) };
}

export async function inspectEnrollment(db: Firestore, rawTarget: EnrollmentTarget, nowValue: Date) {
  const now = trustedNow(nowValue);
  const { enrollment } = await exactSnapshot(db, rawTarget);
  return safeEnrollment(enrollment, await courseTitle(db, enrollment.courseId), now);
}

export async function reviewEnrollmentStatus(
  db: Firestore,
  rawTarget: EnrollmentTarget,
  operation: "revoke" | "reactivate",
  nowValue: Date,
): Promise<EnrollmentReview> {
  const now = trustedNow(nowValue);
  const { selected, snapshot, enrollment } = await exactSnapshot(db, rawTarget);
  if (operation === "revoke" && enrollment.status !== "active") throw new Error("Enrollment is not eligible for revocation.");
  if (operation === "reactivate") {
    if (enrollment.status !== "revoked") throw new Error("Enrollment is not eligible for reactivation.");
    if (enrollment.expiresAt !== null && enrollment.expiresAt.toMillis() <= now.getTime()) throw new Error("Enrollment must be extended before reactivation.");
  }
  const revisionMillis = snapshot.updateTime?.toMillis();
  if (revisionMillis === undefined) throw new Error("Enrollment revision is unavailable.");
  return {
    operation,
    target: selected,
    current: enrollment,
    proposedStatus: operation === "revoke" ? "revoked" : "active",
    proposedExpiresAt: enrollment.expiresAt,
    revisionMillis,
  };
}

export async function reviewEnrollmentExtension(
  db: Firestore,
  rawTarget: EnrollmentTarget,
  expiresAtValue: unknown,
  nowValue: Date,
): Promise<EnrollmentReview> {
  const now = trustedNow(nowValue);
  const expiresAt = parseExpiresAt(expiresAtValue);
  if (expiresAt === null) throw new Error("Enrollment extension requires a finite expiration.");
  requireFutureExpiry(expiresAt, now);
  const { selected, snapshot, enrollment } = await exactSnapshot(db, rawTarget);
  if (enrollment.expiresAt === null) throw new Error("A perpetual Enrollment cannot be extended.");
  const proposed = Timestamp.fromDate(new Date(expiresAt));
  if (proposed.toMillis() <= enrollment.expiresAt.toMillis()) throw new Error("Enrollment expiration must be extended.");
  const revisionMillis = snapshot.updateTime?.toMillis();
  if (revisionMillis === undefined) throw new Error("Enrollment revision is unavailable.");
  return { operation: "extend", target: selected, current: enrollment, proposedStatus: enrollment.status, proposedExpiresAt: proposed, revisionMillis };
}

export function safeEnrollmentReview(review: EnrollmentReview, nowValue: Date) {
  const now = trustedNow(nowValue);
  return {
    operation: review.operation,
    userId: review.target.userId,
    courseId: review.target.courseId,
    currentStatus: review.current.status,
    proposedStatus: review.proposedStatus,
    currentAccessState: accessState(review.current, now),
    currentExpiresAt: review.current.expiresAt?.toDate().toISOString() ?? null,
    proposedExpiresAt: review.proposedExpiresAt?.toDate().toISOString() ?? null,
  };
}

export async function applyEnrollmentReview(db: Firestore, review: EnrollmentReview, nowValue: Date) {
  const now = trustedNow(nowValue);
  const id = getEnrollmentDocumentId(review.target.userId, review.target.courseId);
  const reference = db.doc(`enrollments/${id}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error("Enrollment was not found.");
    const current = validateManagedEnrollment(id, snapshot.data(), review.target);
    if (snapshot.updateTime?.toMillis() !== review.revisionMillis || !isDeepStrictEqual(current, review.current)) throw new Error("Enrollment changed after review.");
    if (review.operation === "revoke") {
      if (current.status !== "active") throw new Error("Enrollment is not eligible for revocation.");
      transaction.update(reference, { status: "revoked" });
    } else if (review.operation === "reactivate") {
      if (current.status !== "revoked" || (current.expiresAt !== null && current.expiresAt.toMillis() <= now.getTime())) throw new Error("Enrollment is not eligible for reactivation.");
      transaction.update(reference, { status: "active" });
    } else {
      if (current.expiresAt === null || review.proposedExpiresAt === null || review.proposedExpiresAt.toMillis() <= current.expiresAt.toMillis() || review.proposedExpiresAt.toMillis() <= now.getTime()) throw new Error("Enrollment is not eligible for extension.");
      transaction.update(reference, { expiresAt: review.proposedExpiresAt });
    }
  });
  const verifiedSnapshot = await reference.get();
  if (!verifiedSnapshot.exists) throw new Error("Enrollment update verification failed.");
  const verified = validateManagedEnrollment(id, verifiedSnapshot.data(), review.target);
  const expected = review.operation === "extend"
    ? { ...review.current, expiresAt: review.proposedExpiresAt }
    : { ...review.current, status: review.proposedStatus };
  if (!isDeepStrictEqual(verified, expected)) throw new Error("Enrollment update verification failed.");
  return {
    operation: review.operation,
    enrollment: safeEnrollment(verified, null, now),
    verified: true as const,
  };
}
