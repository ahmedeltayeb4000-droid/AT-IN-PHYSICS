import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import {
  runTrustedManualEnrollmentGrant,
  type ManualEnrollmentGrantResult,
} from "../enrollments/manualEnrollmentGrant.js";
import {
  parseManualGrantInput,
  requireFutureExpiry,
  validateTargetUserId,
} from "../enrollments/validation.js";
import { resolveSessionDiscoveryProjectId } from "./sessionDiscoveryMigration.js";

export const ENROLLMENT_GRANT_OWNER_UID_ENV = "AT_IN_PHYSICS_OWNER_UID";
const PRODUCTION_PROJECT_ID = "at-in-physics";
const DEMO_PROJECT_ID = "demo-at-in-physics";

export type EnrollmentGrantCliOptions = {
  readonly targetUserId: string;
  readonly courseId: string;
  readonly expiresAt: string | null;
  readonly apply: boolean;
};

export type EnrollmentGrantEnvironment = Readonly<
  Record<string, string | undefined>
>;

function optionValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`The ${option} option requires a value.`);
  }
  return value;
}

export function parseEnrollmentGrantArgs(
  args: readonly string[],
  trustedNow = new Date(),
): EnrollmentGrantCliOptions {
  let targetUserId: string | undefined;
  let courseId: string | undefined;
  let expiresAt: string | null = null;
  let expiresAtSeen = false;
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--user-id") {
      if (targetUserId !== undefined)
        throw new Error("--user-id may be provided only once.");
      targetUserId = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--course-id") {
      if (courseId !== undefined)
        throw new Error("--course-id may be provided only once.");
      courseId = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--expires-at") {
      if (expiresAtSeen)
        throw new Error("--expires-at may be provided only once.");
      expiresAt = optionValue(args, index, argument);
      expiresAtSeen = true;
      index += 1;
    } else if (argument === "--apply") {
      if (apply) throw new Error("--apply may be provided only once.");
      apply = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  const input = parseManualGrantInput({ targetUserId, courseId, expiresAt });
  requireFutureExpiry(input.expiresAt, trustedNow);
  return { ...input, apply };
}

export function resolveEnrollmentGrantProject(
  environment: EnrollmentGrantEnvironment,
): string {
  const projectId = resolveSessionDiscoveryProjectId(environment);
  const authEmulator = Boolean(environment.FIREBASE_AUTH_EMULATOR_HOST);
  const firestoreEmulator = Boolean(environment.FIRESTORE_EMULATOR_HOST);
  if (projectId === DEMO_PROJECT_ID) {
    if (!authEmulator || !firestoreEmulator) {
      throw new Error(
        "The demo project requires both Auth and Firestore emulators.",
      );
    }
    return projectId;
  }
  if (projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error(
      "The configured Firebase project is not an approved enrollment target.",
    );
  }
  if (authEmulator || firestoreEmulator) {
    throw new Error(
      "Production project identity must not be mixed with emulator hosts.",
    );
  }
  return projectId;
}

export function resolveTrustedOwnerUid(
  environment: EnrollmentGrantEnvironment,
): string {
  return validateTargetUserId(environment[ENROLLMENT_GRANT_OWNER_UID_ENV]);
}

async function requireOwnerAuthority(auth: Auth, uid: string): Promise<void> {
  let user;
  try {
    user = await auth.getUser(uid);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "auth/user-not-found")
      throw new Error("Trusted owner Auth user was not found.", {
        cause: error,
      });
    throw error;
  }
  if (user.customClaims?.owner !== true) {
    throw new Error("Trusted owner UID does not have owner authority.");
  }
}

export async function runEnrollmentGrantCliService(
  auth: Auth,
  db: Firestore,
  options: EnrollmentGrantCliOptions,
  trustedOwnerUid: string,
  trustedNow = new Date(),
): Promise<ManualEnrollmentGrantResult> {
  const ownerUid = validateTargetUserId(trustedOwnerUid);
  await requireOwnerAuthority(auth, ownerUid);
  return runTrustedManualEnrollmentGrant(
    auth,
    db,
    options,
    ownerUid,
    trustedNow,
  );
}

export function safeEnrollmentGrantSummary(
  result: ManualEnrollmentGrantResult,
) {
  return {
    enrollmentPath: result.enrollmentPath,
    currentEnrollment: result.currentEnrollment,
    proposedStatus: result.proposedStatus,
    effectiveExpiresAt: result.effectiveExpiresAt,
    changeRequired: result.changeRequired,
    applyStatus: result.applyStatus,
    postApplyVerified: result.postApplyVerified,
  };
}
