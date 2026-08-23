import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import { Timestamp } from "firebase/firestore";
import { mapEnrollmentDocument } from "../src/features/enrollments/enrollmentMapper.ts";
import {
  enrollmentGrantsAccess,
  hasCourseEntitlement,
} from "../src/features/enrollments/entitlement.ts";
import { buildDashboardEnrollmentRows } from "../src/features/enrollments/dashboardEnrollmentViewModel.ts";
import { mapSessionDiscoveryManifest } from "../src/features/courses/sessionDiscovery.ts";
import { buildCourseCurriculum } from "../src/features/courses/courseCurriculum.ts";
import {
  mapSessionDocument,
  MAX_LESSON_TEXT_LENGTH,
} from "../src/features/courses/sessionMapper.ts";
import {
  buildSessionDetailPath,
  composeSessionDetail,
  parseSessionDetailRouteParams,
  SessionDetailUnavailableError,
} from "../src/features/courses/sessionDetail.ts";
import {
  mapVideoAccessDocument,
  VIDEO_ACCESS_DOCUMENT_ID,
} from "../src/features/courses/videoAccess.ts";

const NOW = new Date("2030-01-01T00:00:00.000Z");

function enrollment(overrides = {}) {
  return {
    id: "student_mechanics",
    userId: "student",
    courseId: "mechanics",
    status: "active",
    grantedAt: "2029-01-01T00:00:00.000Z",
    expiresAt: null,
    source: "manual",
    grantedBy: "owner",
    ...overrides,
  };
}

function persistedEnrollment(overrides = {}) {
  return {
    userId: "student",
    courseId: "mechanics",
    status: "active",
    grantedAt: Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z")),
    expiresAt: null,
    source: "manual",
    grantedBy: "owner",
    ...overrides,
  };
}

function course(overrides = {}) {
  return {
    id: "mechanics",
    slug: "mechanics",
    title: "Mechanics",
    shortDescription: "Motion, forces, and energy.",
    status: "published",
    ...overrides,
  };
}

function moduleRecord(overrides = {}) {
  return {
    id: "mechanics-motion-basics",
    courseId: "mechanics",
    title: "Motion Basics",
    order: 1,
    ...overrides,
  };
}

function sessionRecord(overrides = {}) {
  return {
    id: "mechanics-intro-motion",
    courseId: "mechanics",
    moduleId: "mechanics-motion-basics",
    title: "Introduction to Motion",
    order: 1,
    publicationStatus: "published",
    ...overrides,
  };
}

function persistedSession(overrides = {}) {
  return {
    title: "Introduction to Motion",
    order: 1,
    publicationStatus: "published",
    ...overrides,
  };
}

test("Firestore Timestamps map to canonical ISO strings", () => {
  const mapped = mapEnrollmentDocument(
    "student_mechanics",
    persistedEnrollment({
      expiresAt: Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z")),
    }),
  );
  assert.equal(mapped.grantedAt, "2029-01-01T00:00:00.000Z");
  assert.equal(mapped.expiresAt, "2031-01-01T00:00:00.000Z");
});

test("null persisted expiry remains null", () => {
  assert.equal(
    mapEnrollmentDocument("student_mechanics", persistedEnrollment()).expiresAt,
    null,
  );
});

test("malformed Enrollment status is rejected", () => {
  assert.throws(
    () =>
      mapEnrollmentDocument(
        "student_mechanics",
        persistedEnrollment({ status: "expired" }),
      ),
    /status/,
  );
});

test("malformed Enrollment timestamp is rejected", () => {
  assert.throws(
    () =>
      mapEnrollmentDocument(
        "student_mechanics",
        persistedEnrollment({ grantedAt: "not-a-timestamp" }),
      ),
    /grantedAt/,
  );
});

test("malformed Enrollment source is rejected", () => {
  assert.throws(
    () =>
      mapEnrollmentDocument(
        "student_mechanics",
        persistedEnrollment({ source: "forged" }),
      ),
    /source/,
  );
});

test("active Enrollment with null expiry grants access", () => {
  assert.equal(enrollmentGrantsAccess(enrollment(), NOW), true);
});

