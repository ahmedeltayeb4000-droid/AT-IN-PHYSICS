import {
  ATV2_NONCE_PREFIX_BYTES,
  ATV2_TAG_BYTES,
  buildAtv2Aad,
  buildAtv2Nonce,
  decodeAtv2ContentKey,
  magicForAtv2Object,
  validateAtv2ObjectIdentity,
  type Atv2ObjectIdentity,
} from "../../../functions/src/videoPackaging/atv2Format.ts";

function unavailable(): never {
  throw new Error("Encrypted video is unavailable.");
}

export async function decryptAtv2ObjectWithWebCrypto(
  artifact: ArrayBuffer,
  contentKey: string,
  noncePrefix: Uint8Array,
  identity: Atv2ObjectIdentity,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<ArrayBuffer> {
  try {
    const validated = validateAtv2ObjectIdentity(identity);
    if (noncePrefix.byteLength !== ATV2_NONCE_PREFIX_BYTES)
      return unavailable();
    const bytes = new Uint8Array(artifact);
    const magic = new TextEncoder().encode(magicForAtv2Object(validated.type));
    if (
      bytes.byteLength < magic.byteLength + ATV2_TAG_BYTES + 1 ||
      !magic.every((byte, index) => bytes[index] === byte)
    )
      return unavailable();
    let offset = magic.byteLength;
    if (validated.type === "manifest") {
      const embedded = bytes.subarray(offset, offset + ATV2_NONCE_PREFIX_BYTES);
      if (
        embedded.byteLength !== ATV2_NONCE_PREFIX_BYTES ||
        !embedded.every((byte, index) => byte === noncePrefix[index])
      )
        return unavailable();
      offset += ATV2_NONCE_PREFIX_BYTES;
    }
    const payload = bytes.subarray(offset);
    if (payload.byteLength !== validated.plaintextSize + ATV2_TAG_BYTES)
      return unavailable();
    const keyBytes = new Uint8Array(decodeAtv2ContentKey(contentKey));
    const nonce = new Uint8Array(
      buildAtv2Nonce(noncePrefix, validated.counter),
    );
    const aad = new Uint8Array(buildAtv2Aad(validated));
    const encryptedPayload = new Uint8Array(payload);
    const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, [
      "decrypt",
    ]);
    return await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: aad,
        tagLength: ATV2_TAG_BYTES * 8,
      },
      key,
      encryptedPayload,
    );
  } catch {
    return unavailable();
  }
}

export * from "../../../functions/src/videoPackaging/atv2Format.ts";
