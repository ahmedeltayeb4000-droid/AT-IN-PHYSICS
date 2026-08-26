const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SESSION_DISCOVERY_DOCUMENT_ID = "visible";

export type TrustedSessionRecord = {
  readonly id: string;
  readonly order: unknown;
  readonly publicationStatus: unknown;
  readonly releaseAt?: Date | null;
};

export type SessionDiscoveryManifest = {
  readonly sessionIds: readonly string[];
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
  if (!("releaseAt" in session)) return true;
  if (!(session.releaseAt instanceof Date)) return false;

  const releaseAt = session.releaseAt.getTime();
  return !Number.isNaN(releaseAt) && releaseAt <= trustedNow.getTime();
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
