import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  resolveModuleCreationProject,
  runModuleCreationService,
  type ModuleCreationOptions,
} from "../src/tooling/moduleCreation.js";

const PROJECT_ID = "demo-at-in-physics";
const app = initializeApp(
  { projectId: PROJECT_ID },
  "module-creation-integration-tests",
);
let auth: Auth;
let db: Firestore;
let ownerUid: string;
let nonOwnerUid: string;

const courseData = (
  courseId: string,
  status: "draft" | "published" = "draft",
) => ({
  slug: courseId,
  title: `Course ${courseId}`,
  shortDescription: `Description for ${courseId}.`,
  status,
});

const options = (
  courseId: string,
  moduleId: string,
  apply: boolean,
): ModuleCreationOptions => ({
  courseId,
  moduleId,
  title: `Module ${moduleId}`,
  order: 0,
  apply,
});

before(async () => {
  assert.equal(resolveModuleCreationProject(process.env), PROJECT_ID);
  if (
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST
  )
    throw new Error(
      "Module creation integration requires Auth and Firestore emulators.",
    );
  auth = getAuth(app);
  db = getFirestore(app);
  ownerUid = (await auth.createUser({ email: "module-owner@example.test" }))
    .uid;
  nonOwnerUid = (
    await auth.createUser({ email: "module-non-owner@example.test" })
  ).uid;
  await auth.setCustomUserClaims(ownerUid, { owner: true });
});

after(async () => deleteApp(app));

async function seedCourse(courseId: string, data = courseData(courseId)) {
  await db.doc(`courses/${courseId}`).set(data);
}

test("missing/non-owner Auth users and missing Course fail with zero writes", async () => {
  await seedCourse("authority-course");
  await assert.rejects(
    runModuleCreationService(
      auth,
      db,
      options("authority-course", "missing-owner-module", true),
      "missing-owner",
    ),
    /Auth user was not found/,
  );
  await assert.rejects(
    runModuleCreationService(
      auth,
      db,
      options("authority-course", "non-owner-module", true),
      nonOwnerUid,
    ),
    /does not have owner authority/,
  );
  await assert.rejects(
    runModuleCreationService(
      auth,
      db,
      options("missing-course", "module", true),
      ownerUid,
    ),
    /Parent Course was not found/,
  );
  for (const path of [
    "courses/authority-course/modules/missing-owner-module",
    "courses/authority-course/modules/non-owner-module",
    "courses/missing-course/modules/module",
  ])
    assert.equal((await db.doc(path).get()).exists, false);
});

test("malformed parent Course fails closed for draft preparation", async () => {
  for (const [courseId, data] of [
    ["bad-slug-course", { ...courseData("bad-slug-course"), slug: "other" }],
    [
      "bad-status-course",
      { ...courseData("bad-status-course"), status: "hidden" },
    ],
    ["extra-course", { ...courseData("extra-course"), extra: true }],
  ] as const) {
    await seedCourse(courseId, data as never);
    await assert.rejects(
      runModuleCreationService(
        auth,
        db,
        options(courseId, "module", true),
        ownerUid,
      ),
      /Parent Course is malformed/,
    );
    assert.equal(
      (await db.doc(`courses/${courseId}/modules/module`).get()).exists,
      false,
    );
  }
});

test("dry run validates draft Course and performs zero writes", async () => {
  const courseId = "dry-run-module-course";
  await seedCourse(courseId);
  const result = await runModuleCreationService(
    auth,
    db,
    options(courseId, "dry-run-module", false),
    ownerUid,
  );
  assert.equal(result.modulePath, `courses/${courseId}/modules/dry-run-module`);
  assert.equal(result.changeRequired, true);
  assert.equal(result.applyStatus, null);
  assert.equal((await db.doc(result.modulePath).get()).exists, false);
});

test("apply creates exact Module, preserves parent, verifies, and retries idempotently", async () => {
  const courseId = "apply-module-course";
  const moduleId = "created-module";
  await seedCourse(courseId, courseData(courseId, "published"));
  const courseReference = db.doc(`courses/${courseId}`);
  const parentBefore = await courseReference.get();
  const input = options(courseId, moduleId, true);
  const first = await runModuleCreationService(auth, db, input, ownerUid);
  assert.equal(first.applyStatus, "created");
  assert.equal(first.postApplyVerified, true);
  const moduleReference = db.doc(first.modulePath);
  assert.deepEqual((await moduleReference.get()).data(), {
    title: input.title,
    order: 0,
  });
  const parentAfter = await courseReference.get();
  assert.deepEqual(parentAfter.data(), parentBefore.data());
  assert.equal(parentAfter.updateTime?.isEqual(parentBefore.updateTime!), true);
  const moduleBeforeRetry = await moduleReference.get();
  const second = await runModuleCreationService(auth, db, input, ownerUid);
  assert.equal(second.applyStatus, "already-exists");
  assert.equal(second.postApplyVerified, true);
  assert.equal(
    (await moduleReference.get()).updateTime?.isEqual(
      moduleBeforeRetry.updateTime!,
    ),
    true,
  );
});

test("conflicting and malformed Modules fail without overwrite", async () => {
  const courseId = "conflict-module-course";
  await seedCourse(courseId);
  for (const [moduleId, fixture] of [
    ["conflicting-module", { title: "Existing", order: 4 }],
    ["malformed-module", { title: "Existing", order: -1, extra: true }],
  ] as const) {
    const reference = db.doc(`courses/${courseId}/modules/${moduleId}`);
    await reference.set(fixture);
    const before = await reference.get();
    await assert.rejects(
      runModuleCreationService(
        auth,
        db,
        options(courseId, moduleId, true),
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

test("creation is isolated across Courses and creates no Session discovery state", async () => {
  const courseId = "isolation-module-course";
  const otherCourseId = "other-isolation-module-course";
  await Promise.all([seedCourse(courseId), seedCourse(otherCourseId)]);
  const otherModule = db.doc(`courses/${otherCourseId}/modules/shared-module`);
  await otherModule.set({ title: "Preserved", order: 2 });
  const otherBefore = await otherModule.get();
  await runModuleCreationService(
    auth,
    db,
    options(courseId, "shared-module", true),
    ownerUid,
  );
  assert.deepEqual((await otherModule.get()).data(), otherBefore.data());
  assert.equal(
    (await otherModule.get()).updateTime?.isEqual(otherBefore.updateTime!),
    true,
  );
  assert.equal(
    (
      await db
        .doc(
          `courses/${courseId}/modules/shared-module/sessionDiscovery/visible`,
        )
        .get()
    ).exists,
    false,
  );
  assert.equal(
    (
      await db
        .collection(`courses/${courseId}/modules/shared-module/sessions`)
        .get()
    ).empty,
    true,
  );
});
