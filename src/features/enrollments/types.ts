export type EnrollmentStatus = "active" | "revoked";

export type EnrollmentSource = "access_code" | "manual" | "payment";

export type Enrollment = {
  readonly id: string;
  readonly userId: string;
  readonly courseId: string;
  readonly status: EnrollmentStatus;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly source: EnrollmentSource;
  readonly sourceId?: string;
  readonly grantedBy: string;
};

export function getEnrollmentId(userId: string, courseId: string): string {
  if (!userId.trim() || !courseId.trim()) {
    throw new RangeError("Enrollment userId and courseId must not be empty.");
  }

  return `${userId}_${courseId}`;
}
