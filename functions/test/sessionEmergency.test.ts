import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { LifecycleReviewRegistry, runLifecycleReview } from "../src/ownerConsole/protectedContentLifecycle.js";
import {
  SESSION_EMERGENCY_CONFIRMATION,
  applySessionEmergencyWithdrawal,
  reviewSessionEmergencyWithdrawal,
} from "../src/ownerConsole/sessionEmergency.js";
import { derivePublicationManifest, proposePublishedSession } from "../src/tooling/sessionPublication.js";

type Stored = { data: Record<string, unknown>; version: number };
class Ref {
  constructor(readonly path: string, readonly db: MemoryFirestore) {}
  collection(name: string) { return new Collection(`${this.path}/${name}`, this.db); }
  get() { return Promise.resolve(this.db.snapshot(this.path)); }
}
class Collection {
  #limit = Number.POSITIVE_INFINITY;
  constructor(readonly path: string, readonly db: MemoryFirestore) {}
  doc(id: string) { return new Ref(`${this.path}/${id}`, this.db); }
  limit(value: number) { const next = new Collection(this.path, this.db); next.#limit = value; return next; }
  get() { return Promise.resolve(this.db.query(this.path, this.#limit)); }
}
class MemoryFirestore {
  readonly store = new Map<string, Stored>();
  attempts = 0;
  failBeforeCommit = false;
  overlap = false;
  #arrived = 0;
  #release!: () => void;
  #barrier = new Promise<void>((resolve) => { this.#release = resolve; });
  doc(path: string) { return new Ref(path, this); }
  collection(path: string) { return new Collection(path, this); }
  seed(path: string, data: Record<string, unknown>) { this.store.set(path, { data: { ...data }, version: 1 }); }
  snapshot(path: string) {
    const stored = this.store.get(path);
    return { id: path.split("/").at(-1)!, exists: stored !== undefined, data: () => stored?.data, updateTime: stored ? { toMillis: () => stored.version } : undefined, ref: this.doc(path) };
  }
  query(path: string, limit = Number.POSITIVE_INFINITY) {
    const prefix = `${path}/`;
    const docs = [...this.store.keys()].filter((item) => item.startsWith(prefix) && !item.slice(prefix.length).includes("/"))
      .sort().slice(0, limit).map((item) => this.snapshot(item));
    return { docs };
  }
  async runTransaction<T>(handler: (transaction: Transaction) => Promise<T>): Promise<T> {
    for (;;) {
      this.attempts += 1;
      const reads = new Map<string, number>();
      const writes: Array<{ kind: "update" | "set"; path: string; data: Record<string, unknown> }> = [];
      const tx = {
        get: async (value: Ref | Collection) => {
          if (value instanceof Ref) {
            reads.set(value.path, this.store.get(value.path)?.version ?? 0);
            return this.snapshot(value.path);
          }
          const result = this.query(value.path);
          for (const document of result.docs) reads.set(document.ref.path, this.store.get(document.ref.path)?.version ?? 0);
          return result;
        },
        update: (ref: Ref, data: Record<string, unknown>) => writes.push({ kind: "update", path: ref.path, data }),
        set: (ref: Ref, data: Record<string, unknown>) => writes.push({ kind: "set", path: ref.path, data }),
      };
      const result = await handler(tx as unknown as Transaction);
      if (this.overlap && this.#arrived < 2) {
        this.#arrived += 1;
        if (this.#arrived === 2) this.#release();
        await this.#barrier;
      }
      if ([...reads].some(([path, version]) => (this.store.get(path)?.version ?? 0) !== version)) continue;
      if (this.failBeforeCommit) throw new Error("transaction aborted");
      const next = new Map(this.store);
      for (const write of writes) {
        const current = next.get(write.path);
        if (write.kind === "update" && !current) throw new Error("missing update target");
        next.set(write.path, { data: write.kind === "update" ? { ...current!.data, ...write.data } : { ...write.data }, version: (current?.version ?? 0) + 1 });
      }
      this.store.clear();
      for (const [path, value] of next) this.store.set(path, value);
      return result;
    }
  }
}

const NOW = new Date("2030-01-01T00:00:00.000Z");
const target = { courseId: "mechanics", moduleId: "motion", sessionId: "target" } as const;
const coursePath = "courses/mechanics";
const modulePath = `${coursePath}/modules/motion`;
const sessionPath = `${modulePath}/sessions/target`;
const visiblePath = `${modulePath}/sessionDiscovery/visible`;
const freePath = `${modulePath}/sessionDiscovery/free`;
const accessPath = `${sessionPath}/videoAccess/primary`;
const resourcePath = `${sessionPath}/resources/notes`;
const resourceAccessPath = `${resourcePath}/access/primary`;
const key = "A".repeat(42) + "E";
const session = { title: "Target", order: 2, publicationStatus: "published", isFree: false, lessonText: "Keep lesson", videoAssetId: "video", releaseAt: Timestamp.fromDate(new Date("2029-01-01")) };
function database(overrides: Record<string, unknown> = {}) {
  const db = new MemoryFirestore();
  db.seed(coursePath, { slug: "mechanics", title: "Mechanics", shortDescription: "Description", status: "published" });
  db.seed(modulePath, { title: "Motion", order: 1 });
  db.seed(sessionPath, { ...session, ...overrides });
  db.seed(`${modulePath}/sessions/first`, { title: "First", order: 1, publicationStatus: "published" });
  db.seed(`${modulePath}/sessions/last`, { title: "Last", order: 3, publicationStatus: "published", isFree: true });
  db.seed(visiblePath, { sessionIds: ["first", "target", "last"] });
  db.seed(freePath, { sessions: [{ id: "last", title: "Last", order: 3 }] });
  db.seed(accessPath, { videoAssetId: "video", contentKey: key });
  db.seed(resourcePath, { keep: "metadata" });
  db.seed(resourceAccessPath, { keep: "access" });
  db.seed("enrollments/student_mechanics", { keep: "enrollment" });
  db.seed("accessCodes/code", { keep: "code" });
  return db;
}
async function reviewed(db: MemoryFirestore) {
  return reviewSessionEmergencyWithdrawal(db as unknown as Firestore, target, NOW);
}

test("published enrolled Session withdrawal is atomic, minimal, ordered, and preserves bindings and unrelated state", async () => {
  const db = database();
  const before = new Map([...db.store].map(([path, value]) => [path, structuredClone(value.data)]));
  const review = await reviewed(db);
  assert.equal(review.safe.protectedResourceCount, 1);
  assert.equal(review.safe.hasVideo, true);
  assert.equal(review.safe.releaseState, "released");
  const result = await applySessionEmergencyWithdrawal(db as unknown as Firestore, review, NOW);
  assert.equal(result.status, "COMMITTED_AND_VERIFIED");
  assert.deepEqual(db.store.get(sessionPath)!.data, { ...session, publicationStatus: "draft" });
  assert.deepEqual(db.store.get(visiblePath)!.data, { sessionIds: ["first", "last"] });
  assert.deepEqual(db.store.get(freePath)!.data, { sessions: [{ id: "last", title: "Last", order: 3 }] });
  for (const path of [coursePath, modulePath, accessPath, resourcePath, resourceAccessPath, "enrollments/student_mechanics", "accessCodes/code"])
    assert.deepEqual(db.store.get(path)!.data, before.get(path));
});

test("Opened and future-scheduled published Sessions are eligible and removed from both discovery manifests", async () => {
  const db = database({ isFree: true, releaseAt: Timestamp.fromDate(new Date("2031-01-01")) });
  db.store.get(freePath)!.data = { sessions: [{ id: "target", title: "Target", order: 2 }, { id: "last", title: "Last", order: 3 }] };
  const review = await reviewed(db);
  assert.equal(review.safe.releaseState, "scheduled");
  assert.equal(review.safe.isFree, true);
  await applySessionEmergencyWithdrawal(db as unknown as Firestore, review, NOW);
  assert.deepEqual(db.store.get(freePath)!.data, { sessions: [{ id: "last", title: "Last", order: 3 }] });
});

test("draft, malformed, and wrong hierarchy reviews fail closed without writes", async () => {
  for (const [overrides, expected] of [[{ publicationStatus: "draft" }, /published/], [{ publicationStatus: "preview" }, /malformed/]] as const) {
    const db = database(overrides);
    const before = [...db.store].map(([path, value]) => [path, value.version, value.data] as const);
    await assert.rejects(reviewed(db), expected);
    assert.deepEqual([...db.store].map(([path, value]) => [path, value.version, value.data] as const), before);
  }
  const db = database();
  await assert.rejects(reviewSessionEmergencyWithdrawal(db as unknown as Firestore, { ...target, sessionId: "missing" }, NOW), /not found/);
});

test("existing publication workflow can restore a withdrawn draft while preserving content and discovery semantics", () => {
  const withdrawn = { ...session, publicationStatus: "draft" };
  const republished = proposePublishedSession(withdrawn);
  assert.deepEqual(republished, session);
  const manifest = derivePublicationManifest([
    { id: "target", data: withdrawn },
    { id: "first", data: { title: "First", order: 1, publicationStatus: "published" } },
  ], "target", NOW);
  assert.deepEqual(manifest, { sessionIds: ["first", "target"] });
});

test("stale review and transaction abort preserve Session and both manifests", async () => {
  const stale = database();
  const review = await reviewed(stale);
  stale.store.get(sessionPath)!.version += 1;
  await assert.rejects(applySessionEmergencyWithdrawal(stale as unknown as Firestore, review, NOW), /stale/);
  assert.equal(stale.store.get(sessionPath)!.data.publicationStatus, "published");
  const aborted = database();
  const abortReview = await reviewed(aborted);
  aborted.failBeforeCommit = true;
  await assert.rejects(applySessionEmergencyWithdrawal(aborted as unknown as Firestore, abortReview, NOW), /aborted/);
  assert.equal(aborted.store.get(sessionPath)!.data.publicationStatus, "published");
  assert.deepEqual(aborted.store.get(visiblePath)!.data, { sessionIds: ["first", "target", "last"] });
});

test("concurrent independently reviewed withdrawals produce one winner", async () => {
  const db = database(); db.overlap = true;
  const [a, b] = await Promise.all([reviewed(db), reviewed(db)]);
  const results = await Promise.allSettled([
    applySessionEmergencyWithdrawal(db as unknown as Firestore, a, NOW),
    applySessionEmergencyWithdrawal(db as unknown as Firestore, b, NOW),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.ok(db.attempts >= 3);
});

test("registry enforces confirmation-independent reuse, one acquisition, replay, capacity, TTL, and terminal uncertain", async () => {
  assert.equal(SESSION_EMERGENCY_CONFIRMATION, "WITHDRAW SESSION NOW");
  let now = 0;
  const registry = new LifecycleReviewRegistry<number>(1, 10, () => now);
  registry.add("review", 1);
  assert.throws(() => registry.add("extra", 2), /capacity/);
  assert.equal(registry.acquire("review"), 1);
  assert.equal(registry.acquire("review"), null);
  registry.release("review");
  let calls = 0;
  const uncertain = await runLifecycleReview(registry, "review", async () => { calls += 1; return { status: "COMMITTED_VERIFICATION_UNCERTAIN" as const }; });
  assert.equal(uncertain?.status, "COMMITTED_VERIFICATION_UNCERTAIN");
  assert.equal(await runLifecycleReview(registry, "review", async () => { calls += 1; }), null);
  assert.equal(calls, 1);
  registry.add("expires", 2); now = 10;
  assert.equal(registry.acquire("expires"), null);
  now = 11;
  registry.add("retry", 3);
  await assert.rejects(runLifecycleReview(registry, "retry", async () => { throw new Error("precommit"); }), /precommit/);
  assert.equal(await runLifecycleReview(registry, "retry", async (value) => value), 3);
});

test("actual committed withdrawal with failed postverification returns uncertain", async () => {
  const db = database();
  const review = await reviewed(db);
  const result = await applySessionEmergencyWithdrawal(db as unknown as Firestore, review, NOW, {
    verifyCommitted: async () => { throw new Error("post-read unavailable"); },
  });
  assert.equal(result.status, "COMMITTED_VERIFICATION_UNCERTAIN");
  assert.equal(db.store.get(sessionPath)!.data.publicationStatus, "draft");
});

test("Emergency implementation has no Hosting, filesystem, persistence, logging, or unsafe dynamic rendering", async () => {
  const [service, client] = await Promise.all([
    readFile(new URL("../../src/ownerConsole/sessionEmergency.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/ownerConsole/sessionEmergencyClient.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(service, /node:fs|writeFile|unlink|rm\(|firebase deploy|transaction\.(?:create|delete)\(/i);
  assert.doesNotMatch(client, /localStorage|sessionStorage|indexedDB|console\.|innerHTML\s*\+=/i);
  assert.match(client, /textContent/);
  assert.match(client, /WITHDRAW SESSION NOW/);
});
