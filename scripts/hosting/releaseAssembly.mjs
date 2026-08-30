import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DEFAULT_DIST_ROOT = join(REPOSITORY_ROOT, "dist");
export const DEFAULT_STAGING_ROOT = join(
  REPOSITORY_ROOT,
  "hosting-video-staging",
);
export const DEFAULT_RELEASE_ROOT = join(REPOSITORY_ROOT, "hosting-release");

const FRONTEND_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".png",
  ".svg",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
]);
const FORBIDDEN_SUFFIXES = [
  ".publication.json",
  ".mp4",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
];
const FORBIDDEN_NAMES = new Set([".env", "firebase-admin.json"]);
const SECRET_MARKERS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  '"private_key"',
  '"client_email"',
];
const ASSET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isCanonicalId(value) {
  return value.length <= 128 && ASSET_ID_PATTERN.test(value);
}

export function isCanonicalVideoAssetId(value) {
  return typeof value === "string" && isCanonicalId(value);
}

function isCanonicalProtectedResourcePath(path) {
  const parts = path.replaceAll("\\", "/").split("/");
  if (
    parts[0] !== "protected-resources" ||
    parts[1] !== "courses" ||
    !isCanonicalId(parts[2] ?? "")
  ) {
    return false;
  }
  const course =
    parts.length === 5 && parts[3] === "resources";
  const session =
    parts.length === 9 &&
    parts[3] === "modules" &&
    isCanonicalId(parts[4] ?? "") &&
    parts[5] === "sessions" &&
    isCanonicalId(parts[6] ?? "") &&
    parts[7] === "resources";
  const fileName = parts.at(-1) ?? "";
  const resourceId = fileName.endsWith(".atr1")
    ? fileName.slice(0, -5)
    : "";
  return (course || session) && isCanonicalId(resourceId);
}

function assertContained(root, candidate) {
  const value = relative(resolve(root), resolve(candidate));
  if (!value || value === ".." || value.startsWith(`..${sep}`)) {
    throw new Error("Release destination escaped its trusted root.");
  }
}

async function inspectRealDirectory(path, required) {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Expected a real directory: ${path}`);
    }
    return true;
  } catch (error) {
    if (!required && error?.code === "ENOENT") return false;
    throw error;
  }
}

function rejectSensitiveName(path) {
  const name = basename(path).toLowerCase();
  if (
    name.startsWith(".env.") ||
    FORBIDDEN_NAMES.has(name) ||
    FORBIDDEN_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    name.includes("service-account") ||
    name.includes("private-key")
  ) {
    throw new Error(`Forbidden release input: ${name}`);
  }
}

async function copyFrontendTree(
  sourceRoot,
  destinationRoot,
  current = sourceRoot,
) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const source = join(current, entry.name);
    const rel = relative(sourceRoot, source);
    const destination = join(destinationRoot, rel);
    assertContained(destinationRoot, destination);
    if (entry.isSymbolicLink()) throw new Error(`Symlink is forbidden: ${rel}`);
    rejectSensitiveName(source);
    if (entry.isDirectory()) {
      if (entry.name.startsWith("."))
        throw new Error(`Hidden directory is forbidden: ${rel}`);
      await mkdir(destination, { recursive: true });
      await copyFrontendTree(sourceRoot, destinationRoot, source);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Non-regular release input: ${rel}`);
    if (extname(entry.name).toLowerCase() === ".map") continue;
    if (!FRONTEND_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      throw new Error(`Unexpected frontend artifact type: ${rel}`);
    }
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }
}

