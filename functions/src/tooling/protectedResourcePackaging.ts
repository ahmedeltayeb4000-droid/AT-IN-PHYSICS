import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  encryptProtectedResource,
  type ProtectedResourceRandomBytesProvider,
} from "../protectedResources/crypto.js";
import {
  PROTECTED_RESOURCE_FORMAT,
  PROTECTED_RESOURCE_MIME_TYPE,
  buildProtectedResourceRoute,
  protectedResourceCiphertextSize,
  validateProtectedResourceFileName,
  validateProtectedResourceId,
  validateProtectedResourceMimeType,
  validateProtectedResourcePlaintext,
  validateProtectedResourceScope,
  validateProtectedResourceTitle,
  type ProtectedResourceScope,
} from "../protectedResources/format.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
export const DEFAULT_PROTECTED_RESOURCE_STAGING_ROOT = join(
  REPOSITORY_ROOT,
  "hosting-video-staging",
);
export const DEFAULT_PROTECTED_RESOURCE_DESCRIPTOR_ROOT = join(
  REPOSITORY_ROOT,
  "protected-resource-packages",
);

export type ProtectedResourcePackagingInput = Readonly<{
  scope: unknown;
  resourceId: unknown;
  title: unknown;
  originalFileName: unknown;
  mimeType: unknown;
  inputFile: string;
}>;

export type ProtectedResourcePackageIdentity = Readonly<{
  version: 1;
  scope: ProtectedResourceScope;
  resourceId: string;
  title: string;
  originalFileName: string;
  mimeType: typeof PROTECTED_RESOURCE_MIME_TYPE;
  plaintextSize: number;
  formatVersion: typeof PROTECTED_RESOURCE_FORMAT;
  ciphertextRoute: string;
  ciphertextSha256: string;
  ciphertextSize: number;
}>;

export type ProtectedResourcePackagingResult = Readonly<{
  identity: ProtectedResourcePackageIdentity;
  contentKey: string;
  stagingDestination: string;
  descriptorPath: string;
}>;

type PackagingConfiguration = Readonly<{
  stagingRoot?: string;
  descriptorRoot?: string;
  randomBytesProvider?: ProtectedResourceRandomBytesProvider;
}>;

function invalidPackage(message: string): never {
  throw new Error(message);
}

function assertContained(root: string, candidate: string): void {
  const rel = relative(resolve(root), resolve(candidate));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) {
    return invalidPackage("Protected resource output path is unsafe.");
  }
}

function scopeSegments(scope: ProtectedResourceScope): string[] {
  return scope.type === "course"
    ? ["courses", scope.courseId, "resources"]
    : [
        "courses",
        scope.courseId,
        "modules",
        scope.moduleId,
        "sessions",
        scope.sessionId,
        "resources",
      ];
}

async function ensureRealDirectoryChain(
  rootValue: string,
  destinationDirectory: string,
): Promise<void> {
  const root = resolve(rootValue);
  assertContained(dirname(root), root);
  await mkdir(root, { recursive: true });
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    return invalidPackage("Protected resource output root is unsafe.");
  }
  const rel = relative(root, resolve(destinationDirectory));
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    return invalidPackage("Protected resource output path is unsafe.");
  }
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    await mkdir(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stats = await lstat(current);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return invalidPackage("Protected resource output directory is unsafe.");
    }
  }
}

async function inspectInput(
  inputFile: string,
  expectedFileName: string,
): Promise<{ absolutePath: string; plaintext: Buffer }> {
  if (
    typeof inputFile !== "string" ||
    !inputFile ||
    inputFile !== inputFile.trim()
  ) {
    return invalidPackage("A canonical PDF input path is required.");
  }
  const absolutePath = resolve(inputFile);
  if (basename(absolutePath) !== expectedFileName) {
    return invalidPackage("PDF input filename does not match trusted metadata.");
  }
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch {
    return invalidPackage("PDF input could not be inspected.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return invalidPackage("PDF input must be a regular file.");
  }
  const plaintext = await readFile(absolutePath);
  if (plaintext.length !== stats.size) {
    return invalidPackage("PDF input changed during packaging.");
  }
  validateProtectedResourcePlaintext(plaintext);
  return { absolutePath, plaintext };
}

export async function packageProtectedResource(
  input: ProtectedResourcePackagingInput,
  configuration: PackagingConfiguration = {},
): Promise<ProtectedResourcePackagingResult> {
  const scope = validateProtectedResourceScope(input.scope);
  const resourceId = validateProtectedResourceId(input.resourceId);
  const title = validateProtectedResourceTitle(input.title);
  const originalFileName = validateProtectedResourceFileName(
    input.originalFileName,
  );
  const mimeType = validateProtectedResourceMimeType(input.mimeType);
  const { plaintext } = await inspectInput(input.inputFile, originalFileName);
  const ciphertextRoute = buildProtectedResourceRoute(scope, resourceId);
  const expectedCiphertextSize = protectedResourceCiphertextSize(
    plaintext.length,
  );
  const encrypted = encryptProtectedResource(
    plaintext,
    configuration.randomBytesProvider ?? randomBytes,
  );
  if (encrypted.artifact.length !== expectedCiphertextSize) {
    return invalidPackage("Protected resource ciphertext size is invalid.");
  }
  const ciphertextSha256 = createHash("sha256")
    .update(encrypted.artifact)
    .digest("hex");
  const identity: ProtectedResourcePackageIdentity = {
    version: 1,
    scope,
    resourceId,
    title,
    originalFileName,
    mimeType,
    plaintextSize: plaintext.length,
    formatVersion: PROTECTED_RESOURCE_FORMAT,
    ciphertextRoute,
    ciphertextSha256,
    ciphertextSize: encrypted.artifact.length,
  };

  const stagingRoot = resolve(
    configuration.stagingRoot ?? DEFAULT_PROTECTED_RESOURCE_STAGING_ROOT,
  );
  const descriptorRoot = resolve(
    configuration.descriptorRoot ?? DEFAULT_PROTECTED_RESOURCE_DESCRIPTOR_ROOT,
  );
  const segments = scopeSegments(scope);
  const stagingDestination = resolve(
    stagingRoot,
    "protected-resources",
    ...segments,
    `${resourceId}.atr1`,
  );
  const descriptorPath = resolve(
    descriptorRoot,
    ...segments,
    `${resourceId}.package.json`,
  );
  assertContained(stagingRoot, stagingDestination);
  assertContained(descriptorRoot, descriptorPath);

  let artifactCreated = false;
  let descriptorCreated = false;
  try {
    await ensureRealDirectoryChain(stagingRoot, dirname(stagingDestination));
    await ensureRealDirectoryChain(descriptorRoot, dirname(descriptorPath));
    await writeFile(stagingDestination, encrypted.artifact, {
      flag: "wx",
      mode: 0o600,
    });
    artifactCreated = true;
    await writeFile(descriptorPath, `${JSON.stringify(identity, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    descriptorCreated = true;
  } catch (error) {
    if (descriptorCreated) await rm(descriptorPath, { force: true });
    if (artifactCreated) await rm(stagingDestination, { force: true });
    throw new Error("Protected resource package could not be written.", {
      cause: error,
    });
  }

  return {
    identity,
    contentKey: encrypted.contentKey,
    stagingDestination,
    descriptorPath,
  };
}
