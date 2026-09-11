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
        <PageContainer className="relative flex min-h-[580px] flex-col items-center justify-center py-20 text-center sm:min-h-[680px] sm:py-28">
          <p className="at-kicker">Mastering the laws of the universe with ease</p>
          <h1 className="mt-6 bg-gradient-to-b from-cyan-light to-accent bg-clip-text text-5xl font-black tracking-[-.05em] text-transparent drop-shadow-[0_0_24px_rgba(37,199,255,.38)] sm:text-7xl lg:text-8xl">
            {t("hero.title")}
          </h1>
          <p className="mt-5 text-2xl font-black uppercase tracking-[.03em] text-text sm:text-4xl lg:text-5xl">PHYSICIST / AHMED ELTAYEB</p>
          <p className="mt-6 max-w-2xl text-base leading-7 text-text-muted sm:text-lg">{t("hero.subtitle")}</p>
          <a href="#courses" className="at-link-button mt-9">Explore Courses</a>
        </PageContainer>
      </section>

      <Section className="border-y border-border py-10">
        <PageContainer>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Learn with clarity", value: "Concept-first" },
              { label: "Study at your pace", value: "Flexible access" },
              { label: "Watch with confidence", value: "Protected playback" },
              { label: "Build real understanding", value: "Focused practice" },
            ].map((item) => (
              <div key={item.value} className="rounded-2xl border border-accent/45 bg-panel/90 p-6 text-center shadow-[0_0_22px_rgba(37,199,255,.1)]">
                <div aria-hidden="true" className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full border border-accent/35 text-2xl text-accent">⌁</div>
                <div className="text-lg font-bold text-text">
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

      <Section id="courses" className="py-16">
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
                <GlassCard key={course.id} className="flex min-w-0 flex-col p-6">
                  <div className="mb-5 flex h-40 items-center justify-center rounded-xl border border-accent/20 bg-[radial-gradient(circle,rgba(37,199,255,.14),transparent_65%)] px-4 text-center font-bold text-accent">
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
                    className="at-link-button mt-auto w-full"
                  >
                    View Course
                  </Link>
                </GlassCard>
              ))}
            </div>
          )}
        </PageContainer>
      </Section>

      <Section className="border-y border-border bg-panel/20">
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
                    className="at-link-button mt-6 self-start text-sm"
                  >
                    Open Session
                  </Link>
                </GlassCard>
              ))}
            </div>
          )}
        </PageContainer>
      </Section>

      <Section className="bg-panel/20">
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
                className="rounded-xl border border-border bg-panel/70 p-5 transition hover:border-accent/40"
              >
                <h3 className="font-bold text-text">{faq.q}</h3>
                <p className="mt-2 text-text-muted text-sm">{faq.a}</p>
              </div>
            ))}
          </div>
        </PageContainer>
      </Section>

    </PageTransition>
  );
}
