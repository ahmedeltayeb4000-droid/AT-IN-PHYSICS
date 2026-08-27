import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

const PROJECT_ID = "demo-at-in-physics";
const CODE_ID = "a".repeat(64);
const COURSE_ID = "rules-only-course";
const FUTURE = Timestamp.fromDate(new Date("2099-01-01T00:00:00.000Z"));
const PAST = Timestamp.fromDate(new Date("2020-01-01T00:00:00.000Z"));
let environment;

function emulatorConfiguration() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  const value = process.env.FIRESTORE_EMULATOR_HOST || "";
  const separator = value.lastIndexOf(":");
  const host = value.slice(0, separator);
  const port = Number(value.slice(separator + 1));
  if (projectId !== PROJECT_ID || !host || !Number.isInteger(port)) throw new Error("Access Code Rules tests require the demo Firestore emulator.");
  return { host, port };
}

function db(uid) {
  return environment.authenticatedContext(uid).firestore();
}

function code(overrides = {}) {
  return {
    version: 1,
    courseId: COURSE_ID,
    status: "active",
    createdAt: PAST,
    expiresAt: FUTURE,
    redeemedBy: null,
    redeemedAt: null,
    ...overrides,
  };
}

function enrollment(uid, accessCodeId = CODE_ID, overrides = {}) {
  return {
    userId: uid,
    courseId: COURSE_ID,
    status: "active",
    grantedAt: serverTimestamp(),
    expiresAt: null,
    source: "access_code",
    sourceId: accessCodeId,
    grantedBy: "access-code-service",
    ...overrides,
  };
}

async function seed(fixtures) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await Promise.all(Object.entries(fixtures).map(([path, data]) => setDoc(doc(admin, path), data)));
  });
}

async function seedTarget(overrides = {}) {
  await seed({
    [`courses/${COURSE_ID}`]: {
      slug: COURSE_ID,
      title: "Rules-only Course",
      shortDescription: "Access Code test Course.",
      status: "published",
      ...overrides,
    },
    [`accessCodes/${CODE_ID}`]: code(),
  });
}

async function redeem(studentDb, uid, accessCodeId = CODE_ID) {
  return runTransaction(studentDb, async (transaction) => {
    const codeReference = doc(studentDb, "accessCodes", accessCodeId);
    const codeSnapshot = await transaction.get(codeReference);
    const courseId = codeSnapshot.data().courseId;
    const enrollmentReference = doc(studentDb, "enrollments", `${uid}_${courseId}`);
    const enrollmentSnapshot = await transaction.get(enrollmentReference);
    if (codeSnapshot.data().status === "redeemed" && codeSnapshot.data().redeemedBy === uid && enrollmentSnapshot.exists()) return "already-redeemed-by-you";
    transaction.update(codeReference, { status: "redeemed", redeemedBy: uid, redeemedAt: serverTimestamp() });
    transaction.set(enrollmentReference, enrollment(uid, accessCodeId));
    return "created";
  });
}

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  environment = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { ...emulatorConfiguration(), rules } });
});
beforeEach(() => environment.clearFirestore());
after(() => environment.cleanup());

test("Access Code exact gets are narrow and list remains denied", async () => {
  await seedTarget();
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "accessCodes", CODE_ID)));
  await assertSucceeds(getDoc(doc(db("student-a"), "accessCodes", CODE_ID)));
  await assertFails(getDocs(collection(db("student-a"), "accessCodes")));
  for (const [id, value] of [
    ["b".repeat(64), code({ expiresAt: PAST })],
    ["c".repeat(64), code({ status: "revoked" })],
    ["d".repeat(64), code({ extra: true })],
    ["e".repeat(64), code({ status: "redeemed", redeemedBy: "student-b", redeemedAt: PAST })],
  ]) {
    await seed({ [`accessCodes/${id}`]: value });
    await assertFails(getDoc(doc(db("student-a"), "accessCodes", id)));
  }
  await seed({ [`accessCodes/${"f".repeat(64)}`]: code({ status: "redeemed", redeemedBy: "student-a", redeemedAt: PAST }) });
  await assertSucceeds(getDoc(doc(db("student-a"), "accessCodes", "f".repeat(64))));
});

test("valid paired transaction succeeds with exact trusted state", async () => {
  await seedTarget();
  assert.equal(await redeem(db("student-a"), "student-a"), "created");
  const enrollmentSnapshot = await getDoc(doc(db("student-a"), "enrollments", `student-a_${COURSE_ID}`));
  assert.deepEqual(Object.keys(enrollmentSnapshot.data()).sort(), ["courseId", "expiresAt", "grantedAt", "grantedBy", "source", "sourceId", "status", "userId"]);
  assert.equal(enrollmentSnapshot.data().sourceId, CODE_ID);
});

test("neither half of redemption can be written alone", async () => {
  await seedTarget();
  await assertFails(updateDoc(doc(db("student-a"), "accessCodes", CODE_ID), { status: "redeemed", redeemedBy: "student-a", redeemedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db("student-a"), "enrollments", `student-a_${COURSE_ID}`), enrollment("student-a")));
});

