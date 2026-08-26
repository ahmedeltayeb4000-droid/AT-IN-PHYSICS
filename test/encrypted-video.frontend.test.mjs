import assert from "node:assert/strict";
import { test } from "node:test";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TextEncoder } from "node:util";

/* global Headers, ReadableStream, Response */
import {
  ATV1_MAX_ARTIFACT_BYTES,
  decodeAtv1ContentKey,
  decryptAtv1Artifact,
  parseAtv1Artifact,
} from "../src/features/video/atv1.ts";
import {
  buildEncryptedMediaRoute,
  fetchEncryptedMedia,
} from "../src/features/video/encryptedMediaRepository.ts";
import { loadSessionVideo } from "../src/features/video/videoPlayback.ts";
import { encryptVideoBytes } from "../functions/src/videoPackaging/crypto.ts";
import {
  buildProtectedWatermarkLines,
  maskViewerEmail,
  nextWatermarkPosition,
  startWatermarkPositionCycle,
  WATERMARK_POSITIONS,
  WATERMARK_POSITION_INTERVAL_MS,
} from "../src/features/video/watermark.ts";

const MAGIC = new TextEncoder().encode("ATV1");
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const KEY_TEXT = Buffer.from(KEY).toString("base64url");
const IV = Uint8Array.from({ length: 12 }, (_, index) => index + 32);
const PLAINTEXT = Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112]);

async function artifactFixture() {
  const key = await webcrypto.subtle.importKey("raw", KEY, "AES-GCM", false, [
    "encrypt",
  ]);
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: IV, additionalData: MAGIC, tagLength: 128 },
    key,
    PLAINTEXT,
  );
  const artifact = new Uint8Array(MAGIC.length + IV.length + encrypted.byteLength);
  artifact.set(MAGIC);
  artifact.set(IV, MAGIC.length);
  artifact.set(new Uint8Array(encrypted), MAGIC.length + IV.length);
  return artifact.buffer;
}

function session(videoAssetId) {
  const resolvedAssetId =
    arguments.length === 0 ? "mechanics-intro-video" : videoAssetId;
  return {
    id: "mechanics-intro",
    courseId: "mechanics",
    moduleId: "motion",
    title: "Motion",
    order: 0,
    publicationStatus: "published",
    ...(resolvedAssetId === undefined
      ? {}
      : { videoAssetId: resolvedAssetId }),
  };
}

