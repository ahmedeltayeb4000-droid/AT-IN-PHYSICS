import type { Course } from "../courses/types";
import { hasCourseEntitlement } from "./entitlement.ts";
import type { Enrollment } from "./types";

export type DashboardEnrollmentState =
  | "active"
  | "revoked"
  | "expired"
  | "course-unavailable"
  | "entitlement-unavailable";

export type DashboardEnrollmentRow = {
  readonly enrollment: Enrollment;
  readonly course: Course | null;
  readonly state: DashboardEnrollmentState;
};

export function buildDashboardEnrollmentRows(
  enrollments: readonly Enrollment[],
  publishedCourses: readonly Course[],
  now: Date,
): DashboardEnrollmentRow[] {
  const coursesById = new Map(
    publishedCourses
      .filter((course) => course.status === "published")
      .map((course) => [course.id, course]),
  );
  const enrollmentCounts = new Map<string, number>();

  for (const enrollment of enrollments) {
    enrollmentCounts.set(
      enrollment.courseId,
      (enrollmentCounts.get(enrollment.courseId) ?? 0) + 1,
    );
  }

  return enrollments.map((enrollment) => {
    const course = coursesById.get(enrollment.courseId) ?? null;

    if (!course) {
      return { enrollment, course, state: "course-unavailable" };
    }

    if (enrollment.status === "revoked") {
      return { enrollment, course, state: "revoked" };
    }

    if (enrollmentCounts.get(enrollment.courseId) !== 1) {
      return { enrollment, course, state: "entitlement-unavailable" };
    }

    return {
      enrollment,
      course,
      state: hasCourseEntitlement(enrollments, course.id, now)
        ? "active"
        : "expired",
    };
  });
}
