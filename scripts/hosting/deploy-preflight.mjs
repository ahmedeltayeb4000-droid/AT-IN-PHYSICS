import {
  parseDeployPreflightArgs,
  runHostingDeployPreflight,
} from "./deployPreflight.mjs";

try {
  const options = parseDeployPreflightArgs(process.argv.slice(2));
  const result = await runHostingDeployPreflight(options);
  console.log(`Project: ${result.report.projectId}`);
  console.log(
    `Firebase CLI: ${result.report.deployment.firebaseToolsVersion} (repository-local)`,
  );
  console.log(`Hosting target: ${result.report.deployment.hostingTarget}`);
  console.log(`Hosting site: ${result.report.deployment.hostingSite}`);
  console.log(`Deploy source: ${result.report.deployment.deploySource}`);
  console.log(`Commit: ${result.report.gitCommit}`);
  console.log(`Files: ${result.report.summary.fileCount}`);
  console.log(`Total bytes: ${result.report.summary.totalBytes}`);
  console.log(`Frontend bytes: ${result.report.summary.frontendBytes}`);
  console.log(
    `Protected-media bytes: ${result.report.summary.protectedMediaBytes}`,
  );
  console.log(`ATV1 files: ${result.report.summary.atv1Count}`);
  console.log(`Report: ${result.reportPath}`);
  console.log(
    "Actual remaining monthly Hosting transfer quota cannot be proven locally.",
  );
  console.log("PREFLIGHT PASSED. REVIEW REQUIRED. NOTHING WAS DEPLOYED.");
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Hosting deployment preflight failed.",
  );
  process.exitCode = 1;
}
