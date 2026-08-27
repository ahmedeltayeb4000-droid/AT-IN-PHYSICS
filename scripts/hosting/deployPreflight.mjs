import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  auditHostingRelease,
  DEFAULT_RELEASE_ROOT,
} from "./releaseAssembly.mjs";
import {
  FIREBASE_CONFIG_PATH,
  FIREBASE_RC_PATH,
  HOSTING_DEPLOY_SOURCE,
  PINNED_FIREBASE_TOOLS_VERSION,
  PRODUCTION_FIREBASE_PROJECT,
  PRODUCTION_HOSTING_SITE,
  PRODUCTION_HOSTING_TARGET,
  resolvePinnedFirebaseCli,
  validateFirebaseRc,
} from "./deploymentConfig.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEFAULT_PREFLIGHT_REPORT_ROOT = join(
  REPOSITORY_ROOT,
  "hosting-deploy-preflight",
);
export const HOSTING_STORAGE_NO_COST_BYTES = 10 * 1024 ** 3;
export const HOSTING_MONTHLY_TRANSFER_NO_COST_BYTES = 10 * 1024 ** 3;
export const HOSTING_MAX_FILE_BYTES = 2 * 1024 ** 3;
const PROJECT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function optionValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`The ${option} option requires a value.`);
  }
  return value;
}

function validateProjectId(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 6 ||
    value.length > 128 ||
    !PROJECT_ID_PATTERN.test(value)
  ) {
    throw new Error(`${label} is not a canonical Firebase project ID.`);
  }
  return value;
}

export function parseDeployPreflightArgs(args) {
  let projectId;
  let expectedProjectId;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--project") {
      if (projectId !== undefined)
        throw new Error("The --project option may be supplied only once.");
      projectId = optionValue(args, index, argument);
      index += 1;
    } else if (argument === "--expect-project") {
      if (expectedProjectId !== undefined) {
        throw new Error(
          "The --expect-project option may be supplied only once.",
        );
      }
      expectedProjectId = optionValue(args, index, argument);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return {
    projectId: validateProjectId(projectId, "Explicit target project"),
    expectedProjectId: validateProjectId(
      expectedProjectId,
      "Explicit expected project",
    ),
  };
}

export function resolveExplicitProjectTarget({
  projectId,
  expectedProjectId,
  environment = process.env,
}) {
  const target = validateProjectId(projectId, "Explicit target project");
  const expected = validateProjectId(
    expectedProjectId,
    "Explicit expected project",
  );
  if (target !== expected) {
    throw new Error(
      "Explicit target and expected Firebase project IDs differ.",
    );
  }
  const configured = [
    environment.GCLOUD_PROJECT,
    environment.GOOGLE_CLOUD_PROJECT,
    environment.FIREBASE_PROJECT_ID,
  ].filter((value) => typeof value === "string" && value.length > 0);
  if (environment.FIREBASE_CONFIG) {
    let firebaseConfig;
    try {
      firebaseConfig = JSON.parse(environment.FIREBASE_CONFIG);
    } catch (error) {
      throw new Error("FIREBASE_CONFIG is malformed.", { cause: error });
    }
    if (typeof firebaseConfig?.projectId === "string") {
      configured.push(firebaseConfig.projectId);
    }
  }
  for (const value of configured) {
    validateProjectId(value, "Configured environment project");
  }
  const distinct = [...new Set(configured)];
  if (distinct.length > 1) {
    throw new Error(
      "Conflicting Firebase project IDs are configured in the environment.",
    );
  }
  if (distinct.length === 1 && distinct[0] !== target) {
    throw new Error(
      "Configured environment project differs from the explicit target.",
    );
  }
  return target;
}

export async function inspectGitState(repositoryRoot = REPOSITORY_ROOT) {
  const [status, commit] = await Promise.all([
    execFileAsync("git", ["status", "--porcelain"], { cwd: repositoryRoot }),
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
  ]);
  return { status: status.stdout, commit: commit.stdout.trim() };
}

