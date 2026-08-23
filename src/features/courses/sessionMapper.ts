import { Timestamp } from "firebase/firestore";
import type { Session } from "./types";

export const MAX_LESSON_TEXT_LENGTH = 20_000;

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
  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    typeof data.order !== "number" ||
    !Number.isSafeInteger(data.order) ||
    data.order < 0 ||
    (data.publicationStatus !== "draft" &&
      data.publicationStatus !== "published") ||
    (hasReleaseAt && !(data.releaseAt instanceof Timestamp)) ||
    (hasLessonText && !isValidLessonText(data.lessonText))
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
    ...(data.releaseAt instanceof Timestamp
      ? { releaseAt: data.releaseAt.toDate().toISOString() }
      : {}),
    ...(hasLessonText ? { lessonText: data.lessonText as string } : {}),
  };
}
