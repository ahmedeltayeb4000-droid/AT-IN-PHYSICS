import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  ATV2_NONCE_PREFIX_BYTES,
  ATV2_TAG_BYTES,
  buildAtv2Aad,
  buildAtv2Nonce,
  decodeAtv2ContentKey,
  encodeAtv2ContentKey,
  magicForAtv2Object,
  validateAtv2ObjectIdentity,
  type Atv2ObjectIdentity,
} from "./atv2Format.js";

export type Atv2EncryptedObject = Readonly<{
  artifact: Buffer;
  contentKey: string;
  noncePrefix: Buffer;
}>;

function artifactError(): never {
  throw new Error("ATV2 artifact is invalid.");
}

export function encryptAtv2Object(
  plaintext: Uint8Array,
  identity: Atv2ObjectIdentity,
  options: Readonly<{ contentKey?: Uint8Array; noncePrefix?: Uint8Array }> = {},
): Atv2EncryptedObject {
  const validated = validateAtv2ObjectIdentity(identity);
  if (plaintext.byteLength !== validated.plaintextSize) artifactError();
  const key = options.contentKey
    ? Buffer.from(options.contentKey)
    : randomBytes(32);
  const prefix = options.noncePrefix
    ? Buffer.from(options.noncePrefix)
    : randomBytes(ATV2_NONCE_PREFIX_BYTES);
  const contentKey = encodeAtv2ContentKey(key);
  if (prefix.byteLength !== ATV2_NONCE_PREFIX_BYTES) artifactError();
  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    buildAtv2Nonce(prefix, validated.counter),
    { authTagLength: ATV2_TAG_BYTES },
  );
  cipher.setAAD(buildAtv2Aad(validated));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const body = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  const magic = Buffer.from(magicForAtv2Object(validated.type), "ascii");
  const artifact =
    validated.type === "manifest"
      ? Buffer.concat([magic, prefix, body])
      : Buffer.concat([magic, body]);
  return { artifact, contentKey, noncePrefix: prefix };
}

export function decryptAtv2Object(
  artifact: Uint8Array,
  contentKey: string,
  noncePrefix: Uint8Array,
  identity: Atv2ObjectIdentity,
): Buffer {
  const validated = validateAtv2ObjectIdentity(identity);
  const bytes = Buffer.from(artifact);
  const magic = Buffer.from(magicForAtv2Object(validated.type), "ascii");
  if (
    bytes.length < magic.length + ATV2_TAG_BYTES + 1 ||
    !bytes.subarray(0, magic.length).equals(magic)
  )
    artifactError();
  let offset = magic.length;
  if (validated.type === "manifest") {
    if (
      bytes.length < offset + ATV2_NONCE_PREFIX_BYTES + ATV2_TAG_BYTES + 1 ||
      !bytes
        .subarray(offset, offset + ATV2_NONCE_PREFIX_BYTES)
        .equals(Buffer.from(noncePrefix))
    )
      artifactError();
    offset += ATV2_NONCE_PREFIX_BYTES;
  }
  const payload = bytes.subarray(offset);
  if (payload.length !== validated.plaintextSize + ATV2_TAG_BYTES)
    artifactError();
  const ciphertext = payload.subarray(0, -ATV2_TAG_BYTES);
  const tag = payload.subarray(-ATV2_TAG_BYTES);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeAtv2ContentKey(contentKey),
      buildAtv2Nonce(noncePrefix, validated.counter),
      { authTagLength: ATV2_TAG_BYTES },
    );
    decipher.setAAD(buildAtv2Aad(validated));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("ATV2 artifact authentication failed.");
  }
}
