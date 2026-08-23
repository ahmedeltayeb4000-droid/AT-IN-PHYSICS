import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateContentId } from "../lessonContent/validation.js";
import {
  encryptVideoBytes,
  VIDEO_ARTIFACT_FORMAT,
  type RandomBytesProvider,
} from "../videoPackaging/crypto.js";

export const MAX_VIDEO_INPUT_SIZE = 50 * 1024 * 1024;
export const DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT = fileURLToPath(
  new URL("../../../../video-packages/", import.meta.url),
);

const MP4_HEADER_INSPECTION_LENGTH = 24;

export type VideoPackagingOptions = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly sessionId: string;
  readonly videoAssetId: string;
  readonly inputFile: string;
  readonly package: boolean;
};

export type VideoPublicationData = {
  readonly sessionPatch: {
    readonly videoAssetId: string;
  };
  readonly videoAccess: {
    readonly videoAssetId: string;
    readonly contentKey: string;
  };
};

export type VideoPublicationDescriptor = VideoPublicationData & {
  readonly formatVersion: typeof VIDEO_ARTIFACT_FORMAT;
  readonly target: {
    readonly courseId: string;
    readonly moduleId: string;
    readonly sessionId: string;
  };
  readonly artifact: {
    readonly fileName: string;
    readonly sha256: string;
    readonly plaintextSize: number;
    readonly encryptedSize: number;
  };
};

export type VideoPackagingResult = {
  readonly mode: "dry-run" | "package";
  readonly target: VideoPublicationDescriptor["target"];
  readonly videoAssetId: string;
  readonly inputFileName: string;
  readonly plaintextSize: number;
  readonly artifactFileName: string;
  readonly descriptorFileName: string;
  readonly encryptedSize: number | null;
  readonly artifactSha256: string | null;
  readonly contentKeySummary: {
    readonly present: boolean;
    readonly length: number | null;
    readonly fingerprintPrefix: string | null;
  };
};

export type InspectedMp4 = {
  readonly absolutePath: string;
  readonly fileName: string;
  readonly size: number;
};

export type VideoOutputPaths = {
  readonly outputRoot: string;
  readonly artifactPath: string;
  readonly descriptorPath: string;
  readonly artifactFileName: string;
  readonly descriptorFileName: string;
};

function optionValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`The ${option} option requires a value.`);
  }
  return value;
}

export function validateVideoAssetId(value: unknown): string {
  return validateContentId("videoAssetId", value);
}

export function parseVideoPackagingArgs(
  args: readonly string[],
): VideoPackagingOptions {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let sessionId: string | undefined;
  let videoAssetId: string | undefined;
  let inputFile: string | undefined;
  let packageMode = false;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--course-id" ||
      argument === "--module-id" ||
      argument === "--session-id" ||
      argument === "--video-asset-id" ||
      argument === "--input-file"
    ) {
      if (seen.has(argument)) {
        throw new Error(`The ${argument} option may be provided only once.`);
      }
      seen.add(argument);
      const value = optionValue(args, index, argument);
      if (argument === "--course-id") courseId = value;
      if (argument === "--module-id") moduleId = value;
      if (argument === "--session-id") sessionId = value;
      if (argument === "--video-asset-id") videoAssetId = value;
      if (argument === "--input-file") inputFile = value;
      index += 1;
      continue;
    }

    if (argument === "--package") {
      if (packageMode) {
        throw new Error("The --package option may be provided only once.");
      }
      packageMode = true;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  if (
    typeof inputFile !== "string" ||
    !inputFile.trim() ||
    inputFile !== inputFile.trim()
  ) {
    throw new Error("A canonical input file path is required with --input-file.");
  }

  return {
    courseId: validateContentId("courseId", courseId),
    moduleId: validateContentId("moduleId", moduleId),
    sessionId: validateContentId("sessionId", sessionId),
    videoAssetId: validateVideoAssetId(videoAssetId),
    inputFile,
    package: packageMode,
  };
}

export function validateMp4Header(header: Uint8Array, fileSize: number): void {
  const bytes = Buffer.from(header);
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 0 ||
    bytes.length < 16 ||
    bytes.subarray(4, 8).toString("ascii") !== "ftyp"
  ) {
    throw new Error("Input file is not a supported MP4 file.");
  }

  const boxSize = bytes.readUInt32BE(0);
  if (boxSize === 1) {
    if (bytes.length < 24) {
      throw new Error("Input file is not a supported MP4 file.");
    }
    const extendedSize = bytes.readBigUInt64BE(8);
    if (extendedSize < 24n || extendedSize > BigInt(fileSize)) {
      throw new Error("Input file is not a supported MP4 file.");
    }
    return;
  }

  if (boxSize < 16 || boxSize > fileSize) {
    throw new Error("Input file is not a supported MP4 file.");
  }
}

export async function inspectMp4Input(path: string): Promise<InspectedMp4> {
  const absolutePath = resolve(path);
  let fileStats;
  try {
    fileStats = await lstat(absolutePath);
  } catch {
    throw new Error("Input MP4 file could not be inspected.");
  }

  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new Error("Input MP4 must be a regular file.");
  }
  if (fileStats.size === 0) {
    throw new Error("Input MP4 must not be empty.");
  }
  if (fileStats.size > MAX_VIDEO_INPUT_SIZE) {
    throw new Error("Input MP4 exceeds the 50 MiB packaging limit.");
  }
  if (extname(absolutePath).toLowerCase() !== ".mp4") {
    throw new Error("Input file must use the .mp4 extension.");
  }

  const header = Buffer.alloc(
    Math.min(MP4_HEADER_INSPECTION_LENGTH, fileStats.size),
  );
  let handle;
  try {
    handle = await open(absolutePath, "r");
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    validateMp4Header(header.subarray(0, bytesRead), fileStats.size);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Input file is not a supported MP4 file."
    ) {
      throw error;
    }
    throw new Error("Input MP4 file could not be read.", { cause: error });
  } finally {
    await handle?.close();
  }

  return {
    absolutePath,
    fileName: basename(absolutePath),
    size: fileStats.size,
  };
}

