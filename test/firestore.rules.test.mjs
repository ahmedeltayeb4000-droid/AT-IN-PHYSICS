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
  Timestamp,
  collection,
  collectionGroup,
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
const VIDEO_ASSET_ID = "mechanics-intro-motion-video";
const VIDEO_CONTENT_KEY = "A".repeat(43);
const VIDEO_SESSION_PATH =
  "courses/mechanics/modules/motion/sessions/introduction";
const VIDEO_ACCESS_PATH = `${VIDEO_SESSION_PATH}/videoAccess/primary`;
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

function enrollment(userId, courseId = "mechanics", overrides = {}) {
  return {
    userId,
    courseId,
    status: "active",
    grantedAt: "fixture-time",
    expiresAt: null,
    source: "manual",
    grantedBy: "fixture-owner",
    ...overrides,
  };
}

function withoutExpiresAt(userId, courseId = "mechanics") {
  const fixture = enrollment(userId, courseId);
  delete fixture.expiresAt;
  return fixture;
}

function videoSession(overrides = {}) {
  return {
    title: "Introduction",
    order: 1,
    publicationStatus: "published",
    videoAssetId: VIDEO_ASSET_ID,
    ...overrides,
  };
}

function videoAccess(overrides = {}) {
  return {
    videoAssetId: VIDEO_ASSET_ID,
    contentKey: VIDEO_CONTENT_KEY,
    ...overrides,
  };
}

function courseDocument(courseId = "new-course", overrides = {}) {
  return {
    slug: courseId,
    title: "New Course",
    shortDescription: "A trusted draft Course.",
    status: "draft",
    ...overrides,
  };
}

async function seedDocuments(fixtures) {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(
      Object.entries(fixtures).map(([path, data]) =>
        setDoc(doc(db, path), data),
      ),
    );
  });
}

function authenticatedDb(uid) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

function ownerDb(owner = true) {
  return testEnvironment
    .authenticatedContext("trusted-owner", { owner })
    .firestore();
}

function unauthenticatedDb() {
  return testEnvironment.unauthenticatedContext().firestore();
}

before(async () => {
  const { host, port } = emulatorConfiguration();
  const rules = await readFile(
    new URL("../firestore.rules", import.meta.url),
    "utf8",
  );
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
    getDoc(
      doc(authenticatedDb(CURRENT_UID), `enrollments/${CURRENT_UID}_mechanics`),
    ),
  );
  assert.equal(snapshot.exists(), true);
});

