export const SESSION_DISCOVERY_DOCUMENT_ID = "visible";
export const FREE_SESSION_DISCOVERY_DOCUMENT_ID = "free";

export type SessionDiscoveryManifest = {
  readonly sessionIds: readonly string[];
};

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

export type FreeSessionDiscoveryItem = {
  readonly id: string;
  readonly title: string;
  readonly order: number;
};

export function mapFreeSessionDiscoveryManifest(
  value: unknown,
): readonly FreeSessionDiscoveryItem[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Malformed Free Session discovery manifest.");
  }
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 1 || !Array.isArray(data.sessions)) {
    throw new Error("Malformed Free Session discovery manifest.");
  }
  const sessions = data.sessions.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Malformed Free Session discovery manifest.");
    }
    const item = value as Record<string, unknown>;
    if (
      Object.keys(item).length !== 3 ||
      typeof item.id !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      typeof item.order !== "number" ||
      !Number.isSafeInteger(item.order) ||
      item.order < 0
    ) {
      throw new Error("Malformed Free Session discovery manifest.");
    }
    return { id: item.id, title: item.title, order: item.order };
  });
  if (new Set(sessions.map((item) => item.id)).size !== sessions.length) {
    throw new Error("Malformed Free Session discovery manifest.");
  }
  return sessions;
}
