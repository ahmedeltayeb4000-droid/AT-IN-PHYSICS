import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import { publishEncryptedVideoMetadata } from "../src/videoPublication/publishVideoMetadata.js";

const PROJECT_ID = "demo-at-in-physics";
const KEY_A = "A".repeat(43);
const KEY_B = "E".repeat(43);
let app: App;
let db: Firestore;

function requireEmulatorSafety(): void {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (projectId !== PROJECT_ID || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Video publication integration tests require the demo Firestore emulator.",
    );
  }
}

function rawInput(
  courseId: string,
  moduleId: string,
  sessionId: string,
  videoAssetId = "lesson-video-a",
  contentKey = KEY_A,
) {
  return { courseId, moduleId, sessionId, videoAssetId, contentKey };
}

function sessionPath(courseId: string, moduleId: string, sessionId: string) {
  return `courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`;
}

function references(input: ReturnType<typeof rawInput>) {
  const session = db.doc(
    sessionPath(input.courseId, input.moduleId, input.sessionId),
  );
  return {
    session,
    access: session.collection("videoAccess").doc("primary"),
  };
}

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    title: "Introduction to Motion",
    order: 1,
    publicationStatus: "draft",
    releaseAt: Timestamp.fromDate(new Date("2030-01-01T00:00:00.000Z")),
    lessonText: "Preserved lesson text.",
    futureField: { nested: ["preserved", 7] },
    ...overrides,
  };
}

async function snapshotData(reference: DocumentReference) {
  const snapshot = await reference.get();
  return { exists: snapshot.exists, data: snapshot.data(), updateTime: snapshot.updateTime };
}

