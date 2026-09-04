import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import {
  applySessionAvailability,
  reviewSessionAvailability,
} from "../src/ownerConsole/sessionAvailability.js";

const PROJECT_ID = "demo-at-in-physics";
const app = initializeApp(
  { projectId: PROJECT_ID },
  "session-availability-tests",
);
const db = getFirestore(app);
const target = {
  courseId: "mechanics",
  moduleId: "motion",
  sessionId: "intro",
} as const;
const coursePath = "courses/mechanics";
const modulePath = `${coursePath}/modules/motion`;
const sessionPath = `${modulePath}/sessions/intro`;
const visiblePath = `${modulePath}/sessionDiscovery/visible`;
const freePath = `${modulePath}/sessionDiscovery/free`;

before(() => {
  if (
    (process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT) !==
      PROJECT_ID ||
    !process.env.FIRESTORE_EMULATOR_HOST
  ) {
    throw new Error(
      "Session availability integration tests require the demo Firestore emulator.",
    );
  }
});
beforeEach(async () => {
  const snapshots = await db.listCollections();
  await Promise.all(
    snapshots.map((collection) => db.recursiveDelete(collection)),
  );
  await db.doc(coursePath).set({
    slug: "mechanics",
    title: "Mechanics",
    shortDescription: "Description",
    status: "published",
  });
  await db.doc(modulePath).set({ title: "Motion", order: 0 });
  await db.doc(sessionPath).set({
    title: "Intro",
    order: 0,
    publicationStatus: "published",
    isFree: true,
    videoAssetId: "video",
  });
  await db
    .doc(`${modulePath}/sessions/other`)
    .set({ title: "Other", order: 1, publicationStatus: "published" });
  await db.doc(visiblePath).set({ sessionIds: ["intro", "other"] });
  await db
    .doc(freePath)
    .set({ sessions: [{ id: "intro", title: "Intro", order: 0 }] });
  await db
    .doc(`${sessionPath}/videoAccess/primary`)
    .set({ videoAssetId: "video", contentKey: "A".repeat(42) + "E" });
  await db.doc(`${sessionPath}/resources/notes`).set({ preserved: "metadata" });
  await db
    .doc(`${sessionPath}/resources/notes/access/primary`)
    .set({ preserved: "key" });
  await db
    .doc("enrollments/student_mechanics")
    .set({ preserved: "enrollment" });
});
after(() => deleteApp(app));

test("availability apply patches only schedule fields, reconciles discovery, and preserves authority data", async () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  const before = await db.getAll(
    db.doc(`${sessionPath}/videoAccess/primary`),
    db.doc(`${sessionPath}/resources/notes`),
    db.doc(`${sessionPath}/resources/notes/access/primary`),
    db.doc("enrollments/student_mechanics"),
  );
  const review = await reviewSessionAvailability(
    db,
    target,
    "2029-01-01T00:00:00.000Z",
    "2030-01-01T00:00:00.000Z",
  );
  assert.deepEqual(await applySessionAvailability(db, review, now), {
    state: "closed",
    verified: true,
  });
  const session = (await db.doc(sessionPath).get()).data()!;
  assert.deepEqual(Object.keys(session).sort(), [
    "closeAt",
    "isFree",
    "order",
    "publicationStatus",
    "releaseAt",
    "title",
    "videoAssetId",
  ]);
  assert.equal(session.releaseAt instanceof Timestamp, true);
  assert.equal(session.closeAt instanceof Timestamp, true);
  assert.deepEqual((await db.doc(visiblePath).get()).data(), {
    sessionIds: ["other"],
  });
  assert.deepEqual((await db.doc(freePath).get()).data(), { sessions: [] });
  const afterSnapshots = await db.getAll(
    db.doc(`${sessionPath}/videoAccess/primary`),
    db.doc(`${sessionPath}/resources/notes`),
    db.doc(`${sessionPath}/resources/notes/access/primary`),
    db.doc("enrollments/student_mechanics"),
  );
  assert.deepEqual(
    afterSnapshots.map((item) => item.data()),
    before.map((item) => item.data()),
  );
});

test("stale review fails without changing the Session", async () => {
  const review = await reviewSessionAvailability(
    db,
    target,
    null,
    "2031-01-01T00:00:00.000Z",
  );
  await db.doc(sessionPath).update({ title: "Changed" });
  await assert.rejects(
    applySessionAvailability(db, review, new Date("2030-01-01T00:00:00.000Z")),
    /changed after review/,
  );
  const session = (await db.doc(sessionPath).get()).data()!;
  assert.equal(session.title, "Changed");
  assert.equal(Object.hasOwn(session, "closeAt"), false);
});
