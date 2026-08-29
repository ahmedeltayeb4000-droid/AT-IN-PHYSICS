import assert from "node:assert/strict";
import test from "node:test";
import {
  mapProtectedResourceAccessDocument,
  mapProtectedResourceMetadataDocument,
  sortProtectedResourceMetadata,
} from "../src/features/resources/resourceMapper.ts";
import {
  getCourseResourceAccess,
  getCourseResources,
  getSessionResourceAccess,
  getSessionResources,
  ProtectedResourceRepositoryError,
} from "../src/features/resources/resourceRepository.ts";

const COURSE_SCOPE = { type: "course", courseId: "mechanics" };
const HASH = "a".repeat(64);

function metadata(resourceId = "motion-notes", overrides = {}) {
  return {
    version: 1,
    resourceId,
    title: "Motion notes",
    originalFileName: "motion-notes.pdf",
    mimeType: "application/pdf",
    plaintextSize: 1024,
    formatVersion: "ATR1",
    ciphertextRoute: `/protected-resources/courses/mechanics/resources/${resourceId}.atr1`,
    ciphertextSha256: HASH,
    ciphertextSize: 1056,
    createdAt: { seconds: 1, nanoseconds: 0 },
    boundAt: { seconds: 2, nanoseconds: 0 },
    ...overrides,
  };
}

function access(overrides = {}) {
  return {
    version: 1,
    resourceId: "motion-notes",
    formatVersion: "ATR1",
    ciphertextSha256: HASH,
    contentKey: "A".repeat(43),
    ...overrides,
  };
}

function snapshot(id, data, exists = true) {
  return { id, exists: () => exists, data: () => data };
}

function testReads({ lists = {}, documents = {} } = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      async list(path) {
        calls.push({ operation: "list", path: [...path] });
        return {
          docs: (lists[path.join("/")] ?? []).map(({ id, data }) =>
            snapshot(id, data),
          ),
        };
      },
      async get(path) {
        calls.push({ operation: "get", path: [...path] });
        const document = documents[path.join("/")];
        return document
          ? snapshot(document.id, document.data)
          : snapshot(path.at(-1), undefined, false);
      },
    },
  };
}

async function assertSanitizedFailure(action, code) {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof ProtectedResourceRepositoryError);
    assert.equal(error.code, code);
    assert.equal(error.message, "Protected resource is unavailable.");
    assert.doesNotMatch(error.message, /hash|route|contentKey|firestore/i);
    return true;
  });
}

test("repository mapper accepts valid metadata and enforces document ID equality", () => {
  assert.equal(
    mapProtectedResourceMetadataDocument(
      "motion-notes",
      metadata(),
      COURSE_SCOPE,
    ).resourceId,
    "motion-notes",
  );
  assert.throws(() =>
    mapProtectedResourceMetadataDocument("wrong-id", metadata(), COURSE_SCOPE),
  );
});

test("repository mapper rejects malformed metadata and trusted-scope route mismatch", () => {
  assert.throws(() =>
    mapProtectedResourceMetadataDocument(
      "motion-notes",
      metadata("motion-notes", { extra: true }),
      COURSE_SCOPE,
    ),
  );
  assert.throws(() =>
    mapProtectedResourceMetadataDocument(
      "motion-notes",
      metadata(),
      {
        type: "session",
        courseId: "mechanics",
        moduleId: "motion",
        sessionId: "introduction",
      },
    ),
  );
});

test("metadata ordering is stable by title and then resource ID", () => {
  const mapped = [
    metadata("z-resource", { title: "Same" }),
    metadata("a-resource", { title: "Same" }),
    metadata("first-resource", { title: "First" }),
  ].map((data) =>
    mapProtectedResourceMetadataDocument(data.resourceId, data, COURSE_SCOPE),
  );
  assert.deepEqual(
    sortProtectedResourceMetadata(mapped).map(({ resourceId }) => resourceId),
    ["first-resource", "a-resource", "z-resource"],
  );
});

test("access mapper requires exact primary ID and metadata pairing", () => {
  const trustedMetadata = mapProtectedResourceMetadataDocument(
    "motion-notes",
    metadata(),
    COURSE_SCOPE,
  );
  assert.equal(
    mapProtectedResourceAccessDocument(
      "primary",
      access(),
      trustedMetadata,
    ).contentKey.length,
    43,
  );
  assert.throws(() =>
    mapProtectedResourceAccessDocument("alternate", access(), trustedMetadata),
  );
  assert.throws(() =>
    mapProtectedResourceAccessDocument(
      "primary",
      access({ ciphertextSha256: "b".repeat(64) }),
      trustedMetadata,
    ),
  );
  assert.throws(() =>
    mapProtectedResourceAccessDocument(
      "primary",
      access({ extra: true }),
      trustedMetadata,
    ),
  );
});

