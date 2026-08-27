import assert from "node:assert/strict";
import test from "node:test";
import { deriveAccessCodeDocumentId, generateAccessCode, normalizeAccessCode } from "../src/accessCodes/accessCodes.js";

test("generated Access Codes use the canonical high-entropy format", () => {
  const code = generateAccessCode(() => Buffer.from(Array.from({ length: 17 }, (_, index) => index + 1)));
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(code.replaceAll("-", "").length, 26);
});

test("normalization is explicit and lookup is deterministic without plaintext", () => {
  const code = "ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ23";
  assert.equal(normalizeAccessCode(`  ${code.toLowerCase()}  `), code);
  assert.match(deriveAccessCodeDocumentId(code), /^[a-f0-9]{64}$/);
  assert.equal(deriveAccessCodeDocumentId(code), deriveAccessCodeDocumentId(code.toLowerCase()));
  assert.equal(deriveAccessCodeDocumentId(code).includes(code), false);
});

test("malformed code shapes fail before lookup", () => {
  for (const value of ["", "short", "ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ2O", { code: "x" }]) assert.throws(() => normalizeAccessCode(value));
});
