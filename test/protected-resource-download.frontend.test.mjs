import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TextEncoder } from "node:util";
/* global Response */
import { PROTECTED_RESOURCE_FORMAT } from "../functions/src/protectedResources/format.ts";
import { downloadSessionResource } from "../src/features/resources/resourceDownload.ts";
import { decryptAtr1Artifact } from "../src/features/resources/atr1.ts";

const scope = { courseId: "mechanics", moduleId: "motion", sessionId: "displacement" };
const plaintext = Buffer.from("%PDF-1.7\nstudent fixture\n%%EOF\n");
const fixtureKey = webcrypto.getRandomValues(new Uint8Array(32));
const fixtureIv = webcrypto.getRandomValues(new Uint8Array(12));
const cryptoKey = await webcrypto.subtle.importKey("raw", fixtureKey, "AES-GCM", false, ["encrypt"]);
const encryptedPayload = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: fixtureIv, additionalData: new TextEncoder().encode(PROTECTED_RESOURCE_FORMAT), tagLength: 128 }, cryptoKey, plaintext);
const encrypted = {
  artifact: Buffer.concat([Buffer.from(PROTECTED_RESOURCE_FORMAT), Buffer.from(fixtureIv), Buffer.from(encryptedPayload)]),
  contentKey: Buffer.from(fixtureKey).toString("base64url"),
};
const route = "/protected-resources/courses/mechanics/modules/motion/sessions/displacement/resources/notes.atr1";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function metadata(overrides = {}) {
  return {
    version: 1,
    resourceId: "notes",
    title: "Session Notes",
    originalFileName: "Session Notes.pdf",
    mimeType: "application/pdf",
    plaintextSize: plaintext.length,
    formatVersion: "ATR1",
    ciphertextRoute: route,
    ciphertextSha256: hash(encrypted.artifact),
    ciphertextSize: encrypted.artifact.length,
    createdAt: { seconds: 1, nanoseconds: 0 },
    boundAt: { seconds: 1, nanoseconds: 0 },
    ...overrides,
  };
}

function access(overrides = {}) {
  return {
    version: 1,
    resourceId: "notes",
    formatVersion: "ATR1",
    ciphertextSha256: hash(encrypted.artifact),
    contentKey: encrypted.contentKey,
    ...overrides,
  };
}

function response(bytes = encrypted.artifact, headers = {}, status = 200) {
  const responseHeaders = {
    "content-type": "application/octet-stream",
    "content-length": String(bytes.length),
    "x-content-type-options": "nosniff",
  };
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) delete responseHeaders[name];
    else responseHeaders[name] = value;
  }
  return new Response(new Uint8Array(bytes), {
    status,
    headers: responseHeaders,
  });
}

function dependencies(overrides = {}) {
  const events = [];
  const anchor = {
    href: "",
    download: "",
    click: () => events.push("click"),
    remove: () => events.push("remove"),
  };
  return {
    events,
    anchor,
    value: {
      getAccess: async () => access(),
      fetcher: async () => response(),
      decrypt: decryptAtr1Artifact,
      digest: (bytes) => webcrypto.subtle.digest("SHA-256", bytes),
      origin: "https://at-in-physics.web.app",
      createObjectUrl: (blob) => {
        events.push(["blob", blob.type, blob.size]);
        return "blob:trusted";
      },
      revokeObjectUrl: (url) => events.push(["revoke", url]),
      createAnchor: () => anchor,
      appendAnchor: () => events.push("append"),
      ...overrides,
    },
  };
}

test("authorized download verifies exact identity, reuses ATR1 decryption, and cleans up", async () => {
  const fixture = dependencies({
    getAccess: async (...ids) => {
      assert.deepEqual(ids, ["mechanics", "motion", "displacement", "notes"]);
      return access();
    },
    fetcher: async (input, init) => {
      assert.equal(input, route);
      assert.deepEqual(init, {
        method: "GET",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        headers: { accept: "application/octet-stream" },
      });
      return response();
    },
  });
  const stages = [];
  await downloadSessionResource(scope, metadata(), fixture.value, (stage) => stages.push(stage));
  assert.deepEqual(stages, ["access", "downloading", "preparing"]);
  assert.equal(fixture.anchor.download, "Session Notes.pdf");
  assert.equal(fixture.anchor.href, "blob:trusted");
  assert.deepEqual(fixture.events, [
    ["blob", "application/pdf", plaintext.length],
    "append",
    "click",
    "remove",
    ["revoke", "blob:trusted"],
  ]);
});

test("access is on-demand and denial or metadata/access mismatch fails before fetch", async () => {
  let accessReads = 0;
  let fetches = 0;
  const denied = dependencies({
    getAccess: async () => { accessReads += 1; throw new Error("permission-denied SECRET"); },
    fetcher: async () => { fetches += 1; return response(); },
  });
  assert.equal(accessReads, 0);
  await assert.rejects(downloadSessionResource(scope, metadata(), denied.value), /^Error: Protected resource is unavailable\.$/);
  assert.equal(accessReads, 1);
  assert.equal(fetches, 0);
  const mismatched = dependencies({
    getAccess: async () => access({ ciphertextSha256: "a".repeat(64) }),
    fetcher: async () => { fetches += 1; return response(); },
  });
  await assert.rejects(downloadSessionResource(scope, metadata(), mismatched.value), /unavailable/);
  assert.equal(fetches, 0);
});

