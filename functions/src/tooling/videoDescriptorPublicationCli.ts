import console from "node:console";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  parseVideoDescriptorPublicationArgs,
  prepareVideoPublicationPackage,
  runPreparedVideoPublication,
} from "./videoDescriptorPublication.js";
import { resolveSessionDiscoveryProjectId } from "./sessionDiscoveryMigration.js";

function printableStatus(status: "created" | "updated" | "already-current") {
  if (status === "created") return "CREATED";
  if (status === "updated") return "UPDATED";
  return "NO CHANGE";
}

async function main() {
  const options = parseVideoDescriptorPublicationArgs(process.argv.slice(2));
  const projectId = resolveSessionDiscoveryProjectId(process.env);
  const mode = options.apply ? "APPLY" : "DRY RUN";

  console.log(`Project ID: ${projectId}`);
  console.log(`Mode: ${mode}`);

  const prepared = await prepareVideoPublicationPackage(options.descriptorFile);
  console.log(`Course ID: ${prepared.summary.target.courseId}`);
  console.log(`Module ID: ${prepared.summary.target.moduleId}`);
  console.log(`Session ID: ${prepared.summary.target.sessionId}`);
  console.log(`Video asset ID: ${prepared.summary.videoAssetId}`);
  console.log(`Artifact file: ${prepared.summary.artifactFileName}`);
  console.log("Artifact SHA-256 verification: PASSED");
  console.log("Artifact authentication: PASSED");
  console.log("Plaintext MP4 verification: PASSED");

  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "video-descriptor-publication",
  );
  try {
    const result = await runPreparedVideoPublication(
      getFirestore(app),
      prepared,
      options.apply,
    );
    console.log(
      `Current Session video binding: ${result.preflight.currentSessionVideoBinding}`,
    );
    console.log(`Current video access: ${result.preflight.currentVideoAccess}`);
    console.log(`Proposed asset ID: ${result.package.videoAssetId}`);
    console.log(
      `Change required: ${result.preflight.changeRequired ? "YES" : "NO"}`,
    );

    if (!options.apply) {
      console.log("Dry run complete: zero writes performed.");
      return;
    }
    console.log(`Apply result: ${printableStatus(result.applyStatus!)}`);
    console.log("Post-apply verification: PASSED");
  } finally {
    await deleteApp(app);
  }
}

main().catch(() => {
  console.error("Video descriptor publication failed. Sensitive data was not logged.");
  process.exitCode = 1;
});