function requireCleanGitState(state) {
  if (
    typeof state.commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(state.commit)
  ) {
    throw new Error("Current Git commit could not be established safely.");
  }
  if (typeof state.status !== "string" || state.status.trim()) {
    throw new Error("Git working tree must be clean before Hosting preflight.");
  }
  return state.commit;
}

export function validateHostingConfiguration(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("firebase.json is malformed.");
  }
  const hosting = value.hosting;
  if (
    typeof hosting !== "object" ||
    hosting === null ||
    Array.isArray(hosting)
  ) {
    throw new Error("Classic Firebase Hosting configuration is missing.");
  }
  if (hosting.public !== "hosting-release") {
    throw new Error(
      "Firebase Hosting public directory must be hosting-release.",
    );
  }
  if (hosting.target !== PRODUCTION_HOSTING_TARGET) {
    throw new Error(
      "Firebase Hosting target is not the trusted production target.",
    );
  }
  if ("storage" in hosting || "source" in hosting || "site" in hosting) {
    throw new Error(
      "Unsupported paid or framework Hosting configuration detected.",
    );
  }
  if (!Array.isArray(hosting.rewrites)) {
    throw new Error("Hosting SPA rewrite configuration is missing.");
  }
  for (const rewrite of hosting.rewrites) {
    if (
      typeof rewrite !== "object" ||
      rewrite === null ||
      "function" in rewrite ||
      "run" in rewrite ||
      "dynamicLinks" in rewrite ||
      Object.keys(rewrite).some(
        (key) => !["source", "regex", "destination"].includes(key),
      )
    ) {
      throw new Error(
        "Functions, Cloud Run, or unsupported Hosting rewrite detected.",
      );
    }
    if (rewrite.destination !== "/index.html") {
      throw new Error(
        "Hosting rewrite destination is not the static SPA entry point.",
      );
    }
  }
  return hosting;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function validateHostingQuota(entries) {
  let totalBytes = 0;
  let protectedMediaBytes = 0;
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > HOSTING_MAX_FILE_BYTES
    ) {
      throw new Error(
        `Release file exceeds the 2 GiB Hosting ceiling: ${entry.path}`,
      );
    }
    totalBytes += entry.size;
    if (entry.path.startsWith("protected-media/"))
      protectedMediaBytes += entry.size;
  }
  if (totalBytes > HOSTING_STORAGE_NO_COST_BYTES) {
    throw new Error(
      "Release exceeds the 10 GiB zero-budget Hosting storage ceiling.",
    );
  }
  if (protectedMediaBytes > HOSTING_STORAGE_NO_COST_BYTES) {
    throw new Error(
      "Protected media exceeds the zero-budget Hosting storage ceiling.",
    );
  }
  return { totalBytes, protectedMediaBytes };
}

async function inventoryRelease(releaseRoot, relativeFiles) {
  const entries = [];
  for (const relativePath of relativeFiles) {
    const absolutePath = resolve(releaseRoot, relativePath);
    const containment = relative(resolve(releaseRoot), absolutePath);
    if (
      !containment ||
      containment === ".." ||
      containment.startsWith(`..${sep}`)
    ) {
      throw new Error("Release inventory path escaped the trusted root.");
    }
    const stats = await lstat(absolutePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(
        `Release inventory entry is not a regular file: ${relativePath}`,
      );
    }
    entries.push({
      path: relativePath,
      size: stats.size,
      sha256: await sha256File(absolutePath),
    });
  }
  return entries;
}

