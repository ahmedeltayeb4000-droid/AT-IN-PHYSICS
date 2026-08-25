import { assembleHostingRelease } from "./releaseAssembly.mjs";

try {
  const result = await assembleHostingRelease();
  console.log(`Hosting release prepared: ${result.releaseRoot}`);
  console.log(`Files: ${result.files.length}`);
  console.log(`Encrypted ATV1 artifacts: ${result.mediaCount}`);
  console.log("Release audit: PASSED");
  console.log("No upload or deployment was performed.");
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Hosting release preparation failed.",
  );
  process.exitCode = 1;
}
