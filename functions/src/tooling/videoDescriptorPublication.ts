import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import {
  buildVideoPublicationWrites,
  parseVideoPublicationInput,
  publishEncryptedVideoMetadata,
  validateExistingVideoAccess,
  validateSessionForVideoPublication,
  videoPublicationIsCurrent,
  type ValidatedVideoPublicationInput,
  type VideoPublicationResult,
} from "../videoPublication/publishVideoMetadata.js";
import {
  decryptVideoArtifact,
  VIDEO_ARTIFACT_FORMAT,
  VIDEO_AUTH_TAG_LENGTH,
  VIDEO_IV_LENGTH,
} from "../videoPackaging/crypto.js";
import {
  MAX_VIDEO_INPUT_SIZE,
  validateMp4Header,
  type VideoPublicationDescriptor,
} from "./videoPackaging.js";

const MAX_DESCRIPTOR_SIZE = 64 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const TOP_LEVEL_FIELDS = [
  "formatVersion",
  "target",
  "artifact",
  "sessionPatch",
  "videoAccess",
] as const;
const TARGET_FIELDS = ["courseId", "moduleId", "sessionId"] as const;
const ARTIFACT_FIELDS = [
  "fileName",
  "sha256",
  "plaintextSize",
  "encryptedSize",
] as const;
const SESSION_PATCH_FIELDS = ["videoAssetId"] as const;
const VIDEO_ACCESS_FIELDS = ["videoAssetId", "contentKey"] as const;

export type VideoDescriptorPublicationOptions = {
  readonly descriptorFile: string;
  readonly apply: boolean;
};

export type VideoDescriptorPublicationEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type VerifiedVideoPackageSummary = {
  readonly target: VideoPublicationDescriptor["target"];
  readonly videoAssetId: string;
  readonly artifactFileName: string;
  readonly artifactSha256: string;
  readonly plaintextSize: number;
  readonly encryptedSize: number;
  readonly artifactSha256Verified: true;
  readonly artifactAuthenticated: true;
  readonly plaintextMp4Verified: true;
};

export type VideoPublicationPreflight = {
  readonly currentSessionVideoBinding: "ABSENT" | "PRESENT";
  readonly currentVideoAccess: "ABSENT" | "PRESENT";
  readonly proposedStatus: VideoPublicationResult["status"];
  readonly changeRequired: boolean;
};

export type VideoDescriptorPublicationResult = {
  readonly package: VerifiedVideoPackageSummary;
  readonly preflight: VideoPublicationPreflight;
  readonly applyStatus: VideoPublicationResult["status"] | null;
  readonly postApplyVerified: boolean;
};

export type PreparedVideoPublicationPackage = {
  readonly descriptor: VideoPublicationDescriptor;
  readonly input: ValidatedVideoPublicationInput;
  readonly summary: VerifiedVideoPackageSummary;
};

type TrustedPreflightState = {
  readonly summary: VideoPublicationPreflight;
  readonly session: DocumentData;
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

export function parseVideoDescriptorPublicationArgs(
  args: readonly string[],
): VideoDescriptorPublicationOptions {
  let descriptorFile: string | undefined;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--descriptor-file") {
      if (descriptorFile !== undefined) {
        throw new Error("The --descriptor-file option may be provided only once.");
      }
      descriptorFile = optionValue(args, index, argument);
      index += 1;
      continue;
    }
    if (argument === "--apply") {
      if (apply) throw new Error("The --apply option may be provided only once.");
      apply = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (
    typeof descriptorFile !== "string" ||
    !descriptorFile.trim() ||
    descriptorFile !== descriptorFile.trim()
  ) {
    throw new Error(
      "A canonical descriptor path is required with --descriptor-file.",
    );
  }
  if (!descriptorFile.endsWith(".publication.json")) {
    throw new Error("Descriptor file must use the .publication.json suffix.");
  }
  return { descriptorFile, apply };
}

function requireExactRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data);
  if (
    keys.length !== fields.length ||
    keys.some((field) => !fields.includes(field))
  ) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
  return data;
}

function requirePositiveSize(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`Descriptor ${field} is invalid.`);
  }
  return value;
}

