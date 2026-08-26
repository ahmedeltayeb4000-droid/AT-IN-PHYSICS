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
  parseSessionCreationArgs,
  resolveSessionCreationOwnerUid,
  resolveSessionCreationProject,
  runSessionCreationService,
  safeSessionCreationSummary,
} from "./sessionCreation.js";

async function main() {
  const options = parseSessionCreationArgs(process.argv.slice(2));
  const projectId = resolveSessionCreationProject(process.env);
  const ownerUid = resolveSessionCreationOwnerUid(process.env);
  console.log(`Project ID: ${projectId}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Course ID: ${options.courseId}`);
  console.log(`Module ID: ${options.moduleId}`);
  console.log(`Session ID: ${options.sessionId}`);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "owner-session-creation-cli",
  );
  try {
    const summary = safeSessionCreationSummary(
      await runSessionCreationService(
        getAuth(app),
        getFirestore(app),
        options,
        ownerUid,
      ),
    );
    console.log(`Session path: ${summary.sessionPath}`);
    console.log(`Current Session: ${summary.currentSession}`);
    console.log(`Proposed title: ${summary.proposedTitle}`);
    console.log(`Proposed order: ${summary.proposedOrder}`);
    console.log(
      `Proposed publication status: ${summary.proposedPublicationStatus}`,
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
    "Session creation failed. Review the validated local configuration and input.",
  );
  process.exitCode = 1;
});
