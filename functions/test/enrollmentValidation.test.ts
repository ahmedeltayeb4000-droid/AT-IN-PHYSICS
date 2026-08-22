import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualEnrollmentPayload,
  decideManualGrant,
  getEnrollmentDocumentId,
  hasDecodedOwnerClaim,
  isCourseEligibleForEnrollment,
  parseManualGrantInput,
  requireFutureExpiry,
} from "../src/enrollments/validation.js";

const validInput = {
  targetUserId: "student-uid",
  courseId: "quantum-physics",
  expiresAt: "2030-01-02T03:04:05.000Z",
};

test("valid manual grant input is parsed without normalization", () => {
  assert.deepEqual(parseManualGrantInput(validInput), validInput);
});

test("missing and blank targetUserId values are rejected", () => {
  assert.throws(
    () => parseManualGrantInput({ ...validInput, targetUserId: undefined }),
    /targetUserId/,
  );
  assert.throws(
    () => parseManualGrantInput({ ...validInput, targetUserId: "   " }),
    /targetUserId/,
  );
});

test("unsafe UID edge cases are rejected", () => {
  for (const targetUserId of ["student uid", "student/uid", "a".repeat(129)]) {
    assert.throws(
      () => parseManualGrantInput({ ...validInput, targetUserId }),
      /targetUserId/,
    );
  }
});

test("invalid course ID edge cases are rejected", () => {
  for (const courseId of [
    "quantum_physics",
    "Quantum-Physics",
    "-mechanics",
    "mechanics-",
    "quantum--physics",
    "a".repeat(129),
    "courses/mechanics",
  ]) {
    assert.throws(
      () => parseManualGrantInput({ ...validInput, courseId }),
      /courseId/,
    );
  }
});

test("invalid or ambiguous expiry values are rejected", () => {
  assert.throws(
    () => parseManualGrantInput({ ...validInput, expiresAt: "2030-01-02" }),
    /expiresAt/,
  );
  assert.throws(
    () =>
      parseManualGrantInput({
        ...validInput,
        expiresAt: "2030-02-30T03:04:05.000Z",
      }),
    /expiresAt/,
  );
});

test("null expiry is accepted", () => {
  assert.equal(
    parseManualGrantInput({ ...validInput, expiresAt: null }).expiresAt,
    null,
  );
});

test("unknown input fields are rejected", () => {
  assert.throws(
    () => parseManualGrantInput({ ...validInput, status: "active" }),
    /Unknown manual grant field/,
  );
});

test("enrollment document ID is deterministic", () => {
  assert.equal(
    getEnrollmentDocumentId("student-uid", "quantum-physics"),
    "student-uid_quantum-physics",
  );
});

test("manual payload uses trusted values and fixed authority fields", () => {
  const input = parseManualGrantInput(validInput);
  const payload = buildManualEnrollmentPayload({
    input,
    trustedActorUserId: "owner-uid",
    trustedGrantedAt: "trusted-granted-at",
    trustedExpiresAt: "trusted-expiry",
  });

  assert.deepEqual(payload, {
    userId: "student-uid",
    courseId: "quantum-physics",
    status: "active",
    grantedAt: "trusted-granted-at",
    expiresAt: "trusted-expiry",
    source: "manual",
    grantedBy: "owner-uid",
  });
  assert.equal("sourceId" in payload, false);
});

test("raw forged authority fields are rejected before payload building", () => {
  const rawInput = {
    ...validInput,
    status: "revoked",
    source: "payment",
    sourceId: "forged",
    grantedBy: "attacker",
    grantedAt: "forged-time",
  };

  assert.throws(() => parseManualGrantInput(rawInput), /Unknown/);
});

test("future expiry uses an explicitly trusted clock", () => {
  const trustedNow = new Date("2029-01-01T00:00:00.000Z");
  assert.equal(parseManualGrantInput(validInput).expiresAt, validInput.expiresAt);
  assert.doesNotThrow(() => requireFutureExpiry(validInput.expiresAt, trustedNow));
  assert.throws(
    () => requireFutureExpiry("2028-01-01T00:00:00.000Z", trustedNow),
    /future/,
  );
  assert.throws(
    () => requireFutureExpiry("2029-01-01T00:00:00.000Z", trustedNow),
    /future/,
  );
  assert.throws(
    () => requireFutureExpiry(validInput.expiresAt, new Date("invalid")),
    /Trusted current time is invalid/,
  );
  assert.doesNotThrow(() => requireFutureExpiry(null, trustedNow));
});

test("missing enrollment produces a create decision", () => {
  assert.deepEqual(decideManualGrant(null), { action: "create" });
});

test("active enrollment produces an idempotent no-op decision", () => {
  assert.deepEqual(decideManualGrant({ status: "active" }), { action: "no-op" });
});

test("revoked enrollment requires explicit reactivation", () => {
  assert.deepEqual(decideManualGrant({ status: "revoked" }), {
    action: "reject",
    reason: "reactivation-required",
  });
});

test("only published courses are eligible", () => {
  assert.equal(isCourseEligibleForEnrollment("published"), true);
  assert.equal(isCourseEligibleForEnrollment("draft"), false);
  assert.equal(isCourseEligibleForEnrollment(undefined), false);
});

test("decoded owner claim requires the boolean true value", () => {
  assert.equal(hasDecodedOwnerClaim({ owner: true }), true);
  assert.equal(hasDecodedOwnerClaim({ owner: false }), false);
  assert.equal(hasDecodedOwnerClaim({ owner: "true" }), false);
  assert.equal(hasDecodedOwnerClaim({}), false);
});
