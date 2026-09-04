const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SESSION_DISCOVERY_DOCUMENT_ID = "visible";
export const FREE_SESSION_DISCOVERY_DOCUMENT_ID = "free";

export type TrustedSessionRecord = {
  readonly id: string;
  readonly order: unknown;
  readonly publicationStatus: unknown;
  readonly isFree?: unknown;
  readonly releaseAt?: Date | null;
  readonly closeAt?: Date | null;
  readonly title?: unknown;
};

export type SessionDiscoveryManifest = {
  readonly sessionIds: readonly string[];
};

export type FreeSessionDiscoveryItem = {
  readonly id: string;
  readonly title: string;
  readonly order: number;
};

export type FreeSessionDiscoveryManifest = {
  readonly sessions: readonly FreeSessionDiscoveryItem[];
};

export type SessionDiscoveryRefreshInput = {
  readonly courseId: string;
  readonly moduleId: string;
};

function validateContentId(field: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !CONTENT_ID_PATTERN.test(value)
  ) {
    throw new Error(
      `${field} must contain lowercase letters, numbers, and single hyphens only.`,
    );
  }
  return value;
}

export function parseSessionDiscoveryRefreshInput(
  value: unknown,
): SessionDiscoveryRefreshInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Session discovery refresh input must be an object.");
  }

  const input = value as Record<string, unknown>;
  const fields = Object.keys(input);
  if (
    fields.length !== 2 ||
    !fields.includes("courseId") ||
    !fields.includes("moduleId")
  ) {
    throw new Error("Session discovery refresh input fields are invalid.");
  }

  return {
    courseId: validateContentId("courseId", input.courseId),
    moduleId: validateContentId("moduleId", input.moduleId),
  };
}

export function sessionIsStudentVisible(
  session: TrustedSessionRecord,
  trustedNow: Date,
): boolean {
  if (
    session.publicationStatus !== "published" ||
    Number.isNaN(trustedNow.getTime())
  ) {
    return false;
  }
  let releaseAt: number | null = null;
  if ("releaseAt" in session) {
    if (!(session.releaseAt instanceof Date)) return false;
    releaseAt = session.releaseAt.getTime();
    if (Number.isNaN(releaseAt) || releaseAt > trustedNow.getTime())
      return false;
  }
  if (!("closeAt" in session)) return true;
  if (!(session.closeAt instanceof Date)) return false;
  const closeAt = session.closeAt.getTime();
  return (
    !Number.isNaN(closeAt) &&
    (releaseAt === null || releaseAt < closeAt) &&
    trustedNow.getTime() < closeAt
  );
}

export function buildSessionDiscoveryManifest(
  sessions: readonly TrustedSessionRecord[],
  trustedNow: Date,
): SessionDiscoveryManifest {
  if (Number.isNaN(trustedNow.getTime())) {
    throw new Error("Trusted Session discovery time is invalid.");
  }

  const validatedSessions = sessions.map((session) => {
    const id = validateContentId("sessionId", session.id);
    if (
      typeof session.order !== "number" ||
      !Number.isSafeInteger(session.order) ||
      session.order < 0
    ) {
      throw new Error(`Session ${id} has an invalid order.`);
    }
    return { ...session, id, order: session.order };
  });
  const allIds = validatedSessions.map((session) => session.id);
  if (new Set(allIds).size !== allIds.length) {
    throw new Error("Session discovery contains duplicate Session IDs.");
  }

  return {
    sessionIds: validatedSessions
      .filter((session) => sessionIsStudentVisible(session, trustedNow))
      .sort((left, right) => {
        const order = left.order - right.order;
        return order || left.id.localeCompare(right.id, "en");
      })
      .map((session) => session.id),
  };
}

export function sessionIsPublicFree(
  session: TrustedSessionRecord,
  trustedNow: Date,
): boolean {
  return (
    session.isFree === true && sessionIsStudentVisible(session, trustedNow)
  );
}

export function buildFreeSessionDiscoveryManifest(
  sessions: readonly TrustedSessionRecord[],
  trustedNow: Date,
): FreeSessionDiscoveryManifest {
  const visible = buildSessionDiscoveryManifest(
    sessions,
    trustedNow,
  ).sessionIds;
  return {
    sessions: sessions
      .filter(
        (session) => visible.includes(session.id) && session.isFree === true,
      )
      .map((session) => {
        const id = validateContentId("sessionId", session.id);
        if (typeof session.title !== "string" || !session.title.trim()) {
          throw new Error(`Session ${id} has an invalid title.`);
        }
        return { id, title: session.title, order: session.order as number };
      })
      .sort(
        (left, right) =>
          left.order - right.order || left.id.localeCompare(right.id, "en"),
      ),
  };
}

export function freeSessionDiscoveryManifestsEqual(
  value: unknown,
  expected: FreeSessionDiscoveryManifest,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 1 || !Array.isArray(data.sessions))
    return false;
  return (
    data.sessions.length === expected.sessions.length &&
    data.sessions.every((item, index) => {
      if (typeof item !== "object" || item === null || Array.isArray(item))
        return false;
      const record = item as Record<string, unknown>;
      const expectedItem = expected.sessions[index];
      return (
        Object.keys(record).length === 3 &&
        record.id === expectedItem?.id &&
        record.title === expectedItem.title &&
        record.order === expectedItem.order
      );
    })
  );
}

export function sessionDiscoveryManifestsEqual(
  value: unknown,
  expected: SessionDiscoveryManifest,
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 1 || !Array.isArray(data.sessionIds)) {
    return false;
  }
  return (
    data.sessionIds.length === expected.sessionIds.length &&
    data.sessionIds.every(
      (sessionId, index) => sessionId === expected.sessionIds[index],
    )
  );
}

export function validateSessionDiscoveryManifest(
  value: unknown,
): SessionDiscoveryManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Existing Session discovery manifest is malformed.");
  }
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 1 || !Array.isArray(data.sessionIds)) {
    throw new Error("Existing Session discovery manifest is malformed.");
  }
  let sessionIds: string[];
  try {
    sessionIds = data.sessionIds.map((id) =>
      validateContentId("sessionId", id),
    );
  } catch (cause) {
    throw new Error("Existing Session discovery manifest is malformed.", {
      cause,
    });
  }
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error("Existing Session discovery manifest is malformed.");
  }
  return { sessionIds };
}
