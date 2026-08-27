import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  prepareVideoPublicationPackage,
  type PreparedVideoPublicationPackage,
} from "../tooling/videoDescriptorPublication.js";
import { DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT } from "../tooling/videoPackaging.js";
import type { OwnerVideoPreparationSummary } from "./videoPreparation.js";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RELEASE_ROOT = join(REPOSITORY_ROOT, "hosting-release");

type ReleaseAssembly = Readonly<{
  releaseRoot: string;
  files: string[];
  mediaCount: number;
}>;
type PreflightEntry = Readonly<{ path: string; size: number; sha256: string }>;
type PreflightReport = Readonly<{
  projectId: string;
  gitCommit: string;
  summary: Readonly<{
    fileCount: number;
    totalBytes: number;
    frontendBytes: number;
    protectedMediaBytes: number;
    atv1Count: number;
  }>;
  quota: Readonly<{
    actualRemainingMonthlyTransferIsLocallyKnowable: boolean;
  }>;
  deployment: Readonly<{
    firebaseToolsVersion: string;
    projectId: string;
    hostingTarget: string;
    hostingSite: string;
    deploySource: string;
    repositoryLocalCli: boolean;
    shellRequired: boolean;
  }>;
  files: PreflightEntry[];
  outcome: string;
}>;

export type OwnerPreparedVideo = Readonly<{
  preparationId: string;
  summary: OwnerVideoPreparationSummary;
}>;
export type OwnerReleaseReview = Readonly<{
  releaseId: string;
  preparationId: string;
  fingerprint: string;
  descriptorFileName: string;
  prepared: PreparedVideoPublicationPackage;
  safe: {
    projectId: string;
    target: OwnerVideoPreparationSummary["target"];
    videoAssetId: string;
    artifactFileName: string;
    artifactSize: number;
    artifactSha256: string;
    hostingRoute: string;
    releaseFileCount: number;
    atv1Count: number;
    state: "LOCAL_RELEASE_NOT_DEPLOYED";
  };
}>;

export type OwnerVideoReleaseDependencies = Readonly<{
  buildFrontend?: () => Promise<void>;
  preparePackage?: typeof prepareVideoPublicationPackage;
  assembleRelease?: () => Promise<ReleaseAssembly>;
  readReleaseArtifact?: (path: string) => Promise<Buffer>;
  runPreflight?: (options: {
    projectId: string;
    expectedProjectId: string;
  }) => Promise<{ report: PreflightReport; reportPath: string }>;
}>;

async function importHostingModule(relativePath: string) {
  return import(pathToFileURL(join(REPOSITORY_ROOT, relativePath)).href);
}

async function buildFrontend(): Promise<void> {
  const options = {
    cwd: REPOSITORY_ROOT,
    windowsHide: true,
    timeout: 5 * 60_000,
    maxBuffer: 1024 * 1024,
  } as const;
  await execFileAsync(
    process.execPath,
    [join(REPOSITORY_ROOT, "node_modules", "typescript", "bin", "tsc"), "-b"],
    options,
  );
  await execFileAsync(
    process.execPath,
    [join(REPOSITORY_ROOT, "node_modules", "vite", "bin", "vite.js"), "build"],
    options,
  );
}

async function assembleRelease(): Promise<ReleaseAssembly> {
  const module = await importHostingModule(
    "scripts/hosting/releaseAssembly.mjs",
  );
  return module.assembleHostingRelease();
}

async function runPreflight(options: {
  projectId: string;
  expectedProjectId: string;
}) {
  const module = await importHostingModule(
    "scripts/hosting/deployPreflight.mjs",
  );
  return module.runHostingDeployPreflight(options);
}

function assertPreparedIdentity(
  known: OwnerPreparedVideo,
  prepared: PreparedVideoPublicationPackage,
) {
  const expected = known.summary;
  if (
    prepared.input.courseId !== expected.target.courseId ||
    prepared.input.moduleId !== expected.target.moduleId ||
    prepared.input.sessionId !== expected.target.sessionId ||
    prepared.input.videoAssetId !== expected.videoAssetId ||
    prepared.summary.artifactFileName !== expected.artifactFileName ||
    prepared.summary.artifactSha256 !== expected.artifactSha256 ||
    prepared.summary.encryptedSize !== expected.encryptedSize
  ) {
    throw new Error("Prepared video no longer matches its trusted identity.");
  }
}

