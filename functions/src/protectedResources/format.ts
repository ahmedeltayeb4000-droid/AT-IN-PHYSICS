export const PROTECTED_RESOURCE_FORMAT = "ATR1";
export const PROTECTED_RESOURCE_IV_LENGTH = 12;
export const PROTECTED_RESOURCE_AUTH_TAG_LENGTH = 16;
export const PROTECTED_RESOURCE_KEY_LENGTH = 32;
export const PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE = 20 * 1024 * 1024;
export const PROTECTED_RESOURCE_OVERHEAD =
  PROTECTED_RESOURCE_FORMAT.length +
  PROTECTED_RESOURCE_IV_LENGTH +
  PROTECTED_RESOURCE_AUTH_TAG_LENGTH;
export const PROTECTED_RESOURCE_MIME_TYPE = "application/pdf";

const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTENT_KEY_PATTERN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const SAFE_PDF_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ ()-]*\.pdf$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

export type ProtectedResourceScope =
  | Readonly<{ type: "course"; courseId: string }>
  | Readonly<{
      type: "session";
      courseId: string;
      moduleId: string;
      sessionId: string;
    }>;

export type TimestampContract = Readonly<{
  seconds: number;
  nanoseconds: number;
}>;

export type ProtectedResourceMetadata = Readonly<{
  version: 1;
  resourceId: string;
  title: string;
  originalFileName: string;
  mimeType: typeof PROTECTED_RESOURCE_MIME_TYPE;
  plaintextSize: number;
  formatVersion: typeof PROTECTED_RESOURCE_FORMAT;
  ciphertextRoute: string;
  ciphertextSha256: string;
  ciphertextSize: number;
  createdAt: TimestampContract;
  boundAt: TimestampContract;
}>;

export type ProtectedResourceAccess = Readonly<{
  version: 1;
  resourceId: string;
  formatVersion: typeof PROTECTED_RESOURCE_FORMAT;
  ciphertextSha256: string;
  contentKey: string;
}>;

function invalidResource(): never {
  throw new Error("Protected resource is invalid.");
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidResource();
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    return invalidResource();
  }
  return record;
}

export function validateProtectedResourceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !CONTENT_ID_PATTERN.test(value)
  ) {
    return invalidResource();
  }
  return value;
}

export function validateProtectedResourceTitle(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 160 ||
    value !== value.trim() ||
    containsControlCharacter(value)
  ) {
    return invalidResource();
  }
  return value;
}

export function validateProtectedResourceFileName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 120 ||
    value !== value.trim() ||
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("/") ||
    containsControlCharacter(value) ||
    !SAFE_PDF_FILE_NAME.test(value)
  ) {
    return invalidResource();
  }
  const fileStem = value.slice(0, -4);
  const deviceStem = fileStem.split(".", 1)[0]!;
  if (
    fileStem.endsWith(" ") ||
    fileStem.endsWith(".") ||
    WINDOWS_RESERVED_NAME.test(deviceStem)
  ) {
    return invalidResource();
  }
  return value;
}

export function validateProtectedResourceMimeType(
  value: unknown,
): typeof PROTECTED_RESOURCE_MIME_TYPE {
  if (value !== PROTECTED_RESOURCE_MIME_TYPE) return invalidResource();
  return PROTECTED_RESOURCE_MIME_TYPE;
}

export function validateProtectedResourcePlaintext(bytes: Uint8Array): void {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE ||
    !PDF_SIGNATURE.every((byte, index) => bytes[index] === byte)
  ) {
    return invalidResource();
  }
}

export function protectedResourceCiphertextSize(plaintextSize: unknown): number {
  if (
    typeof plaintextSize !== "number" ||
    !Number.isSafeInteger(plaintextSize) ||
    plaintextSize <= 0 ||
    plaintextSize > PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE
  ) {
    return invalidResource();
  }
  return plaintextSize + PROTECTED_RESOURCE_OVERHEAD;
}

export function validateProtectedResourceContentKey(value: unknown): string {
  if (typeof value !== "string" || !CONTENT_KEY_PATTERN.test(value)) {
    return invalidResource();
  }
  return value;
}

function validateSha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    return invalidResource();
  }
  return value;
}

