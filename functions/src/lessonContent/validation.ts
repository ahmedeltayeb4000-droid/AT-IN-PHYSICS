export const MAX_LESSON_TEXT_LENGTH = 20_000;

const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CONTENT_ID_LENGTH = 128;

export function validateLessonText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_LESSON_TEXT_LENGTH ||
    value !== value.trim()
  ) {
    throw new Error(
      "Lesson text must be a non-empty, exactly trimmed string of at most 20000 characters.",
    );
  }
  return value;
}

export function validateContentId(field: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_CONTENT_ID_LENGTH ||
    !CONTENT_ID_PATTERN.test(value)
  ) {
    throw new Error(
      `${field} must contain lowercase letters, numbers, and single hyphens only.`,
    );
  }
  return value;
}

export function decodeLessonText(bytes: Uint8Array): string {
  let value: string;
  try {
    value = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    throw new Error("Lesson file must contain valid UTF-8 text.");
  }
  return validateLessonText(value);
}

export async function readLessonTextFile(
  path: string,
  reader: (path: string) => Promise<Uint8Array> = readFile,
): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await reader(path);
  } catch {
    throw new Error("Lesson file could not be read.");
  }
  return decodeLessonText(bytes);
}
import { readFile } from "node:fs/promises";
