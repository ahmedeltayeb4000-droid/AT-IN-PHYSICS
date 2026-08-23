import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import {
  buildVideoPublicationResult,
  buildVideoPublicationWrites,
  parseVideoPublicationInput,
  validateExistingVideoAccess,
  validateSessionForVideoPublication,
  videoPublicationIsCurrent,
} from "../src/videoPublication/publishVideoMetadata.js";

const CONTENT_KEY = "A".repeat(43);
const RAW_INPUT = {
  courseId: "mechanics",
  moduleId: "mechanics-motion-basics",
  sessionId: "mechanics-intro-motion",
  videoAssetId: "mechanics-intro-motion-video",
  contentKey: CONTENT_KEY,
} as const;

function validSession(overrides: Record<string, unknown> = {}) {
  return {
    title: "Introduction to Motion",
    order: 1,
    publicationStatus: "published",
    ...overrides,
  };
}

test("strict publication input accepts only the exact canonical contract", () => {
  const parsed = parseVideoPublicationInput(RAW_INPUT);
  assert.deepEqual(parsed, RAW_INPUT);
  assert.throws(
    () => parseVideoPublicationInput({ ...RAW_INPUT, status: "published" }),
    /Unknown video publication field/,
  );
  assert.throws(() => parseVideoPublicationInput([]), /must be an object/);
  assert.throws(
    () => parseVideoPublicationInput({ ...RAW_INPUT, sessionId: undefined }),
    /sessionId/,
  );
});

test("unsafe target and video asset IDs are rejected without normalization", () => {
  for (const [field, value] of [
    ["courseId", "Mechanics"],
    ["moduleId", "mechanics/module"],
    ["sessionId", "mechanics--intro"],
    ["videoAssetId", " video-asset"],
  ]) {
    assert.throws(() =>
      parseVideoPublicationInput({ ...RAW_INPUT, [field]: value }),
    );
  }
});

test("noncanonical or invalid 32-byte content keys are rejected", () => {
  for (const contentKey of [
    "A".repeat(42),
    `${"A".repeat(42)}B`,
    `${"A".repeat(42)}=`,
    "_".repeat(43),
  ]) {
    assert.throws(
      () => parseVideoPublicationInput({ ...RAW_INPUT, contentKey }),
      /content key/i,
    );
  }
});

test("trusted Session validation accepts supported optional fields and future fields", () => {
  const session = validSession({
    releaseAt: Timestamp.fromDate(new Date("2030-01-01T00:00:00.000Z")),
    lessonText: "Validated lesson text.",
    videoAssetId: "previous-video",
    futureField: { preserved: true },
  });
  assert.equal(validateSessionForVideoPublication(session), session);
});

test("trusted Session validation fails closed on malformed required and optional fields", () => {
  for (const session of [
    null,
    validSession({ title: "   " }),
    validSession({ order: -1 }),
    validSession({ order: 1.5 }),
    validSession({ publicationStatus: "preview" }),
    validSession({ releaseAt: null }),
    validSession({ lessonText: " trailing " }),
    validSession({ videoAssetId: "INVALID" }),
  ]) {
    assert.throws(
      () => validateSessionForVideoPublication(session),
      /Existing Session.*malformed|must be an object/,
    );
  }
});

test("existing video access requires the exact trusted shape", () => {
  assert.deepEqual(
    validateExistingVideoAccess({
      videoAssetId: RAW_INPUT.videoAssetId,
      contentKey: CONTENT_KEY,
    }),
    { videoAssetId: RAW_INPUT.videoAssetId, contentKey: CONTENT_KEY },
  );
  for (const access of [
    { videoAssetId: RAW_INPUT.videoAssetId },
    { videoAssetId: RAW_INPUT.videoAssetId, contentKey: CONTENT_KEY, extra: true },
    { videoAssetId: "INVALID", contentKey: CONTENT_KEY },
    { videoAssetId: RAW_INPUT.videoAssetId, contentKey: "invalid" },
  ]) {
    assert.throws(
      () => validateExistingVideoAccess(access),
      /video access is malformed/,
    );
  }
});

test("publication writes contain only the allowed Session patch and access fields", () => {
  const input = parseVideoPublicationInput(RAW_INPUT);
  assert.deepEqual(buildVideoPublicationWrites(input), {
    sessionPatch: { videoAssetId: RAW_INPUT.videoAssetId },
    videoAccess: {
      videoAssetId: RAW_INPUT.videoAssetId,
      contentKey: CONTENT_KEY,
    },
  });
  const result = buildVideoPublicationResult("created", input);
  assert.deepEqual(result, {
    status: "created",
    videoAssetId: RAW_INPUT.videoAssetId,
  });
  assert.equal(JSON.stringify(result).includes(CONTENT_KEY), false);
});

test("exact desired-state comparison requires both Session and access agreement", () => {
  const desired = buildVideoPublicationWrites(parseVideoPublicationInput(RAW_INPUT));
  const access = {
    videoAssetId: RAW_INPUT.videoAssetId,
    contentKey: CONTENT_KEY,
  };
  assert.equal(
    videoPublicationIsCurrent(
      validSession({ videoAssetId: RAW_INPUT.videoAssetId }),
      access,
      desired,
    ),
    true,
  );
  assert.equal(videoPublicationIsCurrent(validSession(), access, desired), false);
  assert.equal(
    videoPublicationIsCurrent(
      validSession({ videoAssetId: RAW_INPUT.videoAssetId }),
      null,
      desired,
    ),
    false,
  );
});
