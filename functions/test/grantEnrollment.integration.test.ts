import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getEnrollmentDocumentId } from "../src/enrollments/validation.js";

const PROJECT_ID = "demo-at-in-physics";
const FUNCTIONS_HOST = "127.0.0.1:5001";
const PASSWORD = "Local-test-password-123!";

type LocalUser = {
  readonly uid: string;
  readonly email: string;
  readonly idToken: string;
};

type CallableResult = {
  readonly result?: unknown;
  readonly error?: { readonly status?: string; readonly message?: string };
};

const app = initializeApp({ projectId: PROJECT_ID }, "grant-enrollment-tests");
const auth = getAuth(app);
const db = getFirestore(app);
let owner: LocalUser;
let nonOwner: LocalUser;
let target: LocalUser;

function requireEmulatorSafety() {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (
    projectId !== PROJECT_ID ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    !process.env.FIRESTORE_EMULATOR_HOST
  ) {
    throw new Error("Integration tests require the demo Auth and Firestore emulators.");
  }
}

async function authRequest(path: string, body: Record<string, unknown>) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
  const response = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/${path}?key=fake-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const result = (await response.json()) as {
    localId?: string;
    idToken?: string;
  };
  if (!response.ok || !result.localId || !result.idToken) {
    throw new Error(`Auth emulator request failed: ${path}`);
  }
  return result as { localId: string; idToken: string };
}

async function createLocalUser(name: string): Promise<LocalUser> {
  const email = `${name}@example.test`;
  const result = await authRequest("accounts:signUp", {
    email,
    password: PASSWORD,
    returnSecureToken: true,
  });
  return { uid: result.localId, email, idToken: result.idToken };
}

async function signInLocalUser(user: LocalUser): Promise<LocalUser> {
  const result = await authRequest("accounts:signInWithPassword", {
    email: user.email,
    password: PASSWORD,
    returnSecureToken: true,
  });
  return { ...user, idToken: result.idToken };
}

async function callGrantEnrollment(
  data: Record<string, unknown>,
  idToken?: string,
): Promise<CallableResult> {
  const response = await fetch(
    `http://${FUNCTIONS_HOST}/${PROJECT_ID}/us-central1/grantEnrollment`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify({ data }),
    },
  );
  return (await response.json()) as CallableResult;
}

async function putCourse(courseId: string, status: "draft" | "published") {
  await db.doc(`courses/${courseId}`).set({
    slug: courseId,
    title: courseId,
    shortDescription: "Emulator integration fixture.",
    status,
  });
}

function enrollmentReference(courseId: string) {
  const id = getEnrollmentDocumentId(target.uid, courseId);
  return { id, reference: db.doc(`enrollments/${id}`) };
}

before(async () => {
  requireEmulatorSafety();
  owner = await createLocalUser("owner");
  nonOwner = await createLocalUser("student-caller");
  target = await createLocalUser("target-student");
  await auth.setCustomUserClaims(owner.uid, { owner: true });
  owner = await signInLocalUser(owner);
});

after(async () => {
  await deleteApp(app);
});

test("unauthenticated caller is denied", async () => {
  const response = await callGrantEnrollment({
    targetUserId: "missing-user",
    courseId: "mechanics",
    expiresAt: null,
  });
  assert.equal(response.error?.status, "UNAUTHENTICATED");
});

test("authenticated non-owner is denied", async () => {
  const response = await callGrantEnrollment(
    { targetUserId: target.uid, courseId: "mechanics", expiresAt: null },
    nonOwner.idToken,
  );
  assert.equal(response.error?.status, "PERMISSION_DENIED");
});

test("owner is denied when target Auth user does not exist", async () => {
  await putCourse("target-check-course", "published");
  const response = await callGrantEnrollment(
    {
      targetUserId: "missing-target-user",
      courseId: "target-check-course",
      expiresAt: null,
    },
    owner.idToken,
  );
  assert.equal(response.error?.status, "NOT_FOUND");
});

test("owner is denied when Course does not exist", async () => {
  const response = await callGrantEnrollment(
    { targetUserId: target.uid, courseId: "missing-course", expiresAt: null },
    owner.idToken,
  );
  assert.equal(response.error?.status, "NOT_FOUND");
});

test("owner is denied when Course is draft", async () => {
  await putCourse("draft-course", "draft");
  const response = await callGrantEnrollment(
    { targetUserId: target.uid, courseId: "draft-course", expiresAt: null },
    owner.idToken,
  );
  assert.equal(response.error?.status, "FAILED_PRECONDITION");
});

