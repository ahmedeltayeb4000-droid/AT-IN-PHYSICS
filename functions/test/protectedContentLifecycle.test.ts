import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { ProtectedResourceAccess, ProtectedResourceMetadata } from "../src/protectedResources/format.js";
import type { OwnerVerifiedResourceDeployment } from "../src/ownerConsole/resourceLifecycle.js";
import {
  LifecycleReviewRegistry,
  RESOURCE_REMOVE_CONFIRMATION,
  RESOURCE_REPLACE_CONFIRMATION,
  VIDEO_REPLACE_CONFIRMATION,
  VIDEO_UNBIND_CONFIRMATION,
  applyResourceRemoval,
  applyResourceReplacement,
  applyVideoReplacement,
  applyVideoUnbind,
  readSessionProtectedContentInventory,
  runLifecycleReview,
  type ResourceRemoveReview,
  type ResourceReplaceReview,
  type VideoReplaceReview,
  type VideoUnbindReview,
} from "../src/ownerConsole/protectedContentLifecycle.js";
import { requireExpectedTarget } from "../src/ownerConsole/server.js";

type Stored = { data: Record<string, unknown>; version: number };
class Ref {
  constructor(readonly path: string, readonly store: Map<string, Stored>) {}
  collection(name: string) { return new Collection(`${this.path}/${name}`, this.store); }
  async get() { return snapshot(this.path, this.store); }
}
class Collection {
  constructor(readonly path: string, readonly store: Map<string, Stored>) {}
  doc(id: string) { return new Ref(`${this.path}/${id}`, this.store); }
  limit(count: number) { void count; return this; }
  async get() {
    const prefix = `${this.path}/`;
    const docs = [...this.store.keys()].filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/")).map((path) => ({ id: path.slice(prefix.length), ...snapshot(path, this.store) }));
    return { docs };
  }
}
function snapshot(path: string, store: Map<string, Stored>) {
  const value = store.get(path);
  return { exists: value !== undefined, data: () => value?.data, updateTime: value ? { toMillis: () => value.version } : undefined, ref: new Ref(path, store) };
}
class RacingFirestore {
  readonly store = new Map<string, Stored>();
  attempts = 0;
  #firstFinished = 0;
  #releaseFirst!: () => void;
  #firstBarrier = new Promise<void>((resolve) => { this.#releaseFirst = resolve; });
  constructor(readonly overlappingTransactions = 2) {}
  doc(path: string) { return new Ref(path, this.store); }
  collection(path: string) { return new Collection(path, this.store); }
  async getAll(...refs: Ref[]) { return Promise.all(refs.map((ref) => ref.get())); }
  seed(path: string, data: Record<string, unknown>) { this.store.set(path, { data: { ...data }, version: 1 }); }
  async runTransaction<T>(handler: (transaction: Transaction) => Promise<T>): Promise<T> {
    for (;;) {
      this.attempts += 1;
      const reads = new Map<string, number>();
      const writes: Array<() => void> = [];
      const transaction = {
        get: async (ref: Ref) => { const snap = snapshot(ref.path, this.store); reads.set(ref.path, this.store.get(ref.path)?.version ?? 0); return snap; },
        update: (ref: Ref, patch: Record<string, unknown>) => writes.push(() => { const current = this.store.get(ref.path)!; const next = { ...current.data }; for (const [key, value] of Object.entries(patch)) { if (value && typeof value === "object" && value.constructor?.name === "DeleteTransform") delete next[key]; else next[key] = value; } this.store.set(ref.path, { data: next, version: current.version + 1 }); }),
        set: (ref: Ref, data: Record<string, unknown>) => writes.push(() => { const current = this.store.get(ref.path); this.store.set(ref.path, { data: { ...data }, version: (current?.version ?? 0) + 1 }); }),
        create: (ref: Ref, data: Record<string, unknown>) => writes.push(() => { if (this.store.has(ref.path)) throw new Error("exists"); this.store.set(ref.path, { data: { ...data }, version: 1 }); }),
        delete: (ref: Ref) => writes.push(() => { this.store.delete(ref.path); }),
      };
      const result = await handler(transaction as unknown as Transaction);
      if (this.#firstFinished < this.overlappingTransactions) {
        this.#firstFinished += 1;
        if (this.#firstFinished === this.overlappingTransactions) this.#releaseFirst();
        await this.#firstBarrier;
      }
      if ([...reads].some(([path, version]) => (this.store.get(path)?.version ?? 0) !== version)) continue;
      for (const write of writes) write();
      return result;
    }
  }
}

const target = { courseId: "mechanics", moduleId: "motion", sessionId: "lesson" } as const;
const sessionPath = "courses/mechanics/modules/motion/sessions/lesson";
const accessPath = `${sessionPath}/videoAccess/primary`;
const key = "A".repeat(42) + "E";
const session = { title: "Lesson", order: 1, publicationStatus: "published", lessonText: "Keep me", videoAssetId: "old-video" };
const access = { videoAssetId: "old-video", contentKey: key };
const currentVideo = { sessionTitle: "Lesson", sessionRevision: 1, accessRevision: 1, videoAssetId: "old-video", access };
function videoReplace(id: string): VideoReplaceReview {
  return { operation: "video-replace", target, current: currentVideo, deployment: {} as never, proposed: { videoAssetId: id, contentKey: key }, safe: { ...target, sessionTitle: "Lesson", currentVideoAssetId: "old-video", newVideoAssetId: id, warning: "safe" } };
}
const videoUnbind: VideoUnbindReview = { operation: "video-unbind", target, current: currentVideo, safe: { sessionTitle: "Lesson", videoAssetId: "old-video", warning: "safe" } };

test("lifecycle registry is bounded, expiring, and one-use while acquired", () => {
  let now = 0;
  const registry = new LifecycleReviewRegistry<number>(1, 10, () => now);
  registry.add("a", 1);
  assert.throws(() => registry.add("b", 2), /capacity/);
  assert.equal(registry.acquire("a"), 1);
  assert.equal(registry.acquire("a"), null);
  registry.release("a");
  assert.equal(registry.acquire("a"), 1);
  registry.consume("a");
  assert.equal(registry.acquire("a"), null);
  registry.add("c", 3);
  now = 10;
  assert.equal(registry.acquire("c"), null);
});

test("Session inventory returns only validated paired display metadata", async () => {
  const db = new RacingFirestore();
  db.seed(sessionPath, session); db.seed(accessPath, access);
  db.seed(oldResourcePath, oldMetadata); db.seed(oldResourceAccessPath, oldResourceAccess);
  const inventory = await readSessionProtectedContentInventory(db as unknown as Firestore, target);
  assert.deepEqual(inventory.video, { bound: true, videoAssetId: "old-video" });
  assert.deepEqual(inventory.resources, [{ resourceId: "old-pdf", title: "Old PDF", originalFileName: "Old.pdf", plaintextSize: 10, status: "BOUND" }]);
  assert.doesNotMatch(JSON.stringify(inventory), new RegExp(key));
});

test("same-ID video replacement is rejected without a write", async () => {
  const db = new RacingFirestore(); db.seed(sessionPath, session); db.seed(accessPath, access);
  await assert.rejects(applyVideoReplacement(db as unknown as Firestore, videoReplace("old-video"), { validateDeployment: async () => undefined }), /new immutable/);
  assert.deepEqual(db.store.get(sessionPath)!.data, session);
  assert.deepEqual(db.store.get(accessPath)!.data, access);
});

test("overlapping video replace versus replace has one winner and preserves unrelated fields", async () => {
  const db = new RacingFirestore(); db.seed(sessionPath, session); db.seed(accessPath, access);
  const results = await Promise.allSettled([
    applyVideoReplacement(db as unknown as Firestore, videoReplace("new-video-a"), { validateDeployment: async () => undefined }),
    applyVideoReplacement(db as unknown as Firestore, videoReplace("new-video-b"), { validateDeployment: async () => undefined }),
  ]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(results.filter((value) => value.status === "rejected").length, 1);
  assert.equal(db.store.get(sessionPath)!.data.lessonText, "Keep me");
  assert.equal(db.store.get(sessionPath)!.data.videoAssetId, db.store.get(accessPath)!.data.videoAssetId);
  assert.ok(db.attempts >= 3);
});

test("overlapping video replace versus unbind has one winner and never leaves a split pair", async () => {
  const db = new RacingFirestore(); db.seed(sessionPath, session); db.seed(accessPath, access);
  const results = await Promise.allSettled([
    applyVideoReplacement(db as unknown as Firestore, videoReplace("new-video"), { validateDeployment: async () => undefined }),
    applyVideoUnbind(db as unknown as Firestore, videoUnbind),
  ]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(results.filter((value) => value.status === "rejected").length, 1);
  const finalSession = db.store.get(sessionPath)!.data;
  const finalAccess = db.store.get(accessPath)?.data;
  assert.equal(finalAccess === undefined, finalSession.videoAssetId === undefined);
  if (finalAccess) assert.equal(finalAccess.videoAssetId, finalSession.videoAssetId);
  assert.equal(finalSession.lessonText, "Keep me");
});

const oldResourcePath = `${sessionPath}/resources/old-pdf`;
const oldResourceAccessPath = `${oldResourcePath}/access/primary`;
const stamp = Timestamp.fromMillis(1);
const oldMetadata = { version: 1, resourceId: "old-pdf", title: "Old PDF", originalFileName: "Old.pdf", mimeType: "application/pdf", plaintextSize: 10, formatVersion: "ATR1", ciphertextRoute: "/protected-resources/courses/mechanics/modules/motion/sessions/lesson/resources/old-pdf.atr1", ciphertextSha256: "a".repeat(64), ciphertextSize: 42, createdAt: stamp, boundAt: stamp };
const oldResourceAccess = { version: 1, resourceId: "old-pdf", formatVersion: "ATR1", ciphertextSha256: "a".repeat(64), contentKey: key };
const normalizedOldMetadata = { ...oldMetadata, createdAt: { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds }, boundAt: { seconds: stamp.seconds, nanoseconds: stamp.nanoseconds } } as unknown as ProtectedResourceMetadata;
const currentResource = { metadataRevision: 1, accessRevision: 1, metadata: normalizedOldMetadata, access: oldResourceAccess as unknown as ProtectedResourceAccess };
function resourceDeployment(resourceId = "new-pdf") {
  const identity = { version: 1, scope: { type: "session", ...target }, resourceId, title: "New PDF", originalFileName: "New.pdf", mimeType: "application/pdf", plaintextSize: 12, formatVersion: "ATR1", ciphertextRoute: `/protected-resources/courses/mechanics/modules/motion/sessions/lesson/resources/${resourceId}.atr1`, ciphertextSha256: "b".repeat(64), ciphertextSize: 44 };
  return { status: "VERIFIED_DEPLOYED", review: { release: { preparation: { identity, contentKey: key } } } } as unknown as OwnerVerifiedResourceDeployment;
}
const resourceReplace: ResourceReplaceReview = { operation: "resource-replace", target, current: currentResource, deployment: resourceDeployment(), safe: { ...target, oldResourceId: "old-pdf", oldTitle: "Old PDF", newResourceId: "new-pdf", newTitle: "New PDF", warning: "safe" } };
const resourceRemove: ResourceRemoveReview = { operation: "resource-remove", target, current: currentResource, safe: { resourceId: "old-pdf", title: "Old PDF", warning: "safe" } };

test("overlapping PDF replace versus remove has one winner and no split old pair", { timeout: 5_000 }, async () => {
  const db = new RacingFirestore(); db.seed(oldResourcePath, oldMetadata); db.seed(oldResourceAccessPath, oldResourceAccess); db.seed(`${sessionPath}/resources/unrelated`, { keep: true });
  const results = await Promise.allSettled([
    applyResourceReplacement(db as unknown as Firestore, resourceReplace, { verifyDeployment: async () => undefined }),
    applyResourceRemoval(db as unknown as Firestore, resourceRemove),
  ]);
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  assert.equal(results.filter((value) => value.status === "rejected").length, 1);
  assert.equal(db.store.has(oldResourcePath), false);
  assert.equal(db.store.has(oldResourceAccessPath), false);
  assert.deepEqual(db.store.get(`${sessionPath}/resources/unrelated`)!.data, { keep: true });
  const newMetadataExists = db.store.has(`${sessionPath}/resources/new-pdf`);
  assert.equal(db.store.has(`${sessionPath}/resources/new-pdf/access/primary`), newMetadataExists);
});

test("standalone logical removals delete only authoritative pairs", async () => {
  const videoDb = new RacingFirestore(1); videoDb.seed(sessionPath, session); videoDb.seed(accessPath, access);
  await applyVideoUnbind(videoDb as unknown as Firestore, videoUnbind);
  assert.equal(videoDb.store.get(sessionPath)!.data.videoAssetId, undefined);
  assert.equal(videoDb.store.get(sessionPath)!.data.lessonText, "Keep me");
  assert.equal(videoDb.store.has(accessPath), false);

  const resourceDb = new RacingFirestore(1); resourceDb.seed(oldResourcePath, oldMetadata); resourceDb.seed(oldResourceAccessPath, oldResourceAccess); resourceDb.seed(`${sessionPath}/resources/unrelated`, { keep: true });
  await applyResourceRemoval(resourceDb as unknown as Firestore, resourceRemove);
  assert.equal(resourceDb.store.has(oldResourcePath), false);
  assert.equal(resourceDb.store.has(oldResourceAccessPath), false);
  assert.deepEqual(resourceDb.store.get(`${sessionPath}/resources/unrelated`)!.data, { keep: true });
});

test("Owner Control exposes only the approved lifecycle routes and safe client rendering", async () => {
  const [server, client] = await Promise.all([
    readFile(new URL("../../src/ownerConsole/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/ownerConsole/protectedContentClient.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [
    "/api/protected-content/session/inventory",
    "/api/video/replace/review", "/api/video/replace/apply",
    "/api/video/unbind/review", "/api/video/unbind/apply",
    "/api/resource/session/replace/review", "/api/resource/session/replace/apply",
    "/api/resource/session/remove/review", "/api/resource/session/remove/apply",
  ]) assert.match(server, new RegExp(route.replaceAll("/", "\\/")));
  assert.doesNotMatch(server, /resource\/session\/deploy\/recover/);
  assert.match(server, /REPLACE_SESSION_VIDEO|VIDEO_REPLACE_CONFIRMATION/);
  assert.match(client, /textContent/);
  assert.doesNotMatch(client, /contentKey|metadataPath|accessPath|revision|fingerprint|localStorage|sessionStorage|indexedDB|console\./i);
});

test("confirmation constants are exact and expected target IDs are assertions only", () => {
  assert.equal(VIDEO_REPLACE_CONFIRMATION, "REPLACE SESSION VIDEO");
  assert.equal(VIDEO_UNBIND_CONFIRMATION, "REMOVE VIDEO FROM SESSION");
  assert.equal(RESOURCE_REPLACE_CONFIRMATION, "REPLACE SESSION RESOURCE");
  assert.equal(RESOURCE_REMOVE_CONFIRMATION, "REMOVE RESOURCE FROM SESSION");
  assert.doesNotThrow(() => requireExpectedTarget({ expectedCourseId: "mechanics", expectedModuleId: "motion", expectedSessionId: "lesson" }, target));
  assert.throws(() => requireExpectedTarget({ expectedCourseId: "mechanics", expectedModuleId: "motion", expectedSessionId: "other" }, target), /does not match/);
});

test("resolved verification-uncertain review is consumed while thrown precommit failure is retryable", async () => {
  const registry = new LifecycleReviewRegistry<number>();
  registry.add("uncertain", 1);
  let writes = 0;
  const result = await runLifecycleReview(registry, "uncertain", async () => { writes += 1; return { status: "COMMITTED_VERIFICATION_UNCERTAIN" as const }; });
  assert.equal(result?.status, "COMMITTED_VERIFICATION_UNCERTAIN");
  assert.equal(await runLifecycleReview(registry, "uncertain", async () => { writes += 1; }), null);
  assert.equal(writes, 1);
  registry.add("retry", 2);
  await assert.rejects(runLifecycleReview(registry, "retry", async () => { throw new Error("precommit"); }), /precommit/);
  assert.equal(await runLifecycleReview(registry, "retry", async (value) => value), 2);
});

test("inventory fails closed for malformed or unpaired video and PDF state", async () => {
  const missingVideo = new RacingFirestore(); missingVideo.seed(sessionPath, session);
  await assert.rejects(readSessionProtectedContentInventory(missingVideo as unknown as Firestore, target), /malformed/);
  const mismatchedVideo = new RacingFirestore(); mismatchedVideo.seed(sessionPath, session); mismatchedVideo.seed(accessPath, { ...access, videoAssetId: "different" });
  await assert.rejects(readSessionProtectedContentInventory(mismatchedVideo as unknown as Firestore, target), /malformed/);
  const missingPdf = new RacingFirestore(); missingPdf.seed(sessionPath, session); missingPdf.seed(accessPath, access); missingPdf.seed(oldResourcePath, oldMetadata);
  await assert.rejects(readSessionProtectedContentInventory(missingPdf as unknown as Firestore, target), /malformed/);
  const malformedPdf = new RacingFirestore(); malformedPdf.seed(sessionPath, session); malformedPdf.seed(accessPath, access); malformedPdf.seed(oldResourcePath, oldMetadata); malformedPdf.seed(oldResourceAccessPath, { ...oldResourceAccess, resourceId: "wrong" });
  await assert.rejects(readSessionProtectedContentInventory(malformedPdf as unknown as Firestore, target));
});

test("inventory accepts exactly 100 resources and rejects the 101st", async () => {
  const build = (count: number) => {
    const db = new RacingFirestore(); db.seed(sessionPath, session); db.seed(accessPath, access);
    for (let index = 0; index < count; index += 1) {
      const id = `resource-${index}`;
      const path = `${sessionPath}/resources/${id}`;
      const hash = index.toString(16).padStart(64, "0");
      db.seed(path, { ...oldMetadata, resourceId: id, title: `Resource ${index}`, ciphertextRoute: `/protected-resources/courses/mechanics/modules/motion/sessions/lesson/resources/${id}.atr1`, ciphertextSha256: hash });
      db.seed(`${path}/access/primary`, { ...oldResourceAccess, resourceId: id, ciphertextSha256: hash });
    }
    return db;
  };
  assert.equal((await readSessionProtectedContentInventory(build(100) as unknown as Firestore, target)).resources.length, 100);
  await assert.rejects(readSessionProtectedContentInventory(build(101) as unknown as Firestore, target), /exceeds/);
});

test("same-ID PDF replacement and isolated stale operations fail without unintended writes", async () => {
  const sameIdDb = new RacingFirestore(1); sameIdDb.seed(oldResourcePath, oldMetadata); sameIdDb.seed(oldResourceAccessPath, oldResourceAccess);
  const sameIdReview = { ...resourceReplace, deployment: resourceDeployment("old-pdf") };
  await assert.rejects(applyResourceReplacement(sameIdDb as unknown as Firestore, sameIdReview, { verifyDeployment: async () => undefined }), /new immutable/);
  assert.equal(sameIdDb.store.has(oldResourcePath), true);
  assert.equal(sameIdDb.store.has(`${sessionPath}/resources/new-pdf`), false);

  for (const operation of ["video-replace", "video-unbind"] as const) {
    const db = new RacingFirestore(1); db.seed(sessionPath, session); db.seed(accessPath, access); db.store.get(accessPath)!.version = 2;
    const action = operation === "video-replace"
      ? applyVideoReplacement(db as unknown as Firestore, videoReplace("new-video"), { validateDeployment: async () => undefined })
      : applyVideoUnbind(db as unknown as Firestore, videoUnbind);
    await assert.rejects(action, /stale/);
    assert.equal(db.store.get(sessionPath)!.data.videoAssetId, "old-video");
  }
  for (const operation of ["resource-replace", "resource-remove"] as const) {
    const db = new RacingFirestore(1); db.seed(oldResourcePath, oldMetadata); db.seed(oldResourceAccessPath, oldResourceAccess); db.seed(`${sessionPath}/resources/unrelated`, { keep: true }); db.store.get(oldResourceAccessPath)!.version = 2;
    const action = operation === "resource-replace"
      ? applyResourceReplacement(db as unknown as Firestore, resourceReplace, { verifyDeployment: async () => undefined })
      : applyResourceRemoval(db as unknown as Firestore, resourceRemove);
    await assert.rejects(action, /stale/);
    assert.equal(db.store.has(oldResourcePath), true);
    assert.equal(db.store.has(oldResourceAccessPath), true);
    assert.equal(db.store.has(`${sessionPath}/resources/new-pdf`), false);
    assert.deepEqual(db.store.get(`${sessionPath}/resources/unrelated`)!.data, { keep: true });
  }
});
