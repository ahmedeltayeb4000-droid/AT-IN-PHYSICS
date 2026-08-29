import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptProtectedResource,
  encryptProtectedResource,
  parseProtectedResourceArtifact,
} from "../src/protectedResources/crypto.js";
import {
  buildProtectedResourceRoute,
  PROTECTED_RESOURCE_FORMAT,
  PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE,
  PROTECTED_RESOURCE_OVERHEAD,
  protectedResourceCiphertextSize,
  validateProtectedResourceAccess,
  validateProtectedResourceFileName,
  validateProtectedResourceMetadata,
  validateProtectedResourceMimeType,
  validateProtectedResourcePair,
  validateProtectedResourcePlaintext,
  validateProtectedResourceId,
  validateProtectedResourceScope,
  validateProtectedResourceTitle,
  type ProtectedResourceAccess,
} from "../src/protectedResources/format.js";

const COURSE = { type: "course", courseId: "mechanics" } as const;
const SESSION = {
  type: "session",
  courseId: "mechanics",
  moduleId: "motion-basics",
  sessionId: "displacement",
} as const;
const PDF = Buffer.from("%PDF-1.7\nfixture");
const HASH = "a".repeat(64);
const KEY = Buffer.alloc(32, 7).toString("base64url");
const TIME = { seconds: 1_800_000_000, nanoseconds: 0 };
const COMPATIBILITY_ARTIFACT_HEX =
  "415452312122232425262728292a2b2cb4cd7a1a79e90071e7a3e8c9bcd7bf6b607ff6b1128dffd3419f03303778e454df24bc4b72d65e121e13ff0507d4f72117";

function metadata(scope: unknown = COURSE) {
  return {
    version: 1,
    resourceId: "formula-sheet",
    title: "Formula Sheet",
    originalFileName: "Formula Sheet.pdf",
    mimeType: "application/pdf",
    plaintextSize: PDF.length,
    formatVersion: "ATR1",
    ciphertextRoute: buildProtectedResourceRoute(scope, "formula-sheet"),
    ciphertextSha256: HASH,
    ciphertextSize: PDF.length + PROTECTED_RESOURCE_OVERHEAD,
    createdAt: TIME,
    boundAt: TIME,
  };
}

function access(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    resourceId: "formula-sheet",
    formatVersion: "ATR1",
    ciphertextSha256: HASH,
    contentKey: KEY,
    ...overrides,
  };
}

test("ATR1 round trip has exact authenticated layout and size", () => {
  const packaged = encryptProtectedResource(PDF);
  assert.equal(packaged.artifact.subarray(0, 4).toString("ascii"), PROTECTED_RESOURCE_FORMAT);
  assert.equal(packaged.artifact.length, PDF.length + PROTECTED_RESOURCE_OVERHEAD);
  assert.equal(protectedResourceCiphertextSize(PDF.length), PDF.length + 32);
  assert.deepEqual(decryptProtectedResource(packaged.artifact, packaged.contentKey), PDF);
  assert.equal(parseProtectedResourceArtifact(packaged.artifact).iv.length, 12);
});

test("ATR1 encryption uses fresh keys and IVs", () => {
  const first = encryptProtectedResource(PDF);
  const second = encryptProtectedResource(PDF);
  assert.notEqual(first.contentKey, second.contentKey);
  assert.notDeepEqual(first.iv, second.iv);
  assert.notDeepEqual(first.artifact, second.artifact);
});

test("Node ATR1 encryption matches the browser compatibility vector", () => {
  const plaintext = Buffer.from("%PDF-1.7\ncross-compatible fixture");
  const packaged = encryptProtectedResource(plaintext, (length) =>
    Buffer.from(
      Array.from(
        { length },
        (_, index) => index + (length === 32 ? 1 : 33),
      ),
    ),
  );
  assert.equal(packaged.artifact.toString("hex"), COMPATIBILITY_ARTIFACT_HEX);
});

test("ATR1 fails closed for wrong key, magic, ciphertext, tag, truncation, and malformed key", () => {
  const packaged = encryptProtectedResource(PDF);
  const another = encryptProtectedResource(PDF);
  assert.throws(() => decryptProtectedResource(packaged.artifact, another.contentKey));
  for (const offset of [0, 16, packaged.artifact.length - 1]) {
    const changed = Buffer.from(packaged.artifact);
    changed[offset] ^= 1;
    assert.throws(() => decryptProtectedResource(changed, packaged.contentKey));
  }
  assert.throws(() => decryptProtectedResource(packaged.artifact.subarray(0, 31), packaged.contentKey));
  assert.throws(() => decryptProtectedResource(packaged.artifact, "A".repeat(42)));
});

