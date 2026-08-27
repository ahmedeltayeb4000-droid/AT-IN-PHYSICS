import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { runLessonContentPublication } from "../src/tooling/lessonContentPublication.js";

const PROJECT_ID = "demo-at-in-physics";
let app: App;
let db: Firestore;

function requireEmulatorSafety() {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (projectId !== PROJECT_ID || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Lesson content publication tests require the demo Firestore emulator.",
    );
  }
}

function target(courseId: string, moduleId: string, sessionId: string) {
  return { courseId, moduleId, sessionId };
}

function sessionPath(courseId: string, moduleId: string, sessionId: string) {
  return `courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`;
}

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    title: "Introduction to Motion",
    order: 1,
    publicationStatus: "published",
    releaseAt: Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z")),
    ...overrides,
  };
}

before(() => {
  requireEmulatorSafety();
  app = initializeApp(
    { projectId: PROJECT_ID },
    "lesson-content-publication-tests",
  );
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

test("dry run inspects the exact Session and performs zero writes", async () => {
  const ids = target(
    "lesson-dry-course",
    "lesson-dry-module",
    "lesson-dry-session",
  );
  const reference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, ids.sessionId),
  );
  await reference.set(sessionData());
  const before = await reference.get();

  const result = await runLessonContentPublication(
    db,
    ids,
    "Proposed lesson text.",
    false,
  );

  assert.deepEqual(result.inspection, {
    currentState: "ABSENT",
    currentCharacterCount: null,
    proposedCharacterCount: 21,
    changeRequired: true,
  });
  assert.equal(result.writeNecessary, false);
  assert.equal(result.verified, false);
  const afterSnapshot = await reference.get();
  assert.deepEqual(afterSnapshot.data(), before.data());
  assert.equal(before.updateTime?.isEqual(afterSnapshot.updateTime!), true);
});

test("apply updates only lessonText and preserves exact Session isolation", async () => {
  const ids = target(
    "lesson-apply-course",
    "lesson-apply-module",
    "lesson-apply-session",
  );
  const reference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, ids.sessionId),
  );
  const siblingReference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, "lesson-sibling-session"),
  );
  const otherModuleReference = db.doc(
    sessionPath(ids.courseId, "lesson-other-module", ids.sessionId),
  );
  const otherCourseReference = db.doc(
    sessionPath("lesson-other-course", ids.moduleId, ids.sessionId),
  );
  const initial = sessionData({ lessonText: "Previous lesson text." });
  await Promise.all([
    reference.set(initial),
    siblingReference.set(sessionData({ lessonText: "Sibling text." })),
    otherModuleReference.set(sessionData({ lessonText: "Other module text." })),
    otherCourseReference.set(sessionData({ lessonText: "Other course text." })),
  ]);

  const result = await runLessonContentPublication(
    db,
    ids,
    "Updated lesson text.\n\nSecond paragraph.",
    true,
  );

  assert.equal(result.writeNecessary, true);
  assert.equal(result.verified, true);
  assert.deepEqual((await reference.get()).data(), {
    ...initial,
    lessonText: "Updated lesson text.\n\nSecond paragraph.",
  });
  assert.equal(
    (await siblingReference.get()).data()?.lessonText,
    "Sibling text.",
  );
  assert.equal(
    (await otherModuleReference.get()).data()?.lessonText,
    "Other module text.",
  );
  assert.equal(
    (await otherCourseReference.get()).data()?.lessonText,
    "Other course text.",
  );
});

test("missing Session fails without creating a document", async () => {
  const ids = target(
    "lesson-missing-course",
    "lesson-missing-module",
    "lesson-missing-session",
  );
  await assert.rejects(
    runLessonContentPublication(db, ids, "Valid lesson text.", true),
    /Session was not found/,
  );
  assert.equal(
    (await db.doc(sessionPath(ids.courseId, ids.moduleId, ids.sessionId)).get())
      .exists,
    false,
  );
});