function validateTimestamp(value: unknown): TimestampContract {
  const timestamp = exactRecord(value, ["seconds", "nanoseconds"]);
  if (
    !Number.isSafeInteger(timestamp.seconds) ||
    (timestamp.seconds as number) < 0 ||
    !Number.isInteger(timestamp.nanoseconds) ||
    (timestamp.nanoseconds as number) < 0 ||
    (timestamp.nanoseconds as number) > 999_999_999
  ) {
    return invalidResource();
  }
  return {
    seconds: timestamp.seconds as number,
    nanoseconds: timestamp.nanoseconds as number,
  };
}

export function validateProtectedResourceScope(
  value: unknown,
): ProtectedResourceScope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidResource();
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "course") {
    const scope = exactRecord(value, ["type", "courseId"]);
    return {
      type: "course",
      courseId: validateProtectedResourceId(scope.courseId),
    };
  }
  if (candidate.type === "session") {
    const scope = exactRecord(value, [
      "type",
      "courseId",
      "moduleId",
      "sessionId",
    ]);
    return {
      type: "session",
      courseId: validateProtectedResourceId(scope.courseId),
      moduleId: validateProtectedResourceId(scope.moduleId),
      sessionId: validateProtectedResourceId(scope.sessionId),
    };
  }
  return invalidResource();
}

export function buildProtectedResourceRoute(
  scopeValue: unknown,
  resourceIdValue: unknown,
): string {
  const scope = validateProtectedResourceScope(scopeValue);
  const resourceId = validateProtectedResourceId(resourceIdValue);
  const coursePrefix = `/protected-resources/courses/${scope.courseId}`;
  return scope.type === "course"
    ? `${coursePrefix}/resources/${resourceId}.atr1`
    : `${coursePrefix}/modules/${scope.moduleId}/sessions/${scope.sessionId}/resources/${resourceId}.atr1`;
}

const METADATA_FIELDS = [
  "version",
  "resourceId",
  "title",
  "originalFileName",
  "mimeType",
  "plaintextSize",
  "formatVersion",
  "ciphertextRoute",
  "ciphertextSha256",
  "ciphertextSize",
  "createdAt",
  "boundAt",
] as const;

export function validateProtectedResourceMetadata(
  value: unknown,
  trustedScope: unknown,
): ProtectedResourceMetadata {
  const data = exactRecord(value, METADATA_FIELDS);
  const resourceId = validateProtectedResourceId(data.resourceId);
  const plaintextSize = data.plaintextSize;
  const expectedCiphertextSize = protectedResourceCiphertextSize(plaintextSize);
  if (
    data.version !== 1 ||
    data.formatVersion !== PROTECTED_RESOURCE_FORMAT ||
    data.ciphertextRoute !==
      buildProtectedResourceRoute(trustedScope, resourceId) ||
    data.ciphertextSize !== expectedCiphertextSize
  ) {
    return invalidResource();
  }
  return {
    version: 1,
    resourceId,
    title: validateProtectedResourceTitle(data.title),
    originalFileName: validateProtectedResourceFileName(data.originalFileName),
    mimeType: validateProtectedResourceMimeType(data.mimeType),
    plaintextSize: plaintextSize as number,
    formatVersion: PROTECTED_RESOURCE_FORMAT,
    ciphertextRoute: data.ciphertextRoute,
    ciphertextSha256: validateSha256(data.ciphertextSha256),
    ciphertextSize: expectedCiphertextSize,
    createdAt: validateTimestamp(data.createdAt),
    boundAt: validateTimestamp(data.boundAt),
  };
}

export function validateProtectedResourceAccess(
  value: unknown,
): ProtectedResourceAccess {
  const data = exactRecord(value, [
    "version",
    "resourceId",
    "formatVersion",
    "ciphertextSha256",
    "contentKey",
  ]);
  if (data.version !== 1 || data.formatVersion !== PROTECTED_RESOURCE_FORMAT) {
    return invalidResource();
  }
  return {
    version: 1,
    resourceId: validateProtectedResourceId(data.resourceId),
    formatVersion: PROTECTED_RESOURCE_FORMAT,
    ciphertextSha256: validateSha256(data.ciphertextSha256),
    contentKey: validateProtectedResourceContentKey(data.contentKey),
  };
}

export function validateProtectedResourcePair(
  metadata: ProtectedResourceMetadata,
  access: ProtectedResourceAccess,
): void {
  if (
    metadata.resourceId !== access.resourceId ||
    metadata.formatVersion !== access.formatVersion ||
    metadata.ciphertextSha256 !== access.ciphertextSha256
  ) {
    return invalidResource();
  }
}
