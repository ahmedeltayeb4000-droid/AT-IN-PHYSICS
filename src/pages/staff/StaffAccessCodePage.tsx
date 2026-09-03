import { useEffect, useState } from "react";
import { PageContainer } from "../../components/layout/Primitives";
import { useAuth } from "../../features/auth/AuthContext";
import { getCourses } from "../../features/courses/courseRepository";
import type { Course } from "../../features/courses/types";
import { createStaffAccessCode } from "../../features/staff/staffAccessCodeCreation";

export function StaffAccessCodePage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let active = true;
    getCourses()
      .then((items) => active && setCourses(items))
      .catch(
        () => active && setMessage("Published Courses could not be loaded."),
      );
    return () => {
      active = false;
      setCode(null);
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !courseId) return;
    setPending(true);
    setCode(null);
    setMessage("");
    try {
      const plaintext = await createStaffAccessCode(
        courseId,
        expiresAt ? new Date(expiresAt).toISOString() : null,
      );
      setCode(plaintext);
      setMessage(
        "Access Code generated. Copy it now; it cannot be recovered later.",
      );
    } catch {
      setMessage(
        "Access Code generation failed. Verify your authorization and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <PageContainer className="py-10">
      <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-panel p-6 shadow-sm sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
          A.T IN PHYSICS · Staff workspace
        </p>
        <h1 className="mt-2 text-3xl font-bold">Access Code generation</h1>
        <p className="mt-2 text-sm text-text-muted">
          Signed in as {user?.email ?? "Authenticated Staff"}
        </p>
        <form className="mt-8 grid gap-5" onSubmit={submit}>
          <label className="grid gap-2 text-sm font-semibold">
            Published Course
            <select
              className="rounded-lg border border-border bg-canvas p-3"
              value={courseId}
              onChange={(event) => {
                setCourseId(event.target.value);
                setCode(null);
              }}
              required
            >
              <option value="">Select Course</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Expiration (optional)
            <input
              className="rounded-lg border border-border bg-canvas p-3"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => {
                setExpiresAt(event.target.value);
                setCode(null);
              }}
            />
          </label>
          <button
            className="rounded-lg bg-accent px-5 py-3 font-bold text-white disabled:opacity-60"
            disabled={pending || !courseId}
          >
            {pending ? "Generating..." : "Generate Access Code"}
          </button>
        </form>
        <p className="mt-5 text-sm" role="status">
          {message}
        </p>
        {code && (
          <div className="mt-5 rounded-xl border border-border bg-canvas p-4">
            <p className="text-sm font-bold">One-time Access Code</p>
            <code className="mt-2 block break-all text-lg">{code}</code>
            <button
              type="button"
              className="mt-4 rounded-lg border border-border px-4 py-2 font-semibold"
              onClick={() =>
                navigator.clipboard
                  .writeText(code)
                  .catch(() =>
                    setMessage(
                      "Copy failed. The Access Code remains visible for manual copying.",
                    ),
                  )
              }
            >
              Copy
            </button>
          </div>
        )}
        <p className="mt-6 text-xs text-text-muted">
          The plaintext is displayed only once and cannot be recovered. Signing
          out or leaving this page clears it.
        </p>
      </div>
    </PageContainer>
  );
}
