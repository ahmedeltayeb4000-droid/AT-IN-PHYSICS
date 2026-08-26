import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  resolveSessionCreationProject,
  runSessionCreationService,
  type SessionCreationOptions,
} from "../src/tooling/sessionCreation.js";

const PROJECT_ID = "demo-at-in-physics";
const app = initializeApp(
  { projectId: PROJECT_ID },
  "session-creation-integration-tests",
);
let auth: Auth;
let db: Firestore;
let ownerUid: string;
let nonOwnerUid: string;

const courseData = (id: string, status: "draft" | "published" = "draft") => ({
  slug: id,
  title: `Course ${id}`,
  shortDescription: `Description for ${id}.`,
  status,
});
const moduleData = (title = "Module", order = 0) => ({ title, order });
const options = (
  courseId: string,
  moduleId: string,
  sessionId: string,
  apply: boolean,
): SessionCreationOptions => ({
  courseId,
  moduleId,
  sessionId,
  title: `Session ${sessionId}`,
  order: 0,
  apply,
});

before(async () => {
  assert.equal(resolveSessionCreationProject(process.env), PROJECT_ID);
  if (
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST
  )
    throw new Error(
      "Session creation integration requires Auth and Firestore emulators.",
    );
  auth = getAuth(app);
  db = getFirestore(app);
  ownerUid = (await auth.createUser({ email: "session-owner@example.test" }))
    .uid;
  nonOwnerUid = (
    await auth.createUser({ email: "session-non-owner@example.test" })
  ).uid;
  await auth.setCustomUserClaims(ownerUid, { owner: true });
});

after(async () => deleteApp(app));

async function seedHierarchy(
  courseId: string,
  moduleId: string,
  course: Record<string, unknown> = courseData(courseId),
  module: Record<string, unknown> = moduleData(),
) {
  await db.doc(`courses/${courseId}`).set(course);
  await db.doc(`courses/${courseId}/modules/${moduleId}`).set(module);
}

test("missing/non-owner Auth users and missing hierarchy fail with zero writes", async () => {
  await seedHierarchy("authority-course", "authority-module");
  await assert.rejects(
    runSessionCreationService(
      auth,
      db,
      options(
        "authority-course",
        "authority-module",
        "missing-owner-session",
        true,
      ),
      "missing-owner",
    ),
    /Auth user was not found/,
  );
  await assert.rejects(
    runSessionCreationService(
      auth,
      db,
      options(
        "authority-course",
        "authority-module",
        "non-owner-session",
        true,
      ),
      nonOwnerUid,
    ),
    /does not have owner authority/,
  );
  await assert.rejects(
    runSessionCreationService(
      auth,
      db,
      options("missing-course", "module", "session", true),
      ownerUid,
    ),
    /Parent Course was not found/,
  );
  await db
    .doc("courses/missing-module-course")
    .set(courseData("missing-module-course"));
  await assert.rejects(
    runSessionCreationService(
      auth,
      db,
      options("missing-module-course", "missing-module", "session", true),
      ownerUid,
    ),
    /Parent Module was not found/,
  );
  for (const path of [
    "courses/authority-course/modules/authority-module/sessions/missing-owner-session",
    "courses/authority-course/modules/authority-module/sessions/non-owner-session",
    "courses/missing-course/modules/module/sessions/session",
    "courses/missing-module-course/modules/missing-module/sessions/session",
  ])
    assert.equal((await db.doc(path).get()).exists, false);
});

test("malformed Course and Module fail closed", async () => {
  await seedHierarchy(
    "malformed-course",
    "module",
    { ...courseData("malformed-course"), extra: true },
    moduleData(),
  );
  await assert.rejects(
    runSessionCreationService(
      auth,
      db,
      options("malformed-course", "module", "session", true),
      ownerUid,
    ),
    /Parent Course is malformed/,
  );
  await seedHierarchy(
    "malformed-module-course",
    "module",
    courseData("malformed-module-course"),
    { title: "Module", order: -1, extra: true },
  );
  await assert.rejects(
    runSessionCreationService(
      auth,
      db,
      options("malformed-module-course", "module", "session", true),
      ownerUid,
    ),
    /Parent Module is malformed/,
  );
  assert.equal(
    (
      await db
        .doc("courses/malformed-course/modules/module/sessions/session")
        .get()
    ).exists,
    false,
  );
  assert.equal(
    (
      await db
        .doc("courses/malformed-module-course/modules/module/sessions/session")
        .get()
    ).exists,
    false,
  );
});

test("a Module under another Course cannot satisfy parent validation", async () => {
  await db
    .doc("courses/wrong-parent-course")
    .set(courseData("wrong-parent-course"));
  await seedHierarchy("module-owner-course", "shared-module");
  await assert.rejects(
    runSessionCreationService(
      auth,
      db,
      options("wrong-parent-course", "shared-module", "session", true),
      ownerUid,
    ),
    /Parent Module was not found/,
  );
  assert.equal(
    (
      await db
        .doc(
          "courses/wrong-parent-course/modules/shared-module/sessions/session",
        )
        .get()
    ).exists,
    false,
  );
});

