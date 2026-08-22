import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSessionDiscoveryManifest,
  parseSessionDiscoveryRefreshInput,
  sessionDiscoveryManifestsEqual,
  sessionIsStudentVisible,
  type TrustedSessionRecord,
} from "../src/sessionDiscovery/manifest.js";

const NOW = new Date("2030-01-01T00:00:00.000Z");

function session(
  overrides: Partial<TrustedSessionRecord> = {},
): TrustedSessionRecord {
  return {
    id: "mechanics-intro-motion",
    order: 1,
    publicationStatus: "published",
    ...overrides,
  };
}

test("published Session without releaseAt is visible", () => {
  assert.equal(sessionIsStudentVisible(session(), NOW), true);
});

test("published past and equal release times are visible", () => {
  assert.equal(
    sessionIsStudentVisible(
      session({ releaseAt: new Date("2029-01-01T00:00:00.000Z") }),
      NOW,
    ),
    true,
  );
  assert.equal(
    sessionIsStudentVisible(session({ releaseAt: NOW }), NOW),
    true,
  );
});

test("published future Session is excluded", () => {
  assert.equal(
    sessionIsStudentVisible(
      session({ releaseAt: new Date("2031-01-01T00:00:00.000Z") }),
      NOW,
    ),
    false,
  );
});

test("draft and malformed publication states are excluded", () => {
  for (const publicationStatus of ["draft", "preview", undefined]) {
    assert.equal(
      sessionIsStudentVisible(session({ publicationStatus }), NOW),
      false,
    );
  }
});

test("null, malformed, and invalid release values are excluded", () => {
  for (const releaseAt of [
    null,
    new Date("invalid"),
    "not-a-timestamp" as unknown as Date,
  ]) {
    assert.equal(
      sessionIsStudentVisible(session({ releaseAt }), NOW),
      false,
    );
  }
});

test("manifest ordering is deterministic by order then ID", () => {
  const manifest = buildSessionDiscoveryManifest(
    [
      session({ id: "session-z", order: 2 }),
      session({ id: "session-b", order: 1 }),
      session({ id: "session-a", order: 1 }),
    ],
    NOW,
  );
  assert.deepEqual(manifest.sessionIds, ["session-a", "session-b", "session-z"]);
});

test("manifest excludes draft, future, and malformed Sessions", () => {
  const manifest = buildSessionDiscoveryManifest(
    [
      session({ id: "visible" }),
      session({ id: "draft", publicationStatus: "draft" }),
      session({
        id: "future",
        releaseAt: new Date("2031-01-01T00:00:00.000Z"),
      }),
      session({ id: "malformed", releaseAt: null }),
    ],
    NOW,
  );
  assert.deepEqual(manifest.sessionIds, ["visible"]);
});

test("empty visible set produces an empty manifest", () => {
  assert.deepEqual(
    buildSessionDiscoveryManifest(
      [session({ publicationStatus: "draft" })],
      NOW,
    ),
    { sessionIds: [] },
  );
});

test("duplicate and unsafe Session IDs are rejected", () => {
  assert.throws(
    () =>
      buildSessionDiscoveryManifest(
        [session({ id: "duplicate" }), session({ id: "duplicate" })],
        NOW,
      ),
    /duplicate/i,
  );
  for (const id of ["nested/path", " leading", "trailing ", "Uppercase"]) {
    assert.throws(
      () => buildSessionDiscoveryManifest([session({ id })], NOW),
      /sessionId/,
    );
  }
});

test("invalid Session order and trusted time are rejected", () => {
  assert.throws(
    () => buildSessionDiscoveryManifest([session({ order: 1.5 })], NOW),
    /order/,
  );
  assert.throws(
    () => buildSessionDiscoveryManifest([session()], new Date("invalid")),
    /time/,
  );
});

test("refresh input accepts only strict courseId and moduleId fields", () => {
  assert.deepEqual(
    parseSessionDiscoveryRefreshInput({
      courseId: "mechanics",
      moduleId: "mechanics-motion-basics",
    }),
    { courseId: "mechanics", moduleId: "mechanics-motion-basics" },
  );
  for (const value of [
    null,
    { courseId: "mechanics" },
    { courseId: "mechanics", moduleId: "motion", sessionIds: [] },
    { courseId: "Mechanics", moduleId: "motion" },
    { courseId: "mechanics", moduleId: "nested/path" },
  ]) {
    assert.throws(() => parseSessionDiscoveryRefreshInput(value));
  }
});

test("manifest equality requires the exact ordered shape", () => {
  const expected = { sessionIds: ["first", "second"] };
  assert.equal(sessionDiscoveryManifestsEqual(expected, expected), true);
  assert.equal(
    sessionDiscoveryManifestsEqual({ sessionIds: ["second", "first"] }, expected),
    false,
  );
  assert.equal(
    sessionDiscoveryManifestsEqual(
      { sessionIds: ["first", "second"], forged: true },
      expected,
    ),
    false,
  );
});