test("active Enrollment with future expiry grants access", () => {
  assert.equal(
    enrollmentGrantsAccess(
      enrollment({ expiresAt: "2031-01-01T00:00:00.000Z" }),
      NOW,
    ),
    true,
  );
});

test("active Enrollment with past expiry denies access", () => {
  assert.equal(
    enrollmentGrantsAccess(
      enrollment({ expiresAt: "2029-01-01T00:00:00.000Z" }),
      NOW,
    ),
    false,
  );
});

test("expiry equal to evaluation time denies access", () => {
  assert.equal(
    enrollmentGrantsAccess(
      enrollment({ expiresAt: NOW.toISOString() }),
      NOW,
    ),
    false,
  );
});

test("revoked Enrollment denies access", () => {
  assert.equal(
    enrollmentGrantsAccess(enrollment({ status: "revoked" }), NOW),
    false,
  );
});

test("wrong course does not grant course entitlement", () => {
  assert.equal(hasCourseEntitlement([enrollment()], "thermodynamics", NOW), false);
});

test("missing Enrollment denies course entitlement", () => {
  assert.equal(hasCourseEntitlement([], "mechanics", NOW), false);
});

test("multiple matching Enrollments fail closed", () => {
  assert.equal(
    hasCourseEntitlement(
      [enrollment(), enrollment({ id: "duplicate" })],
      "mechanics",
      NOW,
    ),
    false,
  );
});

test("Dashboard marks a matching active Enrollment without expiry as active", () => {
  const [row] = buildDashboardEnrollmentRows([enrollment()], [course()], NOW);
  assert.equal(row.state, "active");
  assert.equal(row.course?.id, "mechanics");
});

test("Dashboard marks a future-expiring Enrollment as active", () => {
  const [row] = buildDashboardEnrollmentRows(
    [enrollment({ expiresAt: "2031-01-01T00:00:00.000Z" })],
    [course()],
    NOW,
  );
  assert.equal(row.state, "active");
});

test("Dashboard marks a past-expiring Enrollment as expired", () => {
  const [row] = buildDashboardEnrollmentRows(
    [enrollment({ expiresAt: "2029-01-01T00:00:00.000Z" })],
    [course()],
    NOW,
  );
  assert.equal(row.state, "expired");
});

test("Dashboard marks expiry equal to now as expired", () => {
  const [row] = buildDashboardEnrollmentRows(
    [enrollment({ expiresAt: NOW.toISOString() })],
    [course()],
    NOW,
  );
  assert.equal(row.state, "expired");
});

test("Dashboard preserves revoked Enrollment history without access", () => {
  const [row] = buildDashboardEnrollmentRows(
    [enrollment({ status: "revoked" })],
    [course()],
    NOW,
  );
  assert.equal(row.state, "revoked");
});

test("Dashboard marks missing published Course metadata as unavailable", () => {
  const [row] = buildDashboardEnrollmentRows([enrollment()], [], NOW);
  assert.equal(row.state, "course-unavailable");
  assert.equal(row.course, null);
});

test("Dashboard does not join unrelated Course metadata", () => {
  const [row] = buildDashboardEnrollmentRows(
    [enrollment()],
    [course({ id: "thermodynamics", slug: "thermodynamics" })],
    NOW,
  );
  assert.equal(row.state, "course-unavailable");
  assert.equal(row.course, null);
});

test("Dashboard produces an empty result for zero Enrollments", () => {
  assert.deepEqual(buildDashboardEnrollmentRows([], [course()], NOW), []);
});

test("Dashboard fails closed when duplicate Enrollments target one Course", () => {
  const rows = buildDashboardEnrollmentRows(
    [enrollment(), enrollment({ id: "duplicate" })],
    [course()],
    NOW,
  );
  assert.deepEqual(
    rows.map((row) => row.state),
    ["entitlement-unavailable", "entitlement-unavailable"],
  );
});

