import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  inspectOwnerHostingPreflight,
  type OwnerReleaseReview,
  type PreflightReport,
} from "./videoRelease.js";

export const HOSTING_DEPLOY_CONFIRMATION = "DEPLOY HOSTING TO PRODUCTION";
export const HOSTING_DEPLOY_TIMEOUT_MS = 2 * 60_000;
const REMOTE_VERIFY_TIMEOUT_MS = 30_000;
const MAX_CLI_OUTPUT_BYTES = 512 * 1024;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export type OwnerDeployReview = Readonly<{
  reviewId: string;
  release: OwnerReleaseReview;
  fingerprint: string;
  safe: {
    projectId: string;
    hostingTarget: string;
    hostingSite: string;
    firebaseToolsVersion: string;
    gitCommit: string;
    target: OwnerReleaseReview["safe"]["target"];
    videoAssetId: string;
    artifactFileName: string;
    artifactSha256: string;
    artifactSize: number;
    hostingRoute: string;
    releaseFileCount: number;
    releaseTotalBytes: number;
    warning: string;
    state: "PRODUCTION_DEPLOYMENT_REVIEW_NOT_DEPLOYED";
  };
}>;

type CliIdentity = Readonly<{
  version: string;
  nodeExecutable: string;
  cliScript: string;
  cwd: string;
  shell: false;
}>;

type DeploymentDependencies = Readonly<{
  inspect?: typeof inspectOwnerHostingPreflight;
  resolveCli?: () => Promise<CliIdentity>;
  deployArgs?: () => string[];
  runProcess?: (
    executable: string,
    args: string[],
    options: {
      cwd: string;
      shell: false;
      windowsHide: true;
      timeout: number;
      maxBuffer: number;
    },
  ) => Promise<void>;
  fetchImpl?: typeof fetch;
  remoteVerifyTimeoutMs?: number;
}>;

let deploymentActive = false;

async function deploymentConfigModule() {
  return import(
    pathToFileURL(join(REPOSITORY_ROOT, "scripts/hosting/deploymentConfig.mjs"))
      .href
  );
}

async function resolveCli(): Promise<CliIdentity> {
  return (await deploymentConfigModule()).resolvePinnedFirebaseCli();
}

async function deployArgs(): Promise<string[]> {
  return (await deploymentConfigModule()).futureHostingOnlyDeployArgs();
}

function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    shell: false;
    windowsHide: true;
    timeout: number;
    maxBuffer: number;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, options, (error) => {
      if (error)
        reject(new Error("Pinned Firebase Hosting deployment failed."));
      else resolve();
    });
  });
}

function deploymentIdentity(
  release: OwnerReleaseReview,
  report: PreflightReport,
) {
  return {
    projectId: report.projectId,
    hostingTarget: report.deployment.hostingTarget,
    hostingSite: report.deployment.hostingSite,
    firebaseToolsVersion: report.deployment.firebaseToolsVersion,
    gitCommit: report.gitCommit,
    firebaseConfigSha256: report.firebaseConfigSha256,
    firebaseRcSha256: report.firebaseRcSha256,
    releaseFingerprint: release.fingerprint,
    releaseFiles: report.files,
    target: release.safe.target,
    videoAssetId: release.safe.videoAssetId,
    hostingRoute: release.safe.hostingRoute,
    artifactSha256: release.safe.artifactSha256,
    artifactSize: release.safe.artifactSize,
  };
}

