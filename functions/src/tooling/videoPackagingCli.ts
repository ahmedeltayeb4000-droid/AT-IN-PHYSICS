import console from "node:console";
import process from "node:process";
import {
  parseVideoPackagingArgs,
  runVideoPackaging,
} from "./videoPackaging.js";

async function main() {
  const options = parseVideoPackagingArgs(process.argv.slice(2));
  const result = await runVideoPackaging(options);

  console.log(`Course ID: ${result.target.courseId}`);
  console.log(`Module ID: ${result.target.moduleId}`);
  console.log(`Session ID: ${result.target.sessionId}`);
  console.log(`Video asset ID: ${result.videoAssetId}`);
  console.log(`Input file: ${result.inputFileName}`);
  console.log(`Plaintext size: ${result.plaintextSize} bytes`);
  console.log(`Mode: ${result.mode === "package" ? "PACKAGE" : "DRY RUN"}`);
  console.log(`Artifact file: ${result.artifactFileName}`);
  console.log(`Descriptor file: ${result.descriptorFileName}`);

  if (result.mode === "dry-run") {
    console.log("Content key: NOT GENERATED");
    console.log("Dry run complete: zero output files created.");
    return;
  }

  console.log(`Encrypted size: ${result.encryptedSize} bytes`);
  console.log(`Artifact SHA-256: ${result.artifactSha256}`);
  console.log("Content key: PRESENT (redacted)");
  console.log(`Content key length: ${result.contentKeySummary.length}`);
  console.log(
    `Content key fingerprint prefix: ${result.contentKeySummary.fingerprintPrefix}`,
  );
  console.log("Local package complete. No Firebase or Hosting mutation occurred.");
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `Video packaging failed: ${error.message}`
      : "Video packaging failed.",
  );
  process.exitCode = 1;
});
