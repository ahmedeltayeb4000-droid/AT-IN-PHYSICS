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

test("authenticated Dashboard exposes the discoverable activation form", async () => {
  const [router, dashboard, activation] = await Promise.all([
    readFile(new URL("../src/app/router/AppRouter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/dashboard/DashboardPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/accessCodes/AccessCodeActivationCard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(router, /path="dashboard"[\s\S]*?<AuthGuard>[\s\S]*?<DashboardPage/);
  assert.match(dashboard, /<AccessCodeActivationCard\s*\/>/);
  assert.match(activation, />Activate Course</);
  assert.match(activation, /label="Access Code"/);
  assert.match(activation, /<form[\s\S]*?onSubmit=\{handleSubmit\}/);
  assert.match(activation, /type="submit"/);
});

test("activation submits only plaintext input through the established service", async () => {
  const source = await readFile(
    new URL("../src/features/accessCodes/AccessCodeActivationCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /redeemAccessCode\(code\)/);
  assert.doesNotMatch(source, /canonicalizeAccessCode|deriveAccessCodeId|userId\s*:|courseId\s*:|sourceId\s*:|grantedBy\s*:/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|analytics|URLSearchParams|navigate\(|fetch\(/);
});

test("pending state blocks duplicate submissions and keyboard form submission remains native", async () => {
  const source = await readFile(
    new URL("../src/features/accessCodes/AccessCodeActivationCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /if \(isSubmitting\) return/);
  assert.match(source, /setIsSubmitting\(true\)/);
  assert.match(source, /disabled=\{isSubmitting \|\| !code\.trim\(\)\}/);
  assert.match(source, /isLoading=\{isSubmitting\}/);
  assert.doesNotMatch(source, /onClick=\{handleSubmit\}/);
});

test("success clears plaintext and refreshes authoritative Enrollment and Course queries", async () => {
  const source = await readFile(
    new URL("../src/features/accessCodes/AccessCodeActivationCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /setCode\(""\)[\s\S]*?invalidateQueries/);
  assert.match(source, /queryKey: \["enrollments", "user"\]/);
  assert.match(source, /queryKey: \["courses", "published"\]/);
  assert.match(source, /await Promise\.all/);
  assert.doesNotMatch(source, /isEnrolled|setEnrollment|grantAccess|window\.location/);
});

test("activation presents safe success, retry, and sanitized failure states", async () => {
  const source = await readFile(
    new URL("../src/features/accessCodes/AccessCodeActivationCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /already-redeemed-by-you/);
  assert.match(source, /Course activated successfully\./);
  assert.match(source, /already activated on your account\./);
  assert.match(source, /We could not activate a course with that Access Code/);
  assert.match(source, /catch \{/);
  assert.doesNotMatch(source, /error\.message|String\(error\)|FirebaseError|accessCodeId|firestore|enrollments\//i);
});

test("activation status, focus, and form controls are accessible", async () => {
  const source = await readFile(
    new URL("../src/features/accessCodes/AccessCodeActivationCard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /role=\{state\.kind === "error" \? "alert" : "status"\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-describedby=\{statusId\}/);
  assert.match(source, /inputReference\.current\?\.focus\(\)/);
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /spellCheck=\{false\}/);
});
