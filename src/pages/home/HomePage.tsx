import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageContainer, Section } from "../../components/layout/Primitives";
import { PageTransition } from "../../components/ui/PageTransition";
import { Badge } from "../../components/ui/Badge";
import { GlassCard } from "../../components/ui/Card";
import { PhysicsBackground } from "../../components/brand/PhysicsBackground";
import {
  getCourses,
  getPublicFreeSessionsForCourses,
} from "../../features/courses/courseRepository";
import { buildSessionDetailPath } from "../../features/courses/sessionDetail";

export function HomePage() {
  const { t } = useTranslation();
  const {
    data: courses,
    isPending: coursesPending,
    isError: coursesError,
  } = useQuery({
    queryKey: ["courses", "published"],
    queryFn: getCourses,
  });
  const openedSessions = useQuery({
    queryKey: ["opened-sessions", courses?.map((course) => course.id) ?? []],
    queryFn: () => getPublicFreeSessionsForCourses(courses!),
    enabled: Boolean(courses),
  });
  const features =
    (t("features.items", { returnObjects: true }) as string[]) || [];
  const faqs =
    (t("faq.items", { returnObjects: true }) as { q: string; a: string }[]) ||
    [];

  return (
    <PageTransition>
      <section className="relative isolate overflow-hidden">
        <PhysicsBackground />
        <PageContainer className="relative py-28">
          <Badge tone="info">PHYSICIST | AHMED ELTAYEB</Badge>
          <h1 className="mt-6 text-7xl font-bold text-text">
            {t("hero.title")}
          </h1>
          <p className="mt-6 text-lg text-text-muted">{t("hero.subtitle")}</p>
        </PageContainer>
      </section>

      <Section className="py-10 border-b border-border">
        <PageContainer>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { label: "Learn with clarity", value: "Concept-first" },
              { label: "Study at your pace", value: "Flexible access" },
              { label: "Watch with confidence", value: "Protected playback" },
              { label: "Build real understanding", value: "Focused practice" },
            ].map((item) => (
              <div key={item.value} className="text-center">
                <div className="text-xl font-bold text-accent">
                  {item.value}
                </div>
                <div className="text-sm text-text-muted mt-1 uppercase tracking-wider">
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </PageContainer>
      </Section>

      <Section className="py-16">
        <PageContainer>
          <h2 className="mb-12 text-center text-4xl font-bold text-text">
            {t("courses.title")}
          </h2>
          {coursesPending ? (
            <div
              className="grid min-h-40 place-items-center text-sm text-text-muted"
              role="status"
            >
              Loading courses...
            </div>
          ) : coursesError ? (
            <div
              className="grid min-h-40 place-items-center text-sm text-danger"
              role="alert"
            >
              Unable to load courses right now. Please try again later.
            </div>
          ) : courses.length === 0 ? (
            <div className="grid min-h-40 place-items-center text-sm text-text-muted">
              No courses are available right now.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {courses.map((course) => (
                <GlassCard key={course.id} className="p-6 flex flex-col">
                  <div className="h-40 bg-accent/10 rounded-lg mb-4 flex items-center justify-center text-accent font-bold">
                    {course.title}
                  </div>
                  <h3 className="text-xl font-bold text-text mb-2">
                    {course.title}
                  </h3>
                  <p className="text-text-muted text-sm mb-4">
                    {course.shortDescription}
                  </p>
                  <Link
                    to={`/courses/${course.slug}`}
                    className="mt-auto w-full py-2 bg-accent text-white rounded-lg font-bold text-center"
                  >
                    View Course
                  </Link>
                </GlassCard>
              ))}
            </div>
          )}
        </PageContainer>
      </Section>

      <Section className="bg-panel/40">
        <PageContainer>
          <div className="mx-auto max-w-3xl text-center">
            <Badge tone="info">PUBLIC SAMPLE LESSONS</Badge>
            <h2 className="mt-5 text-4xl font-bold text-text">
              Opened Sessions
            </h2>
            <p className="mt-3 text-text-muted">
              Explore selected lessons without enrollment or an Access Code.
            </p>
          </div>
          {openedSessions.isPending ? (
            <div
              className="grid min-h-40 place-items-center text-sm text-text-muted"
              role="status"
            >
              Loading opened sessions...
            </div>
          ) : openedSessions.isError ? (
            <div
              className="grid min-h-40 place-items-center text-sm text-text-muted"
              role="alert"
            >
              Opened Sessions are currently unavailable.
            </div>
          ) : openedSessions.data.length === 0 ? (
            <div className="grid min-h-40 place-items-center text-sm text-text-muted">
              No Opened Sessions are available yet.
            </div>
          ) : (
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {openedSessions.data.map((session) => (
                <GlassCard
                  key={`${session.course.id}/${session.module.id}/${session.id}`}
                  className="flex flex-col p-6"
                >
                  <Badge tone="info">OPENED</Badge>
                  <h3 className="mt-4 text-xl font-bold text-text">
                    {session.title}
                  </h3>
                  <p className="mt-2 text-sm text-text-muted">
                    {session.course.title} · {session.module.title}
                  </p>
                  <Link
                    to={buildSessionDetailPath(
                      session.course.slug,
                      session.module.id,
                      session.id,
                    )!}
                    className="mt-6 inline-flex self-start rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
                  >
                    Open Session
                  </Link>
                </GlassCard>
              ))}
            </div>
          )}
        </PageContainer>
      </Section>

      <Section className="bg-panel/40">
        <PageContainer>
          <h2 className="mb-12 text-center text-4xl font-bold text-text">
            {t("features.title")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((item, i) => (
              <GlassCard key={i} className="p-6">
                <div className="text-accent font-bold text-2xl mb-3">
                  0{i + 1}
                </div>
                <p className="font-semibold text-text">{item}</p>
              </GlassCard>
            ))}
          </div>
        </PageContainer>
      </Section>

      <Section>
        <PageContainer>
          <h2 className="mb-10 text-3xl font-bold text-text text-center">
            {t("faq.title")}
          </h2>
          <div className="max-w-2xl mx-auto space-y-4">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className="border border-border p-5 rounded-xl bg-panel"
              >
                <h3 className="font-bold text-text">{faq.q}</h3>
                <p className="mt-2 text-text-muted text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </PageContainer>
      </Section>

      <footer className="border-t border-border py-8 bg-panel">
        <PageContainer>
          <div className="text-center">
            <p className="text-text-muted text-sm">{t("footer.rights")}</p>
            <div className="mt-2 flex justify-center gap-4 text-sm font-bold text-accent">
              <Link to="/terms">Terms</Link>
              <Link to="/privacy">Privacy</Link>
            </div>
          </div>
        </PageContainer>
      </footer>
    </PageTransition>
  );
}
