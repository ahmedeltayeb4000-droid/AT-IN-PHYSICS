import console from "node:console";
import process from "node:process";
import {
  parseVideoHostingPreparationArgs,
  runVideoHostingPreparation,
} from "./videoHostingPreparation.js";

async function main() {
  const options = parseVideoHostingPreparationArgs(process.argv.slice(2));
  const result = await runVideoHostingPreparation(options);
  console.log(
    `Mode: ${result.mode === "prepare" ? "LOCAL PREPARE" : "DRY RUN"}`,
  );
  console.log(`Source artifact: ${result.sourceArtifact}`);
  console.log(`Hosting route: ${result.hostingRoute}`);
  console.log(`Staging destination: ${result.stagingDestination}`);
  console.log(`Encrypted bytes: ${result.encryptedSize}`);
  console.log(`SHA-256: ${result.sha256}`);
  console.log(`Status: ${result.status}`);
  console.log(
    "Quota assumption: 10 GiB Hosting storage, approximately 10 GiB/month transfer, 2 GiB per file.",
  );
  console.log("No Firebase access, upload, or deployment was performed.");
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Hosting preparation failed.",
  );
  process.exitCode = 1;
});
