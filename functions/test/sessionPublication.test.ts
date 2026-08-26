import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { validateSessionDiscoveryManifest } from "../src/sessionDiscovery/manifest.js";
import {
  classifyContentReadiness,
  classifyReleaseState,
  derivePublicationManifest,
  parseSessionPublicationArgs,
  proposePublishedSession,
  resolveSessionPublicationProject,
  safeSessionPublicationSummary,
} from "../src/tooling/sessionPublication.js";
import { getSessionPath } from "../src/tooling/sessionCreation.js";

const NOW = new Date("2030-01-01T00:00:00.000Z");
const VALID = [
  "--course-id",
  "mechanics",
  "--module-id",
  "motion-basics",
  "--session-id",
  "intro-motion",
];
const session = (overrides: Record<string, unknown> = {}) => ({
  title: "Motion",
  order: 0,
  publicationStatus: "draft",
  ...overrides,
});

test("valid CLI parsing defaults to dry run and apply is explicit", () => {
  assert.deepEqual(parseSessionPublicationArgs(VALID), {
    courseId: "mechanics",
    moduleId: "motion-basics",
    sessionId: "intro-motion",
    apply: false,
  });
  assert.equal(parseSessionPublicationArgs([...VALID, "--apply"]).apply, true);
});

test("missing, unsafe, duplicate, unknown, positional, authority, path, and state inputs fail", () => {
  for (const args of [
    [],
    [
      "--course-id",
      "Course",
      "--module-id",
      "module",
      "--session-id",
      "session",
    ],
    [
      "--course-id",
      "course",
      "--module-id",
      "../module",
      "--session-id",
      "session",
    ],
    [
      "--course-id",
      "course",
      "--module-id",
      "module",
      "--session-id",
      "session/path",
    ],
    [...VALID, "--course-id", "other"],
    [...VALID, "--module-id", "other"],
    [...VALID, "--session-id", "other"],
    [...VALID, "--apply", "--apply"],
    [...VALID, "garbage"],
    [...VALID, "--path", "courses/a"],
    [...VALID, "--owner", "owner"],
    [...VALID, "--publication-status", "published"],
    [...VALID, "--discovery-ids", "session"],
    [...VALID, "--content-key", "secret"],
    [...VALID, "--release-at", "2030-01-01"],
  ])
    assert.throws(() => parseSessionPublicationArgs(args));
});

test("target path is deterministic", () => {
  assert.equal(
    getSessionPath("mechanics", "motion-basics", "intro-motion"),
    "courses/mechanics/modules/motion-basics/sessions/intro-motion",
  );
});

test("draft proposal preserves legal optional and future fields", () => {
  const releaseAt = Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z"));
  const original = session({
    releaseAt,
    lessonText: "Lesson text.",
    videoAssetId: "motion-video",
    futureField: { preserved: true },
  });
  const proposed = proposePublishedSession(original);
  assert.deepEqual(proposed, { ...original, publicationStatus: "published" });
  assert.equal(original.publicationStatus, "draft");
});

test("readiness classification supports empty, lesson, video, and combined Sessions", () => {
  assert.equal(classifyContentReadiness(session()), "EMPTY_SUPPORTED");
  assert.equal(
    classifyContentReadiness(session({ lessonText: "Text" })),
    "LESSON",
  );
  assert.equal(
    classifyContentReadiness(session({ videoAssetId: "video" })),
    "VIDEO",
  );
  assert.equal(
    classifyContentReadiness(
      session({ lessonText: "Text", videoAssetId: "video" }),
    ),
    "LESSON_AND_VIDEO",
  );
});

test("release classification preserves immediate, released, and scheduled semantics", () => {
  assert.equal(classifyReleaseState(session(), NOW), "IMMEDIATE");
  assert.equal(
    classifyReleaseState(session({ releaseAt: Timestamp.fromDate(NOW) }), NOW),
    "RELEASED",
  );
  assert.equal(
    classifyReleaseState(
      session({
        releaseAt: Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z")),
      }),
      NOW,
    ),
    "SCHEDULED",
  );
  assert.throws(() => classifyReleaseState(session({ releaseAt: null }), NOW));
});

test("discovery proposal publishes target, excludes draft/future, and orders by order then ID", () => {
  const proposed = derivePublicationManifest(
    [
      { id: "target", data: session({ order: 2 }) },
      {
        id: "z-tie",
        data: session({ order: 1, publicationStatus: "published" }),
      },
      {
        id: "a-tie",
        data: session({ order: 1, publicationStatus: "published" }),
      },
      { id: "draft", data: session({ order: 0 }) },
      {
        id: "future",
        data: session({
          order: 0,
          publicationStatus: "published",
          releaseAt: Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z")),
        }),
      },
    ],
    "target",
    NOW,
  );
  assert.deepEqual(proposed, { sessionIds: ["a-tie", "z-tie", "target"] });
});

test("published target remains idempotently included and malformed Sessions fail closed", () => {
  assert.deepEqual(
    derivePublicationManifest(
      [{ id: "target", data: session({ publicationStatus: "published" }) }],
      "target",
      NOW,
    ),
    { sessionIds: ["target"] },
  );
  for (const data of [
    null,
    { title: "", order: 0, publicationStatus: "draft" },
    session({ order: -1 }),
    session({ publicationStatus: "preview" }),
    session({ lessonText: " trimmed " }),
    session({ videoAssetId: "INVALID" }),
  ])
    assert.throws(() =>
      derivePublicationManifest([{ id: "target", data }], "target", NOW),
    );
});

test("manifest validation rejects malformed shapes, IDs, duplicates, and extras", () => {
  assert.deepEqual(
    validateSessionDiscoveryManifest({ sessionIds: ["a", "b"] }),
    { sessionIds: ["a", "b"] },
  );
  for (const value of [
    null,
    {},
    { sessionIds: "a" },
    { sessionIds: ["a", "a"] },
    { sessionIds: ["a/b"] },
    { sessionIds: ["a"], extra: true },
  ])
    assert.throws(() => validateSessionDiscoveryManifest(value));
});

test("project guard and safe summary fail closed without sensitive output", () => {
  assert.equal(
    resolveSessionPublicationProject({
      GCLOUD_PROJECT: "demo-at-in-physics",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    }),
    "demo-at-in-physics",
  );
  assert.throws(() =>
    resolveSessionPublicationProject({ GCLOUD_PROJECT: "demo-at-in-physics" }),
  );
  const serialized = JSON.stringify(
    safeSessionPublicationSummary({
      sessionPath: "courses/a/modules/b/sessions/c",
      currentPublicationState: "draft",
      proposedPublicationState: "published",
      releaseState: "IMMEDIATE",
      contentReadiness: "LESSON",
      currentDiscoveryState: "MISSING",
      proposedSessionIds: ["c"],
      sessionChangeRequired: true,
      discoveryChangeRequired: true,
      changeRequired: true,
      applyStatus: null,
      postApplyVerified: false,
    }),
  ).toLowerCase();
  for (const sensitive of [
    "contentkey",
    "credential",
    "password",
    "token",
    "owner",
    "lessontext",
    "videoassetid",
  ])
    assert.equal(serialized.includes(sensitive), false);
});
