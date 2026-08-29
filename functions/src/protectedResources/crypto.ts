import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  PROTECTED_RESOURCE_AUTH_TAG_LENGTH,
  PROTECTED_RESOURCE_FORMAT,
  PROTECTED_RESOURCE_IV_LENGTH,
  PROTECTED_RESOURCE_KEY_LENGTH,
  PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE,
  PROTECTED_RESOURCE_OVERHEAD,
  protectedResourceCiphertextSize,
  validateProtectedResourceContentKey,
  validateProtectedResourcePlaintext,
} from "./format.js";

const MAGIC = Buffer.from(PROTECTED_RESOURCE_FORMAT, "ascii");

export type ProtectedResourceRandomBytesProvider = (size: number) => Buffer;

export type EncryptedProtectedResource = Readonly<{
  artifact: Buffer;
  contentKey: string;
  iv: Buffer;
}>;

function invalidResource(): never {
  throw new Error("Protected resource is invalid.");
}

function secureBytes(
  provider: ProtectedResourceRandomBytesProvider,
  size: number,
): Buffer {
  const value = provider(size);
  if (!Buffer.isBuffer(value) || value.length !== size) return invalidResource();
  return Buffer.from(value);
}

export function encryptProtectedResource(
  plaintext: Uint8Array,
  randomProvider: ProtectedResourceRandomBytesProvider = randomBytes,
): EncryptedProtectedResource {
  validateProtectedResourcePlaintext(plaintext);
  const key = secureBytes(randomProvider, PROTECTED_RESOURCE_KEY_LENGTH);
  const iv = secureBytes(randomProvider, PROTECTED_RESOURCE_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: PROTECTED_RESOURCE_AUTH_TAG_LENGTH,
  });
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  const artifact = Buffer.concat([MAGIC, iv, ciphertext, cipher.getAuthTag()]);
  if (artifact.length !== protectedResourceCiphertextSize(plaintext.byteLength)) {
    return invalidResource();
  }
  return { artifact, contentKey: key.toString("base64url"), iv };
}

export function parseProtectedResourceArtifact(artifact: Uint8Array) {
  const bytes = Buffer.from(artifact);
  if (
    bytes.length <= PROTECTED_RESOURCE_OVERHEAD ||
    bytes.length >
      PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE + PROTECTED_RESOURCE_OVERHEAD ||
    !bytes.subarray(0, MAGIC.length).equals(MAGIC)
  ) {
    return invalidResource();
  }
  const payloadStart = MAGIC.length + PROTECTED_RESOURCE_IV_LENGTH;
  const tagStart = bytes.length - PROTECTED_RESOURCE_AUTH_TAG_LENGTH;
  return {
    iv: Buffer.from(bytes.subarray(MAGIC.length, payloadStart)),
    ciphertext: Buffer.from(bytes.subarray(payloadStart, tagStart)),
    authenticationTag: Buffer.from(bytes.subarray(tagStart)),
  };
}

export function decryptProtectedResource(
  artifact: Uint8Array,
  contentKey: unknown,
): Buffer {
  const parsed = parseProtectedResourceArtifact(artifact);
  const canonicalKey = validateProtectedResourceContentKey(contentKey);
  const key = Buffer.from(canonicalKey, "base64url");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, parsed.iv, {
      authTagLength: PROTECTED_RESOURCE_AUTH_TAG_LENGTH,
    });
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(parsed.authenticationTag);
    const plaintext = Buffer.concat([
      decipher.update(parsed.ciphertext),
      decipher.final(),
    ]);
    validateProtectedResourcePlaintext(plaintext);
    return plaintext;
  } catch {
    return invalidResource();
  }
}
