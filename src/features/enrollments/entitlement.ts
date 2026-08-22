import type { Enrollment } from "./types";

export function enrollmentGrantsAccess(
  enrollment: Enrollment,
  now: Date,
): boolean {
  if (enrollment.status !== "active" || Number.isNaN(now.getTime())) {
    return false;
  }
  if (enrollment.expiresAt === null) return true;

  const expiresAt = Date.parse(enrollment.expiresAt);
  return !Number.isNaN(expiresAt) && expiresAt > now.getTime();
}

export function hasCourseEntitlement(
  enrollments: readonly Enrollment[],
  courseId: string,
  now: Date,
): boolean {
  const matching = enrollments.filter(
    (enrollment) => enrollment.courseId === courseId,
  );
  return (
    matching.length === 1 && enrollmentGrantsAccess(matching[0], now)
  );
}
