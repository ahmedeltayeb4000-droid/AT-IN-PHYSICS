import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

const PROJECT_ID = "demo-at-in-physics";
const CURRENT_UID = "student-current";
const OTHER_UID = "student-other";
let testEnvironment;

function emulatorConfiguration() {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || "";
  const separator = emulatorHost.lastIndexOf(":");
  const host = emulatorHost.slice(0, separator);
  const port = Number(emulatorHost.slice(separator + 1));

  if (projectId !== PROJECT_ID || !host || !Number.isInteger(port)) {
    throw new Error(
      "Rules tests require the demo-at-in-physics Firestore emulator.",
    );
  }
  return { host, port };
}

function enrollment(userId, courseId = "mechanics") {
  return {
    userId,
    courseId,
    status: "active",
    grantedAt: "fixture-time",
    expiresAt: null,
    source: "manual",
    grantedBy: "fixture-owner",
  };
}

async function seedDocuments(fixtures) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(
      Object.entries(fixtures).map(([path, data]) => setDoc(doc(db, path), data)),
    );
  });
}

function authenticatedDb(uid) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

function unauthenticatedDb() {
  return testEnvironment.unauthenticatedContext().firestore();
}

before(async () => {
  const { host, port } = emulatorConfiguration();
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host, port, rules },
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

test("unauthenticated user cannot get an Enrollment", async () => {
  await seedDocuments({
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDoc(doc(unauthenticatedDb(), `enrollments/${CURRENT_UID}_mechanics`)),
  );
});

test("authenticated student can get their own Enrollment", async () => {
  await seedDocuments({
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  const snapshot = await assertSucceeds(
    getDoc(doc(authenticatedDb(CURRENT_UID), `enrollments/${CURRENT_UID}_mechanics`)),
  );
  assert.equal(snapshot.exists(), true);
});

test("authenticated student cannot get another student's Enrollment", async () => {
  await seedDocuments({
    [`enrollments/${OTHER_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), `enrollments/${OTHER_UID}_mechanics`)),
  );
});

test("own-Enrollments query constrained by userId succeeds", async () => {
  await seedDocuments({
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
    [`enrollments/${OTHER_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  const ownQuery = query(
    collection(authenticatedDb(CURRENT_UID), "enrollments"),
    where("userId", "==", CURRENT_UID),
  );
  const snapshot = await assertSucceeds(getDocs(ownQuery));
  assert.equal(snapshot.size, 1);
});

test("broad Enrollment query without ownership constraint fails", async () => {
  await seedDocuments({
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDocs(collection(authenticatedDb(CURRENT_UID), "enrollments")),
  );
});

test("query for another user's Enrollments fails", async () => {
  await seedDocuments({
    [`enrollments/${OTHER_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  const otherQuery = query(
    collection(authenticatedDb(CURRENT_UID), "enrollments"),
    where("userId", "==", OTHER_UID),
  );
  await assertFails(getDocs(otherQuery));
});

test("spoofed deterministic ID does not override stored userId ownership", async () => {
  await seedDocuments({
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), `enrollments/${CURRENT_UID}_mechanics`)),
  );
});

test("stored userId grants ownership even when document ID is noncanonical", async () => {
  await seedDocuments({
    "enrollments/noncanonical-id": enrollment(CURRENT_UID),
  });
  await assertSucceeds(
    getDoc(doc(authenticatedDb(CURRENT_UID), "enrollments/noncanonical-id")),
  );
});

test("authenticated student cannot create an Enrollment", async () => {
  await assertFails(
    setDoc(
      doc(authenticatedDb(CURRENT_UID), `enrollments/${CURRENT_UID}_mechanics`),
      enrollment(CURRENT_UID),
    ),
  );
});

test("authenticated student cannot update Enrollment authority fields", async () => {
  const path = `enrollments/${CURRENT_UID}_mechanics`;
  await seedDocuments({ [path]: enrollment(CURRENT_UID) });

  for (const change of [
    { status: "revoked" },
    { expiresAt: "forged-expiry" },
    { courseId: "other-course" },
    { userId: OTHER_UID },
  ]) {
    await assertFails(updateDoc(doc(authenticatedDb(CURRENT_UID), path), change));
  }
});

test("authenticated student cannot delete their own Enrollment", async () => {
  const path = `enrollments/${CURRENT_UID}_mechanics`;
  await seedDocuments({ [path]: enrollment(CURRENT_UID) });
  await assertFails(deleteDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("unauthenticated write fails", async () => {
  await assertFails(
    setDoc(
      doc(unauthenticatedDb(), `enrollments/${CURRENT_UID}_mechanics`),
      enrollment(CURRENT_UID),
    ),
  );
});

test("published Course remains publicly readable", async () => {
  await seedDocuments({
    "courses/mechanics": { status: "published", title: "Mechanics" },
  });
  await assertSucceeds(getDoc(doc(unauthenticatedDb(), "courses/mechanics")));
});

test("draft Course remains publicly unreadable", async () => {
  await seedDocuments({
    "courses/draft-course": { status: "draft", title: "Draft" },
  });
  await assertFails(getDoc(doc(unauthenticatedDb(), "courses/draft-course")));
});

test("Course Modules remain inaccessible", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({ [path]: { title: "Motion", order: 1 } });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Course Sessions remain inaccessible", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});
