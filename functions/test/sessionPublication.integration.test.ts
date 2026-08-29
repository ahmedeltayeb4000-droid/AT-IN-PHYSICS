import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import {
  resolveSessionPublicationProject,
  runSessionPublicationService,
  type SessionPublicationOptions,
} from "../src/tooling/sessionPublication.js";
import {
  applySessionFreeStatus,
  reviewSessionFreeStatus,
} from "../src/ownerConsole/sessionFreeStatus.js";

const PROJECT_ID = "demo-at-in-physics";
const NOW = new Date("2030-01-01T00:00:00.000Z");
const CONTENT_KEY = "A".repeat(43);
const app = initializeApp(
  { projectId: PROJECT_ID },
  "session-publication-integration-tests",
);
let auth: Auth;
let db: Firestore;
let ownerUid: string;
let nonOwnerUid: string;

const courseData = (id: string) => ({
  slug: id,
  title: `Course ${id}`,
  shortDescription: `Description ${id}.`,
  status: "draft",
});
const moduleData = (title = "Module", order = 0) => ({ title, order });
const sessionData = (overrides: Record<string, unknown> = {}) => ({
  title: "Session",
  order: 0,
  publicationStatus: "draft",
  ...overrides,
});
const options = (
  courseId: string,
  moduleId: string,
  sessionId: string,
  apply: boolean,
): SessionPublicationOptions => ({ courseId, moduleId, sessionId, apply });

before(async () => {
  assert.equal(resolveSessionPublicationProject(process.env), PROJECT_ID);
  if (
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST
  )
    throw new Error(
      "Session publication integration requires Auth and Firestore emulators.",
    );
  auth = getAuth(app);
  db = getFirestore(app);
  ownerUid = (
    await auth.createUser({ email: "publication-owner@example.test" })
  ).uid;
  nonOwnerUid = (
    await auth.createUser({ email: "publication-non-owner@example.test" })
  ).uid;
  await auth.setCustomUserClaims(ownerUid, { owner: true });
});
after(async () => deleteApp(app));

async function seed(
  courseId: string,
  moduleId: string,
  sessionId: string,
  session: Record<string, unknown> = sessionData(),
) {
  await db.doc(`courses/${courseId}`).set(courseData(courseId));
  await db.doc(`courses/${courseId}/modules/${moduleId}`).set(moduleData());
  await db
    .doc(`courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`)
    .set(session);
}

test("authority and missing hierarchy failures perform zero publication writes", async () => {
  await seed("authority-pub-course", "module", "session");
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("authority-pub-course", "module", "session", true),
      "missing-owner",
      NOW,
    ),
    /Auth user was not found/,
  );
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("authority-pub-course", "module", "session", true),
      nonOwnerUid,
      NOW,
    ),
    /does not have owner authority/,
  );
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("missing-pub-course", "module", "session", true),
      ownerUid,
      NOW,
    ),
    /Parent Course was not found/,
  );
  await db
    .doc("courses/missing-pub-module-course")
    .set(courseData("missing-pub-module-course"));
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("missing-pub-module-course", "module", "session", true),
      ownerUid,
      NOW,
    ),
    /Parent Module was not found/,
  );
  await db
    .doc("courses/missing-pub-session-course")
    .set(courseData("missing-pub-session-course"));
  await db
    .doc("courses/missing-pub-session-course/modules/module")
    .set(moduleData());
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("missing-pub-session-course", "module", "session", true),
      ownerUid,
      NOW,
    ),
    /Session was not found/,
  );
  assert.equal(
    (
      await db
        .doc("courses/authority-pub-course/modules/module/sessions/session")
        .get()
    ).data()?.publicationStatus,
    "draft",
  );
});

test("malformed Course, Module, Session, and manifest fail closed", async () => {
  await seed("bad-pub-course", "module", "session");
  await db
    .doc("courses/bad-pub-course")
    .set({ ...courseData("bad-pub-course"), extra: true });
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("bad-pub-course", "module", "session", true),
      ownerUid,
      NOW,
    ),
    /Parent Course is malformed/,
  );
  await seed("bad-pub-module-course", "module", "session");
  await db
    .doc("courses/bad-pub-module-course/modules/module")
    .set({ title: "Module", order: -1 });
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("bad-pub-module-course", "module", "session", true),
      ownerUid,
      NOW,
    ),
    /Parent Module is malformed/,
  );
  await seed(
    "bad-pub-session-course",
    "module",
    "session",
    sessionData({ publicationStatus: "preview" }),
  );
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("bad-pub-session-course", "module", "session", true),
      ownerUid,
      NOW,
    ),
    /Existing Session is malformed/,
  );
  await seed("bad-pub-manifest-course", "module", "session");
  await db
    .doc(
      "courses/bad-pub-manifest-course/modules/module/sessionDiscovery/visible",
    )
    .set({ sessionIds: ["duplicate", "duplicate"] });
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options("bad-pub-manifest-course", "module", "session", true),
      ownerUid,
      NOW,
    ),
    /manifest is malformed/,
  );
  assert.equal(
    (
      await db
        .doc("courses/bad-pub-manifest-course/modules/module/sessions/session")
        .get()
    ).data()?.publicationStatus,
    "draft",
  );
});

