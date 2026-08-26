import type { Course } from "../courses/types";

const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COURSE_FIELDS = ["shortDescription", "slug", "status", "title"];

function isTrustedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value === value.trim() &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

export function mapAdminCourseDocument(id: string, value: unknown): Course {
  if (
    !COURSE_ID_PATTERN.test(id) ||
    id.length > 128 ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("Malformed Course inventory response.");
  }
  const data = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(data).sort()) !==
      JSON.stringify(COURSE_FIELDS) ||
    data.slug !== id ||
    !isTrustedText(data.title, 160) ||
    !isTrustedText(data.shortDescription, 1000) ||
    (data.status !== "draft" && data.status !== "published")
  ) {
    throw new Error("Malformed Course inventory response.");
  }
  return {
    id,
    slug: data.slug,
    title: data.title,
    shortDescription: data.shortDescription,
    status: data.status,
  };
}
