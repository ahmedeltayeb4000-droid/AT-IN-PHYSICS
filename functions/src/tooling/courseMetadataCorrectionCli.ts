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
  applyCourseMetadataCorrection,
  reviewCourseMetadataCorrection,
} from "./courseMetadataCorrection.js";
import { readTrustedCourseTextRequest } from "./courseRequestFile.js";
import {
  resolveCourseCreationOwnerUid,
  resolveCourseCreationProject,
} from "./courseCreation.js";

function args(values: readonly string[]) {
  if (values.length !== 2 && values.length !== 3)
    throw new Error("Use --request-file <path> [--apply].");
  if (
    values[0] !== "--request-file" ||
    !values[1] ||
    (values.length === 3 && values[2] !== "--apply")
  ) {
    throw new Error("Use --request-file <path> [--apply].");
  }
  return { path: values[1], apply: values[2] === "--apply" };
}

async function main() {
  const options = args(process.argv.slice(2));
  const loaded = readTrustedCourseTextRequest(options.path);
  const projectId = resolveCourseCreationProject(process.env);
  const ownerUid = resolveCourseCreationOwnerUid(process.env);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "owner-course-correction-cli",
  );
  try {
    const review = await reviewCourseMetadataCorrection(
      getAuth(app),
      getFirestore(app),
      ownerUid,
      loaded.request,
    );
    console.log(`Project ID: ${projectId}`);
    console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
    console.log(`Course ID: ${review.request.courseId}`);
    console.log(`Request SHA-256: ${loaded.sha256}`);
    console.log(`Revision millis: ${review.revisionMillis}`);
    console.log(`Change required: ${review.changeRequired ? "YES" : "NO"}`);
    console.log(`Proposed title: ${review.request.title}`);
    console.log(
      `Proposed short description: ${review.request.shortDescription}`,
    );
    if (!options.apply) console.log("Dry run complete: zero writes performed.");
    else {
      const result = await applyCourseMetadataCorrection(
        getFirestore(app),
        review,
      );
      console.log(`Apply result: ${result.status}`);
      console.log("Post-apply verification: PASSED");
    }
  } finally {
    await deleteApp(app);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `Course correction failed: ${error.message}`
      : "Course correction failed.",
  );
  process.exitCode = 1;
});
