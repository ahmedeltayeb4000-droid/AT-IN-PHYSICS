export type CustomClaims = Readonly<Record<string, unknown>>;

export type OwnerBootstrapOptions = {
  readonly uid: string;
  readonly apply: boolean;
};

export type AuthUser = {
  readonly uid: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly emailVerified: boolean;
  readonly disabled: boolean;
  readonly customClaims?: CustomClaims;
};

export type OwnerBootstrapAuth = {
  getUser(uid: string): Promise<AuthUser>;
  setCustomUserClaims(uid: string, claims: CustomClaims): Promise<void>;
};

export type OwnerBootstrapLogger = {
  log(message: string, value?: unknown): void;
};

export function parseOwnerBootstrapArgs(args: readonly string[]): OwnerBootstrapOptions {
  let uid: string | undefined;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--uid") {
      if (uid !== undefined) {
        throw new Error("The --uid option may be provided only once.");
      }
      const uidValue = args[index + 1];
      if (uidValue === undefined || uidValue.startsWith("--")) {
        throw new Error("The --uid option requires a UID value.");
      }
      uid = uidValue;
      index += 1;
      continue;
    }

    if (argument === "--apply") {
      if (apply) {
        throw new Error("The --apply option may be provided only once.");
      }
      apply = true;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  if (!uid?.trim()) {
    throw new Error("A non-empty Firebase Auth UID is required with --uid.");
  }

  return { uid, apply };
}

export function proposedOwnerClaims(currentClaims: CustomClaims): CustomClaims {
  return { ...currentClaims, owner: true };
}

function identitySummary(user: AuthUser) {
  return {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
  };
}

export async function bootstrapOwner(
  auth: OwnerBootstrapAuth,
  options: OwnerBootstrapOptions,
  logger: OwnerBootstrapLogger,
): Promise<void> {
  const user = await auth.getUser(options.uid);
  const currentClaims = user.customClaims ?? {};
  const proposedClaims = proposedOwnerClaims(currentClaims);

  logger.log("Target user:", identitySummary(user));
  logger.log("Current custom claims:", currentClaims);
  logger.log("Proposed custom claims:", proposedClaims);

  if (!options.apply) {
    logger.log("Dry run complete. No custom claims were changed.");
    return;
  }

  await auth.setCustomUserClaims(options.uid, proposedClaims);
  const verifiedUser = await auth.getUser(options.uid);
  const resultingClaims = verifiedUser.customClaims ?? {};

  if (resultingClaims.owner !== true) {
    throw new Error("Owner claim verification failed after apply.");
  }

  logger.log("Apply complete. Verified custom claims:", resultingClaims);
}