before(() => {
  requireEmulatorSafety();
  app = initializeApp({ projectId: PROJECT_ID }, "video-publication-tests");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

test("missing Session fails without creating Session or access", async () => {
  const input = rawInput("video-missing-course", "video-missing-module", "video-missing-session");
  const refs = references(input);
  await assert.rejects(publishEncryptedVideoMetadata(db, input), /Session was not found/);
  assert.equal((await refs.session.get()).exists, false);
  assert.equal((await refs.access.get()).exists, false);
});

test("malformed Session fails without mutation", async () => {
  const input = rawInput("video-malformed-course", "video-malformed-module", "video-malformed-session");
  const refs = references(input);
  await refs.session.set(sessionData({ order: "one" }));
  const before = await snapshotData(refs.session);

  await assert.rejects(
    publishEncryptedVideoMetadata(db, input),
    /Existing Session is malformed/,
  );

  const afterSnapshot = await snapshotData(refs.session);
  assert.deepEqual(afterSnapshot.data, before.data);
  assert.equal(afterSnapshot.updateTime?.isEqual(before.updateTime!), true);
  assert.equal((await refs.access.get()).exists, false);
});

test("missing access creates exact metadata and preserves Session and path isolation", async () => {
  const input = rawInput("video-create-course", "video-create-module", "video-create-session");
  const refs = references(input);
  const sibling = db.doc(sessionPath(input.courseId, input.moduleId, "video-create-sibling"));
  const otherModule = db.doc(sessionPath(input.courseId, "video-other-module", input.sessionId));
  const otherCourse = db.doc(sessionPath("video-other-course", input.moduleId, input.sessionId));
  const initial = sessionData();
  await Promise.all([
    refs.session.set(initial),
    sibling.set(sessionData({ title: "Sibling" })),
    otherModule.set(sessionData({ title: "Other module" })),
    otherCourse.set(sessionData({ title: "Other course" })),
  ]);
  const isolatedBefore = await Promise.all([
    snapshotData(sibling),
    snapshotData(otherModule),
    snapshotData(otherCourse),
  ]);

  const result = await publishEncryptedVideoMetadata(db, input);

  assert.deepEqual(result, { status: "created", videoAssetId: input.videoAssetId });
  assert.equal(Object.hasOwn(result, "contentKey"), false);
  assert.deepEqual((await refs.session.get()).data(), {
    ...initial,
    videoAssetId: input.videoAssetId,
  });
  assert.deepEqual((await refs.access.get()).data(), {
    videoAssetId: input.videoAssetId,
    contentKey: input.contentKey,
  });
  const isolatedAfter = await Promise.all([
    snapshotData(sibling),
    snapshotData(otherModule),
    snapshotData(otherCourse),
  ]);
  for (let index = 0; index < isolatedBefore.length; index += 1) {
    assert.deepEqual(isolatedAfter[index].data, isolatedBefore[index].data);
    assert.equal(
      isolatedAfter[index].updateTime?.isEqual(isolatedBefore[index].updateTime!),
      true,
    );
  }
});

test("exact desired state is a zero-write idempotent no-op", async () => {
  const input = rawInput("video-noop-course", "video-noop-module", "video-noop-session");
  const refs = references(input);
  await Promise.all([
    refs.session.set(sessionData({ videoAssetId: input.videoAssetId })),
    refs.access.set({ videoAssetId: input.videoAssetId, contentKey: input.contentKey }),
  ]);
  const beforeSession = await snapshotData(refs.session);
  const beforeAccess = await snapshotData(refs.access);

  const result = await publishEncryptedVideoMetadata(db, input);

  assert.deepEqual(result, { status: "already-current", videoAssetId: input.videoAssetId });
  const afterSession = await snapshotData(refs.session);
  const afterAccess = await snapshotData(refs.access);
  assert.equal(afterSession.updateTime?.isEqual(beforeSession.updateTime!), true);
  assert.equal(afterAccess.updateTime?.isEqual(beforeAccess.updateTime!), true);
});

test("malformed access fails closed without overwriting either document", async () => {
  const input = rawInput("video-bad-access-course", "video-bad-access-module", "video-bad-access-session");
  const refs = references(input);
  await Promise.all([
    refs.session.set(sessionData()),
    refs.access.set({ videoAssetId: input.videoAssetId, contentKey: "malformed", extra: true }),
  ]);
  const beforeSession = await snapshotData(refs.session);
  const beforeAccess = await snapshotData(refs.access);

  await assert.rejects(
    publishEncryptedVideoMetadata(db, input),
    /Existing video access is malformed/,
  );

  const afterSession = await snapshotData(refs.session);
  const afterAccess = await snapshotData(refs.access);
  assert.deepEqual(afterSession.data, beforeSession.data);
  assert.deepEqual(afterAccess.data, beforeAccess.data);
  assert.equal(afterSession.updateTime?.isEqual(beforeSession.updateTime!), true);
  assert.equal(afterAccess.updateTime?.isEqual(beforeAccess.updateTime!), true);
});

test("valid different access is explicitly replaced with the desired binding", async () => {
  const input = rawInput("video-replace-course", "video-replace-module", "video-replace-session");
  const refs = references(input);
  await Promise.all([
    refs.session.set(sessionData({ videoAssetId: "lesson-video-old" })),
    refs.access.set({ videoAssetId: "lesson-video-old", contentKey: KEY_B }),
  ]);

  const result = await publishEncryptedVideoMetadata(db, input);

  assert.deepEqual(result, { status: "updated", videoAssetId: input.videoAssetId });
  assert.equal((await refs.session.get()).data()?.videoAssetId, input.videoAssetId);
  assert.deepEqual((await refs.access.get()).data(), {
    videoAssetId: input.videoAssetId,
    contentKey: input.contentKey,
  });
});

test("asset rotation atomically moves Session and access to the same new asset", async () => {
  const oldInput = rawInput("video-rotate-course", "video-rotate-module", "video-rotate-session");
  const newInput = rawInput(
    oldInput.courseId,
    oldInput.moduleId,
    oldInput.sessionId,
    "lesson-video-b",
    KEY_B,
  );
  const refs = references(oldInput);
  await Promise.all([
    refs.session.set(sessionData({ videoAssetId: oldInput.videoAssetId })),
    refs.access.set({ videoAssetId: oldInput.videoAssetId, contentKey: oldInput.contentKey }),
  ]);

  await publishEncryptedVideoMetadata(db, newInput);

  const [session, access] = await Promise.all([refs.session.get(), refs.access.get()]);
  assert.equal(session.data()?.videoAssetId, newInput.videoAssetId);
  assert.deepEqual(access.data(), {
    videoAssetId: newInput.videoAssetId,
    contentKey: newInput.contentKey,
  });
});

test("failed transaction never leaves a partial Session binding", async () => {
  const input = rawInput("video-atomic-course", "video-atomic-module", "video-atomic-session");
  const refs = references(input);
  const originalAsset = "lesson-video-original";
  await Promise.all([
    refs.session.set(sessionData({ videoAssetId: originalAsset })),
    refs.access.set({ videoAssetId: originalAsset, unexpected: true }),
  ]);

  await assert.rejects(publishEncryptedVideoMetadata(db, input));

  assert.equal((await refs.session.get()).data()?.videoAssetId, originalAsset);
  assert.deepEqual((await refs.access.get()).data(), {
    videoAssetId: originalAsset,
    unexpected: true,
  });
});

test("concurrent publication attempts finish with one internally consistent binding", async () => {
  const first = rawInput("video-concurrent-course", "video-concurrent-module", "video-concurrent-session");
  const second = rawInput(first.courseId, first.moduleId, first.sessionId, "lesson-video-b", KEY_B);
  const refs = references(first);
  await refs.session.set(sessionData());

  await Promise.all([
    publishEncryptedVideoMetadata(db, first),
    publishEncryptedVideoMetadata(db, second),
  ]);

  const [session, access] = await Promise.all([refs.session.get(), refs.access.get()]);
  const assetId = session.data()?.videoAssetId;
  assert.equal(access.data()?.videoAssetId, assetId);
  assert.equal(
    access.data()?.contentKey,
    assetId === first.videoAssetId ? first.contentKey : second.contentKey,
  );
});
