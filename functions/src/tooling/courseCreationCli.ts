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
  resolveCourseCreationOwnerUid,
  resolveCourseCreationProject,
  runCourseCreationService,
  safeCourseCreationSummary,
} from "./courseCreation.js";
import { readTrustedCourseTextRequest } from "./courseRequestFile.js";

function parseCliArgs(values: readonly string[]) {
  if (values.length !== 2 && values.length !== 3) {
    throw new Error("Use --request-file <path> [--apply].");
  }
  if (
    values[0] !== "--request-file" ||
    !values[1] ||
    (values.length === 3 && values[2] !== "--apply")
  ) {
    throw new Error("Use --request-file <path> [--apply].");
  }
  const loaded = readTrustedCourseTextRequest(values[1]);
  return {
    ...loaded.request,
    apply: values[2] === "--apply",
    requestSha256: loaded.sha256,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const projectId = resolveCourseCreationProject(process.env);
  const ownerUid = resolveCourseCreationOwnerUid(process.env);
  console.log(`Project ID: ${projectId}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Course ID: ${options.courseId}`);
  console.log(`Request SHA-256: ${options.requestSha256}`);
  console.log(`Proposed title: ${options.title}`);
  console.log(`Proposed short description: ${options.shortDescription}`);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "owner-course-creation-cli",
  );
  try {
    const result = safeCourseCreationSummary(
      await runCourseCreationService(
        getAuth(app),
        getFirestore(app),
        options,
        ownerUid,
      ),
    );
    console.log(`Course path: ${result.coursePath}`);
    console.log(`Current course: ${result.currentCourse}`);
    console.log(`Change required: ${result.changeRequired ? "YES" : "NO"}`);
    if (!options.apply) console.log("Dry run complete: zero writes performed.");
    else {
      console.log(`Apply result: ${result.applyStatus}`);
      console.log("Post-apply verification: PASSED");
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `Course creation failed: ${error.message}`
      : "Course creation failed.",
  );
  process.exitCode = 1;
});
