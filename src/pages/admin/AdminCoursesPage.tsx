import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { GlassCard } from "../../components/ui/Card";
import { Input } from "../../components/ui/FormControls";
import {
  AdminCourseCreationError,
  createAdminCourse,
} from "../../features/admin/adminCourseCreation";
import { buildAdminCourseDraft } from "../../features/admin/adminCourseCreationValidation";
import { getAdminCourses } from "../../features/admin/adminCourseRepository";

export function AdminCoursesPage() {
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"courseId" | "title" | "shortDescription", string>>
  >({});
  const courses = useQuery({
    queryKey: ["admin", "courses", "inventory"],
    queryFn: getAdminCourses,
  });
  const creation = useMutation({
    mutationFn: createAdminCourse,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "courses", "inventory"],
      });
      setCourseId("");
      setTitle("");
      setShortDescription("");
      setSuccess(true);
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creation.isPending) return;
    setSuccess(false);
    setFieldErrors({});
    try {
      buildAdminCourseDraft({ courseId, title, shortDescription });
    } catch (cause) {
      if (
        cause instanceof AdminCourseCreationError &&
        cause.code === "validation" &&
        cause.field
      ) {
        setFieldErrors({
          [cause.field]:
            cause.field === "courseId"
              ? "Use lowercase letters, numbers, and single hyphens only."
              : "Enter valid text without surrounding whitespace or control characters.",
        });
        return;
      }
    }
    creation.mutate({ courseId, title, shortDescription });
  };
  const errorMessage = creation.isError
    ? creation.error instanceof AdminCourseCreationError
      ? {
          conflict: "A Course with this ID already exists.",
          validation: "Check the Course ID, title, and short description.",
          unauthorized: "Owner authorization is required to create a Course.",
          service: "Unable to create the Course. Please try again.",
        }[creation.error.code]
      : "Unable to create the Course. Please try again."
    : null;
  return (
    <section aria-labelledby="admin-courses-title">
      <h2 id="admin-courses-title" className="text-2xl font-bold text-text">
        Courses
      </h2>
      <p className="mt-2 text-text-muted">
        Read-only owner inventory of draft and published Courses.
      </p>
      <p className="mt-3 rounded-lg border border-border bg-panel/50 p-3 text-sm text-text-muted">
        Editing, publication, and deletion remain available only through trusted
        backend tooling.
      </p>
      <GlassCard className="mt-6 p-6">
        <h3 className="text-lg font-bold text-text">Create Course</h3>
        <p className="mt-1 text-sm text-text-muted">
          New Courses are always created as drafts.
        </p>
        <form className="mt-5 grid gap-4" onSubmit={submit} noValidate>
          <Input
            label="Course ID"
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            disabled={creation.isPending}
            error={fieldErrors.courseId}
            required
            maxLength={128}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            autoComplete="off"
          />
          <Input
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={creation.isPending}
            error={fieldErrors.title}
            required
          />
          <Input
            label="Short Description"
            value={shortDescription}
            onChange={(event) => setShortDescription(event.target.value)}
            disabled={creation.isPending}
            error={fieldErrors.shortDescription}
            required
          />
          <div>
            <Button type="submit" isLoading={creation.isPending}>
              {creation.isPending ? "Creating Course..." : "Create Course"}
            </Button>
          </div>
        </form>
        {errorMessage ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {success ? (
          <p className="mt-4 text-sm text-success" role="status">
            Course created as a draft.
          </p>
        ) : null}
      </GlassCard>
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
