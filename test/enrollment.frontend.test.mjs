import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase/firestore";
import { mapEnrollmentDocument } from "../src/features/enrollments/enrollmentMapper.ts";
import {
  enrollmentGrantsAccess,
  hasCourseEntitlement,
} from "../src/features/enrollments/entitlement.ts";

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
