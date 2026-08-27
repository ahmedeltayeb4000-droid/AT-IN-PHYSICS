import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createAccessCode, deriveAccessCodeDocumentId } from "../src/accessCodes/accessCodes.js";

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