test("malformed existing lessonText fails closed without mutation", async () => {
  const ids = target(
    "lesson-malformed-course",
    "lesson-malformed-module",
    "lesson-malformed-session",
  );
  const reference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, ids.sessionId),
  );
  await reference.set(sessionData({ lessonText: "   " }));
  const before = await reference.get();

  await assert.rejects(
    runLessonContentPublication(db, ids, "Valid lesson text.", true),
    /Existing Session lessonText is malformed/,
  );

  const afterSnapshot = await reference.get();
  assert.deepEqual(afterSnapshot.data(), before.data());
  assert.equal(before.updateTime?.isEqual(afterSnapshot.updateTime!), true);
});

test("invalid proposed lessonText fails before mutation", async () => {
  const ids = target(
    "lesson-invalid-course",
    "lesson-invalid-module",
    "lesson-invalid-session",
  );
  const reference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, ids.sessionId),
  );
  await reference.set(sessionData());
  const before = await reference.get();

  await assert.rejects(
    runLessonContentPublication(db, ids, " trailing ", true),
    /Lesson text/,
  );

  const afterSnapshot = await reference.get();
  assert.deepEqual(afterSnapshot.data(), before.data());
  assert.equal(before.updateTime?.isEqual(afterSnapshot.updateTime!), true);
});

test("no-op apply is idempotent and preserves update time", async () => {
  const ids = target(
    "lesson-noop-course",
    "lesson-noop-module",
    "lesson-noop-session",
  );
  const reference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, ids.sessionId),
  );
  await reference.set(sessionData({ lessonText: "Unchanged lesson text." }));
  const before = await reference.get();

  const result = await runLessonContentPublication(
    db,
    ids,
    "Unchanged lesson text.",
    true,
  );

  assert.equal(result.inspection.changeRequired, false);
  assert.equal(result.writeNecessary, false);
  assert.equal(result.verified, true);
  const afterSnapshot = await reference.get();
  assert.equal(before.updateTime?.isEqual(afterSnapshot.updateTime!), true);
});

test("review revision rejects stale apply without overwriting intervening Session changes", async () => {
  const ids = target(
    "lesson-stale-course",
    "lesson-stale-module",
    "lesson-stale-session",
  );
  const reference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, ids.sessionId),
  );
  await reference.set(
    sessionData({ publicationStatus: "draft", lessonText: "Original." }),
  );
  const reviewed = await reference.get();
  await reference.update({ title: "Changed after review" });
  await assert.rejects(
    runLessonContentPublication(
      db,
      ids,
      "Reviewed proposal.",
      true,
      reviewed.updateTime!.toMillis(),
    ),
    /changed after lesson review/,
  );
  assert.deepEqual((await reference.get()).data(), {
    ...sessionData({ publicationStatus: "draft", lessonText: "Original." }),
    title: "Changed after review",
  });
});

test("draft lesson apply preserves publication, release, video, discovery, and video access", async () => {
  const ids = target(
    "lesson-isolation-course",
    "lesson-isolation-module",
    "lesson-isolation-session",
  );
  const reference = db.doc(
    sessionPath(ids.courseId, ids.moduleId, ids.sessionId),
  );
  const discovery = db.doc(
    `courses/${ids.courseId}/modules/${ids.moduleId}/sessionDiscovery/visible`,
  );
  const access = reference.collection("videoAccess").doc("primary");
  const releaseAt = Timestamp.fromDate(new Date("2035-01-01T00:00:00.000Z"));
  await reference.set(
    sessionData({
      publicationStatus: "draft",
      releaseAt,
      videoAssetId: "asset",
    }),
  );
  await discovery.set({ sessionIds: ["other"] });
  await access.set({ videoAssetId: "asset", contentKey: "A".repeat(43) });
  const [discoveryBefore, accessBefore] = await db.getAll(discovery, access);
  await runLessonContentPublication(db, ids, "Draft lesson content.", true);
  assert.deepEqual((await reference.get()).data(), {
    ...sessionData({
      publicationStatus: "draft",
      releaseAt,
      videoAssetId: "asset",
    }),
    lessonText: "Draft lesson content.",
  });
  assert.equal(
    (await discovery.get()).updateTime?.isEqual(discoveryBefore.updateTime!),
    true,
  );
  assert.equal(
    (await access.get()).updateTime?.isEqual(accessBefore.updateTime!),
    true,
  );
});
