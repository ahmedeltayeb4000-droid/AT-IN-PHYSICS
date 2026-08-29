import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { PageContainer, Section } from "../../components/layout/Primitives";
import { GlassCard } from "../../components/ui/Card";
import { PageTransition } from "../../components/ui/PageTransition";
import { useAuth } from "../../features/auth/AuthContext";
import {
  getCourseBySlug,
  getSessionDetail,
} from "../../features/courses/courseRepository";
import {
  parseSessionDetailRouteParams,
  SessionDetailUnavailableError,
} from "../../features/courses/sessionDetail";
import { hasCourseEntitlement } from "../../features/enrollments/entitlement";
import type { Enrollment } from "../../features/enrollments/types";
import { useMyEnrollments } from "../../features/enrollments/useMyEnrollments";
import { SessionVideoPlayer } from "../../features/video/SessionVideoPlayer";
import type { VideoWatermarkPolicy } from "../../features/video/watermark";
import { SessionResourceList } from "../../features/resources/SessionResourceList";

function StatusPanel({
  title,
  description,
  backTo,
}: {
  title: string;
  description: string;
  backTo: string;
}) {
  return (
    <PageTransition>
      <Section>
        <PageContainer>
          <GlassCard className="mx-auto max-w-2xl p-8 text-center sm:p-10">
            <h1 className="text-3xl font-bold text-text">{title}</h1>
            <p className="mt-3 text-text-muted">{description}</p>
            <Link
              to={backTo}
              className="mt-7 inline-flex rounded-lg bg-accent px-5 py-3 font-semibold text-white"
            >
              Go back
            </Link>
          </GlassCard>
        </PageContainer>
      </Section>
    </PageTransition>
  );
}

function getUnavailableCopy(error: unknown) {
  if (!(error instanceof SessionDetailUnavailableError)) {
    return {
      title: "Unable to load lesson",
      description: "Please try again later.",
    };
  }

  switch (error.reason) {
    case "module-unavailable":
      return {
        title: "Module unavailable",
        description: "This lesson's module is not available.",
      };
    case "discovery-unavailable":
      return {
        title: "Course content unavailable",
        description: "The available lessons could not be verified.",
      };
    case "session-not-discovered":
      return {
        title: "Lesson unavailable",
        description: "This lesson is not currently available in the course.",
      };
    case "session-unavailable":
      return {
        title: "Lesson unavailable",
        description: "This lesson could not be loaded.",
      };
  }
}

function getUnentitledCopy(
  enrollments: readonly Enrollment[],
  courseId: string,
  evaluatedAt: Date,
) {
  const matching = enrollments.filter(
    (enrollment) => enrollment.courseId === courseId,
  );
  if (matching.length === 0) {
    return {
      title: "Active enrollment required",
      description: "You need an active enrollment to open this lesson.",
    };
  }
  if (matching.length !== 1) {
    return {
      title: "Course access unavailable",
      description: "Your course access could not be verified.",
    };
  }
  if (matching[0].status === "revoked") {
    return {
      title: "Enrollment inactive",
      description: "Your enrollment no longer provides access to this lesson.",
    };
  }
  if (
    matching[0].expiresAt !== null &&
    Date.parse(matching[0].expiresAt) <= evaluatedAt.getTime()
  ) {
    return {
      title: "Enrollment expired",
      description: "Your enrollment has expired.",
    };
  }
  return {
    title: "Course access unavailable",
    description: "Your course access could not be verified.",
  };
}