test("valid owner grant creates the deterministic manual Enrollment", async () => {
  const courseId = "mechanics";
  const expiry = "2099-01-02T03:04:05.000Z";
  await putCourse(courseId, "published");
  const { id, reference } = enrollmentReference(courseId);

  const response = await callGrantEnrollment(
    { targetUserId: target.uid, courseId, expiresAt: expiry },
    owner.idToken,
  );
  assert.deepEqual(response.result, { status: "created", enrollmentId: id });

  const snapshot = await reference.get();
  const data = snapshot.data()!;
  assert.deepEqual(Object.keys(data).sort(), [
    "courseId",
    "expiresAt",
    "grantedAt",
    "grantedBy",
    "source",
    "status",
    "userId",
  ]);
  assert.equal(data.userId, target.uid);
  assert.equal(data.courseId, courseId);
  assert.equal(data.status, "active");
  assert.equal(data.source, "manual");
  assert.equal(data.grantedBy, owner.uid);
  assert.equal(data.grantedAt instanceof Timestamp, true);
  assert.equal(data.expiresAt instanceof Timestamp, true);
  assert.equal(data.expiresAt.toDate().toISOString(), expiry);
  assert.equal("sourceId" in data, false);
});

test("repeat grant is idempotent and preserves timestamps", async () => {
  const courseId = "mechanics";
  const expiry = "2099-01-02T03:04:05.000Z";
  const { id, reference } = enrollmentReference(courseId);
  const beforeSnapshot = await reference.get();
  const beforeData = beforeSnapshot.data()!;

  const response = await callGrantEnrollment(
    { targetUserId: target.uid, courseId, expiresAt: expiry },
    owner.idToken,
  );
  assert.deepEqual(response.result, {
    status: "already-active",
    enrollmentId: id,
  });

  const afterData = (await reference.get()).data()!;
  assert.equal(afterData.grantedAt.isEqual(beforeData.grantedAt), true);
  assert.equal(afterData.expiresAt.isEqual(beforeData.expiresAt), true);
  const matching = await db
    .collection("enrollments")
    .where("userId", "==", target.uid)
    .where("courseId", "==", courseId)
    .get();
  assert.equal(matching.size, 1);
});

test("revoked Enrollment is rejected and remains revoked", async () => {
  const courseId = "thermodynamics";
  await putCourse(courseId, "published");
  const { reference } = enrollmentReference(courseId);
  await reference.set({
    userId: target.uid,
    courseId,
    status: "revoked",
    grantedAt: Timestamp.fromDate(new Date("2028-01-01T00:00:00.000Z")),
    expiresAt: null,
    source: "manual",
    grantedBy: owner.uid,
  });

  const response = await callGrantEnrollment(
    { targetUserId: target.uid, courseId, expiresAt: null },
    owner.idToken,
  );
  assert.equal(response.error?.status, "FAILED_PRECONDITION");
  assert.equal((await reference.get()).get("status"), "revoked");
});

test("forged authority fields are rejected without an Enrollment write", async () => {
  const courseId = "quantum-physics";
  await putCourse(courseId, "published");
  const { reference } = enrollmentReference(courseId);
  const response = await callGrantEnrollment(
    {
      targetUserId: target.uid,
      courseId,
      expiresAt: null,
      status: "active",
      grantedBy: owner.uid,
    },
    owner.idToken,
  );
  assert.equal(response.error?.status, "INVALID_ARGUMENT");
  assert.equal((await reference.get()).exists, false);
});

test("past expiry is rejected without an Enrollment write", async () => {
  const courseId = "past-expiry-course";
  await putCourse(courseId, "published");
  const { reference } = enrollmentReference(courseId);
  const response = await callGrantEnrollment(
    {
      targetUserId: target.uid,
      courseId,
      expiresAt: "2020-01-01T00:00:00.000Z",
    },
    owner.idToken,
  );
  assert.equal(response.error?.status, "INVALID_ARGUMENT");
  assert.equal((await reference.get()).exists, false);
});

test("corrupt existing Enrollment fails closed without overwrite", async () => {
  const courseId = "corrupt-course";
  await putCourse(courseId, "published");
  const { reference } = enrollmentReference(courseId);
  await reference.set({
    userId: "different-user",
    courseId,
    status: "active",
    grantedAt: Timestamp.fromDate(new Date("2028-01-01T00:00:00.000Z")),
    expiresAt: null,
    source: "manual",
    grantedBy: owner.uid,
  });

  const response = await callGrantEnrollment(
    { targetUserId: target.uid, courseId, expiresAt: null },
    owner.idToken,
  );
  assert.equal(response.error?.status, "FAILED_PRECONDITION");
  assert.equal((await reference.get()).get("userId"), "different-user");
});
