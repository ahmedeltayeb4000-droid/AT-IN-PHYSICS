import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT } from "../tooling/videoPackaging.js";
import {
  prepareVideoPublicationPackage,
  type PreparedVideoPublicationPackage,
} from "../tooling/videoDescriptorPublication.js";
import {
  createOwnerDeployReview,
  verifyOwnerRemoteArtifact,
  type OwnerDeployReview,
} from "./videoDeployment.js";
import {
  runOwnerFreshHostingPreflight,
  type OwnerReleaseReview,
  type PreflightReport,
} from "./videoRelease.js";
import type { OwnerVerifiedDeployment } from "./videoBinding.js";

type Target = Readonly<{ courseId: string; moduleId: string; sessionId: string }>;
type RecoveryDependencies = Readonly<{
  listPackages?: typeof listPackages;
  preparePackage?: typeof prepareVideoPublicationPackage;
  freshPreflight?: typeof runOwnerFreshHostingPreflight;
  createDeployReview?: typeof createOwnerDeployReview;
  verifyRemote?: typeof verifyOwnerRemoteArtifact;
}>;

async function listPackages() {
  return readdir(DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT, { withFileTypes: true });
}

function sameTarget(prepared: PreparedVideoPublicationPackage, target: Target) {
  return prepared.input.courseId === target.courseId &&
    prepared.input.moduleId === target.moduleId &&
    prepared.input.sessionId === target.sessionId;
}

async function discoverPackage(target: Target, dependencies: RecoveryDependencies) {
  const entries = await (dependencies.listPackages ?? listPackages)();
  const descriptors = entries
    .filter((entry) => entry.name.endsWith(".publication.json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const matches: Array<{ prepared: PreparedVideoPublicationPackage; descriptorFileName: string }> = [];
  for (const entry of descriptors) {
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error("Local video descriptor entry is unsafe.");
    const prepared = await (dependencies.preparePackage ?? prepareVideoPublicationPackage)(
      join(DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT, entry.name),
    );
    if (entry.name !== `${prepared.input.videoAssetId}.publication.json`)
      throw new Error("Local video descriptor filename is inconsistent.");
    if (sameTarget(prepared, target)) matches.push({ prepared, descriptorFileName: entry.name });
  }
  if (matches.length !== 1)
    throw new Error("Exactly one trusted local video descriptor is required.");
  return matches[0]!;
}

function requireReleaseArtifact(report: PreflightReport, prepared: PreparedVideoPublicationPackage) {
  const route = `/protected-media/${prepared.input.videoAssetId}.atv1`;
  const artifact = report.files.find((entry) => entry.path === route.slice(1));
  if (!artifact || artifact.size !== prepared.summary.encryptedSize || artifact.sha256 !== prepared.summary.artifactSha256)
    throw new Error("Hosting release artifact does not match the trusted package.");
  return { route, artifact };
}

function releaseIdentity(
  prepared: PreparedVideoPublicationPackage,
  report: PreflightReport,
  projectId: string,
  recoveryId: string,
): OwnerReleaseReview {
  const { route, artifact } = requireReleaseArtifact(report, prepared);
  return {
    releaseId: recoveryId,
    preparationId: recoveryId,
    fingerprint: createHash("sha256").update(JSON.stringify({
      projectId,
      target: prepared.summary.target,
      videoAssetId: prepared.summary.videoAssetId,
      artifactSha256: artifact.sha256,
      files: report.files.map((entry) => entry.path),
    })).digest("hex"),
    descriptorFileName: `${prepared.input.videoAssetId}.publication.json`,
    prepared,
    safe: {
      projectId,
      target: prepared.summary.target,
      videoAssetId: prepared.summary.videoAssetId,
      artifactFileName: prepared.summary.artifactFileName,
      artifactSize: artifact.size,
      artifactSha256: artifact.sha256,
      hostingRoute: route,
      releaseFileCount: report.summary.fileCount,
      atv1Count: report.summary.atv1Count,
      state: "LOCAL_RELEASE_NOT_DEPLOYED",
    },
  };
}

export async function recoverOwnerExistingDeployment(
  target: Target,
  projectId: string,
  deploymentId: string,
  reviewId: string,
  dependencies: RecoveryDependencies = {},
): Promise<{ deployment: OwnerVerifiedDeployment; safe: Record<string, unknown> }> {
  const discovered = await discoverPackage(target, dependencies);
  const { prepared } = discovered;
  const { report } = await (dependencies.freshPreflight ?? runOwnerFreshHostingPreflight)(projectId);
  if (
    report.projectId !== projectId ||
    report.deployment.projectId !== projectId ||
    report.deployment.hostingTarget !== "production" ||
    report.deployment.hostingSite !== projectId ||
    report.deployment.repositoryLocalCli !== true ||
    report.deployment.shellRequired !== false
  )
    throw new Error("Hosting preflight project identity is inconsistent.");
  const release = releaseIdentity(prepared, report, projectId, deploymentId);
  if (release.descriptorFileName !== discovered.descriptorFileName)
    throw new Error("Recovered descriptor identity is inconsistent.");
  const createReview = dependencies.createDeployReview ?? createOwnerDeployReview;
  const review: OwnerDeployReview = await createReview(release, projectId, reviewId, {
    inspect: async () => ({ report, safe: {} as never }),
  });
  const remote = await (dependencies.verifyRemote ?? verifyOwnerRemoteArtifact)(review);
  const deployment: OwnerVerifiedDeployment = {
    deploymentId,
    status: "VERIFIED_DEPLOYED",
    review,
  };
  return {
    deployment,
    safe: {
      deploymentId,
      status: deployment.status,
      projectId,
      sessionId: target.sessionId,
      videoAssetId: review.safe.videoAssetId,
      hostingRoute: review.safe.hostingRoute,
      artifactSha256: remote.sha256,
      artifactSize: remote.size,
      remoteVerified: true,
      hostingDeploymentPerformed: false,
      firestoreBindingPerformed: false,
    },
  };
}
