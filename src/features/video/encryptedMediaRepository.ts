import { isValidVideoAssetId } from "../courses/sessionMapper.ts";
import { ATV1_MAX_ARTIFACT_BYTES } from "./atv1.ts";

export function buildEncryptedMediaRoute(videoAssetId: unknown): string {
  if (!isValidVideoAssetId(videoAssetId)) {
    throw new Error("Encrypted video is unavailable.");
  }
  return `/protected-media/${videoAssetId}.atv1`;
}

export async function fetchEncryptedMedia(
  videoAssetId: string,
  fetcher: typeof fetch = fetch,
): Promise<ArrayBuffer> {
  const response = await fetcher(buildEncryptedMediaRoute(videoAssetId), {
    credentials: "same-origin",
    cache: "default",
  });
  if (!response.ok) throw new Error("Encrypted video is unavailable.");

  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > ATV1_MAX_ARTIFACT_BYTES)
  ) {
    throw new Error("Encrypted video is unavailable.");
  }

  if (response.body === null) throw new Error("Encrypted video is unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > ATV1_MAX_ARTIFACT_BYTES) {
        await reader.cancel();
        throw new Error("Encrypted video is unavailable.");
      }
      chunks.push(value);
    }
  } catch {
    throw new Error("Encrypted video is unavailable.");
  }

  const artifact = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    artifact.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return artifact.buffer;
}
