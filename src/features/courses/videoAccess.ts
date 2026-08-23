import { isValidVideoAssetId } from "./sessionMapper.ts";

export const VIDEO_ACCESS_DOCUMENT_ID = "primary";

const CONTENT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type VideoAccess = {
  readonly videoAssetId: string;
  readonly contentKey: string;
};

function unavailableVideoAccess(): never {
  throw new Error("Video access is unavailable.");
}

export function isValidContentKey(value: unknown): value is string {
  if (typeof value !== "string" || !CONTENT_KEY_PATTERN.test(value)) {
    return false;
  }

  try {
    const padded = `${value.replace(/-/g, "+").replace(/_/g, "/")}=`;
    const decoded = atob(padded);
    const canonical = btoa(decoded)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    return decoded.length === 32 && canonical === value;
  } catch {
    return false;
  }
}

export function mapVideoAccessDocument(
  documentId: string,
  expectedVideoAssetId: string,
  value: unknown,
): VideoAccess {
  if (
    documentId !== VIDEO_ACCESS_DOCUMENT_ID ||
    !isValidVideoAssetId(expectedVideoAssetId) ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return unavailableVideoAccess();
  }

  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== 2 ||
    data.videoAssetId !== expectedVideoAssetId ||
    !isValidVideoAssetId(data.videoAssetId) ||
    !isValidContentKey(data.contentKey)
  ) {
    return unavailableVideoAccess();
  }

  return {
    videoAssetId: data.videoAssetId,
    contentKey: data.contentKey,
  };
}