test("Course and Session metadata APIs issue exact list paths and sort mapped results", async () => {
  const coursePath = "courses/mechanics/resources";
  const sessionPath =
    "courses/mechanics/modules/motion/sessions/introduction/resources";
  const course = testReads({
    lists: {
      [coursePath]: [
        { id: "z-resource", data: metadata("z-resource", { title: "Same" }) },
        { id: "a-resource", data: metadata("a-resource", { title: "Same" }) },
        {
          id: "first-resource",
          data: metadata("first-resource", { title: "First" }),
        },
      ],
    },
  });
  assert.deepEqual(
    (await getCourseResources("mechanics", course.dependencies)).map(
      ({ resourceId }) => resourceId,
    ),
    ["first-resource", "a-resource", "z-resource"],
  );
  assert.deepEqual(course.calls, [
    { operation: "list", path: ["courses", "mechanics", "resources"] },
  ]);

  const sessionData = metadata("motion-notes", {
    ciphertextRoute:
      "/protected-resources/courses/mechanics/modules/motion/sessions/introduction/resources/motion-notes.atr1",
  });
  const session = testReads({
    lists: { [sessionPath]: [{ id: "motion-notes", data: sessionData }] },
  });
  assert.equal(
    (
      await getSessionResources(
        "mechanics",
        "motion",
        "introduction",
        session.dependencies,
      )
    )[0].resourceId,
    "motion-notes",
  );
  assert.deepEqual(session.calls, [
    {
      operation: "list",
      path: [
        "courses",
        "mechanics",
        "modules",
        "motion",
        "sessions",
        "introduction",
        "resources",
      ],
    },
  ]);
});

test("Course and Session access APIs perform two exact gets and never list access", async () => {
  const courseMetadataPath = "courses/mechanics/resources/motion-notes";
  const courseAccessPath = `${courseMetadataPath}/access/primary`;
  const course = testReads({
    documents: {
      [courseMetadataPath]: { id: "motion-notes", data: metadata() },
      [courseAccessPath]: { id: "primary", data: access() },
    },
  });
  assert.equal(
    (
      await getCourseResourceAccess(
        "mechanics",
        "motion-notes",
        course.dependencies,
      )
    ).resourceId,
    "motion-notes",
  );
  assert.deepEqual(course.calls, [
    { operation: "get", path: courseMetadataPath.split("/") },
    { operation: "get", path: courseAccessPath.split("/") },
  ]);

  const sessionMetadataPath =
    "courses/mechanics/modules/motion/sessions/introduction/resources/motion-notes";
  const sessionAccessPath = `${sessionMetadataPath}/access/primary`;
  const sessionMetadata = metadata("motion-notes", {
    ciphertextRoute:
      "/protected-resources/courses/mechanics/modules/motion/sessions/introduction/resources/motion-notes.atr1",
  });
  const session = testReads({
    documents: {
      [sessionMetadataPath]: { id: "motion-notes", data: sessionMetadata },
      [sessionAccessPath]: { id: "primary", data: access() },
    },
  });
  await getSessionResourceAccess(
    "mechanics",
    "motion",
    "introduction",
    "motion-notes",
    session.dependencies,
  );
  assert.deepEqual(session.calls, [
    { operation: "get", path: sessionMetadataPath.split("/") },
    { operation: "get", path: sessionAccessPath.split("/") },
  ]);
  assert.equal(
    [...course.calls, ...session.calls].some(
      ({ operation }) => operation === "list",
    ),
    false,
  );
});

test("every invalid path ID fails before the first Firestore operation", async () => {
  const reads = testReads();
  const cases = [
    () => getCourseResources("Bad", reads.dependencies),
    () => getSessionResources("Bad", "motion", "introduction", reads.dependencies),
    () => getSessionResources("mechanics", "Bad", "introduction", reads.dependencies),
    () => getSessionResources("mechanics", "motion", "Bad", reads.dependencies),
    () => getCourseResourceAccess("Bad", "motion-notes", reads.dependencies),
    () => getCourseResourceAccess("mechanics", "Bad", reads.dependencies),
    () => getSessionResourceAccess("Bad", "motion", "introduction", "motion-notes", reads.dependencies),
    () => getSessionResourceAccess("mechanics", "Bad", "introduction", "motion-notes", reads.dependencies),
    () => getSessionResourceAccess("mechanics", "motion", "Bad", "motion-notes", reads.dependencies),
    () => getSessionResourceAccess("mechanics", "motion", "introduction", "Bad", reads.dependencies),
  ];
  for (const action of cases) {
    await assertSanitizedFailure(action, "validation");
    assert.equal(reads.calls.length, 0);
  }
});

test("repository flow sanitizes malformed metadata before any access read", async () => {
  const metadataPath = "courses/mechanics/resources/motion-notes";
  const reads = testReads({
    documents: {
      [metadataPath]: {
        id: "motion-notes",
        data: metadata("motion-notes", { ciphertextSha256: "secret-bad-hash" }),
      },
    },
  });
  await assertSanitizedFailure(
    () =>
      getCourseResourceAccess(
        "mechanics",
        "motion-notes",
        reads.dependencies,
      ),
    "malformed",
  );
  assert.deepEqual(reads.calls, [
    { operation: "get", path: metadataPath.split("/") },
  ]);
});

test("repository flow sanitizes malformed and mismatched primary access", async () => {
  const metadataPath = "courses/mechanics/resources/motion-notes";
  const accessPath = `${metadataPath}/access/primary`;
  for (const accessData of [
    access({ extra: "secret" }),
    access({ ciphertextSha256: "b".repeat(64) }),
  ]) {
    const reads = testReads({
      documents: {
        [metadataPath]: { id: "motion-notes", data: metadata() },
        [accessPath]: { id: "primary", data: accessData },
      },
    });
    await assertSanitizedFailure(
      () =>
        getCourseResourceAccess(
          "mechanics",
          "motion-notes",
          reads.dependencies,
        ),
      "malformed",
    );
    assert.deepEqual(reads.calls, [
      { operation: "get", path: metadataPath.split("/") },
      { operation: "get", path: accessPath.split("/") },
    ]);
  }
});
