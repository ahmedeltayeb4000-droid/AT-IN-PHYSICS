const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateStaffAccessCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  const value = [...bytes].map((byte) => ALPHABET[byte & 31]).join("");
  return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15, 20)}-${value.slice(20)}`;
}