test("Dashboard does not use draft Course metadata", () => {
  const [row] = buildDashboardEnrollmentRows(
    [enrollment()],
    [course({ status: "draft" })],
    NOW,
  );
  assert.equal(row.state, "course-unavailable");
  assert.equal(row.course, null);
});

test("valid Session discovery manifest maps without normalization", () => {
  assert.deepEqual(
    mapSessionDiscoveryManifest({ sessionIds: ["released", "unscheduled"] }),
    { sessionIds: ["released", "unscheduled"] },
  );
});

test("malformed Session discovery manifest shapes are rejected", () => {
  for (const value of [
    null,
    {},
    { sessionIds: "not-a-list" },
    { sessionIds: [], forged: true },
    { sessionIds: ["valid", 1] },
  ]) {
    assert.throws(() => mapSessionDiscoveryManifest(value), /Malformed/);
  }
});

test("unsafe or duplicate discovered Session IDs are rejected", () => {
  for (const sessionIds of [
    ["duplicate", "duplicate"],
    ["nested/path"],
    [" whitespace"],
    ["whitespace "],
    ["   "],
  ]) {
    assert.throws(
      () => mapSessionDiscoveryManifest({ sessionIds }),
      /Malformed/,
    );
  }
});

test("Course curriculum preserves ordered Modules and manifest Session order", () => {
  const modules = [
    moduleRecord(),
    moduleRecord({
      id: "mechanics-forces",
      title: "Forces",
      order: 2,
    }),
  ];
  const curriculum = buildCourseCurriculum(modules, [
    [
      sessionRecord({ id: "second-in-manifest", order: 2 }),
      sessionRecord({ id: "first-by-field", order: 1 }),
    ],
    [
      sessionRecord({
        id: "mechanics-newton-laws",
        moduleId: "mechanics-forces",
        title: "Newton's Laws",
      }),
    ],
  ]);

  assert.deepEqual(
    curriculum.map(({ module }) => module.id),
    ["mechanics-motion-basics", "mechanics-forces"],
  );
  assert.deepEqual(
    curriculum[0].sessions.map((session) => session.id),
    ["second-in-manifest", "first-by-field"],
  );
});

test("Module with an empty discovery manifest has no Sessions", () => {
  const curriculum = buildCourseCurriculum([moduleRecord()], [[]]);
  assert.deepEqual(curriculum[0].sessions, []);
});

test("missing or inconsistent curriculum data fails closed", () => {
  assert.throws(
    () => buildCourseCurriculum([moduleRecord()], []),
    /incomplete/,
  );
  assert.throws(
    () =>
      buildCourseCurriculum(
        [moduleRecord()],
        [[sessionRecord({ moduleId: "another-module" })]],
      ),
    /inconsistent/,
  );
});

test("unavailable entitlement does not authorize protected curriculum", () => {
  assert.equal(
    hasCourseEntitlement(
      [enrollment({ status: "revoked" })],
      "mechanics",
      NOW,
    ),
    false,
  );
});

test("Session detail composes verified Course, Module, and Session metadata", () => {
  const expectedCourse = course();
  const expectedModule = moduleRecord();
  const expectedSession = sessionRecord();

  assert.deepEqual(
    composeSessionDetail(
      expectedCourse,
      expectedModule,
      [expectedSession.id],
      expectedSession.id,
      expectedSession,
    ),
    {
      course: expectedCourse,
      module: expectedModule,
      session: expectedSession,
    },
  );
});

test("valid textual lesson content maps without normalization", () => {
  const lessonText = "Start with a reference point.\nThen observe motion.";
  const mapped = mapSessionDocument(
    "mechanics-intro-motion",
    "mechanics",
    "mechanics-motion-basics",
    persistedSession({ lessonText }),
  );

  assert.equal(mapped.lessonText, lessonText);
});

test("Session lesson content is optional", () => {
  const mapped = mapSessionDocument(
    "mechanics-intro-motion",
    "mechanics",
    "mechanics-motion-basics",
    persistedSession(),
  );

  assert.equal("lessonText" in mapped, false);
});

