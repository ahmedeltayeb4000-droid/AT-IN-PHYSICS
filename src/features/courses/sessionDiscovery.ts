export const SESSION_DISCOVERY_DOCUMENT_ID = "visible";

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