async function writeSanitizedReport(reportRoot, report) {
  const root = resolve(reportRoot);
  const temporary = `${root}.tmp-${process.pid}`;
  if (dirname(root) !== dirname(temporary))
    throw new Error("Unsafe preflight report path.");
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary);
  const temporaryFile = join(temporary, "preflight.json");
  await writeFile(temporaryFile, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    const existing = await lstat(root);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error("Preflight report destination must be a real directory.");
    }
    await rm(root, { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await rename(temporary, root);
  return join(root, "preflight.json");
}

export async function runHostingDeployPreflight({
  projectId,
  expectedProjectId,
  environment = process.env,
  repositoryRoot = REPOSITORY_ROOT,
  releaseRoot = DEFAULT_RELEASE_ROOT,
  reportRoot = DEFAULT_PREFLIGHT_REPORT_ROOT,
  firebaseConfigPath = FIREBASE_CONFIG_PATH,
  firebaseRcPath = FIREBASE_RC_PATH,
  gitInspector = inspectGitState,
  cliResolver = resolvePinnedFirebaseCli,
  now = () => new Date(),
} = {}) {
  const targetProjectId = resolveExplicitProjectTarget({
    projectId,
    expectedProjectId,
    environment,
  });
  const commit = requireCleanGitState(await gitInspector(repositoryRoot));
  if (targetProjectId !== PRODUCTION_FIREBASE_PROJECT)
    throw new Error("Preflight target is not the trusted production project.");
  const [firebaseConfigBytes, firebaseRcBytes, firebaseCli] = await Promise.all(
    [
      readFile(firebaseConfigPath),
      readFile(firebaseRcPath),
      cliResolver(repositoryRoot),
    ],
  );
  let firebaseConfig;
  let firebaseRc;
  try {
    firebaseConfig = JSON.parse(firebaseConfigBytes.toString("utf8"));
  } catch (error) {
    throw new Error("firebase.json contains malformed JSON.", { cause: error });
  }
  try {
    firebaseRc = JSON.parse(firebaseRcBytes.toString("utf8"));
  } catch (error) {
    throw new Error(".firebaserc contains malformed JSON.", { cause: error });
  }
  validateHostingConfiguration(firebaseConfig);
  validateFirebaseRc(firebaseRc);
  if (firebaseCli.version !== PINNED_FIREBASE_TOOLS_VERSION)
    throw new Error(
      "Resolved Firebase CLI version differs from the pinned version.",
    );
  const releaseFiles = await auditHostingRelease(resolve(releaseRoot));
  for (const path of releaseFiles.filter((path) =>
    path.startsWith("protected-media/"),
  )) {
    if (!/^protected-media\/[a-z0-9]+(?:-[a-z0-9]+)*\.atv1$/.test(path)) {
      throw new Error(`Protected media path is not canonical: ${path}`);
    }
  }
  const files = await inventoryRelease(resolve(releaseRoot), releaseFiles);
  const { totalBytes, protectedMediaBytes } = validateHostingQuota(files);
  const frontendBytes = totalBytes - protectedMediaBytes;
  const atv1Count = files.filter((entry) =>
    entry.path.startsWith("protected-media/"),
  ).length;
  const report = {
    formatVersion: "hosting-preflight-v1",
    generatedAt: now().toISOString(),
    projectId: targetProjectId,
    gitCommit: commit,
    firebaseConfigSha256: createHash("sha256")
      .update(firebaseConfigBytes)
      .digest("hex"),
    firebaseRcSha256: createHash("sha256")
      .update(firebaseRcBytes)
      .digest("hex"),
    deployment: {
      firebaseToolsVersion: firebaseCli.version,
      projectId: PRODUCTION_FIREBASE_PROJECT,
      hostingTarget: PRODUCTION_HOSTING_TARGET,
      hostingSite: PRODUCTION_HOSTING_SITE,
      deploySource: HOSTING_DEPLOY_SOURCE,
      repositoryLocalCli: true,
      shellRequired: false,
    },
    summary: {
      fileCount: files.length,
      totalBytes,
      frontendBytes,
      protectedMediaBytes,
      atv1Count,
    },
    quota: {
      hostingStorageNoCostBytes: HOSTING_STORAGE_NO_COST_BYTES,
      approximateMonthlyTransferNoCostBytes:
        HOSTING_MONTHLY_TRANSFER_NO_COST_BYTES,
      maximumIndividualFileBytes: HOSTING_MAX_FILE_BYTES,
      estimatedFullReleaseTransferBytes: totalBytes,
      actualRemainingMonthlyTransferIsLocallyKnowable: false,
    },
    files,
    outcome: "PREFLIGHT PASSED — REVIEW REQUIRED; NOTHING DEPLOYED",
  };
  const reportPath = await writeSanitizedReport(reportRoot, report);
  return { report, reportPath };
}