export function buildVideoOutputPaths(
  videoAssetId: string,
  outputRoot = DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT,
): VideoOutputPaths {
  const validatedAssetId = validateVideoAssetId(videoAssetId);
  const resolvedRoot = resolve(outputRoot);
  const artifactFileName = `${validatedAssetId}.atv1`;
  const descriptorFileName = `${validatedAssetId}.publication.json`;
  const artifactPath = resolve(resolvedRoot, artifactFileName);
  const descriptorPath = resolve(resolvedRoot, descriptorFileName);

  if (
    dirname(artifactPath) !== resolvedRoot ||
    dirname(descriptorPath) !== resolvedRoot
  ) {
    throw new Error("Video package output path is unsafe.");
  }

  return {
    outputRoot: resolvedRoot,
    artifactPath,
    descriptorPath,
    artifactFileName,
    descriptorFileName,
  };
}

export function buildVideoPublicationData(
  videoAssetId: string,
  contentKey: string,
): VideoPublicationData {
  const validatedAssetId = validateVideoAssetId(videoAssetId);
  if (!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(contentKey)) {
    throw new Error("Video content key is invalid.");
  }
  return {
    sessionPatch: { videoAssetId: validatedAssetId },
    videoAccess: { videoAssetId: validatedAssetId, contentKey },
  };
}

function contentKeyFingerprint(contentKey: string): string {
  return createHash("sha256").update(contentKey, "utf8").digest("hex").slice(0, 12);
}

async function requireSafeOutputRoot(outputRoot: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
  const stats = await lstat(outputRoot);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Video package output root is unsafe.");
  }
}

async function writeLocalPackage(
  paths: VideoOutputPaths,
  artifact: Buffer,
  descriptor: VideoPublicationDescriptor,
): Promise<void> {
  await requireSafeOutputRoot(paths.outputRoot);
  let artifactCreated = false;
  try {
    await writeFile(paths.artifactPath, artifact, { flag: "wx", mode: 0o600 });
    artifactCreated = true;
    await writeFile(
      paths.descriptorPath,
      `${JSON.stringify(descriptor, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch {
    if (artifactCreated) {
      await rm(paths.artifactPath, { force: true });
    }
    throw new Error("Video package output could not be written.");
  }
}

export async function runVideoPackaging(
  options: VideoPackagingOptions,
  configuration: {
    readonly outputRoot?: string;
    readonly randomBytesProvider?: RandomBytesProvider;
  } = {},
): Promise<VideoPackagingResult> {
  const validated = parseVideoPackagingArgs([
    "--course-id",
    options.courseId,
    "--module-id",
    options.moduleId,
    "--session-id",
    options.sessionId,
    "--video-asset-id",
    options.videoAssetId,
    "--input-file",
    options.inputFile,
    ...(options.package ? ["--package"] : []),
  ]);
  const inspected = await inspectMp4Input(validated.inputFile);
  const paths = buildVideoOutputPaths(
    validated.videoAssetId,
    configuration.outputRoot,
  );
  const target = {
    courseId: validated.courseId,
    moduleId: validated.moduleId,
    sessionId: validated.sessionId,
  };
  const baseResult = {
    target,
    videoAssetId: validated.videoAssetId,
    inputFileName: inspected.fileName,
    plaintextSize: inspected.size,
    artifactFileName: paths.artifactFileName,
    descriptorFileName: paths.descriptorFileName,
  };

  if (!validated.package) {
    return {
      ...baseResult,
      mode: "dry-run",
      encryptedSize: null,
      artifactSha256: null,
      contentKeySummary: {
        present: false,
        length: null,
        fingerprintPrefix: null,
      },
    };
  }

  const plaintext = await readFile(inspected.absolutePath);
  if (plaintext.length !== inspected.size) {
    throw new Error("Input MP4 changed during packaging.");
  }
  validateMp4Header(
    plaintext.subarray(0, MP4_HEADER_INSPECTION_LENGTH),
    plaintext.length,
  );
  const encrypted = encryptVideoBytes(
    plaintext,
    configuration.randomBytesProvider ?? randomBytes,
  );
  const artifactSha256 = createHash("sha256")
    .update(encrypted.artifact)
    .digest("hex");
  const publicationData = buildVideoPublicationData(
    validated.videoAssetId,
    encrypted.contentKey,
  );
  const descriptor: VideoPublicationDescriptor = {
    formatVersion: VIDEO_ARTIFACT_FORMAT,
    target,
    artifact: {
      fileName: paths.artifactFileName,
      sha256: artifactSha256,
      plaintextSize: plaintext.length,
      encryptedSize: encrypted.artifact.length,
    },
    ...publicationData,
  };

  await writeLocalPackage(paths, encrypted.artifact, descriptor);

  return {
    ...baseResult,
    mode: "package",
    encryptedSize: encrypted.artifact.length,
    artifactSha256,
    contentKeySummary: {
      present: true,
      length: encrypted.contentKey.length,
      fingerprintPrefix: contentKeyFingerprint(encrypted.contentKey),
    },
  };
}
