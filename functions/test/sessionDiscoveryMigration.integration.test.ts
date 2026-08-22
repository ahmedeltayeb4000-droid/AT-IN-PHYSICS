import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { runSessionDiscoveryMigration } from "../src/tooling/sessionDiscoveryMigration.js";

const PROJECT_ID = "demo-at-in-physics";
const NOW = new Date("2030-01-01T00:00:00.000Z");
let app: App;
let db: Firestore;

function requireEmulatorSafety() {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (projectId !== PROJECT_ID || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Session discovery migration tests require the demo Firestore emulator.",
    );
  }
}

function manifestPath(courseId: string, moduleId: string) {
  return `courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`;
}

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    title: "Session",
    order: 1,
    publicationStatus: "published",
    ...overrides,
  };
}

async function seedModule(
  courseId: string,
  moduleId: string,
  sessions: Readonly<Record<string, Record<string, unknown>>>,
) {
  const batch = db.batch();
  batch.set(db.doc(`courses/${courseId}`), {
    title: courseId,
    status: "published",
  });
  batch.set(db.doc(`courses/${courseId}/modules/${moduleId}`), {
    title: moduleId,
    order: 1,
  });
  for (const [sessionId, data] of Object.entries(sessions)) {
    batch.set(
      db.doc(`courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`),
      data,
    );
  }
  await batch.commit();
}

