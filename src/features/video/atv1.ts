export const ATV1_MAGIC = "ATV1";
export const ATV1_IV_LENGTH = 12;
export const ATV1_TAG_LENGTH = 16;
export const ATV1_MAX_PLAINTEXT_BYTES = 50 * 1024 * 1024;
export const ATV1_MAX_ARTIFACT_BYTES =
  ATV1_MAX_PLAINTEXT_BYTES + ATV1_MAGIC.length + ATV1_IV_LENGTH + ATV1_TAG_LENGTH;

const CONTENT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAGIC_BYTES = new TextEncoder().encode(ATV1_MAGIC);
const MINIMUM_ARTIFACT_LENGTH =
  MAGIC_BYTES.length + ATV1_IV_LENGTH + ATV1_TAG_LENGTH + 1;

function invalidArtifact(): never {
  throw new Error("Encrypted video is unavailable.");
}

export function decodeAtv1ContentKey(value: unknown): Uint8Array {
  if (typeof value !== "string" || !CONTENT_KEY_PATTERN.test(value)) {
    throw new Error("Video access is unavailable.");
  }

  try {
    const binary = atob(`${value.replace(/-/g, "+").replace(/_/g, "/") }=`);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const canonical = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    if (bytes.length !== 32 || canonical !== value) {
      throw new Error("invalid key");
    }
    return bytes;
  } catch {
    throw new Error("Video access is unavailable.");
  }
}

export type ParsedAtv1Artifact = {
  readonly iv: Uint8Array;
  readonly encryptedPayload: Uint8Array;
};

export function parseAtv1Artifact(artifact: ArrayBuffer): ParsedAtv1Artifact {
  const bytes = new Uint8Array(artifact);
  if (
    bytes.byteLength < MINIMUM_ARTIFACT_LENGTH ||
    bytes.byteLength > ATV1_MAX_ARTIFACT_BYTES ||
    !MAGIC_BYTES.every((byte, index) => bytes[index] === byte)
  ) {
    return invalidArtifact();
  }

  return {
    iv: bytes.subarray(MAGIC_BYTES.length, MAGIC_BYTES.length + ATV1_IV_LENGTH),
    // Web Crypto expects ciphertext and the trailing GCM tag together.
    encryptedPayload: bytes.subarray(MAGIC_BYTES.length + ATV1_IV_LENGTH),
  };
}

export async function decryptAtv1Artifact(
  artifact: ArrayBuffer,
  contentKey: string,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<ArrayBuffer> {
  const parsed = parseAtv1Artifact(artifact);
  const keyBytes = decodeAtv1ContentKey(contentKey);

  try {
    const key = await subtle.importKey("raw", new Uint8Array(keyBytes), "AES-GCM", false, [
      "decrypt",
    ]);
    return await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(parsed.iv),
        additionalData: new Uint8Array(MAGIC_BYTES),
        tagLength: ATV1_TAG_LENGTH * 8,
      },
      key,
      new Uint8Array(parsed.encryptedPayload),
    );
  } catch {
    throw new Error("Encrypted video is unavailable.");
  }
}