test("malformed or non-string lesson content fails closed", () => {
  for (const lessonText of [null, 1, { text: "forged" }, ["forged"]]) {
    assert.throws(
      () =>
        mapSessionDocument(
          "mechanics-intro-motion",
          "mechanics",
          "mechanics-motion-basics",
          persistedSession({ lessonText }),
        ),
      /Malformed Session/,
    );
  }
});

test("empty, whitespace-padded, and oversized lesson text fails closed", () => {
  for (const lessonText of [
    "",
    "   ",
    " leading",
    "trailing ",
    "x".repeat(MAX_LESSON_TEXT_LENGTH + 1),
  ]) {
    assert.throws(
      () =>
        mapSessionDocument(
          "mechanics-intro-motion",
          "mechanics",
          "mechanics-motion-basics",
          persistedSession({ lessonText }),
        ),
      /Malformed Session/,
    );
  }
});

test("Session detail composition preserves valid lesson content", () => {
  const session = sessionRecord({
    lessonText: "Velocity includes both speed and direction.",
  });

  const detail = composeSessionDetail(
    course(),
    moduleRecord(),
    [session.id],
    session.id,
    session,
  );

  assert.equal(
    detail.session.lessonText,
    "Velocity includes both speed and direction.",
  );
});

test("malformed lesson content cannot produce partial Session detail", () => {
  const session = sessionRecord({ lessonText: "   " });

  assert.throws(
    () =>
      composeSessionDetail(
        course(),
        moduleRecord(),
        [session.id],
        session.id,
        session,
      ),
    (error) =>
      error instanceof SessionDetailUnavailableError &&
      error.reason === "session-unavailable",
  );
});

test("Session detail rejects a Session absent from discovery", () => {
  assert.throws(
    () =>
      composeSessionDetail(
        course(),
        moduleRecord(),
        [],
        "mechanics-intro-motion",
        sessionRecord(),
      ),
    (error) =>
      error instanceof SessionDetailUnavailableError &&
      error.reason === "session-not-discovered",
  );
});

test("Session detail rejects cross-Course and cross-Module composition", () => {
  assert.throws(
    () =>
      composeSessionDetail(
        course(),
        moduleRecord({ courseId: "thermodynamics" }),
        ["mechanics-intro-motion"],
        "mechanics-intro-motion",
        sessionRecord(),
      ),
    (error) =>
      error instanceof SessionDetailUnavailableError &&
      error.reason === "module-unavailable",
  );
  for (const mismatchedSession of [
    sessionRecord({ courseId: "thermodynamics" }),
    sessionRecord({ moduleId: "mechanics-forces" }),
  ]) {
    assert.throws(
      () =>
        composeSessionDetail(
          course(),
          moduleRecord(),
          ["mechanics-intro-motion"],
          "mechanics-intro-motion",
          mismatchedSession,
        ),
      (error) =>
        error instanceof SessionDetailUnavailableError &&
        error.reason === "session-unavailable",
    );
  }
});

test("Session detail rejects missing or malformed Session metadata", () => {
  for (const unavailableSession of [
    null,
    sessionRecord({ title: "   " }),
    sessionRecord({ order: -1 }),
  ]) {
    assert.throws(
      () =>
        composeSessionDetail(
          course(),
          moduleRecord(),
          ["mechanics-intro-motion"],
          "mechanics-intro-motion",
          unavailableSession,
        ),
      (error) =>
        error instanceof SessionDetailUnavailableError &&
        error.reason === "session-unavailable",
    );
  }
});

test("unavailable entitlement does not authorize Session detail", () => {
  assert.equal(
    hasCourseEntitlement(
      [enrollment({ expiresAt: NOW.toISOString() })],
      "mechanics",
      NOW,
    ),
    false,
  );
});

test("Session detail route parameters and navigation path are validated", () => {
  assert.deepEqual(
    parseSessionDetailRouteParams({
      slug: "mechanics",
      moduleId: "mechanics-motion-basics",
      sessionId: "mechanics-intro-motion",
    }),
    {
      slug: "mechanics",
      moduleId: "mechanics-motion-basics",
      sessionId: "mechanics-intro-motion",
    },
  );
  assert.equal(
    buildSessionDetailPath(
      "mechanics",
      "mechanics-motion-basics",
      "mechanics-intro-motion",
    ),
    "/courses/mechanics/modules/mechanics-motion-basics/sessions/mechanics-intro-motion",
  );
  assert.equal(
    buildSessionDetailPath("mechanics", "mechanics-motion-basics", "bad/id"),
    null,
  );
});

