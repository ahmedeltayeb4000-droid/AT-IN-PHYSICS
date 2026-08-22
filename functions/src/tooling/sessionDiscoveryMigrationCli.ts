import console from "node:console";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  parseSessionDiscoveryMigrationArgs,
  resolveSessionDiscoveryProjectId,
  runSessionDiscoveryMigration,
  type SessionDiscoveryMigrationInspection,
} from "./sessionDiscoveryMigration.js";

function printableCurrentManifest(
  inspection: SessionDiscoveryMigrationInspection,
): string {
  if (!inspection.currentManifestExists) return "MISSING";

  const value = inspection.currentManifest;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "MALFORMED";
  }
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).length !== 1 ||
    !Array.isArray(data.sessionIds) ||
    !data.sessionIds.every((sessionId) => typeof sessionId === "string")
  ) {
    return "MALFORMED";
  }
  return JSON.stringify({ sessionIds: data.sessionIds });
}

async function main() {
  const options = parseSessionDiscoveryMigrationArgs(process.argv.slice(2));
  const projectId = resolveSessionDiscoveryProjectId(process.env);
  const mode = options.apply ? "APPLY" : "DRY RUN";

  console.log(`Project ID: ${projectId}`);
  console.log(`Course ID: ${options.courseId}`);
  console.log(`Module ID: ${options.moduleId}`);
  console.log(`Mode: ${mode}`);

  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "session-discovery-migration",
  );

  try {
    const result = await runSessionDiscoveryMigration(
      getFirestore(app),
      options,
      new Date(),
      (inspection) => {
        console.log(
          `Current manifest: ${printableCurrentManifest(inspection)}`,
        );
        console.log(
          `Proposed manifest: ${JSON.stringify(inspection.proposedManifest)}`,
        );
        console.log(
          `Change required: ${inspection.changeRequired ? "YES" : "NO"}`,
        );
      },
    );

    if (!options.apply) {
      console.log("Dry run complete: zero writes performed.");
      return;
    }

    console.log(`Apply result: ${result.writeNecessary ? "UPDATED" : "NO CHANGE"}`);
    console.log("Post-apply verification: PASSED");
  } finally {
    await deleteApp(app);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `Session discovery migration failed: ${error.message}`
      : "Session discovery migration failed.",
  );
  process.exitCode = 1;
});
