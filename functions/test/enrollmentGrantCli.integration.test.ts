import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { getEnrollmentDocumentId } from "../src/enrollments/validation.js";
import {
  resolveEnrollmentGrantProject,
  runEnrollmentGrantCliService,
} from "../src/tooling/enrollmentGrant.js";

const PROJECT_ID = "demo-at-in-physics";
const NOW = new Date("2029-01-01T00:00:00.000Z");
const app = initializeApp(
  { projectId: PROJECT_ID },
  "enrollment-grant-cli-tests",
);
let auth: Auth;
let db: Firestore;
let ownerUid: string;
let targetUid: string;
let otherUid: string;

function requireSafety() {
  assert.equal(resolveEnrollmentGrantProject(process.env), PROJECT_ID);
  if (
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST
  ) {
    throw new Error(
      "Enrollment CLI integration requires Auth and Firestore emulators.",
    );
  }
}

async function course(
  courseId: string,
  status: "published" | "draft" = "published",
) {
  await db.doc(`courses/${courseId}`).set({
    slug: courseId,
    title: courseId,
    shortDescription: "CLI integration fixture.",
    status,
  });
}

function options(
  targetUserId: string,
  courseId: string,
  apply: boolean,
  expiresAt: string | null = null,
) {
  return { targetUserId, courseId, apply, expiresAt };
}

function reference(userId: string, courseId: string) {
  return db.doc(`enrollments/${getEnrollmentDocumentId(userId, courseId)}`);
}

before(async () => {
  requireSafety();
  auth = getAuth(app);
  db = getFirestore(app);
  ownerUid = (await auth.createUser({ email: "cli-owner@example.test" })).uid;
  targetUid = (await auth.createUser({ email: "cli-target@example.test" })).uid;
  otherUid = (await auth.createUser({ email: "cli-other@example.test" })).uid;
  await auth.setCustomUserClaims(ownerUid, { owner: true });
});

after(async () => deleteApp(app));

test("missing Auth user, missing Course, and draft Course fail with zero writes", async () => {
  await course("auth-missing-course");
  await assert.rejects(
    runEnrollmentGrantCliService(
      auth,
      db,
      options("missing-auth-user", "auth-missing-course", true),
      ownerUid,
      NOW,
    ),
    /Target Auth user was not found/,
  );
  await assert.rejects(
    runEnrollmentGrantCliService(
      auth,
      db,
      options(targetUid, "missing-course", true),
      ownerUid,
      NOW,
    ),
    /Course was not found/,
  );
  await course("draft-course", "draft");
  await assert.rejects(
    runEnrollmentGrantCliService(
      auth,
      db,
      options(targetUid, "draft-course", true),
      ownerUid,
      NOW,
    ),
    /not eligible/,
  );
  assert.equal(
    (await reference(targetUid, "missing-course").get()).exists,
    false,
  );
  assert.equal(
    (await reference(targetUid, "draft-course").get()).exists,
    false,
  );
});

test("dry run performs zero writes and reports the deterministic target", async () => {
  const courseId = "dry-run-course";
  await course(courseId);
  const result = await runEnrollmentGrantCliService(
    auth,
    db,
    options(targetUid, courseId, false),
    ownerUid,
    NOW,
  );
  assert.equal(result.enrollmentPath, `enrollments/${targetUid}_${courseId}`);
  assert.equal(result.changeRequired, true);
  assert.equal(result.applyStatus, null);
  assert.equal((await reference(targetUid, courseId).get()).exists, false);
});

