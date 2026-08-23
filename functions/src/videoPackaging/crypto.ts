import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

export const VIDEO_ARTIFACT_FORMAT = "ATV1";
export const VIDEO_KEY_LENGTH = 32;
export const VIDEO_IV_LENGTH = 12;
export const VIDEO_AUTH_TAG_LENGTH = 16;

const MAGIC = Buffer.from(VIDEO_ARTIFACT_FORMAT, "ascii");
const ARTIFACT_PREFIX_LENGTH = MAGIC.length + VIDEO_IV_LENGTH;
const MINIMUM_ARTIFACT_LENGTH =
  ARTIFACT_PREFIX_LENGTH + VIDEO_AUTH_TAG_LENGTH + 1;
const CONTENT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type RandomBytesProvider = (size: number) => Buffer;

export type EncryptedVideoPackage = {
  readonly artifact: Buffer;
  readonly contentKey: string;
  readonly iv: Buffer;
};

export type ParsedEncryptedVideoArtifact = {
  readonly format: typeof VIDEO_ARTIFACT_FORMAT;
  readonly iv: Buffer;
  readonly ciphertext: Buffer;
  readonly authenticationTag: Buffer;
};

function invalidArtifact(): never {
  throw new Error("Encrypted video artifact is invalid.");
}

export function encodeContentKey(key: Uint8Array): string {
  const bytes = Buffer.from(key);
  if (bytes.length !== VIDEO_KEY_LENGTH) {
    throw new Error("Video content key must contain exactly 32 bytes.");
  }
  return bytes.toString("base64url");
}

export function decodeContentKey(value: unknown): Buffer {
  if (typeof value !== "string" || !CONTENT_KEY_PATTERN.test(value)) {
    throw new Error("Video content key is invalid.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== VIDEO_KEY_LENGTH ||
    decoded.toString("base64url") !== value
  ) {
    throw new Error("Video content key is invalid.");
  }
  return decoded;
}

function requireRandomBytes(
  provider: RandomBytesProvider,
  size: number,
): Buffer {
  const value = provider(size);
  if (!Buffer.isBuffer(value) || value.length !== size) {
    throw new Error("Secure random byte generation failed.");
  }
  return Buffer.from(value);
}

export function encryptVideoBytes(
  plaintext: Uint8Array,
  randomBytesProvider: RandomBytesProvider = randomBytes,
): EncryptedVideoPackage {
  if (plaintext.byteLength === 0) {
    throw new Error("Video plaintext must not be empty.");
  }

  const key = requireRandomBytes(randomBytesProvider, VIDEO_KEY_LENGTH);
  const iv = requireRandomBytes(randomBytesProvider, VIDEO_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: VIDEO_AUTH_TAG_LENGTH,
  });
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();

  return {
    artifact: Buffer.concat([MAGIC, iv, ciphertext, authenticationTag]),
    contentKey: encodeContentKey(key),
    iv,
  };
}

export function parseEncryptedVideoArtifact(
  artifact: Uint8Array,
): ParsedEncryptedVideoArtifact {
  const bytes = Buffer.from(artifact);
  if (
    bytes.length < MINIMUM_ARTIFACT_LENGTH ||
    !bytes.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    return invalidArtifact();
  }

  const tagStart = bytes.length - VIDEO_AUTH_TAG_LENGTH;
  return {
    format: VIDEO_ARTIFACT_FORMAT,
    iv: Buffer.from(bytes.subarray(MAGIC.length, ARTIFACT_PREFIX_LENGTH)),
    ciphertext: Buffer.from(bytes.subarray(ARTIFACT_PREFIX_LENGTH, tagStart)),
    authenticationTag: Buffer.from(bytes.subarray(tagStart)),
  };
}

export function decryptVideoArtifact(
  artifact: Uint8Array,
  contentKey: string,
): Buffer {
  const parsed = parseEncryptedVideoArtifact(artifact);
  const key = decodeContentKey(contentKey);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv, {
      authTagLength: VIDEO_AUTH_TAG_LENGTH,
    });
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(parsed.authenticationTag);
    return Buffer.concat([
      decipher.update(parsed.ciphertext),
      decipher.final(),
    ]);
  } catch {
    throw new Error("Encrypted video artifact authentication failed.");
  }
}