function fingerprintIdentity(value: ReturnType<typeof deploymentIdentity>) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function createOwnerDeployReview(
  release: OwnerReleaseReview,
  projectId: string,
  reviewId: string,
  dependencies: DeploymentDependencies = {},
): Promise<OwnerDeployReview> {
  const inspected = await (
    dependencies.inspect ?? inspectOwnerHostingPreflight
  )(release, projectId);
  const identity = deploymentIdentity(release, inspected.report);
  const artifact = inspected.report.files.find(
    (entry) => entry.path === release.safe.hostingRoute.replace(/^\//, ""),
  );
  if (
    !artifact ||
    artifact.sha256 !== release.safe.artifactSha256 ||
    artifact.size !== release.safe.artifactSize
  )
    throw new Error("Deployment review artifact identity is inconsistent.");
  return {
    reviewId,
    release,
    fingerprint: fingerprintIdentity(identity),
    safe: {
      projectId: inspected.report.projectId,
      hostingTarget: inspected.report.deployment.hostingTarget,
      hostingSite: inspected.report.deployment.hostingSite,
      firebaseToolsVersion: inspected.report.deployment.firebaseToolsVersion,
      gitCommit: inspected.report.gitCommit,
      target: release.safe.target,
      videoAssetId: release.safe.videoAssetId,
      artifactFileName: release.safe.artifactFileName,
      artifactSha256: artifact.sha256,
      artifactSize: artifact.size,
      hostingRoute: release.safe.hostingRoute,
      releaseFileCount: inspected.report.summary.fileCount,
      releaseTotalBytes: inspected.report.summary.totalBytes,
      warning:
        "This will upload the audited Hosting release to production. Firebase Hosting no-cost quotas are limited.",
      state: "PRODUCTION_DEPLOYMENT_REVIEW_NOT_DEPLOYED",
    },
  };
}

function remoteUrl(review: OwnerDeployReview) {
  const origin = new URL(`https://${review.safe.hostingSite}.web.app`);
  const url = new URL(review.safe.hostingRoute, origin);
  if (url.origin !== origin.origin || url.pathname !== review.safe.hostingRoute)
    throw new Error("Remote protected artifact URL is unsafe.");
  return { origin, url };
}

export async function verifyOwnerRemoteArtifact(
  review: OwnerDeployReview,
  dependencies: DeploymentDependencies = {},
) {
  const { origin, url } = remoteUrl(review);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    dependencies.remoteVerifyTimeoutMs ?? REMOTE_VERIFY_TIMEOUT_MS,
  );
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/octet-stream" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || new URL(location, url).origin !== origin.origin)
        throw new Error("Remote artifact redirected outside the trusted site.");
      throw new Error("Remote artifact returned an unexpected redirect.");
    }
    if (!response.ok) throw new Error("Remote artifact was not available.");
    if (response.url) {
      const finalUrl = new URL(response.url);
      if (finalUrl.origin !== origin.origin || finalUrl.pathname !== url.pathname)
        throw new Error("Remote artifact final URL was unsafe.");
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      Number(declaredLength) !== review.safe.artifactSize
    )
      throw new Error("Remote artifact size did not match the reviewed size.");
    const contentType = response.headers.get("content-type")?.split(";", 1)[0];
    if (contentType !== "application/octet-stream")
      throw new Error("Remote artifact content type was unexpected.");
    if (
      response.headers.get("x-content-type-options")?.toLowerCase() !==
      "nosniff"
    )
      throw new Error("Remote artifact security headers were incomplete.");
    if (!response.body)
      throw new Error("Remote artifact body was unavailable.");
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let size = 0;
    const expectedMagic = new TextEncoder().encode(
      review.safe.hostingRoute.endsWith(".atr1") ? "ATR1" : "ATV1",
    );
    const observedMagic: number[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value) {
        if (observedMagic.length < expectedMagic.length) observedMagic.push(byte);
      }
      size += value.byteLength;
      if (size > review.safe.artifactSize) {
        await reader.cancel();
        throw new Error("Remote artifact exceeded the reviewed size.");
      }
      hash.update(value);
    }
    if (
      size !== review.safe.artifactSize ||
      observedMagic.length !== expectedMagic.length ||
      observedMagic.some((byte, index) => byte !== expectedMagic[index]) ||
      hash.digest("hex") !== review.safe.artifactSha256
    )
      throw new Error(
        "Remote artifact bytes did not match the reviewed artifact.",
      );
    return {
      url: url.href,
      size,
      sha256: review.safe.artifactSha256,
      verified: true as const,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeOwnerHostingDeployment(
  review: OwnerDeployReview,
  projectId: string,
  deploymentId: string,
  dependencies: DeploymentDependencies = {},
) {
  if (deploymentActive)
    throw new Error("A Hosting deployment is already active.");
  deploymentActive = true;
  try {
    const inspected = await (
      dependencies.inspect ?? inspectOwnerHostingPreflight
    )(review.release, projectId);
    const freshFingerprint = fingerprintIdentity(
      deploymentIdentity(review.release, inspected.report),
    );
    if (freshFingerprint !== review.fingerprint)
      throw new Error("Deployment review became stale.");
    const cli = await (dependencies.resolveCli ?? resolveCli)();
    if (
      cli.version !== review.safe.firebaseToolsVersion ||
      cli.shell !== false ||
      cli.nodeExecutable !== process.execPath
    )
      throw new Error("Pinned Firebase CLI identity changed after review.");
    const trustedArgs = dependencies.deployArgs
      ? dependencies.deployArgs()
      : await deployArgs();
    try {
      await (dependencies.runProcess ?? runProcess)(
        cli.nodeExecutable,
        [cli.cliScript, ...trustedArgs],
        {
          cwd: cli.cwd,
          shell: false,
          windowsHide: true,
          timeout: HOSTING_DEPLOY_TIMEOUT_MS,
          maxBuffer: MAX_CLI_OUTPUT_BYTES,
        },
      );
    } catch {
      throw new Error("Pinned Firebase Hosting deployment failed.");
    }
    try {
      const remote = await verifyOwnerRemoteArtifact(review, dependencies);
      return {
        deployCompleted: true as const,
        safe: {
          deploymentId,
          status: "VERIFIED_DEPLOYED" as const,
          projectId: review.safe.projectId,
          hostingSite: review.safe.hostingSite,
          hostingRoute: review.safe.hostingRoute,
          artifactSha256: remote.sha256,
          artifactSize: remote.size,
          remoteVerified: true,
        },
      };
    } catch {
      return {
        deployCompleted: true as const,
        safe: {
          deploymentId,
          status: "DEPLOYMENT_COMPLETED_REMOTE_VERIFICATION_FAILED" as const,
          projectId: review.safe.projectId,
          hostingSite: review.safe.hostingSite,
          hostingRoute: review.safe.hostingRoute,
          artifactSha256: review.safe.artifactSha256,
          artifactSize: review.safe.artifactSize,
          remoteVerified: false,
        },
      };
    }
  } finally {
    deploymentActive = false;
  }
}

export async function retryOwnerRemoteVerification(
  review: OwnerDeployReview,
  deploymentId: string,
  dependencies: DeploymentDependencies = {},
) {
  const remote = await verifyOwnerRemoteArtifact(review, dependencies);
  return {
    deploymentId,
    status: "VERIFIED_DEPLOYED" as const,
    projectId: review.safe.projectId,
    hostingSite: review.safe.hostingSite,
    hostingRoute: review.safe.hostingRoute,
    artifactSha256: remote.sha256,
    artifactSize: remote.size,
    remoteVerified: true,
  };
}
