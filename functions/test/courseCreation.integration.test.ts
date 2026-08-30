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
import {
  applyCoursePublication,
  reviewCoursePublication,
  safeCoursePublicationReview,
} from "../src/ownerConsole/coursePublication.js";

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

test("Course publication review is zero-write and apply changes only status", async () => {
  const courseId = "publication-course";
  const courseRef = db.doc(`courses/${courseId}`);
  const courseData = {
    slug: courseId,
    title: "Publication Course",
    shortDescription: "Publication description.",
    status: "draft",
  };
  await courseRef.set(courseData);
  const isolated = [
    courseRef.collection("modules").doc("module"),
    courseRef.collection("modules").doc("module").collection("sessions").doc("session"),
    courseRef.collection("modules").doc("module").collection("sessionDiscovery").doc("enrolled"),
    courseRef.collection("modules").doc("module").collection("sessionDiscovery").doc("free"),
    db.doc("enrollments/publication-student"),
    db.doc("accessCodes/publication-code"),
    courseRef.collection("resources").doc("resource"),
    courseRef.collection("resources").doc("resource").collection("access").doc("primary"),
    courseRef.collection("modules").doc("module").collection("sessions").doc("session").collection("videoAccess").doc("primary"),
    db.doc("courses/publication-other"),
  ];
  await Promise.all(isolated.map((ref, index) => ref.set({ preserved: index })));
  const courseBefore = await courseRef.get();
  const isolatedBefore = await db.getAll(...isolated);

  const review = await reviewCoursePublication(db, courseId);
  assert.deepEqual(safeCoursePublicationReview(review), {
    courseId,
    title: "Publication Course",
    currentStatus: "draft",
    proposedStatus: "published",
    confirmationPhrase: "PUBLISH COURSE",
  });
  assert.equal((await courseRef.get()).updateTime?.isEqual(courseBefore.updateTime!), true);
  const afterReview = await db.getAll(...isolated);
  afterReview.forEach((snapshot, index) => {
    assert.equal(snapshot.updateTime?.isEqual(isolatedBefore[index]!.updateTime!), true);
  });

  const result = await applyCoursePublication(db, review);
  assert.deepEqual(result, {
    courseId,
    title: "Publication Course",
    status: "published",
    verified: true,
  });
  assert.deepEqual((await courseRef.get()).data(), { ...courseData, status: "published" });
  const isolatedAfter = await db.getAll(...isolated);
  isolatedAfter.forEach((snapshot, index) => {
    assert.deepEqual(snapshot.data(), isolatedBefore[index]!.data());
    assert.equal(snapshot.updateTime?.isEqual(isolatedBefore[index]!.updateTime!), true);
  });
});

test("Course publication fails closed for stale, missing, malformed, and published state", async () => {
  const staleRef = db.doc("courses/publication-stale");
  await staleRef.set({
    slug: "publication-stale",
    title: "Before",
    shortDescription: "Description.",
    status: "draft",
  });
  const staleReview = await reviewCoursePublication(db, "publication-stale");
  await staleRef.update({ title: "After" });
  await assert.rejects(applyCoursePublication(db, staleReview), /changed after publication review/);
  assert.equal((await staleRef.get()).data()?.status, "draft");

  const exactRef = db.doc("courses/publication-exact-state");
  await exactRef.set({
    slug: "publication-exact-state",
    title: "Exact",
    shortDescription: "Description.",
    status: "draft",
  });
  const exactReview = await reviewCoursePublication(db, "publication-exact-state");
  await assert.rejects(
    applyCoursePublication(db, {
      ...exactReview,
      course: { ...exactReview.course, title: "Different reviewed state" },
    }),
    /changed after publication review/,
  );
  assert.equal((await exactRef.get()).data()?.status, "draft");

  await assert.rejects(reviewCoursePublication(db, "publication-missing"), /not found/);
  await db.doc("courses/publication-malformed").set({
    slug: "publication-malformed",
    title: "Malformed",
    shortDescription: "Description.",
    status: "draft",
    extra: true,
  });
  await assert.rejects(reviewCoursePublication(db, "publication-malformed"), /malformed/);
  await db.doc("courses/publication-invalid").set({
    slug: "publication-invalid",
    title: "Invalid",
    shortDescription: "Description.",
    status: "hidden",
  });
  await assert.rejects(reviewCoursePublication(db, "publication-invalid"), /malformed/);
  await db.doc("courses/publication-published").set({
    slug: "publication-published",
    title: "Published",
    shortDescription: "Description.",
    status: "published",
  });
  await assert.rejects(reviewCoursePublication(db, "publication-published"), /not eligible/);
});
