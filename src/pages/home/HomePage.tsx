import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { PhysicsBackground } from "../../components/brand/PhysicsBackground";
import { PageContainer, Section } from "../../components/layout/Primitives";
import { Badge } from "../../components/ui/Badge";
import { Card, GlassCard } from "../../components/ui/Card";
import { PageTransition } from "../../components/ui/PageTransition";

const features = [
  ["◉", "Video Courses", "Structured lessons that make every concept clear."],
  ["▤", "PDF Notes", "Concise references designed for revision."],
  ["◌", "Live Classes", "Learn in real time with expert guidance."],
  ["↗", "One to One", "Personal support when you need it most."],
  ["?", "Question Bank", "Practice across every level and topic."],
  ["✓", "Exams", "Measure progress with focused assessments."],
  ["★", "Certificates", "Celebrate completed learning milestones."],
  ["⌂", "Parent Dashboard", "A clear view of learner progress."],
  ["⚙", "Teacher Dashboard", "Tools for organized teaching."],
  ["◈", "Admin Dashboard", "A unified platform foundation."],
];
const testimonials = [
  {
    quote:
      "The explanations finally made physics feel intuitive, not intimidating.",
    name: "Mariam A.",
    role: "Secondary student",
  },
  {
    quote: "A polished learning space that keeps every resource in one place.",
    name: "Youssef M.",
    role: "University student",
  },
  {
    quote: "The right balance of clarity, practice, and expert support.",
    name: "Nour H.",
    role: "International curriculum student",
  },
];
const faqs = [
  [
    "Who is A.T IN PHYSICS for?",
    "For school and university learners, as well as anyone seeking professional physics instruction.",
  ],
  [
    "What learning formats are available?",
    "The platform foundation supports video lessons, notes, live learning, personal support, practice, and assessments.",
  ],
  [
    "Can I learn in Arabic or English?",
    "Yes. The design system is prepared for Arabic RTL and English LTR experiences.",
  ],
  [
    "Which curricula are supported?",
    "School physics, university physics, international curricula, and professional physics courses are all represented in the platform direction.",
  ],
];
const categories = ["Schools", "Universities", "Physics Courses"];
const stats = [
  ["10K+", "Students"],
  ["120+", "Courses"],
  ["1.8K+", "Lessons"],
  ["2K+", "Certificates"],
];

