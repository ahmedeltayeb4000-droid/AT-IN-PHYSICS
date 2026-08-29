import { Timestamp } from "firebase/firestore";
import type { Session } from "./types";

export const MAX_LESSON_TEXT_LENGTH = 20_000;
export const MAX_VIDEO_ASSET_ID_LENGTH = 128;

const VIDEO_ASSET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function malformedSession(): never {
  throw new Error("Malformed Session document.");
}

export function isValidLessonText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_LESSON_TEXT_LENGTH &&
    value === value.trim()
  );
}

export function isValidVideoAssetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_VIDEO_ASSET_ID_LENGTH &&
    VIDEO_ASSET_ID_PATTERN.test(value)
  );
}

export function mapSessionDocument(
  documentId: string,
  courseId: string,
  moduleId: string,
  value: unknown,
): Session {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return malformedSession();
  }

  const data = value as Record<string, unknown>;
  const hasReleaseAt = Object.prototype.hasOwnProperty.call(data, "releaseAt");
  const hasLessonText = Object.prototype.hasOwnProperty.call(data, "lessonText");
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
    (hasLessonText && !isValidLessonText(data.lessonText)) ||
    (hasVideoAssetId && !isValidVideoAssetId(data.videoAssetId)) ||
    (hasIsFree && typeof data.isFree !== "boolean")
  ) {
    return malformedSession();
  }

  return {
    id: documentId,
    courseId,
    moduleId,
    title: data.title,
    order: data.order,
    publicationStatus: data.publicationStatus,
    isFree: data.isFree === true,
    ...(data.releaseAt instanceof Timestamp
      ? { releaseAt: data.releaseAt.toDate().toISOString() }
      : {}),
    ...(hasLessonText ? { lessonText: data.lessonText as string } : {}),
    ...(hasVideoAssetId ? { videoAssetId: data.videoAssetId as string } : {}),
  };
}
