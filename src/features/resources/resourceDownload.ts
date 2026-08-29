import {
  PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE,
  validateProtectedResourceMetadata,
  validateProtectedResourcePair,
  validateProtectedResourcePlaintext,
  type ProtectedResourceAccess,
  type ProtectedResourceMetadata,
  type ProtectedResourceScope,
} from "../../../functions/src/protectedResources/format.ts";
import { decryptAtr1Artifact, parseAtr1Artifact } from "./atr1.ts";
import { getSessionResourceAccess } from "./resourceRepository.ts";

const MAX_CIPHERTEXT_SIZE = PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE + 32;

export type ResourceDownloadStage =
  | "access"
  | "downloading"
  | "preparing";

export type ResourceDownloadDependencies = Readonly<{
  getAccess: (
    courseId: string,
    moduleId: string,
    sessionId: string,
    resourceId: string,
  ) => Promise<ProtectedResourceAccess>;
  fetcher: typeof fetch;
  decrypt: typeof decryptAtr1Artifact;
  digest: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  origin: string;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  createAnchor: () => HTMLAnchorElement;
  appendAnchor: (anchor: HTMLAnchorElement) => void;
}>;

function unavailable(): never {
  throw new Error("Protected resource is unavailable.");
}

function browserDependencies(): ResourceDownloadDependencies {
  return {
    getAccess: getSessionResourceAccess,
    fetcher: fetch,
    decrypt: decryptAtr1Artifact,
    digest: (bytes) => crypto.subtle.digest("SHA-256", bytes),
    origin: window.location.origin,
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    appendAnchor: (anchor) => document.body.append(anchor),
  };
}

function exactResourceUrl(route: string, originValue: string): URL {
  let origin: URL;
  let url: URL;
  try {
    origin = new URL(originValue);
    url = new URL(route, origin);
  } catch {
    return unavailable();
  }
  if (
    origin.protocol !== "http:" &&
    origin.protocol !== "https:"
  ) return unavailable();
  if (
    !route.startsWith("/protected-resources/") ||
    !route.endsWith(".atr1") ||
    url.origin !== origin.origin ||
    url.pathname !== route ||
    url.search !== "" ||
    url.hash !== ""
  ) return unavailable();
  return url;
}

function canonicalLength(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return unavailable();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return unavailable();
  return parsed;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchVerifiedCiphertext(
  metadata: ProtectedResourceMetadata,
  dependencies: ResourceDownloadDependencies,
): Promise<ArrayBuffer> {
  if (
    metadata.ciphertextSize <= 32 ||
    metadata.ciphertextSize > MAX_CIPHERTEXT_SIZE
  ) return unavailable();
  const expectedUrl = exactResourceUrl(
    metadata.ciphertextRoute,
    dependencies.origin,
  );
  let response: Response;
  try {
    response = await dependencies.fetcher(metadata.ciphertextRoute, {
      method: "GET",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/octet-stream" },
    });
  } catch {
    return unavailable();
  }
  if (!response.ok) return unavailable();
  if (response.url) {
    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      return unavailable();
    }
    if (
      finalUrl.origin !== expectedUrl.origin ||
      finalUrl.pathname !== expectedUrl.pathname ||
      finalUrl.search !== "" ||
      finalUrl.hash !== ""
    ) return unavailable();
  }
  if (response.headers.get("content-type") !== "application/octet-stream")
    return unavailable();
  if (
    response.headers.get("x-content-type-options")?.toLowerCase() !==
    "nosniff"
  ) return unavailable();
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    canonicalLength(declaredLength) !== metadata.ciphertextSize
  ) return unavailable();
  if (!response.body) return unavailable();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > metadata.ciphertextSize) {
        await reader.cancel();
        return unavailable();
      }
      chunks.push(value);
    }
  } catch {
    return unavailable();
  }
  if (received !== metadata.ciphertextSize) return unavailable();
  const artifact = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    artifact.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let digest: ArrayBuffer;
  try {
    parseAtr1Artifact(artifact.buffer);
    digest = await dependencies.digest(artifact.buffer);
  } catch {
    return unavailable();
  }
  if (toHex(digest) !== metadata.ciphertextSha256) return unavailable();
  return artifact.buffer;
}

export async function downloadSessionResource(
  scopeValue: Readonly<{
    courseId: string;
    moduleId: string;
    sessionId: string;
  }>,
  metadataValue: ProtectedResourceMetadata,
  dependenciesValue?: ResourceDownloadDependencies,
  onStage?: (stage: ResourceDownloadStage) => void,
): Promise<void> {
  const dependencies = dependenciesValue ?? browserDependencies();
  const scope: ProtectedResourceScope = {
    type: "session",
    courseId: scopeValue.courseId,
    moduleId: scopeValue.moduleId,
    sessionId: scopeValue.sessionId,
  };
  let metadata: ProtectedResourceMetadata;
  let access: ProtectedResourceAccess;
  try {
    metadata = validateProtectedResourceMetadata(metadataValue, scope);
    onStage?.("access");
    access = await dependencies.getAccess(
      scope.courseId,
      scope.moduleId,
      scope.sessionId,
      metadata.resourceId,
    );
    validateProtectedResourcePair(metadata, access);
  } catch {
    return unavailable();
  }

  onStage?.("downloading");
  const artifact = await fetchVerifiedCiphertext(metadata, dependencies);
  onStage?.("preparing");
  let plaintext: ArrayBuffer;
  try {
    plaintext = await dependencies.decrypt(artifact, access.contentKey);
    if (plaintext.byteLength !== metadata.plaintextSize) return unavailable();
    validateProtectedResourcePlaintext(new Uint8Array(plaintext));
  } catch {
    return unavailable();
  }

  const blob = new Blob([plaintext], { type: "application/pdf" });
  const objectUrl = dependencies.createObjectUrl(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = dependencies.createAnchor();
    anchor.href = objectUrl;
    anchor.download = metadata.originalFileName;
    dependencies.appendAnchor(anchor);
    anchor.click();
  } catch {
    return unavailable();
  } finally {
    anchor?.remove();
    dependencies.revokeObjectUrl(objectUrl);
  }
}
