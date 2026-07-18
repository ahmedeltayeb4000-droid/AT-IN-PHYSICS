export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function passwordError(password: string) {
  if (password.length < 10) return "Use at least 10 characters.";
  const categories = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((rule) =>
    rule.test(password),
  ).length;
  return categories < 3
    ? "Use a mix of uppercase, lowercase, numbers, or symbols."
    : "";
}

export function isValidInternationalPhone(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s()-]/g, ""));
}

export function safeReturnPath(pathname: string | undefined) {
  return pathname?.startsWith("/") && !pathname.startsWith("//")
    ? pathname
    : "/";
}