test("PDF policy validates signature, MIME, size, extension, and safe filename", () => {
  validateProtectedResourcePlaintext(PDF);
  assert.equal(validateProtectedResourceMimeType("application/pdf"), "application/pdf");
  assert.equal(validateProtectedResourceFileName("Formula Sheet.pdf"), "Formula Sheet.pdf");
  assert.equal(validateProtectedResourceFileName(`${"a".repeat(116)}.pdf`).length, 120);
  for (const name of ["FILE.PDF", "../file.pdf", "folder/file.pdf", "file..pdf", "CON.pdf", "CON .pdf", "file .pdf", " file.pdf", "file.pdf ", "file.html"]) {
    assert.throws(() => validateProtectedResourceFileName(name));
  }
  assert.throws(() => validateProtectedResourceMimeType("text/html"));
  assert.throws(() => validateProtectedResourcePlaintext(Buffer.alloc(0)));
  assert.throws(() => validateProtectedResourcePlaintext(Buffer.from("not pdf")));
  assert.throws(() => validateProtectedResourcePlaintext(Buffer.alloc(PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE + 1)));
  assert.throws(() => validateProtectedResourceFileName(`${"a".repeat(117)}.pdf`));
  const maximumPdf = Buffer.alloc(PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE);
  PDF.copy(maximumPdf, 0, 0, 5);
  validateProtectedResourcePlaintext(maximumPdf);
});

test("resource IDs, titles, scopes, and routes are canonical and scope-safe", () => {
  assert.equal(buildProtectedResourceRoute(COURSE, "formula-sheet"), "/protected-resources/courses/mechanics/resources/formula-sheet.atr1");
  assert.equal(buildProtectedResourceRoute(SESSION, "formula-sheet"), "/protected-resources/courses/mechanics/modules/motion-basics/sessions/displacement/resources/formula-sheet.atr1");
  assert.equal(buildProtectedResourceRoute(COURSE, "formula-sheet"), buildProtectedResourceRoute(COURSE, "formula-sheet"));
  assert.equal(validateProtectedResourceTitle("A".repeat(160)).length, 160);
  assert.equal(validateProtectedResourceId("a".repeat(128)).length, 128);
  for (const invalid of ["", "-leading", "trailing-", "repeated--hyphen", "../escape", "a/b", "Uppercase", "a".repeat(129)]) assert.throws(() => validateProtectedResourceId(invalid));
  assert.throws(() => validateProtectedResourceTitle(""));
  assert.throws(() => validateProtectedResourceTitle("control\u0000title"));
  assert.throws(() => validateProtectedResourceTitle(" A"));
  assert.throws(() => validateProtectedResourceTitle("A".repeat(161)));
  assert.throws(() => validateProtectedResourceScope({ ...COURSE, moduleId: "injected" }));
  assert.throws(() => validateProtectedResourceScope({ type: "session", courseId: "mechanics", resourceId: "wrong" }));
});

test("metadata and access contracts are exact, paired, and derived from trusted scope", () => {
  const validMetadata = validateProtectedResourceMetadata(metadata(), COURSE);
  const validAccess = validateProtectedResourceAccess(access());
  validateProtectedResourcePair(validMetadata, validAccess);
  assert.throws(() => validateProtectedResourceMetadata({ ...metadata(), extra: true }, COURSE));
  assert.throws(() => validateProtectedResourceMetadata({ ...metadata(), ciphertextSha256: "A".repeat(64) }, COURSE));
  assert.throws(() => validateProtectedResourceMetadata({ ...metadata(), ciphertextSize: PDF.length + 31 }, COURSE));
  assert.throws(() => validateProtectedResourceMetadata({ ...metadata(), version: 2 }, COURSE));
  assert.throws(() => validateProtectedResourceMetadata({ ...metadata(), formatVersion: "ATV1" }, COURSE));
  assert.throws(() => validateProtectedResourceMetadata(metadata(SESSION), COURSE));
  assert.throws(() => validateProtectedResourceMetadata(metadata(COURSE), SESSION));
  assert.throws(() => validateProtectedResourceAccess(access({ version: 2 })));
  assert.throws(() => validateProtectedResourceAccess(access({ formatVersion: "ATV1" })));
  assert.throws(() => validateProtectedResourceAccess({ ...access(), extra: true }));
  assert.throws(() => validateProtectedResourceAccess(access({ contentKey: "bad" })));
  assert.throws(() => validateProtectedResourcePair(validMetadata, validateProtectedResourceAccess(access({ resourceId: "other" }))));
  assert.throws(() => validateProtectedResourcePair(validMetadata, validateProtectedResourceAccess(access({ ciphertextSha256: "b".repeat(64) }))));
  assert.throws(() =>
    validateProtectedResourcePair(validMetadata, {
      ...validAccess,
      formatVersion: "ATV1",
    } as unknown as ProtectedResourceAccess),
  );
});

test("timestamp contracts are exact and bounded", () => {
  assert.deepEqual(validateProtectedResourceMetadata(metadata(), COURSE).createdAt, TIME);
  for (const timestamp of [
    { seconds: -1, nanoseconds: 0 },
    { seconds: 1.5, nanoseconds: 0 },
    { seconds: Number.MAX_SAFE_INTEGER + 1, nanoseconds: 0 },
    { seconds: 1, nanoseconds: -1 },
    { seconds: 1, nanoseconds: 1_000_000_000 },
    { seconds: 1, nanoseconds: 0, extra: true },
  ]) {
    assert.throws(() =>
      validateProtectedResourceMetadata(
        { ...metadata(), createdAt: timestamp },
        COURSE,
      ),
    );
  }
});
