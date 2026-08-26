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
        Monitor the currently readable course catalog. Administrative mutations
        remain available only through trusted backend tooling.
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
      </div>
    </section>
  );
}
