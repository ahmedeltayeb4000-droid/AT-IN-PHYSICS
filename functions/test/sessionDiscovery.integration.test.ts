import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { refreshSessionDiscoveryManifest } from "../src/sessionDiscovery/refreshSessionDiscovery.js";

const PROJECT_ID = "demo-at-in-physics";
const NOW = new Date("2030-01-01T00:00:00.000Z");
let app: App;
let db: Firestore;

function requireEmulatorSafety() {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (projectId !== PROJECT_ID || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Session discovery integration tests require the demo Firestore emulator.",
    );
  }
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

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    title: "Session",
    order: 1,
    publicationStatus: "published",
    ...overrides,
  };
}

before(() => {
  requireEmulatorSafety();
  app = initializeApp({ projectId: PROJECT_ID }, "session-discovery-tests");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

test("refresh derives and writes only visible Sessions for the exact Module", async () => {
  const courseId = "refresh-course";
  const moduleId = "refresh-module";
  await seedModule(courseId, moduleId, {
    unscheduled: sessionData({ order: 2 }),
    released: sessionData({
      order: 1,
      releaseAt: Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z")),
    }),
    future: sessionData({
      order: 3,
      releaseAt: Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z")),
    }),
    draft: sessionData({ order: 4, publicationStatus: "draft" }),
    malformed: sessionData({ order: 5, releaseAt: null }),
    "missing-status": { title: "Missing status", order: 6 },
    "malformed-status": sessionData({
      order: 7,
      publicationStatus: "preview",
    }),
    "malformed-release": sessionData({
      order: 8,
      releaseAt: "2029-01-01T00:00:00.000Z",
    }),
  });
  await seedModule(courseId, "sibling-module", {
    sibling: sessionData(),
  });
  await seedModule("other-course", "other-module", {
    unrelated: sessionData(),
  });

  const result = await refreshSessionDiscoveryManifest(
    db,
    { courseId, moduleId },
    NOW,
  );
  assert.deepEqual(result, {
    courseId,
    moduleId,
    discoveredCount: 2,
    writeNecessary: true,
  });

  const manifest = await db
    .doc(
      `courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`,
    )
    .get();
  assert.deepEqual(manifest.data(), {
    sessionIds: ["released", "unscheduled"],
  });
  assert.equal(
    (
      await db
        .doc(
          `courses/${courseId}/modules/sibling-module/sessionDiscovery/visible`,
        )
        .get()
    ).exists,
    false,
  );
  assert.equal(
    (
      await db
        .doc(
          "courses/other-course/modules/other-module/sessionDiscovery/visible",
        )
        .get()
    ).exists,
    false,
  );
  assert.equal(
    (
      await db
        .collection(`courses/${courseId}/modules/${moduleId}/sessions`)
        .get()
    ).size,
    8,
  );
});

test("unchanged refresh is idempotent", async () => {
  const courseId = "idempotent-course";
  const moduleId = "idempotent-module";
  await seedModule(courseId, moduleId, { visible: sessionData() });

  const first = await refreshSessionDiscoveryManifest(
    db,
    { courseId, moduleId },
    NOW,
  );
  const reference = db.doc(
    `courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`,
  );
  const firstUpdateTime = (await reference.get()).updateTime;
  const second = await refreshSessionDiscoveryManifest(
    db,
    { courseId, moduleId },
    NOW,
  );
  const secondUpdateTime = (await reference.get()).updateTime;

  assert.equal(first.writeNecessary, true);
  assert.equal(second.writeNecessary, false);
  assert.equal(firstUpdateTime?.isEqual(secondUpdateTime!), true);
});

test("refresh updates the manifest after Session visibility changes", async () => {
  const courseId = "visibility-course";
  const moduleId = "visibility-module";
  const sessionReference = db.doc(
    `courses/${courseId}/modules/${moduleId}/sessions/scheduled`,
  );
  await seedModule(courseId, moduleId, {
    scheduled: sessionData({
      releaseAt: Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z")),
    }),
  });

  const initial = await refreshSessionDiscoveryManifest(
    db,
    { courseId, moduleId },
    NOW,
  );
  assert.equal(initial.discoveredCount, 0);

  await sessionReference.update({
    releaseAt: Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z")),
  });
  const updated = await refreshSessionDiscoveryManifest(
    db,
    { courseId, moduleId },
    NOW,
  );
  assert.deepEqual(updated, {
    courseId,
    moduleId,
    discoveredCount: 1,
    writeNecessary: true,
  });
  assert.deepEqual(
    (
      await db
        .doc(
          `courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`,
        )
        .get()
    ).data(),
    { sessionIds: ["scheduled"] },
  );
});

test("empty visible set persists an empty manifest", async () => {
  const courseId = "empty-course";
  const moduleId = "empty-module";
  await seedModule(courseId, moduleId, {
    draft: sessionData({ publicationStatus: "draft" }),
  });

  const result = await refreshSessionDiscoveryManifest(
    db,
    { courseId, moduleId },
    NOW,
  );
  assert.equal(result.discoveredCount, 0);
  assert.deepEqual(
    (
      await db
        .doc(
          `courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`,
        )
        .get()
    ).data(),
    { sessionIds: [] },
  );
});
