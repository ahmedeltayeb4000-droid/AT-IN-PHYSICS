export type AdminCourseInventoryErrorCode =
  | "unauthenticated"
  | "unauthorized"
  | "unavailable"
  | "malformed"
  | "unknown";

export class AdminCourseInventoryError extends Error {
  readonly code: AdminCourseInventoryErrorCode;

  constructor(code: AdminCourseInventoryErrorCode) {
    super(code);
    this.code = code;
    this.name = "AdminCourseInventoryError";
  }
}

export function classifyAdminCourseInventoryFailure(
  cause: unknown,
): AdminCourseInventoryErrorCode {
  if (cause instanceof AdminCourseInventoryError) return cause.code;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String(cause.code)
      : "";
  if (code === "unauthenticated" || code.endsWith("/unauthenticated")) {
    return "unauthenticated";
  }
  if (
    code === "auth/user-token-expired" ||
    code === "auth/user-disabled" ||
    code === "auth/invalid-user-token"
  ) {
    return "unauthenticated";
  }
  if (code === "permission-denied" || code.endsWith("/permission-denied")) {
    return "unauthorized";
  }
  if (
    code === "unavailable" ||
    code.endsWith("/unavailable") ||
    code === "deadline-exceeded" ||
    code.endsWith("/deadline-exceeded") ||
    code === "auth/network-request-failed"
  ) {
    return "unavailable";
  }
  return "unknown";
}