test("canonical content key decoding is exact and invalid keys fail closed", () => {
  assert.deepEqual(decodeAtv1ContentKey(KEY_TEXT), KEY);
  for (const invalid of ["", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(42)}+`]) {
    assert.throws(() => decodeAtv1ContentKey(invalid), /unavailable/);
  }
});

test("ATV1 parsing validates magic and minimum structure", async () => {
  const artifact = await artifactFixture();
  const parsed = parseAtv1Artifact(artifact);
  assert.deepEqual(parsed.iv, IV);
  assert.equal(parsed.encryptedPayload.byteLength, PLAINTEXT.length + 16);
  assert.throws(() => parseAtv1Artifact(Uint8Array.of(65, 84, 86, 50).buffer), /unavailable/);
  assert.throws(() => parseAtv1Artifact(new Uint8Array(32).buffer), /unavailable/);
});

test("browser SubtleCrypto decrypts backend-compatible ATV1 and rejects wrong or tampered data", async () => {
  const artifact = await artifactFixture();
  assert.deepEqual(
    new Uint8Array(await decryptAtv1Artifact(artifact, KEY_TEXT, webcrypto.subtle)),
    PLAINTEXT,
  );
  await assert.rejects(
    decryptAtv1Artifact(artifact, Buffer.alloc(32, 9).toString("base64url"), webcrypto.subtle),
    /unavailable/,
  );
  for (const offset of [18, new Uint8Array(artifact).length - 1]) {
    const tampered = artifact.slice(0);
    new Uint8Array(tampered)[offset] ^= 1;
    await assert.rejects(decryptAtv1Artifact(tampered, KEY_TEXT, webcrypto.subtle), /unavailable/);
  }
});

test("frontend decryptor consumes an artifact emitted by the backend packager", async () => {
  const packaged = encryptVideoBytes(PLAINTEXT, (length) =>
    length === 32 ? Buffer.from(KEY) : Buffer.from(IV),
  );
  assert.deepEqual(
    new Uint8Array(
      await decryptAtv1Artifact(
        Uint8Array.from(packaged.artifact).buffer,
        packaged.contentKey,
        webcrypto.subtle,
      ),
    ),
    PLAINTEXT,
  );
});

test("media route is same-origin and derived only from a canonical asset ID", () => {
  assert.equal(
    buildEncryptedMediaRoute("mechanics-intro-video"),
    "/protected-media/mechanics-intro-video.atv1",
  );
  for (const invalid of ["https://evil.example/video", "../video", "Uppercase", "a/b"])
    assert.throws(() => buildEncryptedMediaRoute(invalid), /unavailable/);
});

test("media fetch requires success and rejects declared or actual oversized artifacts", async () => {
  const artifact = await artifactFixture();
  assert.deepEqual(
    await fetchEncryptedMedia("mechanics-intro-video", async (url, init) => {
      assert.equal(url, "/protected-media/mechanics-intro-video.atv1");
      assert.equal(init.credentials, "same-origin");
      return new Response(artifact);
    }),
    artifact,
  );
  await assert.rejects(
    fetchEncryptedMedia("mechanics-intro-video", async () => new Response(null, { status: 404 })),
    /unavailable/,
  );
  await assert.rejects(
    fetchEncryptedMedia("mechanics-intro-video", async () =>
      new Response(null, { headers: { "content-length": String(ATV1_MAX_ARTIFACT_BYTES + 1) } }),
    ),
    /unavailable/,
  );
  let cancelled = false;
  await assert.rejects(
    fetchEncryptedMedia("mechanics-intro-video", async () => ({
      ok: true,
      headers: new Headers(),
      body: new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(ATV1_MAX_ARTIFACT_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
    })),
    /unavailable/,
  );
  assert.equal(cancelled, true);
});

test("session without video performs no access, media, or decrypt work", async () => {
  let calls = 0;
  const unavailable = async () => {
    calls += 1;
    throw new Error("unexpected");
  };
  assert.equal(
    await loadSessionVideo(session(undefined), {
      getAccess: unavailable,
      fetchMedia: unavailable,
      decrypt: unavailable,
      createObjectUrl: () => "unexpected",
      revokeObjectUrl: () => { calls += 1; },
    }),
    null,
  );
  assert.equal(calls, 0);
});

test("playback flow fails closed in order and successful cleanup revokes its URL once", async () => {
  const calls = [];
  const base = {
    getAccess: async () => ({ videoAssetId: "mechanics-intro-video", contentKey: KEY_TEXT }),
    fetchMedia: async (assetId) => { calls.push(`media:${assetId}`); return new ArrayBuffer(1); },
    decrypt: async () => { calls.push("decrypt"); return PLAINTEXT.buffer; },
    createObjectUrl: (blob) => { calls.push(`blob:${blob.type}`); return "blob:test"; },
    revokeObjectUrl: (url) => calls.push(`revoke:${url}`),
  };
  await assert.rejects(
    loadSessionVideo(session(), { ...base, getAccess: async () => { throw new Error("denied"); } }),
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    loadSessionVideo(session(), { ...base, fetchMedia: async () => { throw new Error("missing"); } }),
  );
  assert.equal(calls.includes("decrypt"), false);
  await assert.rejects(
    loadSessionVideo(session(), { ...base, getAccess: async () => ({ videoAssetId: "other-video", contentKey: KEY_TEXT }) }),
    /unavailable/,
  );
  const loaded = await loadSessionVideo(session(), base);
  assert.equal(loaded.objectUrl, "blob:test");
  loaded.release();
  loaded.release();
  assert.equal(calls.filter((item) => item === "revoke:blob:test").length, 1);
});

test("changed playback code introduces no persistence, browser writes, or arbitrary URL input", async () => {
  const files = [
    "../src/features/video/atv1.ts",
    "../src/features/video/encryptedMediaRepository.ts",
    "../src/features/video/videoPlayback.ts",
    "../src/features/video/SessionVideoPlayer.tsx",
  ];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB|setDoc|updateDoc|addDoc|deleteDoc)\b/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test("protected playback derives a privacy-reduced authenticated viewer watermark", async () => {
  const email = "alice.student@example.com";
  const uid = "firebase-user-credential-that-must-not-be-rendered";
  const lines = await buildProtectedWatermarkLines(
    { uid, email },
    webcrypto.subtle,
  );
  assert.deepEqual(lines, ["A.T IN PHYSICS", "a***t@e***e.com"]);
  assert.equal(lines.join(" ").includes(email), false);
  assert.equal(lines.join(" ").includes(uid), false);
  assert.equal(maskViewerEmail("invalid"), null);

  const fallback = await buildProtectedWatermarkLines(
    { uid, email: null },
    webcrypto.subtle,
  );
  assert.match(fallback[1], /^Viewer [0-9a-f]{12}$/);
  assert.equal(fallback.join(" ").includes(uid), false);
});

test("watermark position cycle stays in its predefined bounded set", () => {
  let current = 0;
  const visited = new Set([current]);
  for (let index = 0; index < WATERMARK_POSITIONS.length * 2; index += 1) {
    current = nextWatermarkPosition(current);
    visited.add(current);
  }
  assert.deepEqual([...visited].sort(), WATERMARK_POSITIONS.map((_, index) => index));
  assert.equal(nextWatermarkPosition(-1), 0);
  assert.equal(nextWatermarkPosition(WATERMARK_POSITIONS.length), 0);
  assert.equal(WATERMARK_POSITIONS.every((classes) => !/bottom-(?:0|1|2|3|4)\b/.test(classes)), true);
});

test("watermark timer uses the approved interval, cleans up, and reduced motion creates no timer", () => {
  let callback;
  let delay;
  const cleared = [];
  let advances = 0;
  const timers = {
    setInterval(next, nextDelay) {
      callback = next;
      delay = nextDelay;
      return "timer-id";
    },
    clearInterval(timer) {
      cleared.push(timer);
    },
  };
  const cleanup = startWatermarkPositionCycle(() => { advances += 1; }, false, timers);
  assert.equal(delay, WATERMARK_POSITION_INTERVAL_MS);
  callback();
  assert.equal(advances, 1);
  cleanup();
  assert.deepEqual(cleared, ["timer-id"]);

  let reducedTimerCreated = false;
  const reducedCleanup = startWatermarkPositionCycle(() => {}, true, {
    setInterval() { reducedTimerCreated = true; },
    clearInterval() {},
  });
  reducedCleanup();
  assert.equal(reducedTimerCreated, false);
});

test("fullscreen contains video and watermark with accessible wrapper control and lifecycle cleanup", async () => {
  const source = await readFile(
    new URL("../src/features/video/SessionVideoPlayer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /ref=\{wrapperRef\}/);
  assert.match(source, /wrapper\.requestFullscreen\(\)/);
  assert.match(source, /document\.exitFullscreen\(\)/);
  assert.match(source, /aria-label=\{isFullscreen/);
  assert.match(source, /aria-pressed=\{isFullscreen\}/);
  assert.match(source, /addEventListener\("fullscreenchange", update\)/);
  assert.match(source, /removeEventListener\("fullscreenchange", update\)/);
  assert.match(source, /pointer-events-none/);
  assert.match(source, /controlsList="nodownload nofullscreen"/);
});

test("watermark policy is protected-playback scoped and future public playback can opt out", async () => {
  const watermarkSource = await readFile(
    new URL("../src/features/video/watermark.ts", import.meta.url),
    "utf8",
  );
  const playerSource = await readFile(
    new URL("../src/features/video/SessionVideoPlayer.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = await readFile(
    new URL("../src/pages/courses/SessionDetailPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(watermarkSource, /mode: "protected"/);
  assert.match(watermarkSource, /mode: "none"/);
  assert.match(playerSource, /watermark\.mode === "protected"/);
  assert.match(pageSource, /mode: "protected"/);
});

test("watermark additions expose no forbidden viewer secrets or logging", async () => {
  const files = [
    "../src/features/video/watermark.ts",
    "../src/features/video/SessionVideoPlayer.tsx",
    "../src/pages/courses/SessionDetailPage.tsx",
  ];
  const source = (await Promise.all(files.map((file) =>
    readFile(new URL(file, import.meta.url), "utf8"),
  ))).join("\n");
  assert.doesNotMatch(source, /\b(?:accessCode|enrollmentId|password|idToken|refreshToken)\b/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn|info)/);
});