test("dry run classifies content and manifest but performs zero writes", async () => {
  const courseId = "dry-publication-course";
  await seed(
    courseId,
    "module",
    "session",
    sessionData({ lessonText: "Lesson text." }),
  );
  const sessionRef = db.doc(
    `courses/${courseId}/modules/module/sessions/session`,
  );
  const before = await sessionRef.get();
  const result = await runSessionPublicationService(
    auth,
    db,
    options(courseId, "module", "session", false),
    ownerUid,
    NOW,
  );
  assert.equal(result.contentReadiness, "LESSON");
  assert.equal(result.currentDiscoveryState, "MISSING");
  assert.deepEqual(result.proposedSessionIds, ["session"]);
  assert.equal(
    (await sessionRef.get()).updateTime?.isEqual(before.updateTime!),
    true,
  );
  assert.equal(
    (
      await db
        .doc(`courses/${courseId}/modules/module/sessionDiscovery/visible`)
        .get()
    ).exists,
    false,
  );
});

test("apply atomically publishes, preserves optional/parent state, creates discovery, and creates no video access", async () => {
  const courseId = "apply-publication-course";
  const moduleId = "module";
  const sessionId = "target";
  const releaseAt = Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z"));
  await seed(
    courseId,
    moduleId,
    sessionId,
    sessionData({
      lessonText: "Lesson text.",
      releaseAt,
      futureField: { preserved: true },
    }),
  );
  const courseRef = db.doc(`courses/${courseId}`);
  const moduleRef = db.doc(`courses/${courseId}/modules/${moduleId}`);
  const [courseBefore, moduleBefore] = await db.getAll(courseRef, moduleRef);
  const result = await runSessionPublicationService(
    auth,
    db,
    options(courseId, moduleId, sessionId, true),
    ownerUid,
    NOW,
  );
  assert.equal(result.applyStatus, "published");
  assert.equal(result.postApplyVerified, true);
  assert.deepEqual((await db.doc(result.sessionPath).get()).data(), {
    title: "Session",
    order: 0,
    publicationStatus: "published",
    lessonText: "Lesson text.",
    releaseAt,
    futureField: { preserved: true },
  });
  assert.deepEqual(
    (
      await db
        .doc(`courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`)
        .get()
    ).data(),
    { sessionIds: [sessionId] },
  );
  assert.equal(
    (await courseRef.get()).updateTime?.isEqual(courseBefore.updateTime!),
    true,
  );
  assert.equal(
    (await moduleRef.get()).updateTime?.isEqual(moduleBefore.updateTime!),
    true,
  );
  assert.equal(
    (await db.doc(`${result.sessionPath}/videoAccess/primary`).get()).exists,
    false,
  );
});

test("future release remains undiscovered while multiple released Sessions order deterministically", async () => {
  const courseId = "ordered-publication-course";
  const moduleId = "module";
  await seed(
    courseId,
    moduleId,
    "future",
    sessionData({
      order: 0,
      releaseAt: Timestamp.fromDate(new Date("2031-01-01T00:00:00.000Z")),
    }),
  );
  const collection = db.collection(
    `courses/${courseId}/modules/${moduleId}/sessions`,
  );
  await collection
    .doc("z-tie")
    .set(sessionData({ order: 1, publicationStatus: "published" }));
  await collection
    .doc("a-tie")
    .set(sessionData({ order: 1, publicationStatus: "published" }));
  await collection.doc("draft").set(sessionData({ order: 0 }));
  const result = await runSessionPublicationService(
    auth,
    db,
    options(courseId, moduleId, "future", true),
    ownerUid,
    NOW,
  );
  assert.equal(result.releaseState, "SCHEDULED");
  assert.deepEqual(
    (
      await db
        .doc(`courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`)
        .get()
    ).data(),
    { sessionIds: ["a-tie", "z-tie"] },
  );
  assert.equal(
    (await collection.doc("future").get()).data()?.publicationStatus,
    "published",
  );
});