export function SessionDetailPage() {
  const params = parseSessionDetailRouteParams(useParams());
  const { user, loading: authLoading } = useAuth();
  const protectedWatermark = useMemo<VideoWatermarkPolicy>(
    () =>
      user
        ? {
            mode: "protected",
            viewer: { uid: user.uid, email: user.email },
          }
        : { mode: "none" },
    [user],
  );
  const enrollmentsQuery = useMyEnrollments();
  const [evaluatedAt] = useState(() => new Date());
  const courseQuery = useQuery({
    queryKey: ["courses", "published", "slug", params?.slug],
    queryFn: () => getCourseBySlug(params!.slug),
    enabled: params !== null,
  });
  const enrollmentLoading =
    authLoading || (Boolean(user) && enrollmentsQuery.isPending);
  const enrollmentError = Boolean(user) && enrollmentsQuery.isError;
  const entitled = Boolean(
    courseQuery.data &&
      user &&
      !enrollmentLoading &&
      !enrollmentError &&
      hasCourseEntitlement(
        enrollmentsQuery.data ?? [],
        courseQuery.data.id,
        evaluatedAt,
      ),
  );
  const sessionDetailQuery = useQuery({
    queryKey: [
      "courses",
      courseQuery.data?.id ?? null,
      "modules",
      params?.moduleId,
      "sessions",
      params?.sessionId,
    ],
    queryFn: () =>
      getSessionDetail(
        courseQuery.data!,
        params!.moduleId,
        params!.sessionId,
      ),
    enabled: entitled,
  });
  const courseBackTo = params ? `/courses/${params.slug}` : "/dashboard";

  if (params === null) {
    return (
      <StatusPanel
        title="Lesson unavailable"
        description="This lesson address is invalid."
        backTo="/dashboard"
      />
    );
  }
  if (authLoading) {
    return (
      <StatusPanel
        title="Checking your account"
        description="Please wait while your account is verified."
        backTo="/"
      />
    );
  }
  if (!user) {
    return (
      <StatusPanel
        title="Sign in required"
        description="Sign in to open this lesson."
        backTo="/login"
      />
    );
  }
  if (courseQuery.isPending) {
    return (
      <StatusPanel
        title="Loading course"
        description="Please wait while the course is loaded."
        backTo="/dashboard"
      />
    );
  }
  if (courseQuery.isError) {
    return (
      <StatusPanel
        title="Unable to load course"
        description="Please try again later."
        backTo="/dashboard"
      />
    );
  }
  if (courseQuery.data === null) {
    return (
      <StatusPanel
        title="Course not found"
        description="This published course is not available."
        backTo="/dashboard"
      />
    );
  }
  if (enrollmentLoading) {
    return (
      <StatusPanel
        title="Checking course access"
        description="Please wait while your enrollment is verified."
        backTo={courseBackTo}
      />
    );
  }
  if (enrollmentError) {
    return (
      <StatusPanel
        title="Unable to verify course access"
        description="Please try again later."
        backTo={courseBackTo}
      />
    );
  }
  if (!entitled) {
    const copy = getUnentitledCopy(
      enrollmentsQuery.data ?? [],
      courseQuery.data.id,
      evaluatedAt,
    );
    return (
      <StatusPanel
        title={copy.title}
        description={copy.description}
        backTo={courseBackTo}
      />
    );
  }
  if (sessionDetailQuery.isPending) {
    return (
      <StatusPanel
        title="Loading lesson"
        description="Please wait while the lesson is loaded."
        backTo={courseBackTo}
      />
    );
  }
  if (sessionDetailQuery.isError) {
    const copy = getUnavailableCopy(sessionDetailQuery.error);
    return (
      <StatusPanel
        title={copy.title}
        description={copy.description}
        backTo={courseBackTo}
      />
    );
  }

  const { course, module, session } = sessionDetailQuery.data;
  return (
    <PageTransition>
      <Section>
        <PageContainer>
          <div className="mx-auto max-w-3xl">
            <Link
              to={`/courses/${course.slug}`}
              className="text-sm font-semibold text-accent"
            >
              ← Back to {course.title}
            </Link>
            <GlassCard className="mt-8 p-7 sm:p-8">
              <p className="text-sm font-bold uppercase tracking-[.16em] text-accent">
                {module.title}
              </p>
              <h1 className="mt-4 text-4xl font-bold text-text sm:text-5xl">
                {session.title}
              </h1>
              <p className="mt-3 text-text-muted">{course.title}</p>
              {session.videoAssetId ? (
                <SessionVideoPlayer
                  session={session}
                  watermark={protectedWatermark}
                />
              ) : null}
              <div className="mt-10 rounded-xl border border-white/10 bg-white/[.03] p-6">
                <h2 className="text-xl font-bold text-text">Lesson content</h2>
                {session.lessonText ? (
                  <p className="mt-2 whitespace-pre-wrap text-text-muted">
                    {session.lessonText}
                  </p>
                ) : (
                  <p className="mt-2 text-text-muted">
                    Lesson content is not available yet.
                  </p>
                )}
              </div>
              <SessionResourceList
                courseId={course.id}
                moduleId={module.id}
                sessionId={session.id}
              />
            </GlassCard>
          </div>
        </PageContainer>
      </Section>
    </PageTransition>
  );
}