test("dry run validates published hierarchy and creates zero writes", async () => {
  await seedHierarchy(
    "dry-session-course",
    "dry-session-module",
    courseData("dry-session-course", "published"),
  );
  const result = await runSessionCreationService(
    auth,
    db,
    options("dry-session-course", "dry-session-module", "dry-session", false),
    ownerUid,
  );
  assert.equal(result.changeRequired, true);
  assert.equal(result.applyStatus, null);
  assert.equal((await db.doc(result.sessionPath).get()).exists, false);
});

test("apply creates exact draft Session, preserves parents, verifies, and retries as no-op", async () => {
  const courseId = "apply-session-course";
  const moduleId = "apply-session-module";
  const sessionId = "created-session";
  await seedHierarchy(courseId, moduleId);
  const courseRef = db.doc(`courses/${courseId}`);
  const moduleRef = db.doc(`courses/${courseId}/modules/${moduleId}`);
  const [courseBefore, moduleBefore] = await db.getAll(courseRef, moduleRef);
  const input = options(courseId, moduleId, sessionId, true);
  const first = await runSessionCreationService(auth, db, input, ownerUid);
  assert.equal(first.applyStatus, "created");
  assert.equal(first.postApplyVerified, true);
  const sessionRef = db.doc(first.sessionPath);
  assert.deepEqual((await sessionRef.get()).data(), {
    title: input.title,
    order: 0,
    publicationStatus: "draft",
  });
  const [courseAfter, moduleAfter] = await db.getAll(courseRef, moduleRef);
  assert.equal(courseAfter.updateTime?.isEqual(courseBefore.updateTime!), true);
  assert.equal(moduleAfter.updateTime?.isEqual(moduleBefore.updateTime!), true);
  const sessionBeforeRetry = await sessionRef.get();
  const second = await runSessionCreationService(auth, db, input, ownerUid);
  assert.equal(second.applyStatus, "already-exists");
  assert.equal(
    (await sessionRef.get()).updateTime?.isEqual(
      sessionBeforeRetry.updateTime!,
    ),
    true,
  );
});

test("conflicting and malformed existing Sessions are preserved", async () => {
  const courseId = "conflict-session-course";
  const moduleId = "conflict-session-module";
  await seedHierarchy(courseId, moduleId);
  for (const [sessionId, fixture] of [
    [
      "conflicting-session",
      { title: "Existing", order: 2, publicationStatus: "published" },
    ],
    [
      "malformed-session",
      { title: "Existing", order: -1, publicationStatus: "draft", extra: true },
    ],
  ] as const) {
    const reference = db.doc(
      `courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`,
    );
    await reference.set(fixture);
    const before = await reference.get();
    await assert.rejects(
      runSessionCreationService(
        auth,
        db,
        options(courseId, moduleId, sessionId, true),
        ownerUid,
      ),
      /conflicts/,
    );
    assert.deepEqual((await reference.get()).data(), fixture);
    assert.equal(
      (await reference.get()).updateTime?.isEqual(before.updateTime!),
      true,
    );
  }
});

test("creation is isolated across Courses and Modules and exposes no discovery or video access", async () => {
  const courseId = "isolation-session-course";
  const moduleId = "target-module";
  const otherModuleId = "other-module";
  const otherCourseId = "other-isolation-session-course";
  await seedHierarchy(courseId, moduleId);
  await db
    .doc(`courses/${courseId}/modules/${otherModuleId}`)
    .set(moduleData("Other", 1));
  await seedHierarchy(otherCourseId, moduleId);
  const sibling = db.doc(
    `courses/${courseId}/modules/${otherModuleId}/sessions/shared-session`,
  );
  const otherCourse = db.doc(
    `courses/${otherCourseId}/modules/${moduleId}/sessions/shared-session`,
  );
  const discovery = db.doc(
    `courses/${courseId}/modules/${moduleId}/sessionDiscovery/visible`,
  );
  await sibling.set({
    title: "Sibling",
    order: 1,
    publicationStatus: "published",
  });
  await otherCourse.set({
    title: "Other",
    order: 1,
    publicationStatus: "published",
  });
  await discovery.set({ sessionIds: ["preserved-session"] });
  const [siblingBefore, otherBefore, discoveryBefore] = await db.getAll(
    sibling,
    otherCourse,
    discovery,
  );
  await runSessionCreationService(
    auth,
    db,
    options(courseId, moduleId, "shared-session", true),
    ownerUid,
  );
  const [siblingAfter, otherAfter, discoveryAfter] = await db.getAll(
    sibling,
    otherCourse,
    discovery,
  );
  assert.equal(
    siblingAfter.updateTime?.isEqual(siblingBefore.updateTime!),
    true,
  );
  assert.equal(otherAfter.updateTime?.isEqual(otherBefore.updateTime!), true);
  assert.equal(
    discoveryAfter.updateTime?.isEqual(discoveryBefore.updateTime!),
    true,
  );
  assert.deepEqual(discoveryAfter.data(), {
    sessionIds: ["preserved-session"],
  });
  assert.equal(
    (
      await db
        .doc(
          `courses/${courseId}/modules/${moduleId}/sessions/shared-session/videoAccess/primary`,
        )
        .get()
    ).exists,
    false,
  );
});
