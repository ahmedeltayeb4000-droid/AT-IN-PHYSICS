import console from "node:console";
import process from "node:process";
import {
  applicationDefault,
  deleteApp,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  resolveModuleCreationOwnerUid,
  resolveModuleCreationProject,
  runModuleCreationService,
  safeModuleCreationSummary,
} from "./moduleCreation.js";
import { readTrustedModuleCreationRequest } from "./hierarchyCreationRequestFile.js";

function parseCliArgs(values: readonly string[]) {
  if (values.length !== 2 && values.length !== 3)
    throw new Error("Use --request-file <path> [--apply].");
  if (
    values[0] !== "--request-file" ||
    !values[1] ||
    (values.length === 3 && values[2] !== "--apply")
  )
    throw new Error("Use --request-file <path> [--apply].");
  const loaded = readTrustedModuleCreationRequest(values[1]);
  return {
    ...loaded.request,
    apply: values[2] === "--apply",
    requestSha256: loaded.sha256,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const projectId = resolveModuleCreationProject(process.env);
  const ownerUid = resolveModuleCreationOwnerUid(process.env);
  console.log(`Project ID: ${projectId}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Course ID: ${options.courseId}`);
  console.log(`Module ID: ${options.moduleId}`);
  console.log(`Request SHA-256: ${options.requestSha256}`);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "owner-module-creation-cli",
  );
  try {
    const summary = safeModuleCreationSummary(
      await runModuleCreationService(
        getAuth(app),
        getFirestore(app),
        options,
        ownerUid,
      ),
    );
    console.log(`Module path: ${summary.modulePath}`);
    console.log(`Current module: ${summary.currentModule}`);
    console.log(`Proposed title: ${summary.proposedTitle}`);
    console.log(`Proposed order: ${summary.proposedOrder}`);
    console.log(`Change required: ${summary.changeRequired ? "YES" : "NO"}`);
    if (!options.apply) console.log("Dry run complete: zero writes performed.");
    else {
      console.log(`Apply result: ${summary.applyStatus}`);
      console.log("Post-apply verification: PASSED");
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch(() => {
  console.error(
    "Module creation failed. Review the validated local configuration and input.",
  );
  process.exitCode = 1;
});