test("authenticated student cannot get another student's Enrollment", async () => {
  await seedDocuments({
    [`enrollments/${OTHER_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  await assertFails(
    getDoc(
      doc(authenticatedDb(CURRENT_UID), `enrollments/${OTHER_UID}_mechanics`),
    ),
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
    getDoc(
      doc(authenticatedDb(CURRENT_UID), `enrollments/${CURRENT_UID}_mechanics`),
    ),
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
    await assertFails(
      updateDoc(doc(authenticatedDb(CURRENT_UID), path), change),
    );
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

test("authenticated non-owner and missing or false owner claims cannot read a draft Course", async () => {
  await seedDocuments({
    "courses/draft-course": { status: "draft", title: "Draft" },
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), "courses/draft-course")),
  );
  await assertFails(getDoc(doc(ownerDb(false), "courses/draft-course")));
});

test("owner claim reads draft Course and lists draft plus published inventory", async () => {
  await seedDocuments({
    "courses/draft-course": { status: "draft", title: "Draft" },
    "courses/published-course": { status: "published", title: "Published" },
  });
  await assertSucceeds(getDoc(doc(ownerDb(), "courses/draft-course")));
  const snapshot = await assertSucceeds(
    getDocs(collection(ownerDb(), "courses")),
  );
  assert.deepEqual(snapshot.docs.map(({ id }) => id).sort(), [
    "draft-course",
    "published-course",
  ]);
});

test("non-owner Course listing remains constrained to published documents", async () => {
  await seedDocuments({
    "courses/draft-course": { status: "draft", title: "Draft" },
    "courses/published-course": { status: "published", title: "Published" },
  });
  const publishedQuery = query(
    collection(authenticatedDb(CURRENT_UID), "courses"),
    where("status", "==", "published"),
  );
  const snapshot = await assertSucceeds(getDocs(publishedQuery));
  assert.deepEqual(
    snapshot.docs.map(({ id }) => id),
    ["published-course"],
  );
  await assertFails(
    getDocs(collection(authenticatedDb(CURRENT_UID), "courses")),
  );
});

test("owner cannot create, update, or delete Course documents", async () => {
  const path = "courses/draft-course";
  await seedDocuments({ [path]: { status: "draft", title: "Draft" } });
  await assertFails(
    setDoc(doc(ownerDb(), "courses/new-course"), { status: "draft" }),
  );
  await assertFails(updateDoc(doc(ownerDb(), path), { status: "published" }));
  await assertFails(deleteDoc(doc(ownerDb(), path)));
});

test("only owner true can create an exact valid draft Course", async () => {
  const path = "courses/new-course";
  await assertFails(setDoc(doc(unauthenticatedDb(), path), courseDocument()));
  await assertFails(
    setDoc(doc(authenticatedDb(CURRENT_UID), path), courseDocument()),
  );
  await assertFails(setDoc(doc(ownerDb(false), path), courseDocument()));
  await assertSucceeds(setDoc(doc(ownerDb(), path), courseDocument()));
  await assertSucceeds(getDoc(doc(ownerDb(), path)));
  await assertFails(getDoc(doc(unauthenticatedDb(), path)));
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Course create rejects status, slug, missing-field, and extra-field attacks", async () => {
  const attempts = [
    courseDocument("new-course", { status: "published" }),
    courseDocument("new-course", { status: "other" }),
    courseDocument("different-course"),
    { slug: "new-course", title: "Title", status: "draft" },
    courseDocument("new-course", { owner: true }),
  ];
  for (const data of attempts) {
    await assertFails(setDoc(doc(ownerDb(), "courses/new-course"), data));
  }
});

test("Course create enforces canonical ID and trusted text validation", async () => {
  for (const courseId of [
    "Unsafe",
    "unsafe/path",
    "-course",
    "course-",
    "course--two",
    "a".repeat(129),
  ]) {
    await assertFails(
      setDoc(
        doc(ownerDb(), `courses/${courseId.replace("/", "-")}`),
        courseDocument(courseId),
      ),
    );
  }
  for (const overrides of [
    { title: "" },
    { title: "   " },
    { shortDescription: "" },
    { shortDescription: "   " },
    { title: " Leading" },
    { title: "Trailing " },
    { shortDescription: " Leading" },
    { shortDescription: "Trailing " },
    { title: "a".repeat(161) },
    { shortDescription: "a".repeat(1001) },
    { title: "Bad\u0000Title" },
    { shortDescription: "Bad\u007fDescription" },
  ]) {
    await assertFails(
      setDoc(
        doc(ownerDb(), "courses/new-course"),
        courseDocument("new-course", overrides),
      ),
    );
  }
});

test("Course create length matches trusted UTF-16 astral-character boundaries", async () => {
  await assertSucceeds(
    setDoc(
      doc(ownerDb(), "courses/unicode-course"),
      courseDocument("unicode-course", { title: "😀".repeat(80) }),
    ),
  );
  await assertFails(
    setDoc(
      doc(ownerDb(), "courses/unicode-course-too-long"),
      courseDocument("unicode-course-too-long", { title: "😀".repeat(81) }),
    ),
  );
});

test("an existing Course cannot be overwritten through create or update", async () => {
  const path = "courses/existing-course";
  await seedDocuments({ [path]: courseDocument("existing-course") });
  await assertFails(
    setDoc(
      doc(ownerDb(), path),
      courseDocument("existing-course", { title: "Changed" }),
    ),
  );
});

test("Course create authority does not grant writes to adjacent resources", async () => {
  const writes = [
    ["courses/course/modules/module", { title: "Module", order: 0 }],
    [
      "courses/course/modules/module/sessions/session",
      { title: "Session", order: 0 },
    ],
    [
      "courses/course/modules/module/sessionDiscovery/visible",
      { sessionIds: [] },
    ],
    [
      "courses/course/modules/module/sessions/session/videoAccess/primary",
      videoAccess(),
    ],
    ["enrollments/trusted-owner_course", enrollment("trusted-owner", "course")],
  ];
  for (const [path, data] of writes) {
    await assertFails(setDoc(doc(ownerDb(), path), data));
  }
});

test("owner creates an exact Module only beneath a valid existing Course", async () => {
  await seedDocuments({
    "courses/module-course": courseDocument("module-course"),
  });
  const path = "courses/module-course/modules/motion";
  await assertSucceeds(
    setDoc(doc(ownerDb(), path), { title: "Motion", order: 0 }),
  );
  const snapshot = await assertSucceeds(getDoc(doc(ownerDb(), path)));
  assert.deepEqual(snapshot.data(), { title: "Motion", order: 0 });
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const modules = await getDocs(
      collection(context.firestore(), "courses/module-course/modules"),
    );
    assert.deepEqual(
      modules.docs.map(({ id }) => id),
      ["motion"],
    );
  });
});

test("Module create requires owner true and a valid parent Course", async () => {
  await seedDocuments({
    "courses/module-course": courseDocument("module-course"),
    "courses/malformed-course": {
      ...courseDocument("malformed-course"),
      extra: true,
    },
  });
  const data = { title: "Motion", order: 0 };
  await assertFails(
    setDoc(
      doc(unauthenticatedDb(), "courses/module-course/modules/unauth"),
      data,
    ),
  );
  await assertFails(
    setDoc(
      doc(
        authenticatedDb(CURRENT_UID),
        "courses/module-course/modules/student",
      ),
      data,
    ),
  );
  await assertFails(
    setDoc(
      doc(ownerDb(false), "courses/module-course/modules/false-owner"),
      data,
    ),
  );
  await assertFails(
    setDoc(doc(ownerDb(), "courses/missing-course/modules/orphan"), data),
  );
  await assertFails(
    setDoc(doc(ownerDb(), "courses/malformed-course/modules/module"), data),
  );
});

test("Module create rejects ID, schema, title, order, and path manipulation", async () => {
  await seedDocuments({
    "courses/module-course": courseDocument("module-course"),
    "courses/other-course": courseDocument("other-course"),
  });
  const attempts = [
    ["Unsafe", { title: "Motion", order: 0 }],
    ["module", { order: 0 }],
    ["module", { title: "Motion" }],
    ["module", { title: "Motion", order: 0, status: "draft" }],
    ["module", { title: "Motion", order: 0, owner: true }],
    ["module", { title: "", order: 0 }],
    ["module", { title: " Motion", order: 0 }],
    ["module", { title: "Motion ", order: 0 }],
    ["module", { title: "Bad\u0000Title", order: 0 }],
    ["module", { title: "a".repeat(161), order: 0 }],
    ["module", { title: "Motion", order: -1 }],
    ["module", { title: "Motion", order: 1.5 }],
    ["module", { title: "Motion", order: 9007199254740992 }],
    ["module", { title: "Motion", order: "0" }],
  ];
  for (const [moduleId, data] of attempts) {
    await assertFails(
      setDoc(doc(ownerDb(), `courses/module-course/modules/${moduleId}`), data),
    );
  }
  await assertSucceeds(
    setDoc(doc(ownerDb(), "courses/other-course/modules/module"), {
      title: "Other Course Module",
      order: Number.MAX_SAFE_INTEGER,
    }),
  );
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    assert.equal(
      (
        await getDoc(
          doc(context.firestore(), "courses/module-course/modules/module"),
        )
      ).exists(),
      false,
    );
  });
});

test("owner Module writes remain create-only while inventory listing succeeds", async () => {
  const path = "courses/module-course/modules/existing";
  await seedDocuments({
    "courses/module-course": courseDocument("module-course"),
    [path]: { title: "Existing", order: 0 },
  });
  await assertFails(
    setDoc(doc(ownerDb(), path), { title: "Changed", order: 1 }),
  );
  await assertFails(updateDoc(doc(ownerDb(), path), { order: 1 }));
  await assertFails(deleteDoc(doc(ownerDb(), path)));
  await assertSucceeds(
    getDocs(collection(ownerDb(), "courses/module-course/modules")),
  );
});

test("owner Session get does not grant videoAccess privilege", async () => {
  const modulePath = "courses/mechanics/modules/motion";
  const sessionPath = `${modulePath}/sessions/introduction`;
  const accessPath = `${sessionPath}/videoAccess/primary`;
  await seedDocuments({
    [modulePath]: { title: "Motion", order: 1 },
    [sessionPath]: videoSession(),
    [accessPath]: videoAccess(),
  });
  await assertSucceeds(getDoc(doc(ownerDb(), modulePath)));
  await assertSucceeds(getDoc(doc(ownerDb(), sessionPath)));
  await assertFails(getDoc(doc(ownerDb(), accessPath)));
  await assertFails(
    setDoc(doc(ownerDb(), "courses/mechanics/modules/other"), {
      title: "Other",
      order: 2,
    }),
  );
});

test("owner lists draft and published Sessions only beneath the exact Module", async () => {
  const selectedPath = "courses/mechanics/modules/motion/sessions";
  await seedDocuments({
    [`${selectedPath}/draft-session`]: {
      title: "Draft Session",
      order: 2,
      publicationStatus: "draft",
    },
    [`${selectedPath}/published-session`]: {
      title: "Published Session",
      order: 1,
      publicationStatus: "published",
    },
    "courses/mechanics/modules/forces/sessions/other-module-session": {
      title: "Other Module",
      order: 0,
      publicationStatus: "draft",
    },
    "courses/thermodynamics/modules/heat/sessions/other-course-session": {
      title: "Other Course",
      order: 0,
      publicationStatus: "draft",
    },
  });
  const snapshot = await assertSucceeds(
    getDocs(collection(ownerDb(), selectedPath)),
  );
  assert.deepEqual(snapshot.docs.map(({ id }) => id).sort(), [
    "draft-session",
    "published-session",
  ]);
});

test("owner Session inventory does not grant writes or adjacent reads", async () => {
  const sessionPath = "courses/mechanics/modules/motion/sessions/inventory";
  const discoveryPath =
    "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [sessionPath]: {
      title: "Inventory",
      order: 0,
      publicationStatus: "draft",
    },
    [discoveryPath]: { sessionIds: [] },
    [`${sessionPath}/videoAccess/primary`]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  const owner = ownerDb();
  await assertFails(
    setDoc(doc(owner, `${sessionPath}-new`), {
      title: "New",
      order: 1,
      publicationStatus: "draft",
    }),
  );
  await assertFails(updateDoc(doc(owner, sessionPath), { title: "Changed" }));
  await assertFails(deleteDoc(doc(owner, sessionPath)));
  await assertFails(getDoc(doc(owner, discoveryPath)));
  await assertFails(
    getDocs(
      collection(owner, "courses/mechanics/modules/motion/sessionDiscovery"),
    ),
  );
  await assertFails(getDoc(doc(owner, `${sessionPath}/videoAccess/primary`)));
  await assertFails(getDoc(doc(owner, `enrollments/${CURRENT_UID}_mechanics`)));
});

test("owner-style Session list is denied without owner true", async () => {
  const sessionsPath = "courses/mechanics/modules/motion/sessions";
  await seedDocuments({
    [`${sessionsPath}/draft`]: {
      title: "Draft",
      order: 0,
      publicationStatus: "draft",
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDocs(collection(unauthenticatedDb(), sessionsPath)));
  await assertFails(
    getDocs(collection(authenticatedDb(CURRENT_UID), sessionsPath)),
  );
  await assertFails(getDocs(collection(ownerDb(false), sessionsPath)));
});

test("owner creates only the exact trusted draft Session beneath valid parents", async () => {
  const courseId = "session-create-course";
  const moduleId = "session-create-module";
  const path = `courses/${courseId}/modules/${moduleId}/sessions/introduction`;
  await seedDocuments({
    [`courses/${courseId}`]: courseDocument(courseId),
    [`courses/${courseId}/modules/${moduleId}`]: {
      title: "Module",
      order: 0,
    },
  });
  await assertSucceeds(
    setDoc(doc(ownerDb(), path), {
      title: "Introduction",
      order: 0,
      publicationStatus: "draft",
    }),
  );
  const snapshot = await assertSucceeds(getDoc(doc(ownerDb(), path)));
  assert.deepEqual(snapshot.data(), {
    title: "Introduction",
    order: 0,
    publicationStatus: "draft",
  });
});

test("Session create requires owner true and exact valid parent hierarchy", async () => {
  const data = { title: "Session", order: 0, publicationStatus: "draft" };
  const courseId = "session-parent-course";
  const moduleId = "session-parent-module";
  await seedDocuments({
    [`courses/${courseId}`]: courseDocument(courseId),
    [`courses/${courseId}/modules/${moduleId}`]: {
      title: "Module",
      order: 0,
    },
    "courses/malformed-session-course": {
      ...courseDocument("malformed-session-course"),
      extra: true,
    },
    "courses/malformed-session-course/modules/module": {
      title: "Module",
      order: 0,
    },
    "courses/malformed-session-module-course": courseDocument(
      "malformed-session-module-course",
    ),
    "courses/malformed-session-module-course/modules/module": {
      title: "Module",
      order: -1,
    },
    "courses/other-session-course": courseDocument("other-session-course"),
    "courses/other-session-course/modules/shared-module": {
      title: "Module",
      order: 0,
    },
  });
  const validPath = `courses/${courseId}/modules/${moduleId}/sessions`;
  await assertFails(
    setDoc(doc(unauthenticatedDb(), `${validPath}/unauth`), data),
  );
  await assertFails(
    setDoc(doc(authenticatedDb(CURRENT_UID), `${validPath}/student`), data),
  );
  await assertFails(
    setDoc(doc(ownerDb(false), `${validPath}/false-owner`), data),
  );
  for (const path of [
    "courses/missing-session-course/modules/module/sessions/session",
    "courses/malformed-session-course/modules/module/sessions/session",
    "courses/session-parent-course/modules/missing-module/sessions/session",
    "courses/malformed-session-module-course/modules/module/sessions/session",
    "courses/session-parent-course/modules/shared-module/sessions/session",
  ]) {
    await assertFails(setDoc(doc(ownerDb(), path), data));
  }
});

test("Session create rejects publication, optional fields, extras, and malformed input", async () => {
  const courseId = "session-schema-course";
  const moduleId = "session-schema-module";
  const basePath = `courses/${courseId}/modules/${moduleId}/sessions`;
  const valid = { title: "Session", order: 0, publicationStatus: "draft" };
  await seedDocuments({
    [`courses/${courseId}`]: courseDocument(courseId),
    [`courses/${courseId}/modules/${moduleId}`]: {
      title: "Module",
      order: 0,
    },
  });
  const invalidDocuments = [
    { title: "Session", order: 0 },
    { ...valid, publicationStatus: "published" },
    { ...valid, publicationStatus: "preview" },
    { ...valid, extra: true },
    { ...valid, lessonText: "Injected" },
    { ...valid, releaseAt: Timestamp.now() },
    { ...valid, videoAssetId: "video" },
    { ...valid, contentKey: VIDEO_CONTENT_KEY },
    { ...valid, path: "enrollments/target", owner: true },
    { ...valid, title: "" },
    { ...valid, title: " Trimmed" },
    { ...valid, title: "Bad\u0000Title" },
    { ...valid, title: "a".repeat(161) },
    { ...valid, order: -1 },
    { ...valid, order: 1.5 },
    { ...valid, order: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const [index, data] of invalidDocuments.entries()) {
    await assertFails(
      setDoc(doc(ownerDb(), `${basePath}/invalid-${index}`), data),
    );
  }
  await assertFails(setDoc(doc(ownerDb(), `${basePath}/Invalid`), valid));
});

test("owner cannot overwrite, update, delete, or publish an existing Session", async () => {
  const path = "courses/mechanics/modules/motion/sessions/existing-draft";
  await seedDocuments({
    [path]: { title: "Existing", order: 0, publicationStatus: "draft" },
  });
  await assertFails(
    setDoc(doc(ownerDb(), path), {
      title: "Changed",
      order: 1,
      publicationStatus: "draft",
    }),
  );
  await assertFails(
    updateDoc(doc(ownerDb(), path), { publicationStatus: "published" }),
  );
  await assertFails(deleteDoc(doc(ownerDb(), path)));
});

test("authenticated student without Enrollment cannot read a Module", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({ [path]: { title: "Motion", order: 1 } });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("authenticated student without Enrollment cannot read a Session", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("unauthenticated user cannot read a Module", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(unauthenticatedDb(), path)));
});

test("active non-expiring Enrollment allows Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertSucceeds(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("active future-expiring Enrollment allows Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { expiresAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")) },
    ),
  });
  await assertSucceeds(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("expired Enrollment denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { expiresAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")) },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("revoked Enrollment denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { status: "revoked" },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Enrollment for another Course denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_thermodynamics`]: enrollment(
      CURRENT_UID,
      "thermodynamics",
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("another student's Enrollment denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${OTHER_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("spoofed noncanonical Enrollment ID denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    "enrollments/spoofed-authority": enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("stored Enrollment userId mismatch denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("stored Enrollment courseId mismatch denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "thermodynamics",
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("unknown Enrollment status denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { status: "unknown" },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("missing Enrollment expiresAt denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: withoutExpiresAt(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("malformed Enrollment expiresAt denies Module read", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({
    [path]: { title: "Motion", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { expiresAt: "2100-01-01T00:00:00.000Z" },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("unauthenticated user cannot read a Session", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(unauthenticatedDb(), path)));
});

test("published unscheduled Session allows read with active Enrollment", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertSucceeds(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("draft Session denies read with active Enrollment", async () => {
  const path = "courses/mechanics/modules/motion/sessions/draft";
  await seedDocuments({
    [path]: { title: "Draft", order: 2, publicationStatus: "draft" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("future scheduled Session denies read with active Enrollment", async () => {
  const path = "courses/mechanics/modules/motion/sessions/future";
  await seedDocuments({
    [path]: {
      title: "Future",
      order: 2,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")),
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("past scheduled Session allows read with active Enrollment", async () => {
  const path = "courses/mechanics/modules/motion/sessions/released";
  await seedDocuments({
    [path]: {
      title: "Released",
      order: 2,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")),
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertSucceeds(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("malformed Session publicationStatus denies read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/malformed-status";
  await seedDocuments({
    [path]: { title: "Malformed", order: 2, publicationStatus: "preview" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("missing Session publicationStatus denies read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/missing-status";
  await seedDocuments({
    [path]: { title: "Missing", order: 2 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("malformed Session releaseAt denies read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/malformed-release";
  await seedDocuments({
    [path]: {
      title: "Malformed",
      order: 2,
      publicationStatus: "published",
      releaseAt: "2000-01-01T00:00:00.000Z",
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("null Session releaseAt denies read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/null-release";
  await seedDocuments({
    [path]: {
      title: "Null",
      order: 2,
      publicationStatus: "published",
      releaseAt: null,
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("expired Enrollment denies Session read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { expiresAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")) },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("revoked Enrollment denies Session read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { status: "revoked" },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Enrollment for another Course denies Session read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
    [`enrollments/${CURRENT_UID}_thermodynamics`]: enrollment(
      CURRENT_UID,
      "thermodynamics",
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("another student's Enrollment denies Session read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
    [`enrollments/${OTHER_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("stored authority mismatch denies Session read", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "thermodynamics",
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("active Enrollment allows exact-Course Module list query", async () => {
  await seedDocuments({
    "courses/mechanics/modules/motion": { title: "Motion", order: 1 },
    "courses/mechanics/modules/forces": { title: "Forces", order: 2 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  const snapshot = await assertSucceeds(
    getDocs(
      collection(authenticatedDb(CURRENT_UID), "courses/mechanics/modules"),
    ),
  );
  assert.equal(snapshot.size, 2);
});

test("owner lists multiple Modules beneath published and draft Courses", async () => {
  await seedDocuments({
    "courses/published-course": courseDocument("published-course", {
      status: "published",
    }),
    "courses/published-course/modules/second": { title: "Second", order: 2 },
    "courses/published-course/modules/first": { title: "First", order: 1 },
    "courses/draft-course": courseDocument("draft-course"),
    "courses/draft-course/modules/draft-module": {
      title: "Draft Module",
      order: 0,
    },
  });
  const owner = ownerDb();
  const published = await assertSucceeds(
    getDocs(collection(owner, "courses/published-course/modules")),
  );
  const draft = await assertSucceeds(
    getDocs(collection(owner, "courses/draft-course/modules")),
  );
  assert.equal(published.size, 2);
  assert.equal(draft.size, 1);
  await assertSucceeds(
    getDoc(doc(owner, "courses/draft-course/modules/draft-module")),
  );
});

test("Module list remains denied without owner true or active Enrollment", async () => {
  const modulesPath = "courses/draft-course/modules";
  await seedDocuments({
    "courses/draft-course": courseDocument("draft-course"),
    [`${modulesPath}/module`]: { title: "Module", order: 0 },
  });
  await assertFails(getDocs(collection(unauthenticatedDb(), modulesPath)));
  await assertFails(
    getDocs(collection(authenticatedDb(CURRENT_UID), modulesPath)),
  );
  await assertFails(getDocs(collection(ownerDb(false), modulesPath)));
});

test("expired and revoked Enrollments retain Module-list denial", async () => {
  const modulesPath = "courses/mechanics/modules";
  await seedDocuments({
    [`${modulesPath}/motion`]: { title: "Motion", order: 0 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { expiresAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")) },
    ),
  });
  await assertFails(
    getDocs(collection(authenticatedDb(CURRENT_UID), modulesPath)),
  );
  await seedDocuments({
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { status: "revoked" },
    ),
  });
  await assertFails(
    getDocs(collection(authenticatedDb(CURRENT_UID), modulesPath)),
  );
});

test("owner Course hierarchy inventories remain isolated from protected reads", async () => {
  const modulePath = "courses/mechanics/modules/motion";
  const sessionPath = `${modulePath}/sessions/introduction`;
  const discoveryPath = `${modulePath}/sessionDiscovery/visible`;
  const accessPath = `${sessionPath}/videoAccess/primary`;
  await seedDocuments({
    [modulePath]: { title: "Motion", order: 0 },
    [sessionPath]: videoSession(),
    [discoveryPath]: { sessionIds: ["introduction"] },
    [accessPath]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  const owner = ownerDb();
  await assertSucceeds(getDoc(doc(owner, sessionPath)));
  await assertSucceeds(getDocs(collection(owner, `${modulePath}/sessions`)));
  await assertFails(getDoc(doc(owner, discoveryPath)));
  await assertFails(
    getDocs(collection(owner, `${modulePath}/sessionDiscovery`)),
  );
  await assertFails(getDoc(doc(owner, accessPath)));
  await assertFails(getDocs(collection(owner, `${sessionPath}/videoAccess`)));
  await assertFails(getDoc(doc(owner, `enrollments/${CURRENT_UID}_mechanics`)));
});

test("owner Module inventory permission does not allow update or delete", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({ [path]: { title: "Motion", order: 0 } });
  await assertFails(updateDoc(doc(ownerDb(), path), { title: "Changed" }));
  await assertFails(deleteDoc(doc(ownerDb(), path)));
});

test("enrolled student discovers visible Session IDs and directly reads them", async () => {
  const discoveryPath =
    "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [discoveryPath]: { sessionIds: ["released", "unscheduled"] },
    "courses/mechanics/modules/motion/sessions/released": {
      title: "Released",
      order: 1,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")),
    },
    "courses/mechanics/modules/motion/sessions/unscheduled": {
      title: "Unscheduled",
      order: 2,
      publicationStatus: "published",
    },
    "courses/mechanics/modules/motion/sessions/draft": {
      title: "Draft",
      order: 3,
      publicationStatus: "draft",
    },
    "courses/mechanics/modules/motion/sessions/future": {
      title: "Future",
      order: 4,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")),
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });

  const db = authenticatedDb(CURRENT_UID);
  const discovery = await assertSucceeds(getDoc(doc(db, discoveryPath)));
  assert.deepEqual(discovery.data().sessionIds, ["released", "unscheduled"]);
  for (const sessionId of discovery.data().sessionIds) {
    await assertSucceeds(
      getDoc(doc(db, `courses/mechanics/modules/motion/sessions/${sessionId}`)),
    );
  }
  await assertFails(
    getDoc(doc(db, "courses/mechanics/modules/motion/sessions/draft")),
  );
  await assertFails(
    getDoc(doc(db, "courses/mechanics/modules/motion/sessions/future")),
  );
});

test("unauthenticated user cannot read Session discovery", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({ [path]: { sessionIds: ["unscheduled"] } });
  await assertFails(getDoc(doc(unauthenticatedDb(), path)));
});

test("missing Enrollment denies Session discovery", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({ [path]: { sessionIds: ["unscheduled"] } });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("revoked Enrollment denies Session discovery", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: ["unscheduled"] },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { status: "revoked" },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("expired Enrollment denies Session discovery", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: ["unscheduled"] },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { expiresAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")) },
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("another-Course Enrollment denies Session discovery", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: ["unscheduled"] },
    [`enrollments/${CURRENT_UID}_thermodynamics`]: enrollment(
      CURRENT_UID,
      "thermodynamics",
    ),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("malformed Session discovery documents fail closed", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: "not-a-list" },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));

  await seedDocuments({
    [path]: { sessionIds: ["unscheduled"], forged: true },
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Session discovery with an empty ID fails closed in Rules", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: [""] },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Session discovery with a slash-containing ID fails closed in Rules", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: ["nested/session"] },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Session discovery with duplicate IDs fails closed in Rules", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: ["duplicate", "duplicate"] },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("Session discovery collection list is denied", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({
    [path]: { sessionIds: ["unscheduled"] },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDocs(
      collection(
        authenticatedDb(CURRENT_UID),
        "courses/mechanics/modules/motion/sessionDiscovery",
      ),
    ),
  );
});

test("authenticated student cannot create Session discovery", async () => {
  await assertFails(
    setDoc(
      doc(
        authenticatedDb(CURRENT_UID),
        "courses/mechanics/modules/motion/sessionDiscovery/visible",
      ),
      { sessionIds: ["forged"] },
    ),
  );
});

test("authenticated student cannot update Session discovery", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({ [path]: { sessionIds: ["unscheduled"] } });
  await assertFails(
    updateDoc(doc(authenticatedDb(CURRENT_UID), path), {
      sessionIds: ["forged"],
    }),
  );
});

test("authenticated student cannot delete Session discovery", async () => {
  const path = "courses/mechanics/modules/motion/sessionDiscovery/visible";
  await seedDocuments({ [path]: { sessionIds: ["unscheduled"] } });
  await assertFails(deleteDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("unconstrained exact-Course Session list query is denied", async () => {
  await seedDocuments({
    "courses/mechanics/modules/motion/sessions/introduction": {
      title: "Introduction",
      order: 1,
      publicationStatus: "published",
    },
    "courses/mechanics/modules/motion/sessions/displacement": {
      title: "Displacement",
      order: 2,
      publicationStatus: "draft",
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDocs(
      collection(
        authenticatedDb(CURRENT_UID),
        "courses/mechanics/modules/motion/sessions",
      ),
    ),
  );
});

test("publication-only Session query is denied when future releases are possible", async () => {
  const sessionsPath = "courses/mechanics/modules/motion/sessions";
  await seedDocuments({
    [`${sessionsPath}/released`]: {
      title: "Released",
      order: 1,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")),
    },
    [`${sessionsPath}/future`]: {
      title: "Future",
      order: 2,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")),
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  const publishedQuery = query(
    collection(authenticatedDb(CURRENT_UID), sessionsPath),
    where("publicationStatus", "==", "published"),
  );
  await assertFails(getDocs(publishedQuery));
});

test("elapsed release-cutoff Session query remains denied", async () => {
  const sessionsPath = "courses/mechanics/modules/motion/sessions";
  const elapsedCutoff = Timestamp.fromDate(
    new Date("2001-01-01T00:00:00.000Z"),
  );
  await seedDocuments({
    [`${sessionsPath}/released`]: {
      title: "Released",
      order: 1,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")),
    },
    [`${sessionsPath}/future`]: {
      title: "Future",
      order: 2,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")),
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  const releasedQuery = query(
    collection(authenticatedDb(CURRENT_UID), sessionsPath),
    where("publicationStatus", "==", "published"),
    where("releaseAt", "<=", elapsedCutoff),
  );
  await assertFails(getDocs(releasedQuery));
});

test("Session query with a future release cutoff is denied", async () => {
  const sessionsPath = "courses/mechanics/modules/motion/sessions";
  await seedDocuments({
    [`${sessionsPath}/future`]: {
      title: "Future",
      order: 1,
      publicationStatus: "published",
      releaseAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")),
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  const unsafeQuery = query(
    collection(authenticatedDb(CURRENT_UID), sessionsPath),
    where("publicationStatus", "==", "published"),
    where(
      "releaseAt",
      "<=",
      Timestamp.fromDate(new Date("2200-01-01T00:00:00.000Z")),
    ),
  );
  await assertFails(getDocs(unsafeQuery));
});

test("cross-Course Module collection-group enumeration is denied", async () => {
  await seedDocuments({
    "courses/mechanics/modules/motion": { title: "Motion", order: 1 },
    "courses/thermodynamics/modules/heat": { title: "Heat", order: 1 },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDocs(collectionGroup(authenticatedDb(CURRENT_UID), "modules")),
  );
});

test("cross-Course Session collection-group enumeration is denied", async () => {
  await seedDocuments({
    "courses/mechanics/modules/motion/sessions/introduction": {
      title: "Introduction",
      order: 1,
      publicationStatus: "published",
    },
    "courses/thermodynamics/modules/heat/sessions/introduction": {
      title: "Introduction",
      order: 1,
      publicationStatus: "published",
    },
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDocs(collectionGroup(authenticatedDb(CURRENT_UID), "sessions")),
  );
});

test("authenticated student cannot create a Module", async () => {
  await assertFails(
    setDoc(doc(authenticatedDb(CURRENT_UID), "courses/mechanics/modules/new"), {
      title: "New",
      order: 3,
    }),
  );
});

test("authenticated student cannot update a Module", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({ [path]: { title: "Motion", order: 1 } });
  await assertFails(
    updateDoc(doc(authenticatedDb(CURRENT_UID), path), { title: "Changed" }),
  );
});

test("authenticated student cannot delete a Module", async () => {
  const path = "courses/mechanics/modules/motion";
  await seedDocuments({ [path]: { title: "Motion", order: 1 } });
  await assertFails(deleteDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("authenticated student cannot create a Session", async () => {
  await assertFails(
    setDoc(
      doc(
        authenticatedDb(CURRENT_UID),
        "courses/mechanics/modules/motion/sessions/new",
      ),
      { title: "New", order: 3, publicationStatus: "draft" },
    ),
  );
});

test("authenticated student cannot update a Session", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
  });
  await assertFails(
    updateDoc(doc(authenticatedDb(CURRENT_UID), path), { title: "Changed" }),
  );
});

test("authenticated student cannot delete a Session", async () => {
  const path = "courses/mechanics/modules/motion/sessions/introduction";
  await seedDocuments({
    [path]: { title: "Introduction", order: 1, publicationStatus: "published" },
  });
  await assertFails(deleteDoc(doc(authenticatedDb(CURRENT_UID), path)));
});

test("unauthenticated user cannot get video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(unauthenticatedDb(), VIDEO_ACCESS_PATH)));
});

test("authenticated student without Enrollment cannot get video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("active enrolled student can get valid bound video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertSucceeds(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("expired Enrollment denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { expiresAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")) },
    ),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("revoked Enrollment denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(
      CURRENT_UID,
      "mechanics",
      { status: "revoked" },
    ),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("cross-Course Enrollment denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_thermodynamics`]: enrollment(
      CURRENT_UID,
      "thermodynamics",
    ),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("another user's Enrollment denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${OTHER_UID}_mechanics`]: enrollment(OTHER_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("draft parent Session denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession({ publicationStatus: "draft" }),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("future-release parent Session denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession({
      releaseAt: Timestamp.fromDate(new Date("2100-01-01T00:00:00.000Z")),
    }),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("published unscheduled parent Session allows video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertSucceeds(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("published elapsed-release parent Session allows video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession({
      releaseAt: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")),
    }),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertSucceeds(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("missing parent Session denies video access", async () => {
  await seedDocuments({
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("parent Session without videoAssetId denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: {
      title: "Introduction",
      order: 1,
      publicationStatus: "published",
    },
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("malformed parent Session videoAssetId denies video access", async () => {
  for (const videoAssetId of [
    "nested/path",
    "Uppercase",
    "repeated--hyphen",
    "x".repeat(129),
  ]) {
    await testEnvironment.clearFirestore();
    await seedDocuments({
      [VIDEO_SESSION_PATH]: videoSession({ videoAssetId }),
      [VIDEO_ACCESS_PATH]: videoAccess({ videoAssetId }),
      [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
    });
    await assertFails(
      getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
    );
  }
});

test("mismatched access videoAssetId denies video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess({ videoAssetId: "another-video" }),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});

test("malformed video access document fails closed", async () => {
  for (const accessData of [
    { videoAssetId: VIDEO_ASSET_ID },
    { contentKey: VIDEO_CONTENT_KEY },
    { ...videoAccess(), forged: true },
    videoAccess({ videoAssetId: "Uppercase" }),
  ]) {
    await testEnvironment.clearFirestore();
    await seedDocuments({
      [VIDEO_SESSION_PATH]: videoSession(),
      [VIDEO_ACCESS_PATH]: accessData,
      [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
    });
    await assertFails(
      getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
    );
  }
});

test("malformed or noncanonical contentKey denies video access", async () => {
  for (const contentKey of [
    "A".repeat(42),
    "A".repeat(44),
    `${"A".repeat(42)}+`,
    `${"A".repeat(42)}B`,
  ]) {
    await testEnvironment.clearFirestore();
    await seedDocuments({
      [VIDEO_SESSION_PATH]: videoSession(),
      [VIDEO_ACCESS_PATH]: videoAccess({ contentKey }),
      [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
    });
    await assertFails(
      getDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
    );
  }
});

test("video access document ID other than primary is denied", async () => {
  const alternatePath = `${VIDEO_SESSION_PATH}/videoAccess/alternate`;
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [alternatePath]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(getDoc(doc(authenticatedDb(CURRENT_UID), alternatePath)));
});

test("video access collection list is denied", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    getDocs(
      collection(
        authenticatedDb(CURRENT_UID),
        `${VIDEO_SESSION_PATH}/videoAccess`,
      ),
    ),
  );
});

test("authenticated student cannot create video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    setDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH), videoAccess()),
  );
});

test("authenticated student cannot update video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    updateDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH), {
      contentKey: "E".repeat(43),
    }),
  );
});

test("authenticated student cannot delete video access", async () => {
  await seedDocuments({
    [VIDEO_SESSION_PATH]: videoSession(),
    [VIDEO_ACCESS_PATH]: videoAccess(),
    [`enrollments/${CURRENT_UID}_mechanics`]: enrollment(CURRENT_UID),
  });
  await assertFails(
    deleteDoc(doc(authenticatedDb(CURRENT_UID), VIDEO_ACCESS_PATH)),
  );
});
