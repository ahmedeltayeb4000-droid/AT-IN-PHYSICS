const ACCESS_CODE_PATTERN =
  /^[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}-[A-HJ-NP-Z2-9]{6}$/;

export class AccessCodeFormatError extends Error {
  constructor() {
    super("Access Code is invalid or unavailable.");
    this.name = "AccessCodeFormatError";
  }
}

export function canonicalizeAccessCode(value: unknown): string {
  if (typeof value !== "string") throw new AccessCodeFormatError();
  const canonical = value.trim().toUpperCase();
  if (!ACCESS_CODE_PATTERN.test(canonical)) throw new AccessCodeFormatError();
  return canonical;
}

export async function deriveAccessCodeId(value: unknown): Promise<string> {
  const canonical = canonicalizeAccessCode(value);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
