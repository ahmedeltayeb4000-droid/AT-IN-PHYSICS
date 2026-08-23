import console from "node:console";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readLessonTextFile } from "../lessonContent/validation.js";
import {
  parseLessonContentPublicationArgs,
  runLessonContentPublication,
} from "./lessonContentPublication.js";
import { resolveSessionDiscoveryProjectId } from "./sessionDiscoveryMigration.js";

async function main() {
  const options = parseLessonContentPublicationArgs(process.argv.slice(2));
  const projectId = resolveSessionDiscoveryProjectId(process.env);
  const lessonText = await readLessonTextFile(options.lessonFile);
  const mode = options.apply ? "APPLY" : "DRY RUN";

  console.log(`Project ID: ${projectId}`);
  console.log(`Course ID: ${options.courseId}`);
  console.log(`Module ID: ${options.moduleId}`);
  console.log(`Session ID: ${options.sessionId}`);
  console.log(`Mode: ${mode}`);

  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "lesson-content-publication",
  );
  try {
    const result = await runLessonContentPublication(
      getFirestore(app),
      options,
      lessonText,
      options.apply,
    );
    console.log(`Current lessonText: ${result.inspection.currentState}`);
    console.log(
      `Current character count: ${result.inspection.currentCharacterCount ?? "N/A"}`,
    );
    console.log(
      `Proposed character count: ${result.inspection.proposedCharacterCount}`,
    );
    console.log(
      `Change required: ${result.inspection.changeRequired ? "YES" : "NO"}`,
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
      ? `Lesson content publication failed: ${error.message}`
      : "Lesson content publication failed.",
  );
  process.exitCode = 1;
});