export async function prepareOwnerHostingRelease(
  known: OwnerPreparedVideo,
  projectId: string,
  releaseId: string,
  dependencies: OwnerVideoReleaseDependencies = {},
): Promise<OwnerReleaseReview> {
  const descriptorPath = join(
    DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT,
    known.summary.descriptorFileName,
  );
  const preparePackage =
    dependencies.preparePackage ?? prepareVideoPublicationPackage;
  const before = await preparePackage(descriptorPath);
  assertPreparedIdentity(known, before);
  await (dependencies.buildFrontend ?? buildFrontend)();
  const release = await (dependencies.assembleRelease ?? assembleRelease)();
  const after = await preparePackage(descriptorPath);
  assertPreparedIdentity(known, after);
  const route = known.summary.hostingRoute.replace(/^\//, "");
  if (!release.files.includes(route))
    throw new Error("Prepared video is absent from the Hosting release.");
  const releaseArtifact = await (dependencies.readReleaseArtifact ?? readFile)(
    join(RELEASE_ROOT, route),
  );
  const releaseSha256 = createHash("sha256")
    .update(releaseArtifact)
    .digest("hex");
  if (
    releaseArtifact.length !== known.summary.encryptedSize ||
    releaseSha256 !== known.summary.artifactSha256
  )
    throw new Error("Hosting release artifact integrity verification failed.");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        projectId,
        target: known.summary.target,
        videoAssetId: known.summary.videoAssetId,
        artifactSha256: releaseSha256,
        files: release.files,
      }),
    )
    .digest("hex");
  return {
    releaseId,
    preparationId: known.preparationId,
    fingerprint,
    descriptorFileName: known.summary.descriptorFileName,
    prepared: after,
    safe: {
      projectId,
      target: known.summary.target,
      videoAssetId: known.summary.videoAssetId,
      artifactFileName: known.summary.artifactFileName,
      artifactSize: releaseArtifact.length,
      artifactSha256: releaseSha256,
      hostingRoute: known.summary.hostingRoute,
      releaseFileCount: release.files.length,
      atv1Count: release.mediaCount,
      state: "LOCAL_RELEASE_NOT_DEPLOYED",
    },
  };
}

export async function preflightOwnerHostingRelease(
  review: OwnerReleaseReview,
  projectId: string,
  dependencies: OwnerVideoReleaseDependencies = {},
) {
  if (review.safe.projectId !== projectId)
    throw new Error("Release target project changed after review.");
  const prepared = await (
    dependencies.preparePackage ?? prepareVideoPublicationPackage
  )(join(DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT, review.descriptorFileName));
  assertPreparedIdentity(
    {
      preparationId: review.preparationId,
      summary: {
        target: review.safe.target,
        videoAssetId: review.safe.videoAssetId,
        inputFileName: "redacted.mp4",
        plaintextSize: review.prepared.summary.plaintextSize,
        encryptedSize: review.safe.artifactSize,
        artifactFileName: review.safe.artifactFileName,
        descriptorFileName: review.descriptorFileName,
        artifactSha256: review.safe.artifactSha256,
        hostingRoute: review.safe.hostingRoute,
        stagingStatus: "prepared",
        status: "LOCAL_ONLY_NOT_UPLOADED",
      },
    },
    prepared,
  );
  const { report }: { report: PreflightReport; reportPath: string } = await (
    dependencies.runPreflight ?? runPreflight
  )({
    projectId,
    expectedProjectId: projectId,
  });
  const route = review.safe.hostingRoute.replace(/^\//, "");
  const artifact = report.files.find((entry) => entry.path === route);
  if (
    !artifact ||
    artifact.size !== review.safe.artifactSize ||
    artifact.sha256 !== review.safe.artifactSha256
  )
    throw new Error("Preflight release no longer matches the reviewed video.");
  return {
    projectId: report.projectId,
    gitCommit: report.gitCommit,
    ...report.summary,
    artifactSha256: artifact.sha256,
    hostingRoute: review.safe.hostingRoute,
    quotaWarning:
      "Firebase Hosting no-cost quotas are limited; remaining monthly transfer cannot be proven locally.",
    remainingMonthlyTransferKnown:
      report.quota.actualRemainingMonthlyTransferIsLocallyKnowable,
    firebaseToolsVersion: report.deployment.firebaseToolsVersion,
    hostingTarget: report.deployment.hostingTarget,
    hostingSite: report.deployment.hostingSite,
    deploySource: report.deployment.deploySource,
    state: "READY_FOR_DEPLOYMENT_REVIEW_NOT_DEPLOYED" as const,
  };
}
