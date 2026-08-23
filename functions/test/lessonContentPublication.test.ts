import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeLessonText,
  MAX_LESSON_TEXT_LENGTH,
  readLessonTextFile,
  validateLessonText,
} from "../src/lessonContent/validation.js";
import { parseLessonContentPublicationArgs } from "../src/tooling/lessonContentPublication.js";

const VALID_ARGS = [
  "--course-id",
  "mechanics",
  "--module-id",
  "mechanics-motion-basics",
  "--session-id",
  "mechanics-intro-motion",
  "--lesson-file",
  "lesson.txt",
] as const;

test("lesson text validation preserves valid text and internal newlines", () => {
  const value = "First line.\n\nSecond line.";
  assert.equal(validateLessonText(value), value);
  assert.equal(decodeLessonText(new TextEncoder().encode(value)), value);
});

test("lesson text validation exactly matches the frontend invariant", () => {
  for (const value of [
    null,
    1,
    "",
    "   ",
    " leading",
    "trailing ",
    "x".repeat(MAX_LESSON_TEXT_LENGTH + 1),
  ]) {
    assert.throws(() => validateLessonText(value), /Lesson text/);
  }
  assert.equal(
    validateLessonText("x".repeat(MAX_LESSON_TEXT_LENGTH)).length,
    MAX_LESSON_TEXT_LENGTH,
  );
});

test("invalid UTF-8 and a UTF-8 BOM fail safely without normalization", () => {
  assert.throws(() => decodeLessonText(Uint8Array.from([0xc3, 0x28])), /UTF-8/);
  assert.throws(
    () => decodeLessonText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x74, 0x65, 0x78, 0x74])),
    /Lesson text/,
  );
});

test("unreadable lesson files fail with a sanitized error", async () => {
  await assert.rejects(
    readLessonTextFile("missing.txt", async () => {
      throw new Error("sensitive path detail");
    }),
    /^Error: Lesson file could not be read\.$/,
  );
});

test("valid publication arguments default to dry run", () => {
  assert.deepEqual(parseLessonContentPublicationArgs(VALID_ARGS), {
    courseId: "mechanics",
    moduleId: "mechanics-motion-basics",
    sessionId: "mechanics-intro-motion",
    lessonFile: "lesson.txt",
    apply: false,
  });
  assert.equal(
    parseLessonContentPublicationArgs([...VALID_ARGS, "--apply"]).apply,
    true,
  );
});

test("missing values and required options are rejected", () => {
  for (const args of [
    VALID_ARGS.slice(2),
    [...VALID_ARGS.slice(0, 2), ...VALID_ARGS.slice(4)],
    VALID_ARGS.slice(0, -2),
    [...VALID_ARGS.slice(0, -1), "--apply"],
  ]) {
    assert.throws(() => parseLessonContentPublicationArgs(args));
  }
});

test("blank and unsafe target IDs are rejected", () => {
  for (const [option, value] of [
    ["--course-id", "   "],
    ["--module-id", "UPPERCASE"],
    ["--session-id", "nested/path"],
    ["--session-id", "two--hyphens"],
  ]) {
    const args: string[] = [...VALID_ARGS];
    args[args.indexOf(option) + 1] = value;
    assert.throws(() => parseLessonContentPublicationArgs(args));
  }
});

test("duplicate, unknown, positional, and valued apply options are rejected", () => {
  for (const extra of [
    ["--course-id", "other"],
    ["--module-id", "other"],
    ["--session-id", "other"],
    ["--lesson-file", "other.txt"],
    ["--apply", "--apply"],
    ["--unknown"],
    ["garbage"],
    ["--apply", "true"],
  ]) {
    assert.throws(() =>
      parseLessonContentPublicationArgs([...VALID_ARGS, ...extra]),
    );
  }
});
