import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { PageContainer, Section } from "../../components/layout/Primitives";
import { GlassCard } from "../../components/ui/Card";
import { PageTransition } from "../../components/ui/PageTransition";
import { useAuth } from "../../features/auth/AuthContext";
import {
  getCourseBySlug,
  getCourseCurriculum,
} from "../../features/courses/courseRepository";
import { buildSessionDetailPath } from "../../features/courses/sessionDetail";
import { hasCourseEntitlement } from "../../features/enrollments/entitlement";
import { useMyEnrollments } from "../../features/enrollments/useMyEnrollments";

export function CourseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user, loading: authLoading } = useAuth();
  const enrollmentsQuery = useMyEnrollments();
  const [evaluatedAt] = useState(() => new Date());
  const {
    data: course,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["courses", "published", "slug", slug],
    queryFn: () => getCourseBySlug(slug!),
    enabled: Boolean(slug),
  });
  const enrollmentLoading = authLoading || (Boolean(user) && enrollmentsQuery.isPending);
  const enrollmentError = Boolean(user) && enrollmentsQuery.isError;
  const entitled = Boolean(
    course &&
      user &&
      !enrollmentLoading &&
      !enrollmentError &&
      hasCourseEntitlement(
        enrollmentsQuery.data ?? [],
        course.id,
        evaluatedAt,
      ),
  );
  const curriculumQuery = useQuery({
    queryKey: ["courses", course?.id ?? null, "curriculum"],
    queryFn: () => getCourseCurriculum(course!.id),
    enabled: entitled,
  });

  if (slug && isPending) {
    return (
      <PageTransition>
        <Section>
          <PageContainer>
            <div className="grid min-h-64 place-items-center text-sm text-text-muted" role="status">
              Loading course...
            </div>
          </PageContainer>
        </Section>
      </PageTransition>
    );
  }

  if (slug && isError) {
    return (
      <PageTransition>
        <Section>
          <PageContainer>
            <GlassCard className="mx-auto max-w-2xl p-8 text-center sm:p-10">
              <h1 className="text-3xl font-bold text-text">
                Unable to load this course.
              </h1>
              <p className="mt-3 text-text-muted">
                Please try again later.
              </p>
              <Link
                to="/"
                className="mt-7 inline-flex rounded-lg bg-accent px-5 py-3 font-semibold text-white"
              >
                Back to course catalog
              </Link>
            </GlassCard>
          </PageContainer>
        </Section>
      </PageTransition>
    );
  }

  if (!course) {
    return (
      <PageTransition>
        <Section>
          <PageContainer>
            <GlassCard className="mx-auto max-w-2xl p-8 text-center sm:p-10">
              <p className="text-sm font-bold uppercase tracking-[.2em] text-accent">
                Course not found
              </p>
              <h1 className="mt-4 text-3xl font-bold text-text">
                We could not find that course.
              </h1>
              <p className="mt-3 text-text-muted">
                The course link may be incorrect or no longer available.
              </p>
              <Link
                to="/"
                className="mt-7 inline-flex rounded-lg bg-accent px-5 py-3 font-semibold text-white"
              >
                Back to course catalog
              </Link>
            </GlassCard>
          </PageContainer>
        </Section>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <Section>
        <PageContainer>
          <div className="mx-auto max-w-3xl">
            <Link to="/" className="text-sm font-semibold text-accent">
              ← Back to course catalog
            </Link>
            <h1 className="mt-6 text-4xl font-bold text-text sm:text-5xl">
              {course.title}
            </h1>
            <p className="mt-5 text-lg leading-8 text-text-muted">
              {course.shortDescription}
            </p>

            <GlassCard className="mt-10 p-7 sm:p-8">
              <h2 className="text-2xl font-bold text-text">Course curriculum</h2>
              {enrollmentLoading ? (
                <p className="mt-4 text-sm text-text-muted" role="status">
                  Checking course access...
                </p>
              ) : !user ? (
                <div className="mt-4">
                  <p className="leading-7 text-text-muted">
                    Sign in to view curriculum for courses you are enrolled in.
                  </p>
                  <Link
                    to="/login"
                    className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2 font-semibold text-white"
                  >
                    Sign in
                  </Link>
                </div>
              ) : enrollmentError ? (
                <div className="mt-4" role="alert">
                  <p className="font-semibold text-text">
                    Course access is currently unavailable.
                  </p>
                  <p className="mt-2 text-sm text-text-muted">
                    Please try again later.
                  </p>
                </div>
              ) : !entitled ? (
                <div className="mt-4">
                  <p className="font-semibold text-text">
                    Active enrollment required
                  </p>
                  <p className="mt-2 text-sm text-text-muted">
                    This curriculum is available only with an active enrollment.
                  </p>
                </div>
              ) : curriculumQuery.isPending ? (
                <p className="mt-4 text-sm text-text-muted" role="status">
                  Loading curriculum...
                </p>
              ) : curriculumQuery.isError ? (
                <div className="mt-4" role="alert">
                  <p className="font-semibold text-text">
                    Course curriculum is currently unavailable.
                  </p>
                  <p className="mt-2 text-sm text-text-muted">
                    Please try again later.
                  </p>
                </div>
              ) : curriculumQuery.data.length === 0 ? (
                <p className="mt-4 leading-7 text-text-muted">
                  No curriculum is available yet.
                </p>
              ) : (
                <div className="mt-6 space-y-5">
                  {curriculumQuery.data.map(({ module, sessions }) => (
                    <section
                      key={module.id}
                      className="rounded-xl border border-white/10 bg-white/[.03] p-5"
                    >
                      <h3 className="text-lg font-bold text-text">
                        {module.title}
                      </h3>
                      {sessions.length === 0 ? (
                        <p className="mt-3 text-sm text-text-muted">
                          No sessions are currently available.
                        </p>
                      ) : (
                        <ol className="mt-4 space-y-3">
                          {sessions.map((session, index) => {
                            const sessionPath = buildSessionDetailPath(
                              course.slug,
                              module.id,
                              session.id,
                            );
                            return (
                              <li
                                key={session.id}
                                className="rounded-lg border border-white/10 px-4 py-3"
                              >
                                <p className="text-xs font-bold uppercase tracking-[.16em] text-accent">
                                  Session {index + 1}
                                </p>
                                {sessionPath ? (
                                  <Link
                                    to={sessionPath}
                                    className="mt-1 inline-flex font-semibold text-text hover:text-accent"
                                  >
                                    {session.title}
                                  </Link>
                                ) : (
                                  <p className="mt-1 font-semibold text-text">
                                    {session.title}
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>
        </PageContainer>
      </Section>
    </PageTransition>
  );
}
