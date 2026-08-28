import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageContainer, Section } from "../../components/layout/Primitives";
import { Badge } from "../../components/ui/Badge";
import { GlassCard } from "../../components/ui/Card";
import { getCourses } from "../../features/courses/courseRepository";
import {
  buildDashboardEnrollmentRows,
  type DashboardEnrollmentState,
} from "../../features/enrollments/dashboardEnrollmentViewModel";
import { useMyEnrollments } from "../../features/enrollments/useMyEnrollments";
import { AccessCodeActivationCard } from "../../features/accessCodes/AccessCodeActivationCard";

const enrollmentStatePresentation: Record<
  DashboardEnrollmentState,
  {
    readonly label: string;
    readonly message: string;
    readonly tone: "success" | "warning" | "danger" | "neutral";
  }
> = {
  active: {
    label: "Active",
    message: "Your enrollment currently grants access.",
    tone: "success",
  },
  revoked: {
    label: "Revoked",
    message: "This enrollment no longer grants access.",
    tone: "danger",
  },
  expired: {
    label: "Expired",
    message: "This enrollment has expired and no longer grants access.",
    tone: "warning",
  },
  "course-unavailable": {
    label: "Course unavailable",
    message:
      "Published course information is not available for this enrollment.",
    tone: "neutral",
  },
  "entitlement-unavailable": {
    label: "Enrollment unavailable",
    message: "This enrollment cannot currently grant course access.",
    tone: "warning",
  },
};

export function DashboardPage() {
  const enrollmentsQuery = useMyEnrollments();
  const coursesQuery = useQuery({
    queryKey: ["courses", "published"],
    queryFn: getCourses,
  });
  const [evaluatedAt] = useState(() => new Date());

  const isLoading = enrollmentsQuery.isPending || coursesQuery.isPending;
  const isError = enrollmentsQuery.isError || coursesQuery.isError;
  const rows =
    !isLoading && !isError
      ? buildDashboardEnrollmentRows(
          enrollmentsQuery.data,
          coursesQuery.data,
          evaluatedAt,
        )
      : [];

  return (
    <Section className="py-10">
      <PageContainer>
        <h1 className="text-3xl font-bold text-text">Dashboard</h1>
        <p className="mt-2 text-text-muted">
          Your course enrollments and access status.
        </p>

        <AccessCodeActivationCard />

        {isLoading ? (
          <div
            className="mt-8 grid min-h-40 place-items-center text-sm text-text-muted"
            role="status"
          >
            {enrollmentsQuery.isPending && coursesQuery.isPending
              ? "Loading enrollments and course details..."
              : enrollmentsQuery.isPending
                ? "Loading enrollments..."
                : "Loading course details..."}
          </div>
        ) : isError ? (
          <GlassCard className="mt-8 p-6 text-center" role="alert">
            <h2 className="font-bold text-text">
              Unable to load your enrolled courses.
            </h2>
            <p className="mt-2 text-sm text-text-muted">
              Please try again later.
            </p>
          </GlassCard>
        ) : rows.length === 0 ? (
          <GlassCard className="mt-8 p-6 text-center">
            <h2 className="font-bold text-text">No enrollments yet</h2>
            <p className="mt-2 text-sm text-text-muted">
              Your enrolled courses will appear here.
            </p>
          </GlassCard>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {rows.map(({ enrollment, course, state }) => {
              const presentation = enrollmentStatePresentation[state];

              return (
                <GlassCard key={enrollment.id} className="flex flex-col p-6">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-xl font-bold text-text">
                      {course?.title ?? "Course unavailable"}
                    </h2>
                    <Badge tone={presentation.tone}>{presentation.label}</Badge>
                  </div>
                  {course ? (
                    <p className="mt-3 text-sm text-text-muted">
                      {course.shortDescription}
                    </p>
                  ) : null}
                  <p className="mt-4 text-sm text-text-muted">
                    {presentation.message}
                  </p>
                  {state === "active" && course ? (
                    <Link
                      to={`/courses/${course.slug}`}
                      className="mt-6 inline-flex justify-center rounded-lg bg-accent px-4 py-2 font-bold text-white"
                    >
                      View course details
                    </Link>
                  ) : null}
                </GlassCard>
              );
            })}
          </div>
        )}
      </PageContainer>
    </Section>
  );
}