export function parseVideoPublicationDescriptor(
  value: unknown,
): VideoPublicationDescriptor {
  const descriptor = requireExactRecord(
    value,
    TOP_LEVEL_FIELDS,
    "Video publication descriptor",
  );
  const target = requireExactRecord(
    descriptor.target,
    TARGET_FIELDS,
    "Descriptor target",
  );
  const artifact = requireExactRecord(
    descriptor.artifact,
    ARTIFACT_FIELDS,
    "Descriptor artifact",
  );
  const sessionPatch = requireExactRecord(
    descriptor.sessionPatch,
    SESSION_PATCH_FIELDS,
    "Descriptor Session patch",
  );
  const videoAccess = requireExactRecord(
    descriptor.videoAccess,
    VIDEO_ACCESS_FIELDS,
    "Descriptor video access",
  );

  if (descriptor.formatVersion !== VIDEO_ARTIFACT_FORMAT) {
    throw new Error("Descriptor format version is invalid.");
  }

  const input = parseVideoPublicationInput({
    courseId: target.courseId,
    moduleId: target.moduleId,
    sessionId: target.sessionId,
    videoAssetId: sessionPatch.videoAssetId,
    contentKey: videoAccess.contentKey,
  });
  if (videoAccess.videoAssetId !== input.videoAssetId) {
    throw new Error("Descriptor video asset bindings do not match.");
  }

  const expectedFileName = `${input.videoAssetId}.atv1`;
  if (artifact.fileName !== expectedFileName) {
    throw new Error("Descriptor artifact filename is invalid.");
  }
  if (typeof artifact.sha256 !== "string" || !SHA256_PATTERN.test(artifact.sha256)) {
    throw new Error("Descriptor artifact SHA-256 is invalid.");
  }

  const plaintextSize = requirePositiveSize(
    artifact.plaintextSize,
    "plaintext size",
  );
  const encryptedSize = requirePositiveSize(
    artifact.encryptedSize,
    "encrypted size",
  );
  const artifactOverhead =
    VIDEO_ARTIFACT_FORMAT.length + VIDEO_IV_LENGTH + VIDEO_AUTH_TAG_LENGTH;
  if (
    plaintextSize > MAX_VIDEO_INPUT_SIZE ||
    encryptedSize !== plaintextSize + artifactOverhead
  ) {
    throw new Error("Descriptor artifact sizes are inconsistent.");
  }

  return {
    formatVersion: VIDEO_ARTIFACT_FORMAT,
    target: {
      courseId: input.courseId,
      moduleId: input.moduleId,
      sessionId: input.sessionId,
    },
    artifact: {
      fileName: expectedFileName,
      sha256: artifact.sha256,
      plaintextSize,
      encryptedSize,
    },
    sessionPatch: { videoAssetId: input.videoAssetId },
    videoAccess: {
      videoAssetId: input.videoAssetId,
      contentKey: input.contentKey,
    },
  };
}

async function readStrictDescriptorFile(path: string): Promise<unknown> {
  const absolutePath = resolve(path);
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch {
    throw new Error("Video publication descriptor could not be inspected.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Video publication descriptor must be a regular file.");
  }
  if (stats.size === 0 || stats.size > MAX_DESCRIPTOR_SIZE) {
    throw new Error("Video publication descriptor size is invalid.");
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(absolutePath);
  } catch {
    throw new Error("Video publication descriptor could not be read.");
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw new Error("Video publication descriptor must not contain a BOM.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Video publication descriptor must contain valid UTF-8.");
  }
  if (!text.trim()) {
    throw new Error("Video publication descriptor must not be empty.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Video publication descriptor contains malformed JSON.");
  }
}

export async function prepareVideoPublicationPackage(
  descriptorFile: string,
): Promise<PreparedVideoPublicationPackage> {
  const absoluteDescriptorPath = resolve(descriptorFile);
  const descriptor = parseVideoPublicationDescriptor(
    await readStrictDescriptorFile(absoluteDescriptorPath),
  );
  const packageDirectory = dirname(absoluteDescriptorPath);
  const artifactPath = resolve(packageDirectory, descriptor.artifact.fileName);
  if (
    dirname(artifactPath) !== packageDirectory ||
    basename(artifactPath) !== descriptor.artifact.fileName
  ) {
    throw new Error("Encrypted video artifact path is unsafe.");
  }

  let stats;
  try {
    stats = await lstat(artifactPath);
  } catch {
    throw new Error("Encrypted video artifact could not be inspected.");
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Encrypted video artifact must be a regular file.");
  }

  let artifact: Buffer;
  try {
    artifact = await readFile(artifactPath);
  } catch {
    throw new Error("Encrypted video artifact could not be read.");
  }
  if (
    artifact.length !== descriptor.artifact.encryptedSize ||
    createHash("sha256").update(artifact).digest("hex") !==
      descriptor.artifact.sha256
  ) {
    throw new Error("Encrypted video artifact integrity verification failed.");
  }

  const plaintext = decryptVideoArtifact(
    artifact,
    descriptor.videoAccess.contentKey,
  );
  if (plaintext.length !== descriptor.artifact.plaintextSize) {
    throw new Error("Encrypted video plaintext size verification failed.");
  }
  validateMp4Header(plaintext.subarray(0, 24), plaintext.length);

  const input = parseVideoPublicationInput({
    ...descriptor.target,
    ...descriptor.videoAccess,
  });
  return {
    descriptor,
    input,
    summary: {
      target: descriptor.target,
      videoAssetId: input.videoAssetId,
      artifactFileName: descriptor.artifact.fileName,
      artifactSha256: descriptor.artifact.sha256,
      plaintextSize: descriptor.artifact.plaintextSize,
      encryptedSize: descriptor.artifact.encryptedSize,
      artifactSha256Verified: true,
      artifactAuthenticated: true,
      plaintextMp4Verified: true,
    },
  };
}

