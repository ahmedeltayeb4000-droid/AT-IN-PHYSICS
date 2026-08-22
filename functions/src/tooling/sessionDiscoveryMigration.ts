import { type Firestore } from "firebase-admin/firestore";
import {
  SESSION_DISCOVERY_DOCUMENT_ID,
  buildSessionDiscoveryManifest,
  parseSessionDiscoveryRefreshInput,
  sessionDiscoveryManifestsEqual,
  type SessionDiscoveryManifest,
} from "../sessionDiscovery/manifest.js";
import {
  refreshSessionDiscoveryManifest,
  trustedSessionRecordFromSnapshot,
} from "../sessionDiscovery/refreshSessionDiscovery.js";

export type SessionDiscoveryMigrationOptions = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly apply: boolean;
};

export type SessionDiscoveryMigrationInspection = {
  readonly currentManifestExists: boolean;
  readonly currentManifest: unknown;
  readonly proposedManifest: SessionDiscoveryManifest;
  readonly changeRequired: boolean;
};

export type SessionDiscoveryMigrationResult = {
  readonly inspection: SessionDiscoveryMigrationInspection;
  readonly writeNecessary: boolean;
  readonly verified: boolean;
};

export type SessionDiscoveryMigrationEnvironment = Readonly<
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

export function parseSessionDiscoveryMigrationArgs(
  args: readonly string[],
): SessionDiscoveryMigrationOptions {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let courseIdSeen = false;
  let moduleIdSeen = false;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--course-id") {
      if (courseIdSeen) {
        throw new Error("The --course-id option may be provided only once.");
      }
      courseIdSeen = true;
      courseId = optionValue(args, index, argument);
      index += 1;
      continue;
    }

    if (argument === "--module-id") {
      if (moduleIdSeen) {
        throw new Error("The --module-id option may be provided only once.");
      }
      moduleIdSeen = true;
      moduleId = optionValue(args, index, argument);
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

  const input = parseSessionDiscoveryRefreshInput({ courseId, moduleId });
  return { ...input, apply };
}

export function resolveSessionDiscoveryProjectId(
  environment: SessionDiscoveryMigrationEnvironment,
): string {
  const configured = [
    environment.GOOGLE_CLOUD_PROJECT,
    environment.GCLOUD_PROJECT,
  ].filter((value): value is string => value !== undefined && value !== "");
  const distinct = [...new Set(configured)];

  if (distinct.length !== 1) {
    throw new Error(
      distinct.length === 0
        ? "A Firebase project ID is required in GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT."
        : "Configured Firebase project IDs do not match.",
    );
  }

  const projectId = distinct[0];
  if (
    projectId.length > 128 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(projectId)
  ) {
    throw new Error("The configured Firebase project ID is invalid.");
  }
  return projectId;
}

export async function inspectSessionDiscoveryMigration(
  db: Firestore,
  options: Pick<SessionDiscoveryMigrationOptions, "courseId" | "moduleId">,
  trustedNow: Date,
): Promise<SessionDiscoveryMigrationInspection> {
  const input = parseSessionDiscoveryRefreshInput(options);
  if (Number.isNaN(trustedNow.getTime())) {
    throw new Error("Trusted Session discovery time is invalid.");
  }

  const courseReference = db.doc(`courses/${input.courseId}`);
  const moduleReference = courseReference.collection("modules").doc(input.moduleId);
  const manifestReference = moduleReference
    .collection("sessionDiscovery")
    .doc(SESSION_DISCOVERY_DOCUMENT_ID);
  const [courseSnapshot, moduleSnapshot] = await db.getAll(
    courseReference,
    moduleReference,
  );

  if (!courseSnapshot.exists) throw new Error("Course was not found.");
  if (!moduleSnapshot.exists) throw new Error("Module was not found.");

  const [sessionsSnapshot, manifestSnapshot] = await Promise.all([
    moduleReference.collection("sessions").get(),
    manifestReference.get(),
  ]);
  const proposedManifest = buildSessionDiscoveryManifest(
    sessionsSnapshot.docs.map(trustedSessionRecordFromSnapshot),
    trustedNow,
  );
  const currentManifest = manifestSnapshot.exists
    ? manifestSnapshot.data()
    : null;

  return {
    currentManifestExists: manifestSnapshot.exists,
    currentManifest,
    proposedManifest,
    changeRequired:
      !manifestSnapshot.exists ||
      !sessionDiscoveryManifestsEqual(currentManifest, proposedManifest),
  };
}

export async function runSessionDiscoveryMigration(
  db: Firestore,
  options: SessionDiscoveryMigrationOptions,
  trustedNow: Date,
  onInspection?: (inspection: SessionDiscoveryMigrationInspection) => void,
): Promise<SessionDiscoveryMigrationResult> {
  const input = {
    courseId: options.courseId,
    moduleId: options.moduleId,
  };
  const inspection = await inspectSessionDiscoveryMigration(
    db,
    input,
    trustedNow,
  );
  onInspection?.(inspection);

  if (!options.apply) {
    return { inspection, writeNecessary: false, verified: false };
  }

  const refreshResult = await refreshSessionDiscoveryManifest(
    db,
    input,
    trustedNow,
  );
  const manifestSnapshot = await db
    .doc(
      `courses/${options.courseId}/modules/${options.moduleId}/sessionDiscovery/${SESSION_DISCOVERY_DOCUMENT_ID}`,
    )
    .get();
  const verified =
    manifestSnapshot.exists &&
    sessionDiscoveryManifestsEqual(
      manifestSnapshot.data(),
      inspection.proposedManifest,
    );

  if (!verified) {
    throw new Error("Session discovery manifest verification failed after apply.");
  }

  return {
    inspection,
    writeNecessary: refreshResult.writeNecessary,
    verified,
  };
}