async function copyStagedMedia(stagingRoot, destinationRoot) {
  const sourceDirectory = join(stagingRoot, "protected-media");
  if (!(await inspectRealDirectory(stagingRoot, false))) return 0;
  if (!(await inspectRealDirectory(sourceDirectory, false))) return 0;
  const destinationDirectory = join(destinationRoot, "protected-media");
  await mkdir(destinationDirectory);
  let count = 0;
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Only regular ATV1 files may be staged: ${entry.name}`);
    }
    if (!entry.name.endsWith(".atv1")) {
      throw new Error(`Unexpected protected-media file: ${entry.name}`);
    }
    const assetId = entry.name.slice(0, -5);
    if (!isCanonicalVideoAssetId(assetId)) {
      throw new Error(`Noncanonical staged video asset ID: ${entry.name}`);
    }
    const source = join(sourceDirectory, entry.name);
    const bytes = await readFile(source);
    if (
      bytes.length < 32 ||
      bytes.subarray(0, 4).toString("ascii") !== "ATV1"
    ) {
      throw new Error(`Staged media is not an ATV1 artifact: ${entry.name}`);
    }
    const destination = join(destinationDirectory, entry.name);
    assertContained(destinationRoot, destination);
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    count += 1;
  }
  return count;
}

async function copyStagedResources(stagingRoot, destinationRoot) {
  const sourceRoot = join(stagingRoot, "protected-resources");
  if (!(await inspectRealDirectory(stagingRoot, false))) return 0;
  if (!(await inspectRealDirectory(sourceRoot, false))) return 0;
  let count = 0;
  async function copy(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const source = join(current, entry.name);
      const rel = join("protected-resources", relative(sourceRoot, source));
      const destination = join(destinationRoot, rel);
      assertContained(destinationRoot, destination);
      if (entry.isSymbolicLink()) {
        throw new Error(`Protected resource symlink is forbidden: ${rel}`);
      }
      if (entry.isDirectory()) {
        await mkdir(destination);
        await copy(source);
        continue;
      }
      if (!entry.isFile() || !isCanonicalProtectedResourcePath(rel)) {
        throw new Error(`Protected resource path is not canonical: ${rel}`);
      }
      const bytes = await readFile(source);
      if (
        bytes.length <= 32 ||
        bytes.subarray(0, 4).toString("ascii") !== "ATR1"
      ) {
        throw new Error(`Protected resource is not an ATR1 artifact: ${rel}`);
      }
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      count += 1;
    }
  }
  await mkdir(join(destinationRoot, "protected-resources"));
  await copy(sourceRoot);
  return count;
}

export async function auditHostingRelease(releaseRoot) {
  await inspectRealDirectory(releaseRoot, true);
  const files = [];
  async function inspect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const rel = relative(releaseRoot, path).replaceAll("\\", "/");
      if (entry.isSymbolicLink())
        throw new Error(`Release symlink is forbidden: ${rel}`);
      rejectSensitiveName(path);
      if (entry.isDirectory()) {
        await inspect(path);
        continue;
      }
      if (!entry.isFile())
        throw new Error(`Release entry is not regular: ${rel}`);
      if (rel.startsWith("protected-media/") && !rel.endsWith(".atv1")) {
        throw new Error(`Protected media output is not ATV1: ${rel}`);
      }
      if (rel.startsWith("protected-resources/")) {
        if (!isCanonicalProtectedResourcePath(rel)) {
          throw new Error(`Protected resource path is not canonical: ${rel}`);
        }
        const bytes = await readFile(path);
        if (
          bytes.length <= 32 ||
          bytes.subarray(0, 4).toString("ascii") !== "ATR1"
        ) {
          throw new Error(`Protected resource output is not ATR1: ${rel}`);
        }
      } else if (!rel.startsWith("protected-media/")) {
        const content = await readFile(path, "utf8");
        if (SECRET_MARKERS.some((marker) => content.includes(marker))) {
          throw new Error(`Credential material detected in release: ${rel}`);
        }
      }
      files.push(rel);
    }
  }
  await inspect(releaseRoot);
  if (!files.includes("index.html"))
    throw new Error("Release is missing index.html.");
  return files.sort();
}

export async function assembleHostingRelease({
  distRoot = DEFAULT_DIST_ROOT,
  stagingRoot = DEFAULT_STAGING_ROOT,
  releaseRoot = DEFAULT_RELEASE_ROOT,
} = {}) {
  await inspectRealDirectory(distRoot, true);
  const release = resolve(releaseRoot);
  const temporary = `${release}.tmp-${process.pid}`;
  if (dirname(temporary) !== dirname(release))
    throw new Error("Unsafe release temporary path.");
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary);
  try {
    await copyFrontendTree(resolve(distRoot), temporary);
    const mediaCount = await copyStagedMedia(resolve(stagingRoot), temporary);
    const resourceCount = await copyStagedResources(
      resolve(stagingRoot),
      temporary,
    );
    const files = await auditHostingRelease(temporary);
    if (await inspectRealDirectory(release, false)) {
      await rm(release, { recursive: true });
    }
    await rename(temporary, release);
    return { releaseRoot: release, files, mediaCount, resourceCount };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