test("missing, draft, or malformed target Course blocks redemption", async () => {
  for (const state of ["missing", "draft", "malformed"]) {
    await environment.clearFirestore();
    await seed({ [`accessCodes/${CODE_ID}`]: code() });
    if (state !== "missing") {
      await seed({
        [`courses/${COURSE_ID}`]: {
          slug: COURSE_ID,
          title: "Rules-only Course",
          shortDescription: "Access Code test Course.",
          status: state === "draft" ? "draft" : "published",
          ...(state === "malformed" ? { extra: true } : {}),
        },
      });
    }
    await assert.rejects(redeem(db("student-a"), "student-a"));
  }
});

test("code mutation, creation, and deletion attacks fail", async () => {
  await seedTarget();
  const student = db("student-a");
  for (const patch of [
    { courseId: "other", status: "redeemed", redeemedBy: "student-a", redeemedAt: serverTimestamp() },
    { status: "redeemed", redeemedBy: "student-b", redeemedAt: serverTimestamp() },
    { status: "redeemed", redeemedBy: "student-a", redeemedAt: PAST },
    { status: "revoked" },
  ]) await assertFails(updateDoc(doc(student, "accessCodes", CODE_ID), patch));
  await assertFails(setDoc(doc(student, "accessCodes", "9".repeat(64)), code()));
  await assertFails(deleteDoc(doc(student, "accessCodes", CODE_ID)));
});

test("Enrollment authority-field attacks fail atomically", async () => {
  for (const [name, id, patch] of [
    ["wrong-uid", `student-a_${COURSE_ID}`, { userId: "student-b" }],
    ["wrong-id", `student-a_wrong`, {}],
    ["wrong-course", `student-a_${COURSE_ID}`, { courseId: "other" }],
    ["wrong-source-id", `student-a_${COURSE_ID}`, { sourceId: "b".repeat(64) }],
    ["wrong-source", `student-a_${COURSE_ID}`, { source: "manual" }],
    ["wrong-granter", `student-a_${COURSE_ID}`, { grantedBy: "student-a" }],
    ["browser-time", `student-a_${COURSE_ID}`, { grantedAt: PAST }],
    ["extra", `student-a_${COURSE_ID}`, { extra: true }],
  ]) {
    await environment.clearFirestore();
    await seedTarget();
    const student = db("student-a");
    const batch = writeBatch(student);
    batch.update(doc(student, "accessCodes", CODE_ID), { status: "redeemed", redeemedBy: "student-a", redeemedAt: serverTimestamp() });
    batch.set(doc(student, "enrollments", id), enrollment("student-a", CODE_ID, patch));
    await assert.rejects(batch.commit(), undefined, name);
  }
});

test("existing active or revoked Enrollment cannot be overwritten or reactivated", async () => {
  for (const status of ["active", "revoked"]) {
    await environment.clearFirestore();
    await seedTarget();
    await seed({ [`enrollments/student-a_${COURSE_ID}`]: { ...enrollment("student-a"), grantedAt: PAST, status } });
    await assert.rejects(redeem(db("student-a"), "student-a"));
  }
});

test("two concurrent students racing one code produce exactly one winner", async () => {
  await seedTarget();
  const outcomes = await Promise.allSettled([redeem(db("student-a"), "student-a"), redeem(db("student-b"), "student-b")]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  let enrollmentCount = 0;
  await environment.withSecurityRulesDisabled(async (context) => {
    enrollmentCount = (await getDocs(collection(context.firestore(), "enrollments"))).size;
  });
  assert.equal(enrollmentCount, 1);
});

test("same student retry is read-only and another student cannot inspect or reuse it", async () => {
  await seedTarget();
  assert.equal(await redeem(db("student-a"), "student-a"), "created");
  assert.equal(await redeem(db("student-a"), "student-a"), "already-redeemed-by-you");
  await assertFails(getDoc(doc(db("student-b"), "accessCodes", CODE_ID)));
  await assert.rejects(redeem(db("student-b"), "student-b"));
});

test("resulting Enrollment authorizes Course content, discovery, Session, and protected video", async () => {
  await seedTarget();
  const modulePath = `courses/${COURSE_ID}/modules/basics`;
  const sessionPath = `${modulePath}/sessions/introduction`;
  await seed({
    [modulePath]: { title: "Basics", order: 0 },
    [`${modulePath}/sessionDiscovery/visible`]: { sessionIds: ["introduction"] },
    [sessionPath]: { title: "Introduction", order: 0, publicationStatus: "published", videoAssetId: "intro-video" },
    [`${sessionPath}/videoAccess/primary`]: { videoAssetId: "intro-video", contentKey: "A".repeat(43) },
  });
  const student = db("student-a");
  await redeem(student, "student-a");
  await assertSucceeds(getDoc(doc(student, modulePath)));
  await assertSucceeds(getDoc(doc(student, `${modulePath}/sessionDiscovery/visible`)));
  await assertSucceeds(getDoc(doc(student, sessionPath)));
  await assertSucceeds(getDoc(doc(student, `${sessionPath}/videoAccess/primary`)));
});
