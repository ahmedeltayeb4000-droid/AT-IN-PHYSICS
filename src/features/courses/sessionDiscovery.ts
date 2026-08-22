import type { Session } from "./types";

export const SESSION_DISCOVERY_DOCUMENT_ID = "visible";

export type SessionDiscoveryManifest = {
  readonly sessionIds: readonly string[];
};

export function sessionIsStudentVisible(session: Session, now: Date): boolean {
  if (
    session.publicationStatus !== "published" ||
    Number.isNaN(now.getTime())
  ) {
    return false;
  }
  if (session.releaseAt === undefined) return true;

  const releaseAt = Date.parse(session.releaseAt);
  return !Number.isNaN(releaseAt) && releaseAt <= now.getTime();
}

export function buildSessionDiscoveryManifest(
  sessions: readonly Session[],
  courseId: string,
  moduleId: string,
  now: Date,
): SessionDiscoveryManifest {
  const visibleSessions = sessions
    .filter(
      (session) =>
        session.courseId === courseId &&
        session.moduleId === moduleId &&
        sessionIsStudentVisible(session, now),
    )
    .sort((left, right) => {
      const order = left.order - right.order;
      return order || left.id.localeCompare(right.id, "en");
    });
  const sessionIds = visibleSessions.map((session) => session.id);

  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error("Session discovery contains duplicate Session IDs.");
  }

  return { sessionIds };
}

export function mapSessionDiscoveryManifest(
  value: unknown,
): SessionDiscoveryManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Malformed Session discovery manifest.");
  }

  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== 1 ||
    !Array.isArray(data.sessionIds) ||
    data.sessionIds.some(
      (sessionId) =>
        typeof sessionId !== "string" ||
        !sessionId.trim() ||
        sessionId !== sessionId.trim() ||
        sessionId.includes("/"),
    )
  ) {
    throw new Error("Malformed Session discovery manifest.");
  }

  const sessionIds = data.sessionIds as string[];
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error("Malformed Session discovery manifest.");
  }

  return { sessionIds: [...sessionIds] };
}
