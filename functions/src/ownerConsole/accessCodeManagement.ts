import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";
import {
  validateCourseId,
  validateTargetUserId,
} from "../enrollments/validation.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";

export const ACCESS_CODE_INVENTORY_LIMIT = 250;
export const ACCESS_CODE_REVIEW_LIMIT = 250;
export const REVOKE_ACCESS_CODE_CONFIRMATION = "REVOKE ACCESS CODE";

export type TrustedAccessCode = Readonly<{
  version: 1 | 2;
  courseId: string;
  status: "active" | "redeemed" | "revoked";
  createdAt: Timestamp;
  expiresAt: Timestamp | null;
  redeemedBy: string | null;
  redeemedAt: Timestamp | null;
  createdByUid?: string;
}>;

export type AccessCodeReview = Readonly<{
  documentId: string;
  current: TrustedAccessCode;
  revisionMillis: number;
}>;

export type AccessCodeHandleRegistry = Map<string, string>;

const ACCESS_CODE_FIELDS = [
  "courseId",
  "createdAt",
  "expiresAt",
  "redeemedAt",
  "redeemedBy",
  "status",
  "version",
];
const ACCESS_CODE_V2_FIELDS = [...ACCESS_CODE_FIELDS, "createdByUid"];
const ACCESS_CODE_ID = /^[a-f0-9]{64}$/;

function exactKeys(data: DocumentData, expected: readonly string[]) {
  const actual = Object.keys(data).sort();
  const fields = [...expected].sort();
  return (
    actual.length === fields.length &&
    actual.every((field, index) => field === fields[index])
  );
}

function trustedNow(value: Date) {
  if (Number.isNaN(value.getTime()))
    throw new Error("Trusted time is invalid.");
  return value;
}

function validateDocumentId(value: string) {
  if (!ACCESS_CODE_ID.test(value)) throw new Error("Access Code is malformed.");
  return value;
}

export function validateManagedAccessCode(
  documentId: string,
  value: unknown,
): TrustedAccessCode {
  validateDocumentId(documentId);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Access Code is malformed.");
  const data = value as DocumentData;
  if (!(
    (data.version === 1 && exactKeys(data, ACCESS_CODE_FIELDS)) ||
    (data.version === 2 && exactKeys(data, ACCESS_CODE_V2_FIELDS))
  ))
    throw new Error("Access Code is malformed.");
  if (data.version === 2) validateTargetUserId(data.createdByUid);
  const courseId = validateCourseId(data.courseId);
  if (
    !(data.createdAt instanceof Timestamp) ||
    (data.expiresAt !== null && !(data.expiresAt instanceof Timestamp))
  )
    throw new Error("Access Code is malformed.");
  if (
    data.status !== "active" &&
    data.status !== "redeemed" &&
    data.status !== "revoked"
  )
    throw new Error("Access Code is malformed.");
  if (data.status === "redeemed") {
    validateTargetUserId(data.redeemedBy);
    if (!(data.redeemedAt instanceof Timestamp))
      throw new Error("Access Code is malformed.");
  } else if (data.redeemedBy !== null || data.redeemedAt !== null) {
    throw new Error("Access Code is malformed.");
  }
  return {
    version: data.version,
    courseId,
    status: data.status,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt,
    redeemedBy: data.redeemedBy,
    redeemedAt: data.redeemedAt,
    ...(data.version === 2 ? { createdByUid: data.createdByUid } : {}),
  };
}

function operationalState(accessCode: TrustedAccessCode, now: Date) {
  if (accessCode.status === "redeemed") return "redeemed" as const;
  if (accessCode.status === "revoked") return "revoked" as const;
  if (
    accessCode.expiresAt !== null &&
    accessCode.expiresAt.toMillis() <= now.getTime()
  )
    return "expired" as const;
  return "unused" as const;
}

function requireRevocable(accessCode: TrustedAccessCode, now: Date) {
  if (
    accessCode.status !== "active" ||
    accessCode.redeemedBy !== null ||
    accessCode.redeemedAt !== null ||
    (accessCode.expiresAt !== null &&
      accessCode.expiresAt.toMillis() <= now.getTime())
  )
    throw new Error("Access Code is not eligible for revocation.");
}

function safeAccessCode(
  accessCode: TrustedAccessCode,
  courseTitle: string | null,
  now: Date,
) {
  return {
    courseId: accessCode.courseId,
    courseTitle,
    state: operationalState(accessCode, now),
    createdAt: accessCode.createdAt.toDate().toISOString(),
    expiresAt: accessCode.expiresAt?.toDate().toISOString() ?? null,
    redeemedAt: accessCode.redeemedAt?.toDate().toISOString() ?? null,
  };
}

