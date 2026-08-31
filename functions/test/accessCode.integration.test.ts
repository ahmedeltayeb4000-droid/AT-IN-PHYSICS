import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { createAccessCode, deriveAccessCodeDocumentId } from "../src/accessCodes/accessCodes.js";
import {
  applyAccessCodeRevocation,
  inspectAccessCode,
  readAccessCodeInventory,
  reviewAccessCodeRevocation,
} from "../src/ownerConsole/accessCodeManagement.js";

const PROJECT_ID = "demo-at-in-physics";
const app = initializeApp({ projectId: PROJECT_ID }, "access-code-tests");
const db = getFirestore(app);
const now = new Date("2030-01-01T00:00:00.000Z");
async function putCourse(courseId: string, overrides: Record<string, unknown> = {}) {
  await db.doc(`courses/${courseId}`).set({ slug: courseId, title: "Course", shortDescription: "Description", status: "published", ...overrides });
}
before(() => {
  if ((process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT) !== PROJECT_ID || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Access Code integration tests require the demo Firestore emulator.");
});
after(() => deleteApp(app));

test("generation supports arbitrary published courses and persists no plaintext", async () => {
  await putCourse("future-electrodynamics");
  const result = await createAccessCode(db, "future-electrodynamics", null, now);
  const data = (await db.doc(`accessCodes/${deriveAccessCodeDocumentId(result.code)}`).get()).data()!;
  assert.deepEqual(Object.keys(data).sort(), ["courseId", "createdAt", "expiresAt", "redeemedAt", "redeemedBy", "status", "version"]);
  assert.equal(JSON.stringify(data).includes(result.code), false);
  assert.equal(result.courseId, "future-electrodynamics");
});

test("generation rejects missing, malformed, draft, and expired targets", async () => {
  await putCourse("draft-target", { status: "draft" });
  await putCourse("malformed-target", { owner: true });
  await assert.rejects(createAccessCode(db, "missing-target", null, now));
  await assert.rejects(createAccessCode(db, "draft-target", null, now));
  await assert.rejects(createAccessCode(db, "malformed-target", null, now));
  await putCourse("expiry-target");
  await assert.rejects(createAccessCode(db, "expiry-target", "2029-01-01T00:00:00.000Z", now));
});

function accessCode(courseId: string, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    courseId,
    status: "active",
    createdAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")),
    redeemedBy: null,
    redeemedAt: null,
    ...overrides,
  };
}

test("management inventory is bounded, opaque, deterministic, classified, and malformed-safe", async () => {
  const courseId = "management-inventory";
  await putCourse(courseId, { title: "Management Inventory" });
  const batch = db.batch();
  const existing = await db.collection("accessCodes").get();
  for (const snapshot of existing.docs) batch.delete(snapshot.ref);
  for (let index = 0; index < 246; index += 1) {
    const id = index.toString(16).padStart(64, "0");
    batch.set(db.doc(`accessCodes/${id}`), accessCode(courseId));
  }
  batch.set(db.doc(`accessCodes/${"e".repeat(64)}`), accessCode(courseId, { extra: true }));
  batch.set(db.doc(`accessCodes/${"f".repeat(63)}0`), accessCode(courseId, { expiresAt: Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z")) }));
  batch.set(db.doc(`accessCodes/${"f".repeat(63)}1`), accessCode(courseId, { status: "redeemed", redeemedBy: "student", redeemedAt: Timestamp.fromDate(now) }));
  batch.set(db.doc(`accessCodes/${"f".repeat(63)}2`), accessCode(courseId, { status: "revoked" }));
  batch.set(db.doc(`accessCodes/${"f".repeat(63)}3`), accessCode(courseId));
  await batch.commit();
  const result = await readAccessCodeInventory(db, now);
  assert.equal(result.response.accessCodes.length, 249);
  assert.equal(result.response.limit, 250);
  assert.equal(result.response.limitReached, true);
  assert.equal(result.response.malformedCount, 1);
  assert.equal(result.handles.size, 249);
  const serialized = JSON.stringify(result.response);
  for (const forbidden of ["redeemedBy", "revision", "sourceId", "accessCodes/", "f".repeat(64)]) assert.equal(serialized.includes(forbidden), false);
  const states = new Set(result.response.accessCodes.map((item) => item.state));
  assert.deepEqual(states, new Set(["unused", "expired", "redeemed", "revoked"]));
  const second = await readAccessCodeInventory(db, now);
  assert.equal(second.response.accessCodes.some((item) => result.handles.has(item.handle)), false);
});

test("management inspection and revocation are exact, stale-safe, status-only, and Enrollment-isolated", async () => {
  const courseId = "management-revoke";
  const documentId = "b".repeat(64);
  const reference = db.doc(`accessCodes/${documentId}`);
  const enrollment = db.doc(`enrollments/student_${courseId}`);
  await putCourse(courseId);
  await reference.set(accessCode(courseId));
  await enrollment.set({ preserved: true });
  const inspected = await inspectAccessCode(db, documentId, now);
  assert.equal(inspected.state, "unused");
  assert.equal("redeemedBy" in inspected, false);
  const before = await reference.get();
  const enrollmentBefore = await enrollment.get();
  const review = await reviewAccessCodeRevocation(db, documentId, now);
  assert.equal((await reference.get()).updateTime?.isEqual(before.updateTime!), true);
  const result = await applyAccessCodeRevocation(db, review, now);
  assert.deepEqual(result, { state: "revoked", verified: true });
  assert.deepEqual((await reference.get()).data(), { ...before.data(), status: "revoked" });
  assert.deepEqual((await enrollment.get()).data(), enrollmentBefore.data());
  assert.equal((await enrollment.get()).updateTime?.isEqual(enrollmentBefore.updateTime!), true);
  await assert.rejects(applyAccessCodeRevocation(db, review, now), /changed after review/);
});

test("management rejects expired, redeemed, revoked, missing, malformed, and stale targets", async () => {
  const courseId = "management-failures";
  await putCourse(courseId);
  const fixtures = [
    ["c".repeat(64), accessCode(courseId, { expiresAt: Timestamp.fromDate(new Date("2029-01-01T00:00:00.000Z")) })],
    ["d".repeat(64), accessCode(courseId, { status: "redeemed", redeemedBy: "student", redeemedAt: Timestamp.fromDate(now) })],
    ["e".repeat(64), accessCode(courseId, { status: "revoked" })],
    ["f".repeat(64), accessCode(courseId, { extra: true })],
  ] as const;
  for (const [id, data] of fixtures) await db.doc(`accessCodes/${id}`).set(data);
  for (const [id] of fixtures) await assert.rejects(reviewAccessCodeRevocation(db, id, now));
  await assert.rejects(reviewAccessCodeRevocation(db, "9".repeat(64), now), /not found/);
  const staleId = "8".repeat(64);
  const staleReference = db.doc(`accessCodes/${staleId}`);
  await staleReference.set(accessCode(courseId));
  const stale = await reviewAccessCodeRevocation(db, staleId, now);
  await staleReference.update({ createdAt: FieldValue.serverTimestamp() });
  await assert.rejects(applyAccessCodeRevocation(db, stale, now), /changed after review/);
});
