export const ATV2_FORMAT_VERSION = "ATV2" as const;
export const ATV2_AAD_MAGIC = "ATV2-AAD";
export const ATV2_MANIFEST_MAGIC = "ATV2M";
export const ATV2_INITIALIZATION_MAGIC = "ATV2I";
export const ATV2_MEDIA_SEGMENT_MAGIC = "ATV2S";
export const ATV2_NONCE_PREFIX_BYTES = 4;
export const ATV2_NONCE_BYTES = 12;
export const ATV2_TAG_BYTES = 16;
export const ATV2_KEY_BYTES = 32;
export const ATV2_MAX_MANIFEST_CIPHERTEXT_BYTES = 4 * 1024 * 1024;
export const ATV2_MAX_INITIALIZATION_PLAINTEXT_BYTES = 4 * 1024 * 1024;
export const ATV2_MAX_MEDIA_SEGMENT_PLAINTEXT_BYTES = 8 * 1024 * 1024;
export const ATV2_MAX_SEGMENTS = 1_000_000;
export const ATV2_MAX_TIMESCALE = 1_000_000_000;
export const ATV2_MAX_CODEC_LENGTH = 256;

const ASSET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ENCODER = new TextEncoder();
const AAD_MAGIC_BYTES = ENCODER.encode(ATV2_AAD_MAGIC);

export type Atv2ObjectType = "manifest" | "initialization" | "media";

export type Atv2ObjectIdentity = Readonly<{
  assetId: string;
  type: Atv2ObjectType;
  counter: number;
  plaintextSize: number;
  startTicks: number;
  durationTicks: number;
}>;

export type Atv2InitializationMetadata = Readonly<{
  path: "init.atv2i";
  counter: 1;
  plaintextSize: number;
  encryptedSize: number;
  ciphertextSha256: string;
}>;

export type Atv2SegmentMetadata = Readonly<{
  index: number;
  path: string;
  counter: number;
  startTicks: number;
  durationTicks: number;
  plaintextSize: number;
  encryptedSize: number;
  ciphertextSha256: string;
}>;

export type Atv2Manifest = Readonly<{
  formatVersion: "ATV2";
  assetId: string;
  media: Readonly<{
    container: "video/mp4";
    codecs: string;
    timescale: number;
    durationTicks: number;
  }>;
  noncePrefix: string;
  initialization: Atv2InitializationMetadata;
  segments: readonly Atv2SegmentMetadata[];
}>;

function invalid(message = "ATV2 data is invalid."): never {
  throw new Error(message);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  )
    return invalid();
  return value;
}

export function validateAtv2AssetId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !ASSET_ID_PATTERN.test(value)
  )
    return invalid("ATV2 asset ID is invalid.");
  const bytes = ENCODER.encode(value);
  if (bytes.length !== value.length || bytes.length > 0xffff)
    return invalid("ATV2 asset ID is invalid.");
  return value;
}

export function atv2SegmentPath(index: number): string {
  const safeIndex = safeInteger(index, 0, ATV2_MAX_SEGMENTS - 1);
  return `segments/${safeIndex.toString().padStart(6, "0")}.atv2s`;
}

export function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeCanonicalBase64url(
  value: unknown,
  expectedBytes: number,
): Uint8Array {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value))
    return invalid("ATV2 Base64url value is invalid.");
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    if (bytes.length !== expectedBytes || encodeBase64url(bytes) !== value)
      return invalid("ATV2 Base64url value is invalid.");
    return bytes;
  } catch {
    return invalid("ATV2 Base64url value is invalid.");
  }
}

export function encodeAtv2ContentKey(bytes: Uint8Array): string {
  if (bytes.byteLength !== ATV2_KEY_BYTES)
    return invalid("ATV2 content key is invalid.");
  return encodeBase64url(bytes);
}

export function decodeAtv2ContentKey(value: unknown): Uint8Array {
  return decodeCanonicalBase64url(value, ATV2_KEY_BYTES);
}

export function buildAtv2Nonce(
  prefix: Uint8Array,
  counter: number,
): Uint8Array {
  if (prefix.byteLength !== ATV2_NONCE_PREFIX_BYTES)
    return invalid("ATV2 nonce prefix is invalid.");
  const safeCounter = safeInteger(counter, 0);
  const nonce = new Uint8Array(ATV2_NONCE_BYTES);
  nonce.set(prefix, 0);
  new DataView(nonce.buffer).setBigUint64(
    ATV2_NONCE_PREFIX_BYTES,
    BigInt(safeCounter),
    false,
  );
  return nonce;
}

