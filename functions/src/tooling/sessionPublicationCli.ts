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
  parseSessionPublicationArgs,
  resolveSessionPublicationOwnerUid,
  resolveSessionPublicationProject,
  runSessionPublicationService,
  safeSessionPublicationSummary,
} from "./sessionPublication.js";

async function main() {
  const options = parseSessionPublicationArgs(process.argv.slice(2));
  const projectId = resolveSessionPublicationProject(process.env);
  const ownerUid = resolveSessionPublicationOwnerUid(process.env);
  console.log(`Project ID: ${projectId}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Course ID: ${options.courseId}`);
  console.log(`Module ID: ${options.moduleId}`);
  console.log(`Session ID: ${options.sessionId}`);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "owner-session-publication-cli",
  );
  try {
    const summary = safeSessionPublicationSummary(
      await runSessionPublicationService(
        getAuth(app),
        getFirestore(app),
        options,
        ownerUid,
      ),
    );
    console.log(`Session path: ${summary.sessionPath}`);
    console.log(
      `Current publication state: ${summary.currentPublicationState}`,
    );
    console.log(`Release state: ${summary.releaseState}`);
    console.log(`Content readiness: ${summary.contentReadiness}`);
    console.log(`Current discovery state: ${summary.currentDiscoveryState}`);
    console.log(
      `Proposed publication state: ${summary.proposedPublicationState}`,
    );
    console.log(
      `Proposed discovery IDs: ${summary.proposedSessionIds.join(", ") || "NONE"}`,
    );
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
    "Session publication failed. Review the validated local configuration and input.",
  );
  process.exitCode = 1;
});