function publicationReferences(
  db: Firestore,
  input: ValidatedVideoPublicationInput,
) {
  const session = db.doc(
    `courses/${input.courseId}/modules/${input.moduleId}/sessions/${input.sessionId}`,
  );
  return {
    session,
    access: session.collection("videoAccess").doc("primary"),
  };
}

async function trustedPreflight(
  db: Firestore,
  input: ValidatedVideoPublicationInput,
): Promise<TrustedPreflightState> {
  const references = publicationReferences(db, input);
  const [sessionSnapshot, accessSnapshot] = await db.getAll(
    references.session,
    references.access,
  );
  if (!sessionSnapshot.exists) throw new Error("Session was not found.");
  const session = validateSessionForVideoPublication(sessionSnapshot.data());
  const access = accessSnapshot.exists
    ? validateExistingVideoAccess(accessSnapshot.data())
    : null;
  const current = videoPublicationIsCurrent(
    session,
    access,
    buildVideoPublicationWrites(input),
  );

  return {
    session,
    summary: {
      currentSessionVideoBinding: Object.prototype.hasOwnProperty.call(
        session,
        "videoAssetId",
      )
        ? "PRESENT"
        : "ABSENT",
      currentVideoAccess: accessSnapshot.exists ? "PRESENT" : "ABSENT",
      proposedStatus: current
        ? "already-current"
        : accessSnapshot.exists
          ? "updated"
          : "created",
      changeRequired: !current,
    },
  };
}

function withoutVideoAssetId(data: DocumentData): DocumentData {
  const copy = { ...data };
  delete copy.videoAssetId;
  return copy;
}

async function verifyAppliedPublication(
  db: Firestore,
  input: ValidatedVideoPublicationInput,
  sessionBefore: DocumentData,
): Promise<void> {
  const references = publicationReferences(db, input);
  const [sessionSnapshot, accessSnapshot] = await db.getAll(
    references.session,
    references.access,
  );
  if (!sessionSnapshot.exists || !accessSnapshot.exists) {
    throw new Error("Video publication verification failed after apply.");
  }
  const session = validateSessionForVideoPublication(sessionSnapshot.data());
  const access = validateExistingVideoAccess(accessSnapshot.data());
  if (
    session.videoAssetId !== input.videoAssetId ||
    access.videoAssetId !== input.videoAssetId ||
    access.contentKey !== input.contentKey ||
    !isDeepStrictEqual(
      withoutVideoAssetId(session),
      withoutVideoAssetId(sessionBefore),
    )
  ) {
    throw new Error("Video publication verification failed after apply.");
  }
}

export async function runPreparedVideoPublication(
  db: Firestore,
  prepared: PreparedVideoPublicationPackage,
  apply: boolean,
): Promise<VideoDescriptorPublicationResult> {
  const preflight = await trustedPreflight(db, prepared.input);
  if (!apply) {
    return {
      package: prepared.summary,
      preflight: preflight.summary,
      applyStatus: null,
      postApplyVerified: false,
    };
  }

  const publication = await publishEncryptedVideoMetadata(db, prepared.input);
  await verifyAppliedPublication(db, prepared.input, preflight.session);
  return {
    package: prepared.summary,
    preflight: preflight.summary,
    applyStatus: publication.status,
    postApplyVerified: true,
  };
}

export async function runVideoDescriptorPublication(
  db: Firestore,
  options: VideoDescriptorPublicationOptions,
): Promise<VideoDescriptorPublicationResult> {
  const parsedOptions = parseVideoDescriptorPublicationArgs([
    "--descriptor-file",
    options.descriptorFile,
    ...(options.apply ? ["--apply"] : []),
  ]);
  const prepared = await prepareVideoPublicationPackage(
    parsedOptions.descriptorFile,
  );
  return runPreparedVideoPublication(db, prepared, parsedOptions.apply);
}