test("valid Session videoAssetId maps without normalization", () => {
  const mapped = mapSessionDocument(
    "mechanics-intro-motion",
    "mechanics",
    "mechanics-motion-basics",
    persistedSession({ videoAssetId: "mechanics-intro-motion-video" }),
  );

  assert.equal(mapped.videoAssetId, "mechanics-intro-motion-video");
});

test("Session videoAssetId remains optional", () => {
  const mapped = mapSessionDocument(
    "mechanics-intro-motion",
    "mechanics",
    "mechanics-motion-basics",
    persistedSession(),
  );

  assert.equal("videoAssetId" in mapped, false);
});

test("malformed Session videoAssetId fails closed", () => {
  for (const videoAssetId of [
    "",
    "   ",
    " leading",
    "trailing ",
    "nested/path",
    "../traversal",
    "Uppercase",
    "under_score",
    "repeated--hyphen",
    "-leading-hyphen",
    "trailing-hyphen-",
    "x".repeat(129),
  ]) {
    assert.throws(
      () =>
        mapSessionDocument(
          "mechanics-intro-motion",
          "mechanics",
          "mechanics-motion-basics",
          persistedSession({ videoAssetId }),
        ),
      /Malformed Session/,
    );
  }
});

test("valid bound video access maps without exposing extra fields", () => {
  const contentKey = "A".repeat(43);
  assert.deepEqual(
    mapVideoAccessDocument(
      VIDEO_ACCESS_DOCUMENT_ID,
      "mechanics-intro-motion-video",
      {
        videoAssetId: "mechanics-intro-motion-video",
        contentKey,
      },
    ),
    {
      videoAssetId: "mechanics-intro-motion-video",
      contentKey,
    },
  );
});

test("malformed and noncanonical video content keys fail closed", () => {
  for (const contentKey of [
    "",
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}+`,
    `${"A".repeat(42)}/`,
    `${"A".repeat(42)}=`,
    `${"A".repeat(42)}B`,
  ]) {
    assert.throws(
      () =>
        mapVideoAccessDocument(
          VIDEO_ACCESS_DOCUMENT_ID,
          "mechanics-intro-motion-video",
          {
            videoAssetId: "mechanics-intro-motion-video",
            contentKey,
          },
        ),
      /Video access is unavailable/,
    );
  }
});

test("video access asset mismatch and unknown fields fail closed", () => {
  const contentKey = "A".repeat(43);
  for (const value of [
    {
      videoAssetId: "another-video",
      contentKey,
    },
    {
      videoAssetId: "mechanics-intro-motion-video",
      contentKey,
      forged: true,
    },
  ]) {
    assert.throws(
      () =>
        mapVideoAccessDocument(
          VIDEO_ACCESS_DOCUMENT_ID,
          "mechanics-intro-motion-video",
          value,
        ),
      /Video access is unavailable/,
    );
  }
});

test("missing or non-primary video access document fails closed", () => {
  assert.throws(
    () =>
      mapVideoAccessDocument(
        VIDEO_ACCESS_DOCUMENT_ID,
        "mechanics-intro-motion-video",
        undefined,
      ),
    /Video access is unavailable/,
  );
  assert.throws(
    () =>
      mapVideoAccessDocument("alternate", "mechanics-intro-motion-video", {
        videoAssetId: "mechanics-intro-motion-video",
        contentKey: "A".repeat(43),
      }),
    /Video access is unavailable/,
  );
});

test("video access repository uses one exact document read and no query", async () => {
  const source = await readFile(
    new URL("../src/features/courses/videoAccessRepository.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /\bgetDoc\s*\(/);
  assert.doesNotMatch(source, /\b(?:collection|getDocs|query)\s*\(/);
});
