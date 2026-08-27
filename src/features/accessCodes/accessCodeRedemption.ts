import type { User } from "firebase/auth";
import {
  Timestamp,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "../../lib/firebase";
import { getEnrollmentId } from "../enrollments/types";
import { deriveAccessCodeId } from "./accessCodeFormat";

const ACCESS_CODE_FIELDS = [
  "courseId",
  "createdAt",
  "expiresAt",
  "redeemedAt",
  "redeemedBy",
  "status",
  "version",
].sort();
const ENROLLMENT_FIELDS = [
  "courseId",
  "expiresAt",
  "grantedAt",
  "grantedBy",
  "source",
  "sourceId",
  "status",
  "userId",
].sort();
const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AccessCodeRedemptionResult = Readonly<{
  success: true;
  courseId: string;
  enrollmentState: "created" | "already-redeemed-by-you";
}>;

export class AccessCodeRedemptionError extends Error {
  constructor(message = "Access Code is invalid or unavailable.") {
    super(message);
    this.name = "AccessCodeRedemptionError";
  }
}

function exactKeys(data: DocumentData, expected: readonly string[]): boolean {
  const actual = Object.keys(data).sort();
  return (
    actual.length === expected.length &&
    actual.every((field, index) => field === expected[index])
  );
}

function validCourseId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    COURSE_ID_PATTERN.test(value)
  );
}

function requireAccessCodeRecord(data: DocumentData | undefined): DocumentData {
  if (
    !data ||
    !exactKeys(data, ACCESS_CODE_FIELDS) ||
    data.version !== 1 ||
    !validCourseId(data.courseId) ||
    !(data.createdAt instanceof Timestamp) ||
    (data.expiresAt !== null && !(data.expiresAt instanceof Timestamp)) ||
    !["active", "redeemed"].includes(data.status)
  ) {
    throw new AccessCodeRedemptionError();
  }
  if (
    (data.status === "active" &&
      (data.redeemedBy !== null || data.redeemedAt !== null)) ||
    (data.status === "redeemed" &&
      (typeof data.redeemedBy !== "string" ||
        !(data.redeemedAt instanceof Timestamp)))
  ) {
    throw new AccessCodeRedemptionError();
  }
  return data;
}

function isExactRedeemedEnrollment(
  data: DocumentData | undefined,
  uid: string,
  courseId: string,
  accessCodeId: string,
): boolean {
  return Boolean(
    data &&
      exactKeys(data, ENROLLMENT_FIELDS) &&
      data.userId === uid &&
      data.courseId === courseId &&
      data.status === "active" &&
      data.grantedAt instanceof Timestamp &&
      data.expiresAt === null &&
      data.source === "access_code" &&
      data.sourceId === accessCodeId &&
      data.grantedBy === "access-code-service",
  );
}

export async function redeemAccessCodeForUser(
  user: User | null,
  code: unknown,
): Promise<AccessCodeRedemptionResult> {
  if (!user) throw new AccessCodeRedemptionError("Sign in to redeem an Access Code.");

  try {
    const accessCodeId = await deriveAccessCodeId(code);
    return await runTransaction(firebaseDb, async (transaction) => {
      const codeReference = doc(firebaseDb, "accessCodes", accessCodeId);
      const codeSnapshot = await transaction.get(codeReference);
      if (!codeSnapshot.exists()) throw new AccessCodeRedemptionError();
      const accessCode = requireAccessCodeRecord(codeSnapshot.data());
      const courseId = accessCode.courseId as string;
      const enrollmentReference = doc(
        firebaseDb,
        "enrollments",
        getEnrollmentId(user.uid, courseId),
      );
      const enrollmentSnapshot = await transaction.get(enrollmentReference);

      if (
        accessCode.status === "redeemed" &&
        accessCode.redeemedBy === user.uid &&
        isExactRedeemedEnrollment(
          enrollmentSnapshot.data(),
          user.uid,
          courseId,
          accessCodeId,
        )
      ) {
        return {
          success: true,
          courseId,
          enrollmentState: "already-redeemed-by-you",
        };
      }
      if (accessCode.status !== "active" || enrollmentSnapshot.exists()) {
        throw new AccessCodeRedemptionError();
      }

      transaction.update(codeReference, {
        status: "redeemed",
        redeemedBy: user.uid,
        redeemedAt: serverTimestamp(),
      });
      transaction.set(enrollmentReference, {
        userId: user.uid,
        courseId,
        status: "active",
        grantedAt: serverTimestamp(),
        expiresAt: null,
        source: "access_code",
        sourceId: accessCodeId,
        grantedBy: "access-code-service",
      });
      return { success: true, courseId, enrollmentState: "created" };
    });
  } catch (error) {
    if (error instanceof AccessCodeRedemptionError) throw error;
    throw new AccessCodeRedemptionError();
  }
}

export function redeemAccessCode(
  code: unknown,
): Promise<AccessCodeRedemptionResult> {
  return redeemAccessCodeForUser(firebaseAuth.currentUser, code);
}