test("published Sessions reconcile stale discovery and repeated publication is idempotent", async () => {
  const courseId = "reconcile-publication-course";
  await seed(
    courseId,
    "module",
    "target",
    sessionData({ publicationStatus: "published" }),
  );
  await db
    .doc(`courses/${courseId}/modules/module/sessions/draft`)
    .set(sessionData({ order: 1 }));
  const manifestRef = db.doc(
    `courses/${courseId}/modules/module/sessionDiscovery/visible`,
  );
  await manifestRef.set({ sessionIds: ["draft"] });
  const first = await runSessionPublicationService(
    auth,
    db,
    options(courseId, "module", "target", true),
    ownerUid,
    NOW,
  );
  assert.equal(first.applyStatus, "reconciled");
  assert.deepEqual((await manifestRef.get()).data(), {
    sessionIds: ["target"],
  });
  const sessionRef = db.doc(
    `courses/${courseId}/modules/module/sessions/target`,
  );
  const [sessionBefore, manifestBefore] = await db.getAll(
    sessionRef,
    manifestRef,
  );
  const second = await runSessionPublicationService(
    auth,
    db,
    options(courseId, "module", "target", true),
    ownerUid,
    NOW,
  );
  assert.equal(second.applyStatus, "already-current");
  assert.equal(
    (await sessionRef.get()).updateTime?.isEqual(sessionBefore.updateTime!),
    true,
  );
  assert.equal(
    (await manifestRef.get()).updateTime?.isEqual(manifestBefore.updateTime!),
    true,
  );
});

test("video binding is validated without mutation and cross-hierarchy documents remain isolated", async () => {
  const courseId = "video-publication-course";
  await seed(
    courseId,
    "module",
    "target",
    sessionData({ videoAssetId: "target-video" }),
  );
  const targetRef = db.doc(
    `courses/${courseId}/modules/module/sessions/target`,
  );
  await assert.rejects(
    runSessionPublicationService(
      auth,
      db,
      options(courseId, "module", "target", true),
      ownerUid,
      NOW,
    ),
    /binding is incomplete/,
  );
  const accessRef = db.doc(`${targetRef.path}/videoAccess/primary`);
  await accessRef.set({
    videoAssetId: "target-video",
    contentKey: CONTENT_KEY,
  });
  await seed(
    "other-publication-course",
    "module",
    "target",
    sessionData({ publicationStatus: "published" }),
  );
  await db
    .doc(`courses/${courseId}/modules/other-module`)
    .set(moduleData("Other", 2));
  await db
    .doc(`courses/${courseId}/modules/other-module/sessions/target`)
    .set(sessionData({ publicationStatus: "published" }));
  const otherCourse = db.doc(
    "courses/other-publication-course/modules/module/sessions/target",
  );
  const otherModule = db.doc(
    `courses/${courseId}/modules/other-module/sessions/target`,
  );
  const [accessBefore, otherCourseBefore, otherModuleBefore] = await db.getAll(
    accessRef,
    otherCourse,
    otherModule,
  );
  await runSessionPublicationService(
    auth,
    db,
    options(courseId, "module", "target", true),
    ownerUid,
    NOW,
  );
  assert.equal(
    (await accessRef.get()).updateTime?.isEqual(accessBefore.updateTime!),
    true,
  );
  assert.equal(
    (await otherCourse.get()).updateTime?.isEqual(
      otherCourseBefore.updateTime!,
    ),
    true,
  );
  assert.equal(
    (await otherModule.get()).updateTime?.isEqual(
      otherModuleBefore.updateTime!,
    ),
    true,
  );
});

test("trusted Free/Paid change validates hierarchy, revision, and atomically refreshes the public projection", async () => {
  const courseId = "free-status-course";
  const moduleId = "module";
  const sessionId = "sample";
  await seed(courseId, moduleId, sessionId, sessionData({
    title: "Free Sample",
    publicationStatus: "published",
  }));
  const target = { courseId, moduleId, sessionId };
  const freeReview = await reviewSessionFreeStatus(db, target, true);
  assert.equal(freeReview.currentIsFree, false);
  await applySessionFreeStatus(db, freeReview, NOW);
  const sessionRef = db.doc(`courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`);
  const freeRef = db.doc(`courses/${courseId}/modules/${moduleId}/sessionDiscovery/free`);
  assert.equal((await sessionRef.get()).data()?.isFree, true);
  assert.deepEqual((await freeRef.get()).data(), {
    sessions: [{ id: sessionId, title: "Free Sample", order: 0 }],
  });
  const paidReview = await reviewSessionFreeStatus(db, target, false);
  await applySessionFreeStatus(db, paidReview, NOW);
  assert.equal((await sessionRef.get()).data()?.isFree, false);
  assert.deepEqual((await freeRef.get()).data(), { sessions: [] });
  const stale = await reviewSessionFreeStatus(db, target, true);
  await sessionRef.update({ title: "Changed after review" });
  await assert.rejects(applySessionFreeStatus(db, stale, NOW), /changed after review/);
});
