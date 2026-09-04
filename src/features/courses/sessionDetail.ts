import type { Course, Module, Session } from "./types";
import { isValidLessonText, isValidVideoAssetId } from "./sessionMapper.ts";

const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CONTENT_ID_LENGTH = 128;

export interface SessionDetailRouteParams {
  readonly slug: string;
  readonly moduleId: string;
  readonly sessionId: string;
}

export interface SessionDetail {
  readonly course: Course;
  readonly module: Module;
  readonly session: Session;
}

export type SessionDetailUnavailableReason =
  | "module-unavailable"
  | "discovery-unavailable"
  | "session-not-discovered"
  | "session-unavailable";

export class SessionDetailUnavailableError extends Error {
  readonly reason: SessionDetailUnavailableReason;

  constructor(reason: SessionDetailUnavailableReason, options?: ErrorOptions) {
    super("Session detail is unavailable.", options);
    this.name = "SessionDetailUnavailableError";
    this.reason = reason;
  }
}

function isValidContentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_CONTENT_ID_LENGTH &&
    CONTENT_ID_PATTERN.test(value)
  );
}

function isValidSession(session: Session): boolean {
  return (
    isValidContentId(session.id) &&
    isValidContentId(session.courseId) &&
    isValidContentId(session.moduleId) &&
    session.title.trim().length > 0 &&
    Number.isSafeInteger(session.order) &&
    session.order >= 0 &&
    (session.publicationStatus === "draft" ||
      session.publicationStatus === "published") &&
    (session.isFree === undefined || typeof session.isFree === "boolean") &&
    (session.releaseAt === undefined ||
      (session.releaseAt.length > 0 &&
        Number.isFinite(Date.parse(session.releaseAt)))) &&
    (session.closeAt === undefined ||
      (session.closeAt.length > 0 &&
        Number.isFinite(Date.parse(session.closeAt)))) &&
    (session.releaseAt === undefined ||
      session.closeAt === undefined ||
      Date.parse(session.releaseAt) < Date.parse(session.closeAt)) &&
    (session.lessonText === undefined ||
      isValidLessonText(session.lessonText)) &&
    (session.videoAssetId === undefined ||
      isValidVideoAssetId(session.videoAssetId))
  );
}

export function parseSessionDetailRouteParams(params: {
  readonly slug?: string;
  readonly moduleId?: string;
  readonly sessionId?: string;
}): SessionDetailRouteParams | null {
  if (
    !isValidContentId(params.slug) ||
    !isValidContentId(params.moduleId) ||
    !isValidContentId(params.sessionId)
  ) {
    return null;
  }

  return {
    slug: params.slug,
    moduleId: params.moduleId,
    sessionId: params.sessionId,
  };
}

export function buildSessionDetailPath(
  slug: string,
  moduleId: string,
  sessionId: string,
): string | null {
  const params = parseSessionDetailRouteParams({ slug, moduleId, sessionId });

  return params
    ? `/courses/${params.slug}/modules/${params.moduleId}/sessions/${params.sessionId}`
    : null;
}

export function composeSessionDetail(
  course: Course,
  module: Module,
  discoveredSessionIds: readonly string[],
  requestedSessionId: string,
  session: Session | null,
): SessionDetail {
  if (module.courseId !== course.id) {
    throw new SessionDetailUnavailableError("module-unavailable");
  }

  if (!discoveredSessionIds.includes(requestedSessionId)) {
    throw new SessionDetailUnavailableError("session-not-discovered");
  }

  if (
    session === null ||
    !isValidSession(session) ||
    session.id !== requestedSessionId ||
    session.courseId !== course.id ||
    session.moduleId !== module.id
  ) {
    throw new SessionDetailUnavailableError("session-unavailable");
  }

  return { course, module, session };
}
