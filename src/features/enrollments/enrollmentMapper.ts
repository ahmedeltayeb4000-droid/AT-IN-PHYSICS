import { Timestamp } from "firebase/firestore";
import type {
  Enrollment,
  EnrollmentSource,
  EnrollmentStatus,
} from "./types";

const ENROLLMENT_STATUSES = new Set<EnrollmentStatus>(["active", "revoked"]);
const ENROLLMENT_SOURCES = new Set<EnrollmentSource>([
  "access_code",
  "manual",
  "payment",
]);

function malformed(id: string, field: string): never {
  throw new Error(`Malformed Enrollment "${id}": invalid ${field}.`);
}

function requireRecord(id: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return malformed(id, "document data");
  }
  return value as Record<string, unknown>;
}

function requireString(id: string, field: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return malformed(id, field);
  return value;
}

function requireTimestamp(id: string, field: string, value: unknown): string {
  if (!(value instanceof Timestamp)) return malformed(id, field);
  return value.toDate().toISOString();
}

export function mapEnrollmentDocument(id: string, value: unknown): Enrollment {
  if (!id.trim()) return malformed(id, "document ID");
  const data = requireRecord(id, value);
  const status = data.status;
  const source = data.source;

  if (
    typeof status !== "string" ||
    !ENROLLMENT_STATUSES.has(status as EnrollmentStatus)
  ) {
    return malformed(id, "status");
  }
  if (
    typeof source !== "string" ||
    !ENROLLMENT_SOURCES.has(source as EnrollmentSource)
  ) {
    return malformed(id, "source");
  }

  const expiresAt =
    data.expiresAt === null
      ? null
      : requireTimestamp(id, "expiresAt", data.expiresAt);
  const sourceId = data.sourceId;
  if (sourceId !== undefined && typeof sourceId !== "string") {
    return malformed(id, "sourceId");
  }

  return {
    id,
    userId: requireString(id, "userId", data.userId),
    courseId: requireString(id, "courseId", data.courseId),
    status: status as EnrollmentStatus,
    grantedAt: requireTimestamp(id, "grantedAt", data.grantedAt),
    expiresAt,
    source: source as EnrollmentSource,
    ...(sourceId === undefined ? {} : { sourceId }),
    grantedBy: requireString(id, "grantedBy", data.grantedBy),
  };
}
