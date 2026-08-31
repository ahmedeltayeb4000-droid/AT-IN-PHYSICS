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
import {
  applyEnrollmentReview,
  inspectEnrollment,
  readEnrollmentInventory,
  reviewEnrollmentExtension,
  reviewEnrollmentStatus,
} from "../src/ownerConsole/enrollmentManagement.js";

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

test("Enrollment Management revokes, extends, and reactivates with exact isolated writes", async () => {
  const courseId = "managed-course";
  await course(courseId);
  const enrollmentRef = reference(targetUid, courseId);
  const accessCodeRef = db.doc(`accessCodes/${"a".repeat(64)}`);
  const sessionRef = db.doc(`courses/${courseId}/modules/basics/sessions/intro`);
  const isolated = [
    db.doc(`courses/${courseId}/modules/basics`),
    sessionRef,
    db.doc(`courses/${courseId}/modules/basics/sessionDiscovery/visible`),
    db.doc(`courses/${courseId}/modules/basics/sessionDiscovery/free`),
    accessCodeRef,
    db.doc(`courses/${courseId}/resources/notes`),
    db.doc(`courses/${courseId}/resources/notes/access/primary`),
    sessionRef.collection("videoAccess").doc("primary"),
    reference(otherUid, courseId),
  ];
  await Promise.all(isolated.map((item, index) => item.set({ preserved: index })));
  const original = {
    userId: targetUid,
    courseId,
    status: "active",
    grantedAt: Timestamp.fromDate(NOW),
    expiresAt: Timestamp.fromDate(new Date("2030-01-01T00:00:00.000Z")),
    source: "access_code",
    sourceId: "a".repeat(64),
    grantedBy: "access-code-service",
  };
  await enrollmentRef.set(original);
  const isolatedBefore = await db.getAll(...isolated);

  const revoke = await reviewEnrollmentStatus(db, { userId: targetUid, courseId }, "revoke", NOW);
  const beforeReview = await enrollmentRef.get();
  assert.equal((await enrollmentRef.get()).updateTime?.isEqual(beforeReview.updateTime!), true);
  await applyEnrollmentReview(db, revoke, NOW);
  assert.deepEqual((await enrollmentRef.get()).data(), { ...original, status: "revoked" });
  await assert.rejects(applyEnrollmentReview(db, revoke, NOW), /changed after review/);

  const extend = await reviewEnrollmentExtension(db, { userId: targetUid, courseId }, "2031-01-01T00:00:00.000Z", NOW);
  await applyEnrollmentReview(db, extend, NOW);
  const extended = (await enrollmentRef.get()).data()!;
  assert.equal(extended.status, "revoked");
  assert.equal(extended.expiresAt.toDate().toISOString(), "2031-01-01T00:00:00.000Z");

  const reactivate = await reviewEnrollmentStatus(db, { userId: targetUid, courseId }, "reactivate", NOW);
  await applyEnrollmentReview(db, reactivate, NOW);
  const reactivated = (await enrollmentRef.get()).data()!;
  assert.equal(reactivated.status, "active");
  assert.equal(reactivated.sourceId, original.sourceId);
  assert.equal(reactivated.grantedBy, original.grantedBy);
  assert.equal(reactivated.grantedAt.isEqual(original.grantedAt), true);
  assert.deepEqual((await accessCodeRef.get()).data(), { preserved: 4 });
  const isolatedAfter = await db.getAll(...isolated);
  isolatedAfter.forEach((snapshot, index) => {
    assert.deepEqual(snapshot.data(), isolatedBefore[index]!.data());
    assert.equal(snapshot.updateTime?.isEqual(isolatedBefore[index]!.updateTime!), true);
  });
});

test("Enrollment Management fails closed for invalid states, expirations, stale reviews, and malformed records", async () => {
  const courseId = "managed-failures";
  await course(courseId);
  const enrollmentRef = reference(targetUid, courseId);
  const finite = {
    userId: targetUid,
    courseId,
    status: "active",
    grantedAt: Timestamp.fromDate(NOW),
    expiresAt: Timestamp.fromDate(new Date("2030-01-01T00:00:00.000Z")),
    source: "manual",
    grantedBy: ownerUid,
  };
  await enrollmentRef.set(finite);
  await assert.rejects(reviewEnrollmentStatus(db, { userId: targetUid, courseId }, "reactivate", NOW), /not eligible/);
  const stale = await reviewEnrollmentStatus(db, { userId: targetUid, courseId }, "revoke", NOW);
  await enrollmentRef.update({ expiresAt: Timestamp.fromDate(new Date("2030-06-01T00:00:00.000Z")) });
  await assert.rejects(applyEnrollmentReview(db, stale, NOW), /changed after review/);
  for (const value of ["bad", "2028-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"]) {
    await assert.rejects(reviewEnrollmentExtension(db, { userId: targetUid, courseId }, value, NOW));
  }
  await enrollmentRef.update({ expiresAt: null });
  await assert.rejects(reviewEnrollmentExtension(db, { userId: targetUid, courseId }, "2032-01-01T00:00:00.000Z", NOW), /perpetual/);
  await enrollmentRef.update({ status: "revoked", expiresAt: Timestamp.fromDate(new Date("2028-01-01T00:00:00.000Z")) });
  await assert.rejects(reviewEnrollmentStatus(db, { userId: targetUid, courseId }, "reactivate", NOW), /extended/);
  await assert.rejects(reviewEnrollmentStatus(db, { userId: targetUid, courseId: "missing-managed" }, "revoke", NOW), /not found/);
  await enrollmentRef.set({ ...finite, extra: true });
  await assert.rejects(inspectEnrollment(db, { userId: targetUid, courseId }, NOW), /malformed/);
});

test("Enrollment inventory is bounded, deterministic, classified, and sanitized", async () => {
  const courseId = "managed-inventory";
  await course(courseId);
  const batch = db.batch();
  for (let index = 0; index < 251; index += 1) {
    const uid = `inventory-user-${String(index).padStart(3, "0")}`;
    batch.set(reference(uid, courseId), {
      userId: uid,
      courseId,
      status: index === 0 ? "revoked" : "active",
      grantedAt: Timestamp.fromDate(NOW),
      expiresAt: index === 1 ? Timestamp.fromDate(new Date("2028-01-01T00:00:00.000Z")) : null,
      source: "manual",
      grantedBy: ownerUid,
    });
  }
  await batch.commit();
  const result = await readEnrollmentInventory(db, NOW);
  assert.equal(result.enrollments.length <= 250, true);
  assert.equal(result.limit, 250);
  assert.equal(result.limitReached, true);
  assert.deepEqual([...result.enrollments].map((item) => `${item.userId}_${item.courseId}`), [...result.enrollments].map((item) => `${item.userId}_${item.courseId}`).sort());
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("grantedBy"), false);
  assert.equal(serialized.includes("sourceId"), false);
  assert.equal(serialized.includes("revision"), false);
  const revoked = await inspectEnrollment(db, { userId: "inventory-user-000", courseId }, NOW);
  const expired = await inspectEnrollment(db, { userId: "inventory-user-001", courseId }, NOW);
  assert.equal(revoked.accessState, "revoked");
  assert.equal(expired.accessState, "expired");
});
