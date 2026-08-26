export type OwnerAccessState =
  "loading" | "unauthenticated" | "denied" | "allowed";

export function resolveOwnerAccessState(input: {
  readonly authLoading: boolean;
  readonly claimsLoading: boolean;
  readonly authenticated: boolean;
  readonly isOwner: boolean;
}): OwnerAccessState {
  if (input.authLoading || (input.authenticated && input.claimsLoading))
    return "loading";
  if (!input.authenticated) return "unauthenticated";
  return input.isOwner ? "allowed" : "denied";
}
