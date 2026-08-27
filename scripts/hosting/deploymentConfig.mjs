import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_ROOT = fileURLToPath(
  new URL("../../", import.meta.url),
);
export const PRODUCTION_FIREBASE_PROJECT = "at-in-physics";
export const PRODUCTION_HOSTING_TARGET = "production";
export const PRODUCTION_HOSTING_SITE = "at-in-physics";
export const HOSTING_DEPLOY_SOURCE = "hosting-release";
export const PINNED_FIREBASE_TOOLS_VERSION = "15.28.1";
export const FIREBASE_CONFIG_PATH = join(REPOSITORY_ROOT, "firebase.json");
export const FIREBASE_RC_PATH = join(REPOSITORY_ROOT, ".firebaserc");

function exactKeys(value, keys, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} is malformed.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw new Error(`${label} contains unexpected configuration.`);
  return value;
}

export function validateFirebaseRc(value) {
  const root = exactKeys(value, ["projects", "targets"], ".firebaserc");
  const projects = exactKeys(
    root.projects,
    ["default"],
    ".firebaserc projects",
  );
  if (projects.default !== PRODUCTION_FIREBASE_PROJECT)
    throw new Error(
      ".firebaserc default project is not the trusted production project.",
    );
  const targets = exactKeys(
    root.targets,
    [PRODUCTION_FIREBASE_PROJECT],
    ".firebaserc targets",
  );
  const projectTargets = exactKeys(
    targets[PRODUCTION_FIREBASE_PROJECT],
    ["hosting"],
    ".firebaserc project targets",
  );
  const hosting = exactKeys(
    projectTargets.hosting,
    [PRODUCTION_HOSTING_TARGET],
    ".firebaserc Hosting targets",
  );
  const sites = hosting[PRODUCTION_HOSTING_TARGET];
  if (
    !Array.isArray(sites) ||
    sites.length !== 1 ||
    sites[0] !== PRODUCTION_HOSTING_SITE
  )
    throw new Error(
      "Hosting target must resolve to exactly the trusted production site.",
    );
  return {
    projectId: PRODUCTION_FIREBASE_PROJECT,
    hostingTarget: PRODUCTION_HOSTING_TARGET,
    hostingSite: PRODUCTION_HOSTING_SITE,
  };
}

export function validatePinnedFirebaseDependency(packageJson, packageLock) {
  if (
    packageJson?.devDependencies?.["firebase-tools"] !==
      PINNED_FIREBASE_TOOLS_VERSION ||
    packageLock?.packages?.[""]?.devDependencies?.["firebase-tools"] !==
      PINNED_FIREBASE_TOOLS_VERSION ||
    packageLock?.packages?.["node_modules/firebase-tools"]?.version !==
      PINNED_FIREBASE_TOOLS_VERSION ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(
      packageLock?.packages?.["node_modules/firebase-tools"]?.integrity ?? "",
    )
  )
    throw new Error(
      "firebase-tools is not exactly pinned by the repository manifest and lock.",
    );
  return PINNED_FIREBASE_TOOLS_VERSION;
}

function assertContained(root, candidate) {
  const value = relative(resolve(root), resolve(candidate));
  if (!value || value === ".." || value.startsWith(`..${sep}`))
    throw new Error("Repository-local Firebase CLI path escaped node_modules.");
}

export async function resolvePinnedFirebaseCli(
  repositoryRoot = REPOSITORY_ROOT,
) {
  const modulesRoot = join(resolve(repositoryRoot), "node_modules");
  const packageRoot = join(modulesRoot, "firebase-tools");
  const packagePath = join(packageRoot, "package.json");
  let manifest;
  try {
    const [packageStats, packageFileStats] = await Promise.all([
      lstat(packageRoot),
      lstat(packagePath),
    ]);
    if (
      !packageStats.isDirectory() ||
      packageStats.isSymbolicLink() ||
      !packageFileStats.isFile() ||
      packageFileStats.isSymbolicLink()
    )
      throw new Error(
        "Repository-local firebase-tools package is not regular.",
      );
    const [installedManifest, repositoryManifest, repositoryLock] =
      await Promise.all([
        readFile(packagePath, "utf8"),
        readFile(join(repositoryRoot, "package.json"), "utf8"),
        readFile(join(repositoryRoot, "package-lock.json"), "utf8"),
      ]);
    manifest = JSON.parse(installedManifest);
    validatePinnedFirebaseDependency(
      JSON.parse(repositoryManifest),
      JSON.parse(repositoryLock),
    );
  } catch (error) {
    throw new Error("Pinned repository-local Firebase CLI is unavailable.", {
      cause: error,
    });
  }
  if (
    manifest.name !== "firebase-tools" ||
    manifest.version !== PINNED_FIREBASE_TOOLS_VERSION ||
    manifest.bin?.firebase !== "./lib/bin/firebase.js"
  )
    throw new Error(
      "Repository-local Firebase CLI identity does not match the pinned contract.",
    );
  const cliScript = join(packageRoot, "lib", "bin", "firebase.js");
  const stats = await lstat(cliScript);
  if (!stats.isFile() || stats.isSymbolicLink())
    throw new Error(
      "Repository-local Firebase CLI entry point is not a regular file.",
    );
  const realModulesRoot = await realpath(modulesRoot);
  const realCliScript = await realpath(cliScript);
  assertContained(realModulesRoot, realCliScript);
  return {
    packageName: "firebase-tools",
    version: PINNED_FIREBASE_TOOLS_VERSION,
    nodeExecutable: process.execPath,
    cliScript: realCliScript,
    cwd: resolve(repositoryRoot),
    shell: false,
  };
}

export function futureHostingOnlyDeployArgs() {
  return [
    "deploy",
    "--only",
    `hosting:${PRODUCTION_HOSTING_TARGET}`,
    "--project",
    PRODUCTION_FIREBASE_PROJECT,
    "--config",
    FIREBASE_CONFIG_PATH,
  ];
}
