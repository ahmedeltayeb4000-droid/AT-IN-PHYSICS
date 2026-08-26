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
  parseCourseCreationArgs,
  resolveCourseCreationOwnerUid,
  resolveCourseCreationProject,
  runCourseCreationService,
  safeCourseCreationSummary,
} from "./courseCreation.js";

async function main() {
  const options = parseCourseCreationArgs(process.argv.slice(2));
  const projectId = resolveCourseCreationProject(process.env);
  const ownerUid = resolveCourseCreationOwnerUid(process.env);
  console.log(`Project ID: ${projectId}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Course ID: ${options.courseId}`);
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
