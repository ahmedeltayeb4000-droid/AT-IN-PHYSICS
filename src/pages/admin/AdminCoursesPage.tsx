import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { GlassCard } from "../../components/ui/Card";
import { getAdminCourses } from "../../features/admin/adminCourseRepository";

export function AdminCoursesPage() {
  const courses = useQuery({
    queryKey: ["admin", "courses", "inventory"],
    queryFn: getAdminCourses,
  });
  return (
    <section aria-labelledby="admin-courses-title">
      <h2 id="admin-courses-title" className="text-2xl font-bold text-text">
        Courses
      </h2>
      <p className="mt-2 text-text-muted">
        Read-only owner inventory of draft and published Courses.
      </p>
      <p className="mt-3 rounded-lg border border-border bg-panel/50 p-3 text-sm text-text-muted">
        Course changes remain available only through trusted backend tooling.
      </p>
      {courses.isPending ? (
        <div
          className="mt-8 grid min-h-40 place-items-center text-sm text-text-muted"
          role="status"
        >
          Loading Courses...
        </div>
      ) : courses.isError ? (
        <GlassCard className="mt-8 p-6 text-center" role="alert">
          <h3 className="font-bold text-text">Unable to load Courses</h3>
          <p className="mt-2 text-sm text-text-muted">
            Please try again later.
          </p>
        </GlassCard>
      ) : courses.data.length === 0 ? (
        <GlassCard className="mt-8 p-6 text-center">
          <h3 className="font-bold text-text">No Courses</h3>
          <p className="mt-2 text-sm text-text-muted">
            Draft and published Courses will appear here.
          </p>
        </GlassCard>
      ) : (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {courses.data.map((course) => (
            <GlassCard key={course.id} className="p-6">
              <div className="flex items-start justify-between gap-4">
                <h3 className="text-xl font-bold text-text">{course.title}</h3>
                <Badge
                  tone={course.status === "published" ? "success" : "neutral"}
                >
                  {course.status === "published" ? "Published" : "Draft"}
                </Badge>
              </div>
              <p className="mt-2 font-mono text-xs text-text-muted">
                {course.id} · {course.slug}
              </p>
              <p className="mt-4 text-sm text-text-muted">
                {course.shortDescription}
              </p>
            </GlassCard>
          ))}
        </div>
      )}
    </section>
  );
}
