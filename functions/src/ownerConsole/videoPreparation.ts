import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import {
  MAX_VIDEO_INPUT_SIZE,
  DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT,
  runVideoPackaging,
  validateVideoAssetId,
  type VideoPackagingResult,
} from "../tooling/videoPackaging.js";
import {
  runVideoHostingPreparation,
  type VideoHostingPreparationResult,
} from "../tooling/videoHostingPreparation.js";
import { readOwnerLessonContent } from "./inventory.js";

export type OwnerVideoPreparationInput = Readonly<{
  courseId: string;
  moduleId: string;
  sessionId: string;
  videoAssetId: string;
  originalFileName: string;
  bytes: Uint8Array;
}>;

export type OwnerVideoPreparationSummary = Readonly<{
  target: { courseId: string; moduleId: string; sessionId: string };
  videoAssetId: string;
  inputFileName: string;
  plaintextSize: number;
  encryptedSize: number;
  artifactFileName: string;
  descriptorFileName: string;
  artifactSha256: string;
  hostingRoute: string;
  stagingStatus: "prepared" | "already-current";
  status: "LOCAL_ONLY_NOT_UPLOADED";
}>;

export function validateOwnerVideoFileName(value: unknown): string {
  const hasUnsafeCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        character === "/" ||
        character === "\\" ||
        codePoint < 32 ||
        codePoint === 127
      );
    });
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value !== value.trim() ||
    !value.toLowerCase().endsWith(".mp4") ||
    hasUnsafeCharacter
  )
    throw new Error("Selected video filename is invalid.");
  return value;
}

export async function prepareOwnerProtectedVideo(
  db: Firestore,
  input: OwnerVideoPreparationInput,
  dependencies: Readonly<{
    packageVideo?: typeof runVideoPackaging;
    stageVideo?: typeof runVideoHostingPreparation;
    readTarget?: typeof readOwnerLessonContent;
  }> = {},
): Promise<OwnerVideoPreparationSummary> {
  const originalFileName = validateOwnerVideoFileName(input.originalFileName);
  const videoAssetId = validateVideoAssetId(input.videoAssetId);
  if (
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > MAX_VIDEO_INPUT_SIZE
  )
    throw new Error("Selected video must be between 1 byte and 50 MiB.");
  const target = await (dependencies.readTarget ?? readOwnerLessonContent)(
    db,
    input.courseId,
    input.moduleId,
    input.sessionId,
  );
  const temporaryRoot = await mkdtemp(join(tmpdir(), "at-owner-video-"));
  const inputPath = join(temporaryRoot, "upload.mp4");
  try {
    await writeFile(inputPath, input.bytes, { flag: "wx", mode: 0o600 });
    const packaged = await (dependencies.packageVideo ?? runVideoPackaging)({
      courseId: target.courseId,
      moduleId: target.moduleId,
      sessionId: target.sessionId,
      videoAssetId,
      inputFile: inputPath,
      package: true,
    });
    const descriptorPath = join(
      DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT,
      packaged.descriptorFileName,
    );
    const staged = await (
      dependencies.stageVideo ?? runVideoHostingPreparation
    )({ descriptorFile: descriptorPath, prepare: true });
    return safeSummary(target, originalFileName, packaged, staged);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function safeSummary(
  target: Awaited<ReturnType<typeof readOwnerLessonContent>>,
  inputFileName: string,
  packaged: VideoPackagingResult,
  staged: VideoHostingPreparationResult,
): OwnerVideoPreparationSummary {
  if (
    packaged.encryptedSize === null ||
    packaged.artifactSha256 === null ||
    (staged.status !== "prepared" && staged.status !== "already-current")
  )
    throw new Error("Protected video preparation did not complete.");
  return {
    target: {
      courseId: target.courseId,
      moduleId: target.moduleId,
      sessionId: target.sessionId,
    },
    videoAssetId: packaged.videoAssetId,
    inputFileName,
    plaintextSize: packaged.plaintextSize,
    encryptedSize: packaged.encryptedSize,
    artifactFileName: packaged.artifactFileName,
    descriptorFileName: packaged.descriptorFileName,
    artifactSha256: packaged.artifactSha256,
    hostingRoute: staged.hostingRoute,
    stagingStatus: staged.status,
    status: "LOCAL_ONLY_NOT_UPLOADED",
  };
}
