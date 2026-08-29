import {
  PROTECTED_RESOURCE_AUTH_TAG_LENGTH,
  PROTECTED_RESOURCE_FORMAT,
  PROTECTED_RESOURCE_IV_LENGTH,
  PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE,
  PROTECTED_RESOURCE_OVERHEAD,
  validateProtectedResourceContentKey,
  validateProtectedResourcePlaintext,
} from "../../../functions/src/protectedResources/format.ts";

const MAGIC = new TextEncoder().encode(PROTECTED_RESOURCE_FORMAT);
export const ATR1_MAX_ARTIFACT_SIZE =
  PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE + PROTECTED_RESOURCE_OVERHEAD;

function invalidResource(): never {
  throw new Error("Protected resource is invalid.");
}

export function parseAtr1Artifact(artifact: ArrayBuffer) {
  const bytes = new Uint8Array(artifact);
  if (
    bytes.byteLength <= PROTECTED_RESOURCE_OVERHEAD ||
    bytes.byteLength > ATR1_MAX_ARTIFACT_SIZE ||
    !MAGIC.every((byte, index) => bytes[index] === byte)
  ) {
    return invalidResource();
  }
  return {
    iv: bytes.subarray(MAGIC.length, MAGIC.length + PROTECTED_RESOURCE_IV_LENGTH),
    encryptedPayload: bytes.subarray(MAGIC.length + PROTECTED_RESOURCE_IV_LENGTH),
  };
}

export async function decryptAtr1Artifact(
  artifact: ArrayBuffer,
  contentKey: unknown,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<ArrayBuffer> {
  const parsed = parseAtr1Artifact(artifact);
  const canonicalKey = validateProtectedResourceContentKey(contentKey);
  const binary = atob(
    `${canonicalKey.replace(/-/g, "+").replace(/_/g, "/")}=`,
  );
  const keyBytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  try {
    const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, [
      "decrypt",
    ]);
    const plaintext = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(parsed.iv),
        additionalData: new Uint8Array(MAGIC),
        tagLength: PROTECTED_RESOURCE_AUTH_TAG_LENGTH * 8,
      },
      key,
      new Uint8Array(parsed.encryptedPayload),
    );
    validateProtectedResourcePlaintext(new Uint8Array(plaintext));
    return plaintext;
  } catch {
    return invalidResource();
  }
}
