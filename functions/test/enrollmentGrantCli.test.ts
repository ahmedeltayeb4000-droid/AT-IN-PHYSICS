import assert from "node:assert/strict";
import test from "node:test";
import { getEnrollmentDocumentId } from "../src/enrollments/validation.js";
import {
  parseEnrollmentGrantArgs,
  resolveEnrollmentGrantProject,
  resolveTrustedOwnerUid,
  safeEnrollmentGrantSummary,
} from "../src/tooling/enrollmentGrant.js";

const NOW = new Date("2029-01-01T00:00:00.000Z");
const VALID = ["--user-id", "student-uid", "--course-id", "mechanics"] as const;

test("valid arguments default to dry run and apply is explicit", () => {
  assert.deepEqual(parseEnrollmentGrantArgs(VALID, NOW), {
    targetUserId: "student-uid",
    courseId: "mechanics",
    expiresAt: null,
    apply: false,
  });
  assert.equal(
    parseEnrollmentGrantArgs([...VALID, "--apply"], NOW).apply,
    true,
  );
  assert.equal(
    parseEnrollmentGrantArgs(
      [...VALID, "--expires-at", "2030-01-01T00:00:00.000Z"],
      NOW,
    ).expiresAt,
    "2030-01-01T00:00:00.000Z",
  );
});

test("missing, blank, unsafe, duplicate, unknown, and positional arguments fail", () => {
  for (const args of [
    [],
    ["--user-id", "--course-id", "mechanics"],
    ["--user-id", "   ", "--course-id", "mechanics"],
    ["--user-id", "student/uid", "--course-id", "mechanics"],
    ["--user-id", "student", "--course-id", "Invalid"],
    [...VALID, "--user-id", "other"],
    [...VALID, "--course-id", "other"],
    [...VALID, "--expires-at", "2030-01-01"],
    [...VALID, "--expires-at", "2020-01-01T00:00:00.000Z"],
    [...VALID, "--apply", "true"],
    [...VALID, "--apply", "--apply"],
    [...VALID, "--status", "active"],
    [...VALID, "garbage"],
  ]) {
    assert.throws(() => parseEnrollmentGrantArgs(args, NOW));
  }
});

test("authority-field injection is impossible and ID remains deterministic", () => {
  for (const field of [
    "--status",
    "--source",
    "--granted-by",
    "--document-id",
  ]) {
    assert.throws(() =>
      parseEnrollmentGrantArgs([...VALID, field, "forged"], NOW),
    );
  }
  assert.equal(
    getEnrollmentDocumentId("student-uid", "mechanics"),
    "student-uid_mechanics",
  );
});

test("project and owner environment guards fail closed", () => {
  assert.equal(
    resolveEnrollmentGrantProject({
      GCLOUD_PROJECT: "demo-at-in-physics",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    }),
    "demo-at-in-physics",
  );
  assert.throws(() => resolveEnrollmentGrantProject({}), /required/);
  assert.throws(() =>
    resolveEnrollmentGrantProject({
      GCLOUD_PROJECT: "at-in-physics",
      GOOGLE_CLOUD_PROJECT: "other-project",
    }),
  );
  assert.throws(() =>
    resolveEnrollmentGrantProject({ GCLOUD_PROJECT: "demo-at-in-physics" }),
  );
  assert.throws(() =>
    resolveEnrollmentGrantProject({
      GCLOUD_PROJECT: "at-in-physics",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    }),
  );
  assert.equal(
    resolveTrustedOwnerUid({ AT_IN_PHYSICS_OWNER_UID: "owner-uid" }),
    "owner-uid",
  );
  assert.throws(() => resolveTrustedOwnerUid({}));
});

test("safe summary excludes email, tokens, claims, and authority internals", () => {
  const summary = safeEnrollmentGrantSummary({
    enrollmentId: "student-uid_mechanics",
    enrollmentPath: "enrollments/student-uid_mechanics",
    currentEnrollment: "MISSING",
    proposedStatus: "active",
    changeRequired: true,
    applyStatus: null,
    effectiveExpiresAt: null,
    postApplyVerified: false,
  });
  const serialized = JSON.stringify(summary);
  for (const sensitive of [
    "email",
    "token",
    "claims",
    "password",
    "grantedBy",
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});