test("apply creates exact authority payload, verifies it, and repeats as no-op", async () => {
  const courseId = "apply-course";
  const expiry = "2030-01-02T03:04:05.000Z";
  await course(courseId);
  const first = await runEnrollmentGrantCliService(
    auth,
    db,
    options(targetUid, courseId, true, expiry),
    ownerUid,
    NOW,
  );
  assert.equal(first.applyStatus, "created");
  assert.equal(first.postApplyVerified, true);
  const enrollment = (await reference(targetUid, courseId).get()).data()!;
  assert.deepEqual(Object.keys(enrollment).sort(), [
    "courseId",
    "expiresAt",
    "grantedAt",
    "grantedBy",
    "source",
    "status",
    "userId",
  ]);
  assert.equal(enrollment.userId, targetUid);
  assert.equal(enrollment.courseId, courseId);
  assert.equal(enrollment.status, "active");
  assert.equal(enrollment.source, "manual");
  assert.equal(enrollment.grantedBy, ownerUid);
  assert.equal(enrollment.grantedAt.toDate().toISOString(), NOW.toISOString());
  assert.equal(enrollment.expiresAt.toDate().toISOString(), expiry);
  const before = await reference(targetUid, courseId).get();
  const second = await runEnrollmentGrantCliService(
    auth,
    db,
    options(targetUid, courseId, true, expiry),
    ownerUid,
    NOW,
  );
  assert.equal(second.applyStatus, "already-active");
  assert.equal(second.postApplyVerified, true);
  const after = await reference(targetUid, courseId).get();
  assert.equal(after.updateTime?.isEqual(before.updateTime!), true);
});

test("revoked and malformed Enrollments fail closed", async () => {
  for (const [courseId, data] of [
    [
      "revoked-course",
      {
        userId: targetUid,
        courseId: "revoked-course",
        status: "revoked",
        grantedAt: Timestamp.fromDate(NOW),
        expiresAt: null,
        source: "manual",
        grantedBy: ownerUid,
      },
    ],
    [
      "malformed-course",
      {
        userId: "wrong-user",
        courseId: "malformed-course",
        status: "active",
        grantedAt: Timestamp.fromDate(NOW),
        expiresAt: null,
        source: "manual",
        grantedBy: ownerUid,
      },
    ],
  ] as const) {
    await course(courseId);
    const enrollmentReference = reference(targetUid, courseId);
    await enrollmentReference.set(data);
    const before = await enrollmentReference.get();
    await assert.rejects(
      runEnrollmentGrantCliService(
        auth,
        db,
        options(targetUid, courseId, true),
        ownerUid,
        NOW,
      ),
      /reactivation|inconsistent/,
    );
    const after = await enrollmentReference.get();
    assert.equal(after.updateTime?.isEqual(before.updateTime!), true);
  }
});

test("cross-user and cross-course documents remain isolated", async () => {
  const courseId = "isolation-course";
  const otherCourseId = "other-isolation-course";
  await Promise.all([course(courseId), course(otherCourseId)]);
  const otherUserReference = reference(otherUid, courseId);
  const otherCourseReference = reference(targetUid, otherCourseId);
  const fixture = {
    status: "active",
    grantedAt: Timestamp.fromDate(NOW),
    expiresAt: null,
    source: "manual",
    grantedBy: ownerUid,
  } as const;
  await Promise.all([
    otherUserReference.set({ ...fixture, userId: otherUid, courseId }),
    otherCourseReference.set({
      ...fixture,
      userId: targetUid,
      courseId: otherCourseId,
    }),
  ]);
  const before = await Promise.all([
    otherUserReference.get(),
    otherCourseReference.get(),
  ]);
  const result = await runEnrollmentGrantCliService(
    auth,
    db,
    options(targetUid, courseId, true),
    ownerUid,
    NOW,
  );
  assert.equal(result.applyStatus, "created");
  const afterSnapshots = await Promise.all([
    otherUserReference.get(),
    otherCourseReference.get(),
  ]);
  afterSnapshots.forEach((snapshot, index) => {
    assert.equal(snapshot.updateTime?.isEqual(before[index].updateTime!), true);
  });
});

test("non-owner trusted UID is rejected before Firestore mutation", async () => {
  const courseId = "authority-course";
  await course(courseId);
  await assert.rejects(
    runEnrollmentGrantCliService(
      auth,
      db,
      options(targetUid, courseId, true),
      otherUid,
      NOW,
    ),
    /does not have owner authority/,
  );
  assert.equal((await reference(targetUid, courseId).get()).exists, false);
});
