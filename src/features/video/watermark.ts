export const WATERMARK_POSITION_INTERVAL_MS = 12_000;

export const WATERMARK_POSITIONS = [
  "left-4 top-4 sm:left-6 sm:top-6",
  "right-4 top-4 sm:right-6 sm:top-6",
  "left-4 bottom-16 sm:left-6 sm:bottom-20",
  "right-4 bottom-16 sm:right-6 sm:bottom-20",
  "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
] as const;

export type ProtectedWatermarkViewer = {
  readonly uid: string;
  readonly email: string | null;
};

export type VideoWatermarkPolicy =
  | { readonly mode: "protected"; readonly viewer: ProtectedWatermarkViewer }
  | { readonly mode: "none" };

function maskPart(value: string): string {
  if (value.length <= 1) return `${value}***`;
  if (value.length === 2) return `${value[0]}***`;
  return `${value[0]}***${value.at(-1)}`;
}

export function maskViewerEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254 || value !== value.trim()) {
    return null;
  }
  const parts = value.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const domainParts = parts[1].split(".");
  if (domainParts.length < 2 || domainParts.some((part) => !part)) return null;
  const suffix = domainParts.pop()!;
  return `${maskPart(parts[0])}@${domainParts.map(maskPart).join(".")}.${suffix}`;
}

export async function buildProtectedWatermarkLines(
  viewer: ProtectedWatermarkViewer,
  subtle: SubtleCrypto = crypto.subtle,
): Promise<readonly [string, string]> {
  if (typeof viewer.uid !== "string" || !viewer.uid.trim()) {
    throw new Error("Viewer identity is unavailable.");
  }
  const maskedEmail = maskViewerEmail(viewer.email);
  if (maskedEmail) return ["A.T IN PHYSICS", maskedEmail];

  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(viewer.uid),
  );
  const fingerprint = Array.from(new Uint8Array(digest).subarray(0, 6), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return ["A.T IN PHYSICS", `Viewer ${fingerprint}`];
}

export function nextWatermarkPosition(current: number): number {
  if (!Number.isInteger(current) || current < 0 || current >= WATERMARK_POSITIONS.length) {
    return 0;
  }
  return (current + 1) % WATERMARK_POSITIONS.length;
}

export type WatermarkTimerDependencies = {
  readonly setInterval: (callback: () => void, delay: number) => unknown;
  readonly clearInterval: (timer: unknown) => void;
};

export function startWatermarkPositionCycle(
  onAdvance: () => void,
  reducedMotion: boolean,
  timers: WatermarkTimerDependencies = {
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (timer) => window.clearInterval(timer as number),
  },
): () => void {
  if (reducedMotion) return () => undefined;
  const timer = timers.setInterval(onAdvance, WATERMARK_POSITION_INTERVAL_MS);
  return () => timers.clearInterval(timer);
}