test("route, redirect, final URL, status, and response headers fail closed", async () => {
  await assert.rejects(downloadSessionResource(scope, metadata({ ciphertextRoute: "https://evil.example/file.atr1" }), dependencies().value), /unavailable/);
  for (const fetcher of [
    async () => { throw new TypeError("redirect rejected"); },
    async () => response(Buffer.from("missing"), {}, 404),
    async () => response(encrypted.artifact, { "content-type": "application/pdf" }),
    async () => response(encrypted.artifact, { "x-content-type-options": "wrong" }),
    async () => response(encrypted.artifact, { "content-length": "01" }),
    async () => response(encrypted.artifact, { "content-length": String(encrypted.artifact.length + 1) }),
    async () => {
      const value = response();
      Object.defineProperty(value, "url", { value: "https://evil.example/file.atr1" });
      return value;
    },
  ]) {
    await assert.rejects(downloadSessionResource(scope, metadata(), dependencies({ fetcher }).value), /^Error: Protected resource is unavailable\.$/);
  }
});

test("bounded streaming rejects truncated, oversized, and extra ciphertext", async () => {
  for (const bytes of [
    encrypted.artifact.subarray(0, -1),
    Buffer.concat([encrypted.artifact, Buffer.from([1])]),
  ]) {
    await assert.rejects(downloadSessionResource(scope, metadata(), dependencies({
      fetcher: async () => response(bytes, { "content-length": undefined }),
    }).value), /unavailable/);
  }
  await assert.rejects(downloadSessionResource(scope, metadata({ ciphertextSize: 20 * 1024 * 1024 + 33 }), dependencies().value), /unavailable/);
});

test("magic, layout, SHA-256, wrong key, and authentication failure are sanitized", async () => {
  const changed = Buffer.from(encrypted.artifact);
  changed[changed.length - 1] ^= 1;
  await assert.rejects(downloadSessionResource(scope, metadata(), dependencies({ fetcher: async () => response(changed) }).value), /unavailable/);

  const wrongMagic = Buffer.from(encrypted.artifact);
  wrongMagic[0] = 0;
  const wrongMagicHash = hash(wrongMagic);
  await assert.rejects(downloadSessionResource(scope, metadata({ ciphertextSha256: wrongMagicHash }), dependencies({
    getAccess: async () => access({ ciphertextSha256: wrongMagicHash }),
    fetcher: async () => response(wrongMagic),
  }).value), /unavailable/);

  await assert.rejects(downloadSessionResource(scope, metadata(), dependencies({
    getAccess: async () => access({ contentKey: Buffer.alloc(32, 9).toString("base64url") }),
  }).value), /unavailable/);

  const badTagHash = hash(changed);
  await assert.rejects(downloadSessionResource(scope, metadata({ ciphertextSha256: badTagHash }), dependencies({
    getAccess: async () => access({ ciphertextSha256: badTagHash }),
    fetcher: async () => response(changed),
  }).value), /unavailable/);
});

test("plaintext size and PDF signature fail before Blob creation", async () => {
  let blobs = 0;
  for (const [meta, decrypt] of [
    [metadata({ plaintextSize: plaintext.length - 1 }), async () => plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength)],
    [metadata(), async () => new TextEncoder().encode("NOT-PDF").buffer],
  ]) {
    await assert.rejects(downloadSessionResource(scope, meta, dependencies({
      decrypt,
      createObjectUrl: () => { blobs += 1; return "blob:bad"; },
    }).value), /unavailable/);
  }
  assert.equal(blobs, 0);
});

test("anchor-stage failure still removes anchor and revokes the Object URL", async () => {
  const fixture = dependencies();
  fixture.anchor.click = () => { throw new Error("browser refused"); };
  await assert.rejects(downloadSessionResource(scope, metadata(), fixture.value), /unavailable/);
  assert.deepEqual(fixture.events.slice(-2), ["remove", ["revoke", "blob:trusted"]]);
});

test("Session UI isolates resources, prevents duplicate active clicks, and contains no persistence or eager access read", async () => {
  const component = await readFile(new URL("../src/features/resources/SessionResourceList.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/pages/courses/SessionDetailPage.tsx", import.meta.url), "utf8");
  const pipeline = await readFile(new URL("../src/features/resources/resourceDownload.ts", import.meta.url), "utf8");
  assert.match(component, /getSessionResources\(courseId, moduleId, sessionId\)/);
  assert.doesNotMatch(component, /getSessionResourceAccess/);
  assert.match(component, /activeDownloads\.current\.has\(resource\.resourceId\)/);
  assert.match(component, /activeDownloads\.current\.add\(resource\.resourceId\)/);
  assert.match(component, /activeDownloads\.current\.delete\(resource\.resourceId\)/);
  assert.match(component, /Video and lesson content remain available/);
  assert.match(page, /SessionVideoPlayer/);
  assert.match(page, /Lesson content/);
  assert.match(page, /SessionResourceList/);
  assert.doesNotMatch(pipeline + component, /localStorage|sessionStorage|indexedDB|caches\.|CacheStorage|console\.(log|error)/i);
});
