import { createHash, randomBytes } from "node:crypto";
import {
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}-[A-HJ-NP-Z2-9]{6}$/;
export type GenerateAccessCodeResult = Readonly<{ code: string; courseId: string; expiresAt: string | null }>;

export class AccessCodeError extends Error {
  constructor(readonly code: "invalid-argument" | "not-found" | "failed-precondition", message: string) {
    super(message);
    this.name = "AccessCodeError";
  }
}

export function normalizeAccessCode(value: unknown): string {
  if (typeof value !== "string") throw new AccessCodeError("invalid-argument", "Access Code is malformed.");
  const code = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) throw new AccessCodeError("invalid-argument", "Access Code is malformed.");
  return code;
}

export function deriveAccessCodeDocumentId(code: string): string {
  return createHash("sha256").update(normalizeAccessCode(code), "utf8").digest("hex");
}

export function generateAccessCode(random = randomBytes): string {
  const bytes = random(17);
  let bits = 0;
  let buffer = 0;
  let value = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && value.length < 26) {
      bits -= 5;
      value += ALPHABET[(buffer >>> bits) & 31];
    }
  }
  return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15, 20)}-${value.slice(20)}`;
}

function parseOwnerExpiry(value: unknown, now: Date): { iso: string | null; timestamp: Timestamp | null } {
  if (value === null) return { iso: null, timestamp: null };
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new AccessCodeError("invalid-argument", "Access Code expiry is malformed.");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value || date <= now) {
    throw new AccessCodeError("invalid-argument", "Access Code expiry must be in the future.");
  }
  return { iso: value, timestamp: Timestamp.fromDate(date) };
}

export async function createAccessCode(db: Firestore, courseIdValue: unknown, expiresAtValue: unknown, now: Date): Promise<GenerateAccessCodeResult> {
  const courseId = validateCourseId(courseIdValue);
  const expiry = parseOwnerExpiry(expiresAtValue, now);
  const code = generateAccessCode();
  const reference = db.doc(`accessCodes/${deriveAccessCodeDocumentId(code)}`);
  await db.runTransaction(async (transaction) => {
    const course = await transaction.get(db.doc(`courses/${courseId}`));
    if (!course.exists) throw new AccessCodeError("not-found", "Course was not found.");
    try { validateTrustedCourseDocument(course.data(), courseId); } catch { throw new AccessCodeError("failed-precondition", "Course is malformed."); }
    if (course.data()?.status !== "published") throw new AccessCodeError("failed-precondition", "Course is not eligible for enrollment.");
    transaction.create(reference, {
      version: 1, courseId, status: "active", createdAt: Timestamp.fromDate(now), expiresAt: expiry.timestamp,
      redeemedBy: null, redeemedAt: null,
    });
  });
  return { code, courseId, expiresAt: expiry.iso };
}