function objectTypeByte(type: Atv2ObjectType): number {
  if (type === "manifest") return 0;
  if (type === "initialization") return 1;
  if (type === "media") return 2;
  return invalid("ATV2 object type is invalid.");
}

export function validateAtv2ObjectIdentity(
  value: Atv2ObjectIdentity,
): Atv2ObjectIdentity {
  const assetId = validateAtv2AssetId(value.assetId);
  const type = value.type;
  objectTypeByte(type);
  const counter = safeInteger(value.counter, 0);
  const maximumSize =
    type === "manifest"
      ? ATV2_MAX_MANIFEST_CIPHERTEXT_BYTES - ATV2_TAG_BYTES
      : type === "initialization"
        ? ATV2_MAX_INITIALIZATION_PLAINTEXT_BYTES
        : ATV2_MAX_MEDIA_SEGMENT_PLAINTEXT_BYTES;
  const plaintextSize = safeInteger(value.plaintextSize, 1, maximumSize);
  const startTicks = safeInteger(value.startTicks, 0);
  const durationTicks = safeInteger(value.durationTicks, 0);
  if (
    (type === "manifest" && counter !== 0) ||
    (type === "initialization" && counter !== 1) ||
    (type === "media" && counter < 2)
  )
    invalid("ATV2 object counter is invalid.");
  if (type === "media") {
    if (durationTicks === 0) invalid("ATV2 media timing is invalid.");
  } else if (startTicks !== 0 || durationTicks !== 0)
    invalid("ATV2 object timing is invalid.");
  return { assetId, type, counter, plaintextSize, startTicks, durationTicks };
}

export function buildAtv2Aad(input: Atv2ObjectIdentity): Uint8Array {
  const value = validateAtv2ObjectIdentity(input);
  const asset = ENCODER.encode(value.assetId);
  const bytes = new Uint8Array(12 + asset.length + 32);
  bytes.set(AAD_MAGIC_BYTES, 0);
  bytes[8] = 0x02;
  bytes[9] = objectTypeByte(value.type);
  const view = new DataView(bytes.buffer);
  view.setUint16(10, asset.length, false);
  bytes.set(asset, 12);
  let offset = 12 + asset.length;
  for (const field of [
    value.counter,
    value.plaintextSize,
    value.startTicks,
    value.durationTicks,
  ]) {
    view.setBigUint64(offset, BigInt(field), false);
    offset += 8;
  }
  return bytes;
}

function sha256(value: unknown): string {
  if (typeof value !== "string" || !SHA256_BASE64URL_PATTERN.test(value))
    return invalid();
  decodeCanonicalBase64url(value, 32);
  return value;
}

function encryptedSize(plaintextSize: number, actual: unknown): number {
  const expected = plaintextSize + 5 + ATV2_TAG_BYTES;
  const value = safeInteger(actual, 5 + ATV2_TAG_BYTES + 1);
  if (value !== expected) return invalid();
  return value;
}