export function HomePage() {
  const [testimonial, setTestimonial] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  return (
    <PageTransition>
      <section className="relative isolate overflow-hidden">
        <PhysicsBackground />
        <PageContainer className="relative flex min-h-[calc(100vh-4rem)] items-center py-20 sm:py-28">
          <div className="max-w-3xl">
            <Badge tone="info">PHYSICIST | AHMED ELTAYEB</Badge>
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mt-6 font-display text-5xl font-bold leading-[1.06] tracking-tight text-text sm:text-7xl"
            >
              Physics, <span className="text-accent">explained</span> for the
              way you learn.
            </motion.h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-text-muted">
              A.T IN PHYSICS brings clear teaching, purposeful practice, and
              modern learning tools together in one exceptional physics
              experience.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                to="/register"
                className="rounded-xl bg-accent px-6 py-3.5 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-strong"
              >
                Start Learning
              </Link>
              <Link
                to="/login"
                className="rounded-xl border border-border bg-panel/60 px-6 py-3.5 font-semibold text-text transition hover:bg-panel"
              >
                Login
              </Link>
            </div>
            <p className="mt-7 text-sm text-text-subtle">
              School · University · International Curriculum · Professional
              Courses
            </p>
          </div>
        </PageContainer>
      </section>
      <Section id="about" className="border-y border-border bg-panel/40">
        <PageContainer>
          <div className="grid gap-10 lg:grid-cols-[.85fr_1.15fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[.2em] text-accent">
                About the platform
              </p>
              <h2 className="mt-4 font-display text-3xl font-bold text-text sm:text-4xl">
                Built around the ideas that move the universe.
              </h2>
            </div>
            <p className="text-lg leading-8 text-text-muted">
              From first principles to advanced problem solving, A.T IN PHYSICS
              gives every learner a deliberate path through physics—with
              teaching that connects theory, mathematics, and real-world
              intuition.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              "School Physics",
              "University Physics",
              "International Curriculum",
              "Professional Physics Courses",
            ].map((item, index) => (
              <motion.div
                key={item}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.06 }}
              >
                <GlassCard className="flex items-center gap-3 py-4">
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 font-bold text-accent">
                    {index + 1}
                  </span>
                  <span className="font-semibold text-text">{item}</span>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </PageContainer>
      </Section>
      <Section id="features">
        <PageContainer>
          <div className="max-w-2xl">
            <p className="text-sm font-bold uppercase tracking-[.2em] text-accent">
              Platform features
            </p>
            <h2 className="mt-4 font-display text-3xl font-bold text-text sm:text-4xl">
              Everything your physics learning needs.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {features.map(([symbol, title, description], index) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.04 }}
                whileHover={{ y: -5 }}
              >
                <Card className="h-full p-5">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-lg font-bold text-accent">
                    {symbol}
                  </span>
                  <h3 className="mt-5 font-display font-bold text-text">
                    {title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-text-muted">
                    {description}
                  </p>
                </Card>
              </motion.div>
            ))}
          </div>
        </PageContainer>
      </Section>
      <Section className="bg-panel/40">
        <PageContainer>
          <p className="text-center text-sm font-bold uppercase tracking-[.2em] text-accent">
            Learning categories
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {categories.map((category, index) => (
              <motion.article
                key={category}
                whileHover={{ scale: 1.02 }}
                className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-panel to-navy p-7"
              >
                <span className="text-6xl font-display font-bold text-accent/20">
                  0{index + 1}
                </span>
                <h3 className="relative -mt-6 font-display text-2xl font-bold text-text">
                  {category}
                </h3>
                <p className="mt-2 text-sm text-text-muted">
                  A focused, structured route for every stage of learning.
                </p>
              </motion.article>
            ))}
          </div>
        </PageContainer>
      </Section>
      <Section>
        <PageContainer>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map(([value, label], index) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="rounded-2xl border border-border bg-panel p-6 text-center"
              >
                <p className="font-display text-3xl font-bold text-accent sm:text-4xl">
                  {value}
                </p>
                <p className="mt-2 text-sm text-text-muted">{label}</p>
              </motion.div>
            ))}
          </div>
        </PageContainer>
      </Section>
      <Section className="overflow-hidden bg-panel/40">
        <PageContainer>
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-bold uppercase tracking-[.2em] text-accent">
              Learner stories
            </p>
            <h2 className="mt-4 font-display text-3xl font-bold text-text">
              A better way to meet physics.
            </h2>
            <div className="relative mt-9 min-h-56">
              <AnimatePresence mode="wait">
                <motion.figure
                  key={testimonial}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-2xl border border-border bg-panel p-8 shadow-xl"
                >
                  <blockquote className="text-xl leading-8 text-text">
                    “{testimonials[testimonial].quote}”
                  </blockquote>
                  <figcaption className="mt-6">
                    <p className="font-bold text-text">
                      {testimonials[testimonial].name}
                    </p>
                    <p className="text-sm text-text-muted">
                      {testimonials[testimonial].role}
                    </p>
                  </figcaption>
                </motion.figure>
              </AnimatePresence>
            </div>
            <div className="mt-5 flex justify-center gap-2">
              {testimonials.map((item, index) => (
                <button
                  key={item.name}
                  aria-label={"Show testimonial " + (index + 1)}
                  onClick={() => setTestimonial(index)}
                  className={
                    "h-2.5 rounded-full transition " +
                    (testimonial === index
                      ? "w-7 bg-accent"
                      : "w-2.5 bg-border")
                  }
                />
              ))}
            </div>
          </div>
        </PageContainer>
      </Section>
      <Section id="faq">
        <PageContainer className="max-w-4xl">
          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-[.2em] text-accent">
              FAQ
            </p>
            <h2 className="mt-4 font-display text-3xl font-bold text-text">
              Answers, without the friction.
            </h2>
          </div>
          <div className="mt-10 space-y-3">
            {faqs.map(([question, answer], index) => (
              <Card key={question} className="p-0">
                <button
                  className="flex w-full items-center justify-between gap-6 p-5 text-left font-semibold text-text"
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  aria-expanded={openFaq === index}
                >
                  <span>{question}</span>
                  <span className="text-accent">
                    {openFaq === index ? "−" : "+"}
                  </span>
                </button>
                <AnimatePresence>
                  {openFaq === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 leading-7 text-text-muted">
                        {answer}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            ))}
          </div>
        </PageContainer>
      </Section>
      <Section
        id="contact"
        className="relative overflow-hidden bg-gradient-to-br from-accent/15 to-transparent"
      >
        <PageContainer>
          <Card className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[1.1fr_.9fr]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[.2em] text-accent">
                Contact
              </p>
              <h2 className="mt-4 font-display text-3xl font-bold text-text">
                Let’s make physics clearer.
              </h2>
              <p className="mt-4 max-w-xl leading-7 text-text-muted">
                Reach out for platform questions, learning guidance, and updates
                from A.T IN PHYSICS.
              </p>
            </div>
            <div className="grid gap-3 text-sm">
              <a
                className="rounded-xl border border-border p-4 text-text-muted hover:bg-panel-hover"
                href="mailto:hello@atinphysics.com"
              >
                <strong className="block text-text">Email</strong>
                hello@atinphysics.com
              </a>
              <a
                className="rounded-xl border border-border p-4 text-text-muted hover:bg-panel-hover"
                href="https://wa.me/201000000000"
              >
                <strong className="block text-text">WhatsApp</strong>Message the
                A.T IN PHYSICS team
              </a>
              <a
                className="rounded-xl border border-border p-4 text-text-muted hover:bg-panel-hover"
                href="https://facebook.com"
              >
                <strong className="block text-text">Facebook</strong>Follow our
                community
              </a>
              <div className="rounded-xl border border-border p-4 text-text-muted">
                <strong className="block text-text">Location</strong>Cairo,
                Egypt
              </div>
            </div>
          </Card>
        </PageContainer>
      </Section>
    </PageTransition>
  );
}
