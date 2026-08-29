import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrustedSessionCreationDocument,
  getSessionPath,
  inspectExistingSession,
  parseSessionCreationArgs,
  resolveSessionCreationProject,
  safeSessionCreationSummary,
} from "../src/tooling/sessionCreation.js";

const VALID = [
  "--course-id",
  "mechanics",
  "--module-id",
  "motion-basics",
  "--session-id",
  "intro-motion",
  "--title",
  "Introduction to Motion",
  "--order",
  "0",
];

test("valid parser returns the minimum draft Session and defaults to dry run", () => {
  const options = parseSessionCreationArgs(VALID);
  assert.deepEqual(options, {
    courseId: "mechanics",
    moduleId: "motion-basics",
    sessionId: "intro-motion",
    title: "Introduction to Motion",
    order: 0,
    apply: false,
  });
  assert.deepEqual(buildTrustedSessionCreationDocument(options), {
    title: "Introduction to Motion",
    order: 0,
    publicationStatus: "draft",
    isFree: false,
  });
  assert.equal(parseSessionCreationArgs([...VALID, "--apply"]).apply, true);
});

test("missing, blank, unsafe, duplicate, unknown, positional, path, and authority inputs fail", () => {
  for (const args of [
    [],
    [
      "--course-id",
      "",
      "--module-id",
      "module",
      "--session-id",
      "session",
      "--title",
      "Title",
      "--order",
      "0",
    ],
    [
      "--course-id",
      "Course",
      "--module-id",
      "module",
      "--session-id",
      "session",
      "--title",
      "Title",
      "--order",
      "0",
    ],
    [
      "--course-id",
      "course",
      "--module-id",
      "../module",
      "--session-id",
      "session",
      "--title",
      "Title",
      "--order",
      "0",
    ],
    [
      "--course-id",
      "course",
      "--module-id",
      "module",
      "--session-id",
      "session/path",
      "--title",
      "Title",
      "--order",
      "0",
    ],
    [
      "--course-id",
      "course",
      "--module-id",
      "module",
      "--session-id",
      "session",
      "--title",
      " Title",
      "--order",
      "0",
    ],
    [...VALID, "--course-id", "other"],
    [...VALID, "--module-id", "other"],
    [...VALID, "--session-id", "other"],
    [...VALID, "--title", "Other"],
    [...VALID, "--order", "1"],
    [...VALID, "--apply", "--apply"],
    [...VALID, "garbage"],
    [...VALID, "--path", "courses/a/modules/b/sessions/c"],
    [...VALID, "--owner", "owner"],
    [...VALID, "--status", "published"],
    [...VALID, "--publication-status", "published"],
    [...VALID, "--video-asset-id", "video"],
    [...VALID, "--release-at", "2030-01-01"],
    [...VALID, "--lesson-text", "text"],
  ])
    assert.throws(() => parseSessionCreationArgs(args));
});

test("title and order validation fail closed", () => {
  assert.throws(() =>
    parseSessionCreationArgs([
      "--course-id",
      "course",
      "--module-id",
      "module",
      "--session-id",
      "session",
      "--title",
      "a".repeat(161),
      "--order",
      "0",
    ]),
  );
  assert.throws(() =>
    parseSessionCreationArgs([
      "--course-id",
      "course",
      "--module-id",
      "module",
      "--session-id",
      "session",
      "--title",
      "Bad\u0000Title",
      "--order",
      "0",
    ]),
  );
  for (const order of ["-1", "+1", "01", "1.5", "1e2", "9007199254740992"])
    assert.throws(() =>
      parseSessionCreationArgs([...VALID.slice(0, -1), order]),
    );
});

test("Session path is deterministic from three canonical IDs", () => {
  assert.equal(
    getSessionPath("mechanics", "motion-basics", "intro-motion"),
    "courses/mechanics/modules/motion-basics/sessions/intro-motion",
  );
  assert.throws(() => getSessionPath("mechanics/other", "module", "session"));
  assert.throws(() => getSessionPath("mechanics", "module/other", "session"));
  assert.throws(() => getSessionPath("mechanics", "module", "session/other"));
});

test("exact state distinguishes absent optional fields from null, values, and extras", () => {
  const expected = {
    title: "Motion",
    order: 0,
    publicationStatus: "draft" as const,
  };
  assert.equal(inspectExistingSession(undefined, expected), "MISSING");
  assert.equal(
    inspectExistingSession(
      { title: "Motion", order: 0, publicationStatus: "draft" },
      expected,
    ),
    "IDENTICAL",
  );
  for (const existing of [
    null,
    { ...expected, publicationStatus: "published" },
    { ...expected, releaseAt: null },
    { ...expected, lessonText: "Text" },
    { ...expected, videoAssetId: "video" },
    { ...expected, extra: true },
    { title: "Motion", order: 0 },
  ])
    assert.throws(() => inspectExistingSession(existing as never, expected));
});

test("project guard accepts only coherent production or fully emulated demo", () => {
  assert.equal(
    resolveSessionCreationProject({ GCLOUD_PROJECT: "at-in-physics" }),
    "at-in-physics",
  );
  assert.equal(
    resolveSessionCreationProject({
      GCLOUD_PROJECT: "demo-at-in-physics",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    }),
    "demo-at-in-physics",
  );
  for (const environment of [
    {},
    { GCLOUD_PROJECT: "other" },
    { GCLOUD_PROJECT: "demo-at-in-physics" },
    {
      GCLOUD_PROJECT: "at-in-physics",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    },
    { GCLOUD_PROJECT: "at-in-physics", GOOGLE_CLOUD_PROJECT: "other" },
  ])
    assert.throws(() => resolveSessionCreationProject(environment));
});

test("safe summary includes no authority, credentials, optional content, or video data", () => {
  const summary = safeSessionCreationSummary({
    sessionPath: "courses/a/modules/b/sessions/c",
    currentSession: "MISSING",
    proposedTitle: "Motion",
    proposedOrder: 0,
    proposedPublicationStatus: "draft",
    changeRequired: true,
    applyStatus: null,
    postApplyVerified: false,
  });
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const sensitive of [
    "owner",
    "claim",
    "credential",
    "token",
    "password",
    "videoassetid",
    "contentkey",
    "lessontext",
    "releaseat",
  ])
    assert.equal(serialized.includes(sensitive), false);
});
