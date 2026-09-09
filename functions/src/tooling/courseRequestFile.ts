import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCourseId } from "../enrollments/validation.js";
import { validateTrustedContentText } from "./courseCreation.js";

const REQUEST_FIELDS = ["courseId", "shortDescription", "title"];

export type TrustedCourseTextRequest = Readonly<{
  courseId: string;
  title: string;
  shortDescription: string;
}>;

export function parseTrustedCourseTextRequest(
  value: unknown,
): TrustedCourseTextRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Course request must be a JSON object.");
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().length !== REQUEST_FIELDS.length ||
    !Object.keys(input)
      .sort()
      .every((field, index) => field === REQUEST_FIELDS[index])
  ) {
    throw new Error("Course request fields are invalid.");
  }
  return {
    courseId: validateCourseId(input.courseId),
    title: validateTrustedContentText("title", input.title, 160),
    shortDescription: validateTrustedContentText(
      "shortDescription",
      input.shortDescription,
      1000,
    ),
  };
}

export function readStrictJsonRequest(path: string) {
  const absolutePath = resolve(path);
  const stats = lstatSync(absolutePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("Request must be a regular file.");
  }
  const bytes = readFileSync(absolutePath);
  if (bytes.length === 0 || bytes.length > 4096) {
    throw new Error("Course request file size is invalid.");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Course request file must contain valid UTF-8 JSON.");
  }
  return { value, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function readTrustedCourseTextRequest(path: string) {
  const loaded = readStrictJsonRequest(path);
  return {
    request: parseTrustedCourseTextRequest(loaded.value),
    sha256: loaded.sha256,
  };
}
