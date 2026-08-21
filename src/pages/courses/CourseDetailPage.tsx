import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { PageContainer, Section } from "../../components/layout/Primitives";
import { GlassCard } from "../../components/ui/Card";
import { PageTransition } from "../../components/ui/PageTransition";
import { getCourseBySlug } from "../../features/courses/courseRepository";

export function CourseDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const {
    data: course,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["courses", "published", "slug", slug],
    queryFn: () => getCourseBySlug(slug!),
    enabled: Boolean(slug),
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
              <p className="mt-3 leading-7 text-text-muted">
                Curriculum and lessons for this course will be added in a later
                development sprint.
              </p>
            </GlassCard>
          </div>
        </PageContainer>
      </Section>
    </PageTransition>
  );
}
