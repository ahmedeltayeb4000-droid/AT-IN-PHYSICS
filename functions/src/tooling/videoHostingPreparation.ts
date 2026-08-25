import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareVideoPublicationPackage } from "./videoDescriptorPublication.js";

export const HOSTING_STORAGE_NO_COST_BYTES = 10 * 1024 ** 3;
export const HOSTING_MONTHLY_TRANSFER_NO_COST_BYTES = 10 * 1024 ** 3;
export const HOSTING_MAX_FILE_BYTES = 2 * 1024 ** 3;
export const DEFAULT_HOSTING_VIDEO_STAGING_ROOT = fileURLToPath(
  new URL("../../../../hosting-video-staging/", import.meta.url),
);

export type VideoHostingPreparationOptions = {
  readonly descriptorFile: string;
  readonly prepare: boolean;
};

export type VideoHostingPreparationResult = {
  readonly mode: "dry-run" | "prepare";
  readonly status: "preparation-required" | "prepared" | "already-current";
  readonly sourceArtifact: string;
  readonly stagingDestination: string;
  readonly hostingRoute: string;
  readonly videoAssetId: string;
  readonly encryptedSize: number;
  readonly sha256: string;
  readonly quota: {
    readonly storageNoCostBytes: number;
    readonly monthlyTransferNoCostBytes: number;
    readonly maximumIndividualFileBytes: number;
  };
};

function valueAfter(args: readonly string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("The --descriptor-file option requires a value.");
  }
  return value;
}

export function parseVideoHostingPreparationArgs(
  args: readonly string[],
): VideoHostingPreparationOptions {
  let descriptorFile: string | undefined;
  let prepare = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--descriptor-file") {
      if (descriptorFile !== undefined) {
        throw new Error(
          "The --descriptor-file option may be provided only once.",
        );
      }
      descriptorFile = valueAfter(args, index);
      index += 1;
    } else if (argument === "--prepare") {
      if (prepare)
        throw new Error("The --prepare option may be provided only once.");
      prepare = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (!descriptorFile || descriptorFile !== descriptorFile.trim()) {
    throw new Error(
      "A canonical descriptor path is required with --descriptor-file.",
    );
  }
  if (!descriptorFile.endsWith(".publication.json")) {
    throw new Error("Descriptor file must use the .publication.json suffix.");
  }
  return { descriptorFile, prepare };
}

export function assertWithinStagingRoot(
  root: string,
  destination: string,
): void {
  const rel = relative(resolve(root), resolve(destination));
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    resolve(rel) === rel
  ) {
    throw new Error("Hosting staging destination is unsafe.");
  }
}

export function validateHostingFileSize(size: number): void {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > HOSTING_MAX_FILE_BYTES
  ) {
    throw new Error(
      "Encrypted artifact exceeds the 2 GiB Hosting file-size ceiling.",
    );
  }
}

async function regularFileHash(path: string): Promise<string | null> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Hosting staging destination could not be inspected.", {
      cause: error,
    });
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Hosting staging destination must be a regular file.");
  }
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function ensureSafeDirectory(path: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await mkdir(path);
      return;
    }
    throw new Error("Hosting staging directory could not be inspected.", {
      cause: error,
    });
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Hosting staging directory must be a real directory.");
  }
}

async function inspectDirectoryIfPresent(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("Hosting staging directory must be a real directory.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function runVideoHostingPreparation(
  options: VideoHostingPreparationOptions,
  stagingRoot = DEFAULT_HOSTING_VIDEO_STAGING_ROOT,
): Promise<VideoHostingPreparationResult> {
  const parsed = parseVideoHostingPreparationArgs([
    "--descriptor-file",
    options.descriptorFile,
    ...(options.prepare ? ["--prepare"] : []),
  ]);
  const trusted = await prepareVideoPublicationPackage(parsed.descriptorFile);
  validateHostingFileSize(trusted.summary.encryptedSize);

  const root = resolve(stagingRoot);
  const protectedDirectory = join(root, "protected-media");
  const destination = join(
    protectedDirectory,
    trusted.summary.artifactFileName,
  );
  assertWithinStagingRoot(root, destination);
  await inspectDirectoryIfPresent(root);
  await inspectDirectoryIfPresent(protectedDirectory);
  const source = resolve(
    dirname(resolve(parsed.descriptorFile)),
    trusted.summary.artifactFileName,
  );
  const existingHash = await regularFileHash(destination);
  if (
    existingHash !== null &&
    existingHash !== trusted.summary.artifactSha256
  ) {
    throw new Error(
      "Hosting staging destination conflicts with the verified artifact.",
    );
  }

  let status: VideoHostingPreparationResult["status"] =
    existingHash === trusted.summary.artifactSha256
      ? "already-current"
      : "preparation-required";
  if (parsed.prepare && status === "preparation-required") {
    await ensureSafeDirectory(root);
    await ensureSafeDirectory(protectedDirectory);
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const racedHash = await regularFileHash(destination);
        if (racedHash === trusted.summary.artifactSha256)
          status = "already-current";
        else
          throw new Error(
            "Hosting staging destination conflicts with the verified artifact.",
            { cause: error },
          );
      } else {
        throw error;
      }
    }
    if (status !== "already-current") {
      const copiedHash = await regularFileHash(destination);
      if (copiedHash !== trusted.summary.artifactSha256) {
        await rm(destination, { force: true });
        throw new Error(
          "Prepared Hosting artifact failed post-copy verification.",
        );
      }
      status = "prepared";
    }
  }

  return {
    mode: parsed.prepare ? "prepare" : "dry-run",
    status,
    sourceArtifact: source,
    stagingDestination: destination,
    hostingRoute: `/protected-media/${trusted.summary.videoAssetId}.atv1`,
    videoAssetId: trusted.summary.videoAssetId,
    encryptedSize: trusted.summary.encryptedSize,
    sha256: trusted.summary.artifactSha256,
    quota: {
      storageNoCostBytes: HOSTING_STORAGE_NO_COST_BYTES,
      monthlyTransferNoCostBytes: HOSTING_MONTHLY_TRANSFER_NO_COST_BYTES,
      maximumIndividualFileBytes: HOSTING_MAX_FILE_BYTES,
    },
  };
}