before(() => {
  requireEmulatorSafety();
  app = initializeApp({ projectId: PROJECT_ID }, "session-discovery-migration-tests");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

test("dry run derives canonical visibility and ordering with zero writes", async () => {
  const courseId = "migration-dry-course";
  const moduleId = "migration-dry-module";
  await seedModule(courseId, moduleId, {
    unscheduled: sessionData({ order: 2 }),
    released: sessionData({
      order: 1,
      releaseAt: Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z")),
    }),
    "released-tie": sessionData({
      order: 1,
      releaseAt: Timestamp.fromDate(new Date("2029-06-01T00:00:00.000Z")),
    }),
    future: sessionData({
      order: 3,
      releaseAt: Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z")),
    }),
    draft: sessionData({ order: 4, publicationStatus: "draft" }),
  });
  const sourceReferences = [
    db.doc(`courses/${courseId}`),
    db.doc(`courses/${courseId}/modules/${moduleId}`),
    db.doc(
      `courses/${courseId}/modules/${moduleId}/sessions/unscheduled`,
    ),
  ];
  const sourceUpdateTimes = (await db.getAll(...sourceReferences)).map(
    (snapshot) => snapshot.updateTime,
  );

  const result = await runSessionDiscoveryMigration(
    db,
    { courseId, moduleId, apply: false },
    NOW,
  );

  assert.deepEqual(result.inspection.proposedManifest, {
    sessionIds: ["released", "released-tie", "unscheduled"],
  });
  assert.equal(result.inspection.currentManifestExists, false);
  assert.equal(result.inspection.changeRequired, true);
  assert.equal(result.writeNecessary, false);
  assert.equal(
    (await db.doc(manifestPath(courseId, moduleId)).get()).exists,
    false,
  );
  const sourceSnapshotsAfter = await db.getAll(...sourceReferences);
  sourceSnapshotsAfter.forEach((snapshot, index) => {
    assert.equal(
      sourceUpdateTimes[index]?.isEqual(snapshot.updateTime!),
      true,
    );
  });
});

test("dry run leaves an existing stale manifest unchanged", async () => {
  const courseId = "migration-stale-dry-course";
  const moduleId = "migration-stale-dry-module";
  await seedModule(courseId, moduleId, { current: sessionData() });
  const reference = db.doc(manifestPath(courseId, moduleId));
  await reference.set({ sessionIds: ["stale"] });
  const updateTime = (await reference.get()).updateTime;

  const result = await runSessionDiscoveryMigration(
    db,
    { courseId, moduleId, apply: false },
    NOW,
  );

  assert.equal(result.inspection.changeRequired, true);
  assert.deepEqual((await reference.get()).data(), { sessionIds: ["stale"] });
  assert.equal(updateTime?.isEqual((await reference.get()).updateTime!), true);
});

test("apply creates a missing manifest and verifies it", async () => {
  const courseId = "migration-create-course";
  const moduleId = "migration-create-module";
  await seedModule(courseId, moduleId, { visible: sessionData() });

  const result = await runSessionDiscoveryMigration(
    db,
    { courseId, moduleId, apply: true },
    NOW,
  );

  assert.equal(result.writeNecessary, true);
  assert.equal(result.verified, true);
  assert.deepEqual(
    (await db.doc(manifestPath(courseId, moduleId)).get()).data(),
    { sessionIds: ["visible"] },
  );
});

test("apply updates a stale manifest and preserves exact Module isolation", async () => {
  const courseId = "migration-update-course";
  const moduleId = "migration-update-module";
  const siblingModuleId = "migration-sibling-module";
  const otherCourseId = "migration-other-course";
  const otherModuleId = "migration-other-module";
  await seedModule(courseId, moduleId, { current: sessionData() });
  await seedModule(courseId, siblingModuleId, { sibling: sessionData() });
  await seedModule(otherCourseId, otherModuleId, { unrelated: sessionData() });
  const target = db.doc(manifestPath(courseId, moduleId));
  const sibling = db.doc(manifestPath(courseId, siblingModuleId));
  const unrelated = db.doc(manifestPath(otherCourseId, otherModuleId));
  await target.set({ sessionIds: ["stale"] });
  await sibling.set({ sessionIds: ["sibling-stale"] });
  await unrelated.set({ sessionIds: ["unrelated-stale"] });

  const result = await runSessionDiscoveryMigration(
    db,
    { courseId, moduleId, apply: true },
    NOW,
  );

  assert.equal(result.writeNecessary, true);
  assert.deepEqual((await target.get()).data(), { sessionIds: ["current"] });
  assert.deepEqual((await sibling.get()).data(), {
    sessionIds: ["sibling-stale"],
  });
  assert.deepEqual((await unrelated.get()).data(), {
    sessionIds: ["unrelated-stale"],
  });
});

test("apply is idempotent when the manifest is canonical", async () => {
  const courseId = "migration-idempotent-course";
  const moduleId = "migration-idempotent-module";
  await seedModule(courseId, moduleId, { visible: sessionData() });
  const reference = db.doc(manifestPath(courseId, moduleId));
  await reference.set({ sessionIds: ["visible"] });
  const updateTime = (await reference.get()).updateTime;

  const result = await runSessionDiscoveryMigration(
    db,
    { courseId, moduleId, apply: true },
    NOW,
  );

  assert.equal(result.inspection.changeRequired, false);
  assert.equal(result.writeNecessary, false);
  assert.equal(result.verified, true);
  assert.equal(updateTime?.isEqual((await reference.get()).updateTime!), true);
});

test("missing Course and Module fail without manifest writes", async () => {
  await assert.rejects(
    runSessionDiscoveryMigration(
      db,
      {
        courseId: "migration-missing-course",
        moduleId: "missing-module",
        apply: true,
      },
      NOW,
    ),
    /Course was not found/,
  );
  assert.equal(
    (
      await db
        .doc(manifestPath("migration-missing-course", "missing-module"))
        .get()
    ).exists,
    false,
  );

  const courseId = "migration-course-without-module";
  await db.doc(`courses/${courseId}`).set({ status: "published" });
  await assert.rejects(
    runSessionDiscoveryMigration(
      db,
      { courseId, moduleId: "missing-module", apply: true },
      NOW,
    ),
    /Module was not found/,
  );
  assert.equal(
    (await db.doc(manifestPath(courseId, "missing-module")).get()).exists,
    false,
  );
});

test("fatal malformed trusted Session data fails before manifest writes", async () => {
  const courseId = "migration-malformed-course";
  const moduleId = "migration-malformed-module";
  await seedModule(courseId, moduleId, {
    malformed: sessionData({ order: "first" }),
  });

  await assert.rejects(
    runSessionDiscoveryMigration(
      db,
      { courseId, moduleId, apply: true },
      NOW,
    ),
    /invalid order/,
  );
  assert.equal(
    (await db.doc(manifestPath(courseId, moduleId)).get()).exists,
    false,
  );
});
