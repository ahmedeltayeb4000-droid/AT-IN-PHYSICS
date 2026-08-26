import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  resolveCourseCreationProject,
  runCourseCreationService,
  type CourseCreationOptions,
} from "../src/tooling/courseCreation.js";

const PROJECT_ID = "demo-at-in-physics";
const app = initializeApp(
  { projectId: PROJECT_ID },
  "course-creation-integration-tests",
);
let auth: Auth;
let db: Firestore;
let ownerUid: string;
let nonOwnerUid: string;

function options(courseId: string, apply: boolean): CourseCreationOptions {
  return {
    courseId,
    title: `Title ${courseId}`,
    shortDescription: `Description ${courseId}.`,
    apply,
  };
}

before(async () => {
  assert.equal(resolveCourseCreationProject(process.env), PROJECT_ID);
  if (
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST
  )
    throw new Error(
      "Course creation integration requires Auth and Firestore emulators.",
    );
  auth = getAuth(app);
  db = getFirestore(app);
  ownerUid = (await auth.createUser({ email: "course-owner@example.test" }))
    .uid;
  nonOwnerUid = (
    await auth.createUser({ email: "course-non-owner@example.test" })
  ).uid;
  await auth.setCustomUserClaims(ownerUid, { owner: true });
});

after(async () => deleteApp(app));

test("dry run validates owner and reports deterministic path with zero writes", async () => {
  const result = await runCourseCreationService(
    auth,
    db,
    options("dry-run-course", false),
    ownerUid,
  );
  assert.equal(result.coursePath, "courses/dry-run-course");
  assert.equal(result.changeRequired, true);
  assert.equal(result.applyStatus, null);
  assert.equal((await db.doc(result.coursePath).get()).exists, false);
});

test("apply creates exact draft state, verifies it, and identical retry is a no-op", async () => {
  const input = options("created-course", true);
  const first = await runCourseCreationService(auth, db, input, ownerUid);
  assert.equal(first.applyStatus, "created");
  assert.equal(first.postApplyVerified, true);
  const reference = db.doc(first.coursePath);
  assert.deepEqual((await reference.get()).data(), {
    slug: input.courseId,
    title: input.title,
    shortDescription: input.shortDescription,
    status: "draft",
  });
  const before = await reference.get();
  const second = await runCourseCreationService(auth, db, input, ownerUid);
  assert.equal(second.applyStatus, "already-exists");
  assert.equal(second.postApplyVerified, true);
  assert.equal(
    (await reference.get()).updateTime?.isEqual(before.updateTime!),
    true,
  );
});

test("non-owner and missing Auth user are rejected with zero writes", async () => {
  await assert.rejects(
    runCourseCreationService(
      auth,
      db,
      options("non-owner-course", true),
      nonOwnerUid,
    ),
    /does not have owner authority/,
  );
  await assert.rejects(
    runCourseCreationService(
      auth,
      db,
      options("missing-owner-course", true),
      "missing-owner",
    ),
    /Auth user was not found/,
  );
  assert.equal((await db.doc("courses/non-owner-course").get()).exists, false);
  assert.equal(
    (await db.doc("courses/missing-owner-course").get()).exists,
    false,
  );
});

test("conflicting Course is rejected without overwrite", async () => {
  const reference = db.doc("courses/conflicting-course");
  const fixture = {
    slug: "conflicting-course",
    title: "Existing",
    shortDescription: "Existing data.",
    status: "published",
    extra: "preserve",
  };
  await reference.set(fixture);
  const before = await reference.get();
  await assert.rejects(
    runCourseCreationService(
      auth,
      db,
      options("conflicting-course", true),
      ownerUid,
    ),
    /conflicts/,
  );
  assert.deepEqual((await reference.get()).data(), fixture);
  assert.equal(
    (await reference.get()).updateTime?.isEqual(before.updateTime!),
    true,
  );
});

test("creation is isolated from other Courses", async () => {
  const other = db.doc("courses/isolation-existing");
  await other.set({ preserved: true });
  const before = await other.get();
  await runCourseCreationService(
    auth,
    db,
    options("isolation-created", true),
    ownerUid,
  );
  assert.deepEqual((await other.get()).data(), { preserved: true });
  assert.equal(
    (await other.get()).updateTime?.isEqual(before.updateTime!),
    true,
  );
});