async function courseTitle(
  db: Firestore,
  courseId: string,
): Promise<string | null> {
  const snapshot = await db.doc(`courses/${courseId}`).get();
  if (!snapshot.exists) return null;
  try {
    validateTrustedCourseDocument(snapshot.data(), courseId);
    return snapshot.data()!.title;
  } catch {
    return null;
  }
}

function opaqueId(registry: ReadonlyMap<string, unknown>) {
  for (;;) {
    const value = randomBytes(24).toString("base64url");
    if (!registry.has(value)) return value;
  }
}

export async function readAccessCodeInventory(db: Firestore, nowValue: Date) {
  const now = trustedNow(nowValue);
  const snapshot = await db
    .collection("accessCodes")
    .orderBy(FieldPath.documentId())
    .limit(ACCESS_CODE_INVENTORY_LIMIT)
    .get();
  const valid: Array<{ documentId: string; accessCode: TrustedAccessCode }> =
    [];
  let malformedCount = 0;
  for (const item of snapshot.docs) {
    try {
      valid.push({
        documentId: item.id,
        accessCode: validateManagedAccessCode(item.id, item.data()),
      });
    } catch {
      malformedCount += 1;
    }
  }
  const titles = new Map<string, string | null>();
  await Promise.all(
    [...new Set(valid.map(({ accessCode }) => accessCode.courseId))].map(
      async (courseId) => titles.set(courseId, await courseTitle(db, courseId)),
    ),
  );
  const handles: AccessCodeHandleRegistry = new Map();
  const accessCodes = valid.map(({ documentId, accessCode }) => {
    const handle = opaqueId(handles);
    handles.set(handle, documentId);
    return {
      handle,
      ...safeAccessCode(
        accessCode,
        titles.get(accessCode.courseId) ?? null,
        now,
      ),
    };
  });
  return {
    response: {
      accessCodes,
      limit: ACCESS_CODE_INVENTORY_LIMIT,
      limitReached: snapshot.size === ACCESS_CODE_INVENTORY_LIMIT,
      malformedCount,
    },
    handles,
  };
}

async function exactSnapshot(db: Firestore, rawDocumentId: string) {
  const documentId = validateDocumentId(rawDocumentId);
  const snapshot = await db.doc(`accessCodes/${documentId}`).get();
  if (!snapshot.exists) throw new Error("Access Code was not found.");
  return {
    documentId,
    snapshot,
    accessCode: validateManagedAccessCode(documentId, snapshot.data()),
  };
}

export async function inspectAccessCode(
  db: Firestore,
  documentId: string,
  nowValue: Date,
) {
  const now = trustedNow(nowValue);
  const { accessCode } = await exactSnapshot(db, documentId);
  return safeAccessCode(
    accessCode,
    await courseTitle(db, accessCode.courseId),
    now,
  );
}

export async function reviewAccessCodeRevocation(
  db: Firestore,
  documentId: string,
  nowValue: Date,
): Promise<AccessCodeReview> {
  const now = trustedNow(nowValue);
  const exact = await exactSnapshot(db, documentId);
  requireRevocable(exact.accessCode, now);
  const revisionMillis = exact.snapshot.updateTime?.toMillis();
  if (revisionMillis === undefined)
    throw new Error("Access Code revision is unavailable.");
  return {
    documentId: exact.documentId,
    current: exact.accessCode,
    revisionMillis,
  };
}

export function safeAccessCodeReview(review: AccessCodeReview, nowValue: Date) {
  const now = trustedNow(nowValue);
  return {
    courseId: review.current.courseId,
    state: operationalState(review.current, now),
    createdAt: review.current.createdAt.toDate().toISOString(),
    expiresAt: review.current.expiresAt?.toDate().toISOString() ?? null,
    proposedState: "revoked" as const,
  };
}

export async function applyAccessCodeRevocation(
  db: Firestore,
  review: AccessCodeReview,
  nowValue: Date,
) {
  const now = trustedNow(nowValue);
  const documentId = validateDocumentId(review.documentId);
  const reference = db.doc(`accessCodes/${documentId}`);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error("Access Code was not found.");
    const current = validateManagedAccessCode(documentId, snapshot.data());
    if (
      snapshot.updateTime?.toMillis() !== review.revisionMillis ||
      !isDeepStrictEqual(current, review.current)
    )
      throw new Error("Access Code changed after review.");
    requireRevocable(current, now);
    transaction.update(reference, { status: "revoked" });
  });
  const verifiedSnapshot = await reference.get();
  if (!verifiedSnapshot.exists)
    throw new Error("Access Code update verification failed.");
  const verified = validateManagedAccessCode(
    documentId,
    verifiedSnapshot.data(),
  );
  if (!isDeepStrictEqual(verified, { ...review.current, status: "revoked" }))
    throw new Error("Access Code update verification failed.");
  return { state: "revoked" as const, verified: true as const };
}
