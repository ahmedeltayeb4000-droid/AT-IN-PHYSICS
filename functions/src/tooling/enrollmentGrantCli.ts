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
  parseEnrollmentGrantArgs,
  resolveEnrollmentGrantProject,
  resolveTrustedOwnerUid,
  runEnrollmentGrantCliService,
  safeEnrollmentGrantSummary,
} from "./enrollmentGrant.js";

async function main() {
  const trustedNow = new Date();
  const options = parseEnrollmentGrantArgs(process.argv.slice(2), trustedNow);
  const projectId = resolveEnrollmentGrantProject(process.env);
  const ownerUid = resolveTrustedOwnerUid(process.env);
  console.log(`Project ID: ${projectId}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`User UID: ${options.targetUserId}`);
  console.log(`Course ID: ${options.courseId}`);

  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "owner-enrollment-grant-cli",
  );
  try {
    const result = await runEnrollmentGrantCliService(
      getAuth(app),
      getFirestore(app),
      options,
      ownerUid,
      trustedNow,
    );
    const summary = safeEnrollmentGrantSummary(result);
    console.log(`Enrollment path: ${summary.enrollmentPath}`);
    console.log(`Current enrollment: ${summary.currentEnrollment}`);
    console.log(`Proposed status: ${summary.proposedStatus}`);
    console.log(`Expiry: ${summary.effectiveExpiresAt ?? "NONE"}`);
    console.log(`Change required: ${summary.changeRequired ? "YES" : "NO"}`);
    if (!options.apply) {
      console.log("Dry run complete: zero writes performed.");
    } else {
      console.log(`Apply result: ${summary.applyStatus}`);
      console.log("Post-apply verification: PASSED");
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `Enrollment grant failed: ${error.message}`
      : "Enrollment grant failed.",
  );
  process.exitCode = 1;
});
