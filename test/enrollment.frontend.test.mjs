import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase/firestore";
import { mapEnrollmentDocument } from "../src/features/enrollments/enrollmentMapper.ts";
import {
  enrollmentGrantsAccess,
  hasCourseEntitlement,
} from "../src/features/enrollments/entitlement.ts";
import { buildDashboardEnrollmentRows } from "../src/features/enrollments/dashboardEnrollmentViewModel.ts";

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
