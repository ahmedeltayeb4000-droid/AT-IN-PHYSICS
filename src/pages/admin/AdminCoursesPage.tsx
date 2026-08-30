import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { GlassCard } from "../../components/ui/Card";
import { Input, Select } from "../../components/ui/FormControls";
import {
  AdminCourseCreationError,
  createAdminCourse,
} from "../../features/admin/adminCourseCreation";
import { buildAdminCourseDraft } from "../../features/admin/adminCourseCreationValidation";
import {
  AdminCourseInventoryError,
  getAdminCourses,
} from "../../features/admin/adminCourseRepository";
import {
  AdminModuleCreationError,
  createAdminModule,
} from "../../features/admin/adminModuleCreation";
import { buildAdminModuleCreation } from "../../features/admin/adminModuleCreationValidation";
import {
  AdminModuleInventoryError,
  getAdminModules,
} from "../../features/admin/adminModuleRepository";
import {
  AdminSessionInventoryError,
  getAdminSessions,
} from "../../features/admin/adminSessionRepository";
import {
  AdminSessionCreationError,
  createAdminSession,
} from "../../features/admin/adminSessionCreation";
import { buildAdminSessionCreation } from "../../features/admin/adminSessionCreationValidation";

export function AdminCoursesPage() {
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"courseId" | "title" | "shortDescription", string>>
  >({});
  const [moduleCourseId, setModuleCourseId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleOrder, setModuleOrder] = useState("0");
  const [moduleSuccess, setModuleSuccess] = useState(false);
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionOrder, setSessionOrder] = useState("0");
  const [sessionSuccess, setSessionSuccess] = useState(false);
  const [sessionFieldErrors, setSessionFieldErrors] = useState<
    Partial<
      Record<"courseId" | "moduleId" | "sessionId" | "title" | "order", string>
    >
  >({});
  const [moduleFieldErrors, setModuleFieldErrors] = useState<
    Partial<Record<"courseId" | "moduleId" | "title" | "order", string>>
  >({});
  const courses = useQuery({
    queryKey: ["admin", "courses", "inventory"],
    queryFn: getAdminCourses,
  });
  const modules = useQuery({
    queryKey: ["admin", "courses", moduleCourseId, "modules", "inventory"],
    queryFn: () => getAdminModules(moduleCourseId),
    enabled: moduleCourseId !== "",
  });
  const sessions = useQuery({
    queryKey: [
      "admin",
      "courses",
      moduleCourseId,
      "modules",
      selectedModuleId,
      "sessions",
      "inventory",
    ],
    queryFn: () => getAdminSessions(moduleCourseId, selectedModuleId),
    enabled: moduleCourseId !== "" && selectedModuleId !== "",
  });
  const sessionCreation = useMutation({
    mutationFn: createAdminSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [
          "admin",
          "courses",
          moduleCourseId,
          "modules",
          selectedModuleId,
          "sessions",
          "inventory",
        ],
      });
      setSessionId("");
      setSessionTitle("");
      setSessionOrder("0");
      setSessionSuccess(true);
    },
  });
  const submitSession = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sessionCreation.isPending) return;
    setSessionSuccess(false);
    setSessionFieldErrors({});
    try {
      buildAdminSessionCreation({
        courseId: moduleCourseId,
        moduleId: selectedModuleId,
        sessionId,
        title: sessionTitle,
        order: sessionOrder,
      });
    } catch (cause) {
      if (
        cause instanceof AdminSessionCreationError &&
        cause.code === "validation" &&
        cause.field
      ) {
        setSessionFieldErrors({
          [cause.field]:
            cause.field === "order"
              ? "Enter a nonnegative whole number."
              : cause.field === "title"
                ? "Enter valid text without surrounding whitespace or control characters."
                : "Select the Course and Module and use a canonical Session ID.",
        });
        return;
      }
    }
    sessionCreation.mutate({
      courseId: moduleCourseId,
      moduleId: selectedModuleId,
      sessionId,
      title: sessionTitle,
      order: sessionOrder,
    });
  };
  const sessionCreationErrorMessage = sessionCreation.isError
    ? sessionCreation.error instanceof AdminSessionCreationError
      ? {
          conflict:
            "A Session with this ID already exists in the selected Module.",
          validation: "Check the Session ID, title, and order.",
          unauthorized: "Owner authorization is required to create a Session.",
          service: "Unable to create the Session. Please try again.",
        }[sessionCreation.error.code]
      : "Unable to create the Session. Please try again."
    : null;
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
  const moduleCreation = useMutation({
    mutationFn: createAdminModule,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["admin", "courses", moduleCourseId, "modules", "inventory"],
      });
      setModuleId("");
      setModuleTitle("");
      setModuleOrder("0");
      setModuleSuccess(true);
    },
  });
  const submitModule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (moduleCreation.isPending) return;
    setModuleSuccess(false);
    setModuleFieldErrors({});
    try {
      buildAdminModuleCreation({
        courseId: moduleCourseId,
        moduleId,
        title: moduleTitle,
        order: moduleOrder,
      });
    } catch (cause) {
      if (
        cause instanceof AdminModuleCreationError &&
        cause.code === "validation" &&
        cause.field
      ) {
        setModuleFieldErrors({
          [cause.field]:
            cause.field === "order"
              ? "Enter a nonnegative whole number."
              : cause.field === "title"
                ? "Enter valid text without surrounding whitespace or control characters."
                : "Select a Course and use a canonical Module ID.",
        });
        return;
      }
    }
    moduleCreation.mutate({
      courseId: moduleCourseId,
      moduleId,
      title: moduleTitle,
      order: moduleOrder,
    });
  };
  const moduleErrorMessage = moduleCreation.isError
    ? moduleCreation.error instanceof AdminModuleCreationError
      ? {
          conflict:
            "A Module with this ID already exists in the selected Course.",
          validation: "Check the Course, Module ID, title, and order.",
          unauthorized: "Owner authorization is required to create a Module.",
          service: "Unable to create the Module. Please try again.",
        }[moduleCreation.error.code]
      : "Unable to create the Module. Please try again."
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
      <GlassCard className="mt-6 p-6">
        <h3 className="text-lg font-bold text-text">Create Module</h3>
        <p className="mt-1 text-sm text-text-muted">
          Add a Module beneath an existing Course. This does not create
          Sessions.
        </p>
        <form className="mt-5 grid gap-4" onSubmit={submitModule} noValidate>
          <Select
            label="Course"
            value={moduleCourseId}
            onChange={(event) => {
              setModuleCourseId(event.target.value);
              setSelectedModuleId("");
              setSessionId("");
              setSessionTitle("");
              setSessionOrder("0");
              setSessionSuccess(false);
              setSessionFieldErrors({});
            }}
            disabled={moduleCreation.isPending || courses.isPending}
            error={moduleFieldErrors.courseId}
            required
          >
            <option value="">Select a Course</option>
            {courses.data?.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title} ({course.id})
              </option>
            ))}
          </Select>
          <Input
            label="Module ID"
            value={moduleId}
            onChange={(event) => setModuleId(event.target.value)}
            disabled={moduleCreation.isPending}
            error={moduleFieldErrors.moduleId}
            required
            maxLength={128}
            autoComplete="off"
          />
          <Input
            label="Module Title"
            value={moduleTitle}
            onChange={(event) => setModuleTitle(event.target.value)}
            disabled={moduleCreation.isPending}
            error={moduleFieldErrors.title}
            required
          />
          <Input
            label="Order"
            value={moduleOrder}
            onChange={(event) => setModuleOrder(event.target.value)}
            disabled={moduleCreation.isPending}
            error={moduleFieldErrors.order}
            required
            inputMode="numeric"
          />
          <div>
            <Button type="submit" isLoading={moduleCreation.isPending}>
              {moduleCreation.isPending
                ? "Creating Module..."
                : "Create Module"}
            </Button>
          </div>
        </form>
        {moduleErrorMessage ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {moduleErrorMessage}
          </p>
        ) : null}
        {moduleSuccess ? (
          <p className="mt-4 text-sm text-success" role="status">
            Module created successfully.
          </p>
        ) : null}
      </GlassCard>
      <GlassCard className="mt-6 p-6">
        <h3 className="text-lg font-bold text-text">Modules</h3>
        {!moduleCourseId ? (
          <p className="mt-3 text-sm text-text-muted">
            Select a Course above to view its Modules.
          </p>
        ) : modules.isPending ? (
          <p className="mt-3 text-sm text-text-muted" role="status">
            Loading Modules...
          </p>
        ) : modules.isError ? (
          <div className="mt-3" role="alert">
            <p className="font-bold text-text">Unable to load Modules</p>
            <p className="mt-1 text-sm text-text-muted">
              {modules.error instanceof AdminModuleInventoryError &&
              modules.error.code === "unauthorized"
                ? "Owner authorization is required to view Modules."
                : modules.error instanceof AdminModuleInventoryError &&
                    modules.error.code === "malformed"
                  ? "Module inventory data is malformed."
                  : "The Module inventory service is unavailable. Please try again."}
            </p>
          </div>
        ) : modules.data.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No Modules</p>
        ) : (
          <ul className="mt-4 grid gap-3" aria-label="Module inventory">
            {modules.data.map((module) => (
              <li
                key={module.id}
                className="rounded-lg border border-border bg-panel/50 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <h4 className="font-bold text-text">{module.title}</h4>
                  <span className="text-sm text-text-muted">
                    Order {module.order}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs text-text-muted">
                  {module.id}
                </p>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
      <GlassCard className="mt-6 p-6">
        <h3 className="text-lg font-bold text-text">Sessions</h3>
        {!moduleCourseId ? (
          <p className="mt-3 text-sm text-text-muted">
            Select a Course before viewing Sessions.
          </p>
        ) : modules.isPending ? (
          <p className="mt-3 text-sm text-text-muted" role="status">
            Loading Modules...
          </p>
        ) : modules.isError ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            Modules must be available before Sessions can be loaded.
          </p>
        ) : (
          <Select
            label="Module"
            value={selectedModuleId}
            onChange={(event) => {
              setSelectedModuleId(event.target.value);
              setSessionId("");
              setSessionTitle("");
              setSessionOrder("0");
              setSessionSuccess(false);
              setSessionFieldErrors({});
            }}
          >
            <option value="">Select a Module</option>
            {modules.data.map((module) => (
              <option key={module.id} value={module.id}>
                {module.title} ({module.id})
              </option>
            ))}
          </Select>
        )}
        {moduleCourseId && selectedModuleId ? (
          <form className="mt-5 grid gap-4" onSubmit={submitSession} noValidate>
            <h4 className="font-bold text-text">Create Session</h4>
            <p className="text-sm text-text-muted">
              New Sessions are created as drafts without lesson or video
              content.
            </p>
            <Input
              label="Session ID"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              disabled={sessionCreation.isPending}
              error={sessionFieldErrors.sessionId}
              required
              maxLength={128}
              autoComplete="off"
            />
            <Input
              label="Session Title"
              value={sessionTitle}
              onChange={(event) => setSessionTitle(event.target.value)}
              disabled={sessionCreation.isPending}
              error={sessionFieldErrors.title}
              required
            />
            <Input
              label="Session Order"
              value={sessionOrder}
              onChange={(event) => setSessionOrder(event.target.value)}
              disabled={sessionCreation.isPending}
              error={sessionFieldErrors.order}
              required
              inputMode="numeric"
            />
            <div>
              <Button type="submit" isLoading={sessionCreation.isPending}>
                {sessionCreation.isPending
                  ? "Creating Session..."
                  : "Create Session"}
              </Button>
            </div>
            {sessionCreationErrorMessage ? (
              <p className="text-sm text-danger" role="alert">
                {sessionCreationErrorMessage}
              </p>
            ) : null}
            {sessionSuccess ? (
              <p className="text-sm text-success" role="status">
                Session created successfully as a draft.
              </p>
            ) : null}
          </form>
        ) : null}
        {moduleCourseId && !selectedModuleId ? (
          <p className="mt-3 text-sm text-text-muted">
            Select a Module to view its Sessions.
          </p>
        ) : !selectedModuleId ? null : sessions.isPending ? (
          <p className="mt-3 text-sm text-text-muted" role="status">
            Loading Sessions...
          </p>
        ) : sessions.isError ? (
          <div className="mt-3" role="alert">
            <p className="font-bold text-text">Unable to load Sessions</p>
            <p className="mt-1 text-sm text-text-muted">
              {sessions.error instanceof AdminSessionInventoryError &&
              sessions.error.code === "unauthorized"
                ? "Owner authorization is required to view Sessions."
                : sessions.error instanceof AdminSessionInventoryError &&
                    sessions.error.code === "malformed"
                  ? "Session inventory data is malformed."
                  : "The Session inventory service is unavailable. Please try again."}
            </p>
          </div>
        ) : selectedModuleId && sessions.data.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">No Sessions</p>
        ) : selectedModuleId ? (
          <ul className="mt-4 grid gap-3" aria-label="Session inventory">
            {sessions.data.map((session) => (
              <li
                key={session.id}
                className="rounded-lg border border-border bg-panel/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-bold text-text">{session.title}</h4>
                    <p className="mt-1 font-mono text-xs text-text-muted">
                      {session.id}
                    </p>
                  </div>
                  <Badge
                    tone={
                      session.publicationStatus === "published"
                        ? "success"
                        : "neutral"
                    }
                  >
                    {session.publicationStatus === "published"
                      ? "Published"
                      : "Draft"}
                  </Badge>
                </div>
                <p className="mt-3 text-sm text-text-muted">
                  Order {session.order} · Lesson{" "}
                  {session.hasLessonText ? "Yes" : "No"} · Video{" "}
                  {session.hasVideo ? "Yes" : "No"}
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  Release: {session.releaseAt ?? "Immediate when published"}
                </p>
              </li>
            ))}
          </ul>
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
            {courses.error instanceof AdminCourseInventoryError
              ? {
                  unauthenticated: "Sign in again to refresh owner authorization.",
                  unauthorized: "The current account is not authorized to read the owner Course inventory.",
                  unavailable: "The Course inventory service is temporarily unavailable.",
                  malformed: "Course inventory data does not match the trusted schema.",
                  unknown: "The Course inventory failed for an unknown reason.",
                }[courses.error.code]
              : "The Course inventory failed for an unknown reason."}
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
