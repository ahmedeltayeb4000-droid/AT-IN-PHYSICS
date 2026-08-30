import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { GlassCard } from "../../components/ui/Card";
import { getCourses } from "../../features/courses/courseRepository";

export function AdminOverviewPage() {
  const courses = useQuery({
    queryKey: ["courses", "published"],
    queryFn: getCourses,
  });
  return (
    <section aria-labelledby="admin-overview-title">
      <h2 id="admin-overview-title" className="text-2xl font-bold text-text">
        Overview
      </h2>
      <p className="mt-2 max-w-2xl text-text-muted">
        Use this browser workspace for owner-authorized Course setup and
        inventory. Sensitive publishing and protected-content operations remain
        isolated in Trusted Owner Control on this computer.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <GlassCard className="p-6">
          <p className="text-sm font-semibold text-text-muted">
            Published courses
          </p>
          <p className="mt-2 text-3xl font-bold text-text" aria-live="polite">
            {courses.isPending
              ? "—"
              : courses.isError
                ? "Unavailable"
                : courses.data.length}
          </p>
        </GlassCard>
        <GlassCard className="flex flex-col justify-between p-6">
          <div>
            <h3 className="font-bold text-text">Course Management</h3>
            <p className="mt-2 text-sm text-text-muted">
              Review Courses currently visible through the safe frontend
              repository.
            </p>
          </div>
          <Link
            to="/admin/courses"
            className="mt-5 inline-flex self-start rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white"
          >
            Open Courses
          </Link>
        </GlassCard>
        <GlassCard className="flex flex-col justify-between p-6">
          <div>
            <h3 className="font-bold text-text">Trusted Owner Control</h3>
            <p className="mt-2 text-sm text-text-muted">
              For protected videos and PDFs, Access Codes, review/apply,
              publication, and binding, run START-OWNER-CONTROL.cmd on the
              trusted owner computer, then open the loopback-only console.
            </p>
          </div>
          <a
            href="http://127.0.0.1:4317"
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex self-start rounded-lg border border-accent px-4 py-2 text-sm font-bold text-accent"
          >
            Open Trusted Owner Control
          </a>
        </GlassCard>
      </div>
    </section>
  );
}
