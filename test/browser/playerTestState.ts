export type FixtureFailure =
  | "none"
  | "access"
  | "fetch"
  | "key"
  | "atv1"
  | "decrypt"
  | "late";

export const playerAudit = {
  calls: [] as string[],
  createdUrls: [] as string[],
  revokedUrls: [] as string[],
  watermarkTimers: new Set<unknown>(),
  mediaListeners: 0,
  fullscreenListeners: 0,
};

export const fixtureState: {
  failure: FixtureFailure;
  lateResolve?: (value: ArrayBuffer) => void;
} = { failure: "none" };

export const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
export const contentKey = btoa(String.fromCharCode(...keyBytes))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");

export async function artifactFixture(): Promise<ArrayBuffer> {
  const magic = new TextEncoder().encode("ATV1");
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 32);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: magic, tagLength: 128 },
    key,
    new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]),
  );
  const artifact = new Uint8Array(magic.length + iv.length + encrypted.byteLength);
  artifact.set(magic);
  artifact.set(iv, magic.length);
  artifact.set(new Uint8Array(encrypted), magic.length + iv.length);
  return artifact.buffer;
}
