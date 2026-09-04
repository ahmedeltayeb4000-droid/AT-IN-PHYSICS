import type { DocumentData, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import {
  validateContentId,
  validateLessonText,
} from "../lessonContent/validation.js";
import {
  buildVideoPublicationData,
  validateVideoAssetId,
  type VideoPublicationData,
} from "../tooling/videoPackaging.js";
import { decodeContentKey } from "../videoPackaging/crypto.js";

const VIDEO_PUBLICATION_FIELDS = new Set([
  "courseId",
  "moduleId",
  "sessionId",
  "videoAssetId",
  "contentKey",
]);

declare const validatedVideoPublicationInput: unique symbol;

export type ValidatedVideoPublicationInput = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly sessionId: string;
  readonly videoAssetId: string;
  readonly contentKey: string;
  readonly [validatedVideoPublicationInput]: true;
};

export type TrustedVideoAccess = {
  readonly videoAssetId: string;
  readonly contentKey: string;
};

export type VideoPublicationResult = {
  readonly status: "created" | "updated" | "already-current";
  readonly videoAssetId: string;
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function validateContentKey(value: unknown): string {
  decodeContentKey(value);
  return value as string;
}

export function parseVideoPublicationInput(
  value: unknown,
): ValidatedVideoPublicationInput {
  const input = requireRecord(value, "Video publication input");
  const unknownFields = Object.keys(input).filter(
    (field) => !VIDEO_PUBLICATION_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    throw new Error(`Unknown video publication field: ${unknownFields[0]}`);
  }

  const courseId = validateContentId("courseId", input.courseId);
  const moduleId = validateContentId("moduleId", input.moduleId);
  const sessionId = validateContentId("sessionId", input.sessionId);
  const publicationData = buildVideoPublicationData(
    validateVideoAssetId(input.videoAssetId),
    validateContentKey(input.contentKey),
  );
  return {
    courseId,
    moduleId,
    sessionId,
    videoAssetId: publicationData.sessionPatch.videoAssetId,
    contentKey: publicationData.videoAccess.contentKey,
  } as ValidatedVideoPublicationInput;
}

export function validateSessionForVideoPublication(
  value: unknown,
): DocumentData {
  const data = requireRecord(value, "Existing Session");
  const hasReleaseAt = Object.prototype.hasOwnProperty.call(data, "releaseAt");
  const hasCloseAt = Object.prototype.hasOwnProperty.call(data, "closeAt");
  const hasLessonText = Object.prototype.hasOwnProperty.call(
    data,
    "lessonText",
  );
  const hasVideoAssetId = Object.prototype.hasOwnProperty.call(
    data,
    "videoAssetId",
  );
  const hasIsFree = Object.prototype.hasOwnProperty.call(data, "isFree");

  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    typeof data.order !== "number" ||
    !Number.isSafeInteger(data.order) ||
    data.order < 0 ||
    (data.publicationStatus !== "draft" &&
      data.publicationStatus !== "published") ||
    (hasReleaseAt && !(data.releaseAt instanceof Timestamp)) ||
    (hasCloseAt && !(data.closeAt instanceof Timestamp)) ||
    (hasReleaseAt &&
      hasCloseAt &&
      (data.closeAt as Timestamp).toMillis() <=
        (data.releaseAt as Timestamp).toMillis()) ||
    (hasIsFree && typeof data.isFree !== "boolean")
  ) {
    throw new Error("Existing Session is malformed.");
  }

  try {
    if (hasLessonText) validateLessonText(data.lessonText);
    if (hasVideoAssetId) validateVideoAssetId(data.videoAssetId);
  } catch {
    throw new Error("Existing Session is malformed.");
  }
  return data;
}

export function validateExistingVideoAccess(
  value: unknown,
): TrustedVideoAccess {
  const data = requireRecord(value, "Existing video access");
  if (
    Object.keys(data).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(data, "videoAssetId") ||
    !Object.prototype.hasOwnProperty.call(data, "contentKey")
  ) {
    throw new Error("Existing video access is malformed.");
  }

  try {
    return {
      videoAssetId: validateVideoAssetId(data.videoAssetId),
      contentKey: validateContentKey(data.contentKey),
    };
  } catch {
    throw new Error("Existing video access is malformed.");
  }
}

export function buildVideoPublicationWrites(
  input: ValidatedVideoPublicationInput,
): VideoPublicationData {
  return buildVideoPublicationData(input.videoAssetId, input.contentKey);
}

export function buildVideoPublicationResult(
  status: VideoPublicationResult["status"],
  input: ValidatedVideoPublicationInput,
): VideoPublicationResult {
  return { status, videoAssetId: validateVideoAssetId(input.videoAssetId) };
}

export function videoPublicationIsCurrent(
  session: DocumentData,
  access: TrustedVideoAccess | null,
  desired: VideoPublicationData,
): boolean {
  return (
    session.videoAssetId === desired.sessionPatch.videoAssetId &&
    access?.videoAssetId === desired.videoAccess.videoAssetId &&
    access.contentKey === desired.videoAccess.contentKey
  );
}

export async function publishEncryptedVideoMetadata(
  db: Firestore,
  rawInput: unknown,
  expectedSessionRevisionMillis?: number,
): Promise<VideoPublicationResult> {
  const input = parseVideoPublicationInput(rawInput);
  const sessionReference = db.doc(
    `courses/${input.courseId}/modules/${input.moduleId}/sessions/${input.sessionId}`,
  );
  const accessReference = sessionReference
    .collection("videoAccess")
    .doc("primary");

  return db.runTransaction(async (transaction) => {
    const sessionSnapshot = await transaction.get(sessionReference);
    if (!sessionSnapshot.exists) throw new Error("Session was not found.");
    if (
      expectedSessionRevisionMillis !== undefined &&
      sessionSnapshot.updateTime?.toMillis() !== expectedSessionRevisionMillis
    )
      throw new Error("Session changed after video binding review.");
    const session = validateSessionForVideoPublication(sessionSnapshot.data());

    const accessSnapshot = await transaction.get(accessReference);
    const existingAccess = accessSnapshot.exists
      ? validateExistingVideoAccess(accessSnapshot.data())
      : null;
    const desired = buildVideoPublicationWrites(input);

    if (videoPublicationIsCurrent(session, existingAccess, desired)) {
      return buildVideoPublicationResult("already-current", input);
    }

    transaction.update(sessionReference, desired.sessionPatch);
    transaction.set(accessReference, desired.videoAccess);
    return buildVideoPublicationResult(
      accessSnapshot.exists ? "updated" : "created",
      input,
    );
  });
}
