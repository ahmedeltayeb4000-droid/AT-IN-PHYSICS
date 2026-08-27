import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";
import {
  AccessCodeFormatError,
  canonicalizeAccessCode,
  deriveAccessCodeId,
} from "../src/features/accessCodes/accessCodeFormat.ts";

const EXAMPLE = ["ABCDE", "FGHJK", "LMNPQ", "RSTUV", "WXYZ23"].join("-");

test("student canonicalization exactly matches the owner code contract", async () => {
  assert.equal(canonicalizeAccessCode(`  ${EXAMPLE.toLowerCase()}  `), EXAMPLE);
  assert.equal(
    await deriveAccessCodeId(EXAMPLE),
    createHash("sha256").update(EXAMPLE, "utf8").digest("hex"),
  );
  for (const value of ["", "short", `${EXAMPLE.slice(0, -1)}O`, { code: EXAMPLE }]) {
    assert.throws(() => canonicalizeAccessCode(value), AccessCodeFormatError);
  }
});

test("redemption service accepts code only and derives all authority locally", async () => {
  const source = await readFile(
    new URL("../src/features/accessCodes/accessCodeRedemption.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /redeemAccessCode\(\s*code: unknown/);
  assert.match(source, /firebaseAuth\.currentUser/);
  assert.match(source, /doc\(firebaseDb,\s*"accessCodes",\s*accessCodeId\)/s);
  assert.match(source, /getEnrollmentId\(user\.uid, courseId\)/);
  assert.match(source, /transaction\.get\(codeReference\)/);
  assert.match(source, /transaction\.get\(enrollmentReference\)/);
  assert.match(source, /transaction\.update\(codeReference/);
  assert.match(source, /transaction\.set\(enrollmentReference/);
  assert.equal((source.match(/serverTimestamp\(\)/g) ?? []).length, 2);
  assert.match(source, /sourceId: accessCodeId/);
  assert.doesNotMatch(source, /console\.|logger\.|analytics|fetch\(/);
});

test("redemption failures and safe retry expose only minimal states", async () => {
  const source = await readFile(
    new URL("../src/features/accessCodes/accessCodeRedemption.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(!user\)/);
  assert.match(source, /already-redeemed-by-you/);
  assert.match(source, /Access Code is invalid or unavailable\./);
  assert.doesNotMatch(source, /return \{[^}]*accessCodeId/s);
});
