import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  applyCourseMetadataCorrection,
  reviewCourseMetadataCorrection,
} from "../src/tooling/courseMetadataCorrection.js";
import { parseTrustedCourseTextRequest } from "../src/tooling/courseRequestFile.js";

const app = initializeApp(
  { projectId: "demo-at-in-physics" },
  "course-correction-integration-tests",
);
let auth: Auth;
let db: Firestore;
let ownerUid: string;

before(async () => {
  if (
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST
  ) {
    throw new Error(
      "Course correction integration requires Auth and Firestore emulators.",
    );
  }
  auth = getAuth(app);
  db = getFirestore(app);
  ownerUid = (
    await auth.createUser({ email: "course-correction-owner@example.test" })
  ).uid;
  await auth.setCustomUserClaims(ownerUid, { owner: true });
});

after(async () => deleteApp(app));

test("review is zero-write and apply preserves exact structured Unicode text", async () => {
  const courseId = "correction-unicode";
  const reference = db.doc(`courses/${courseId}`);
  const before = {
    slug: courseId,
    title: "^Malformed^",
    shortDescription: "^Malformed^ description^",
    status: "draft",
  };
  await reference.set(before);
  const child = reference.collection("modules").doc("preserved");
  await child.set({ title: "Preserved", order: 0 });
  const request = parseTrustedCourseTextRequest({
    courseId,
    title: "TEST — Exact spaces & ^shell$ punctuation!",
    shortDescription: "Sentence one. Sentence two; symbols: & | < > ^ $ !",
  });
  const review = await reviewCourseMetadataCorrection(
    auth,
    db,
    ownerUid,
    request,
  );
  assert.deepEqual((await reference.get()).data(), before);
  assert.equal(review.changeRequired, true);
  assert.deepEqual(await applyCourseMetadataCorrection(db, review), {
    status: "corrected",
    verified: true,
  });
  assert.deepEqual((await reference.get()).data(), {
    slug: courseId,
    title: request.title,
    shortDescription: request.shortDescription,
    status: "draft",
  });
  assert.deepEqual((await child.get()).data(), {
    title: "Preserved",
    order: 0,
  });
});

test("stale review and published Course fail closed", async () => {
  const courseId = "correction-stale";
  const reference = db.doc(`courses/${courseId}`);
  await reference.set({
    slug: courseId,
    title: "Before",
    shortDescription: "Before.",
    status: "draft",
  });
  const request = parseTrustedCourseTextRequest({
    courseId,
    title: "After",
    shortDescription: "After.",
  });
  const review = await reviewCourseMetadataCorrection(
    auth,
    db,
    ownerUid,
    request,
  );
  await reference.update({ shortDescription: "Concurrent change." });
  await assert.rejects(
    applyCourseMetadataCorrection(db, review),
    /changed after review/,
  );
  assert.equal((await reference.get()).data()?.title, "Before");

  await reference.update({ status: "published" });
  await assert.rejects(
    reviewCourseMetadataCorrection(auth, db, ownerUid, request),
    /Only a draft Course/,
  );
});