export function validateAtv2Manifest(value: unknown): Atv2Manifest {
  const root = record(value);
  exactKeys(root, [
    "formatVersion",
    "assetId",
    "media",
    "noncePrefix",
    "initialization",
    "segments",
  ]);
  if (root.formatVersion !== ATV2_FORMAT_VERSION)
    return invalid("ATV2 manifest version is unsupported.");
  const assetId = validateAtv2AssetId(root.assetId);
  const media = record(root.media);
  exactKeys(media, ["container", "codecs", "timescale", "durationTicks"]);
  if (
    media.container !== "video/mp4" ||
    typeof media.codecs !== "string" ||
    media.codecs.length === 0 ||
    media.codecs.length > ATV2_MAX_CODEC_LENGTH ||
    media.codecs.trim() !== media.codecs
  )
    return invalid();
  const timescale = safeInteger(media.timescale, 1, ATV2_MAX_TIMESCALE);
  const durationTicks = safeInteger(media.durationTicks, 1);
  if (typeof root.noncePrefix !== "string") return invalid();
  const noncePrefix = root.noncePrefix;
  decodeCanonicalBase64url(noncePrefix, ATV2_NONCE_PREFIX_BYTES);

  const initialization = record(root.initialization);
  exactKeys(initialization, [
    "path",
    "counter",
    "plaintextSize",
    "encryptedSize",
    "ciphertextSha256",
  ]);
  if (initialization.path !== "init.atv2i" || initialization.counter !== 1)
    return invalid();
  const initializationPlaintextSize = safeInteger(
    initialization.plaintextSize,
    1,
    ATV2_MAX_INITIALIZATION_PLAINTEXT_BYTES,
  );
  const validatedInitialization: Atv2InitializationMetadata = {
    path: "init.atv2i",
    counter: 1,
    plaintextSize: initializationPlaintextSize,
    encryptedSize: encryptedSize(
      initializationPlaintextSize,
      initialization.encryptedSize,
    ),
    ciphertextSha256: sha256(initialization.ciphertextSha256),
  };

  if (
    !Array.isArray(root.segments) ||
    root.segments.length === 0 ||
    root.segments.length > ATV2_MAX_SEGMENTS
  )
    return invalid();
  let expectedStart = 0;
  const segments = root.segments.map(
    (candidate, index): Atv2SegmentMetadata => {
      const segment = record(candidate);
      exactKeys(segment, [
        "index",
        "path",
        "counter",
        "startTicks",
        "durationTicks",
        "plaintextSize",
        "encryptedSize",
        "ciphertextSha256",
      ]);
      const validatedIndex = safeInteger(
        segment.index,
        0,
        ATV2_MAX_SEGMENTS - 1,
      );
      if (
        validatedIndex !== index ||
        segment.counter !== index + 2 ||
        segment.path !== atv2SegmentPath(index)
      )
        return invalid();
      const startTicks = safeInteger(segment.startTicks, 0);
      const segmentDuration = safeInteger(segment.durationTicks, 1);
      if (
        startTicks !== expectedStart ||
        startTicks > Number.MAX_SAFE_INTEGER - segmentDuration
      )
        return invalid();
      expectedStart = startTicks + segmentDuration;
      const plaintextSize = safeInteger(
        segment.plaintextSize,
        1,
        ATV2_MAX_MEDIA_SEGMENT_PLAINTEXT_BYTES,
      );
      return {
        index,
        path: atv2SegmentPath(index),
        counter: index + 2,
        startTicks,
        durationTicks: segmentDuration,
        plaintextSize,
        encryptedSize: encryptedSize(plaintextSize, segment.encryptedSize),
        ciphertextSha256: sha256(segment.ciphertextSha256),
      };
    },
  );
  if (expectedStart !== durationTicks) return invalid();
  return {
    formatVersion: ATV2_FORMAT_VERSION,
    assetId,
    media: {
      container: "video/mp4",
      codecs: media.codecs,
      timescale,
      durationTicks,
    },
    noncePrefix,
    initialization: validatedInitialization,
    segments,
  };
}

export function serializeAtv2Manifest(value: Atv2Manifest): string {
  const manifest = validateAtv2Manifest(value);
  return JSON.stringify({
    formatVersion: manifest.formatVersion,
    assetId: manifest.assetId,
    media: manifest.media,
    noncePrefix: manifest.noncePrefix,
    initialization: manifest.initialization,
    segments: manifest.segments,
  });
}

export function parseCanonicalAtv2Manifest(text: string): Atv2Manifest {
  if (
    typeof text !== "string" ||
    ENCODER.encode(text).byteLength >
      ATV2_MAX_MANIFEST_CIPHERTEXT_BYTES - ATV2_TAG_BYTES
  )
    return invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid();
  }
  const manifest = validateAtv2Manifest(parsed);
  if (serializeAtv2Manifest(manifest) !== text)
    return invalid("ATV2 manifest serialization is not canonical.");
  return manifest;
}

export function magicForAtv2Object(type: Atv2ObjectType): string {
  if (type === "manifest") return ATV2_MANIFEST_MAGIC;
  if (type === "initialization") return ATV2_INITIALIZATION_MAGIC;
  if (type === "media") return ATV2_MEDIA_SEGMENT_MAGIC;
  return invalid();
}
