import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalizeAccessCode } from "../src/features/accessCodes/accessCodeFormat.ts";
import { generateStaffAccessCode } from "../src/features/staff/staffAccessCodeFormat.ts";
const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
test("Staff generator uses Web Crypto and the canonical redeemable format", () => {
  const code = generateStaffAccessCode();
  assert.equal(canonicalizeAccessCode(code), code);
});
test("Staff surface is narrow, guarded, volatile, and contains no persistence or Owner controls", async () => {
  const [page, creation, router, guards] = await Promise.all([
    source("../src/pages/staff/StaffAccessCodePage.tsx"),
    source("../src/features/staff/staffAccessCodeCreation.ts"),
    source("../src/app/router/AppRouter.tsx"),
    source("../src/features/auth/AuthGuards.tsx"),
  ]);
  assert.match(router, /path="staff\/access-codes"/);
  assert.match(router, /StaffAccessCodeGuard/);
  assert.match(guards, /staffAccessCodesCreate/);
  const format = await source("../src/features/staff/staffAccessCodeFormat.ts");
  assert.match(format, /crypto\.getRandomValues/);
  assert.match(creation, /deriveAccessCodeId/);
  assert.match(creation, /version: 2/);
  assert.match(creation, /createdByUid: user\.uid/);
  assert.doesNotMatch(
    `${page}\n${creation}`,
    /localStorage|sessionStorage|console\.|\/admin|Owner Control|Emergency|Enrollment management/i,
  );
  assert.match(page, /pending \|\| !courseId/);
  assert.match(page, /setCode\(null\)/);
});
