import assert from "node:assert/strict";
import test from "node:test";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { parseTrustedCourseTextRequest } from "../src/tooling/courseRequestFile.js";
import {
  parseTrustedModuleCreationRequest,
  parseTrustedSessionCreationRequest,
} from "../src/tooling/hierarchyCreationRequestFile.js";
import {
  applyCourseMetadataCorrection,
  reviewCourseMetadataCorrection,
} from "../src/tooling/courseMetadataCorrection.js";

const proposed = parseTrustedCourseTextRequest({
  courseId: "lifecycle-smoke-test",
  title: "TEST — Session Lifecycle Smoke & ^shell$ punctuation!",
  shortDescription:
    "Controlled production smoke target. Not teaching content; exact text survives.",
});

function fixture() {
  let data = {
    slug: proposed.courseId,
    title: "^Malformed^ title^",
    shortDescription: "^Malformed^ description^",
    status: "draft",
  };
  let revision = 7;
  const reference = {
    get: async () => ({
      exists: true,
      data: () => ({ ...data }),
      updateTime: { toMillis: () => revision },
    }),
  };
  const db = {
    doc: () => reference,
    runTransaction: async (
      operation: (transaction: unknown) => Promise<void>,
    ) =>
      operation({
        get: reference.get,
        update: (_reference: unknown, patch: Partial<typeof data>) => {
          data = { ...data, ...patch };
          revision += 1;
        },
      }),
  } as unknown as Firestore;
  return { db, getData: () => data };
}

test("structured request preserves spaces, em dash, punctuation, and shell metacharacters", () => {
  assert.equal(
    proposed.title,
    "TEST — Session Lifecycle Smoke & ^shell$ punctuation!",
  );
  assert.equal(
    proposed.shortDescription,
    "Controlled production smoke target. Not teaching content; exact text survives.",
  );
});

test("Module and Session structured requests preserve exact reviewed titles", () => {
  assert.deepEqual(
    parseTrustedModuleCreationRequest({
      courseId: "test-course",
      moduleId: "test-module",
      title: "TEST — Module & ^shell$ punctuation!",
      order: 0,
    }),
    {
      courseId: "test-course",
      moduleId: "test-module",
      title: "TEST — Module & ^shell$ punctuation!",
      order: 0,
    },
  );
  assert.deepEqual(
    parseTrustedSessionCreationRequest({
      courseId: "test-course",
      moduleId: "test-module",
      sessionId: "test-session",
      title: "TEST — Session; exact | text > shell",
      order: 0,
      isFree: false,
    }),
    {
      courseId: "test-course",
      moduleId: "test-module",
      sessionId: "test-session",
      title: "TEST — Session; exact | text > shell",
      order: 0,
      isFree: false,
    },
  );
});

test("review and apply update only draft Course text and verify exact reread", async () => {
  const state = fixture();
  const auth = {
    getUser: async () => ({ customClaims: { owner: true } }),
  } as unknown as Auth;
  const review = await reviewCourseMetadataCorrection(
    auth,
    state.db,
    "owner",
    proposed,
  );
  assert.equal(review.changeRequired, true);
  const result = await applyCourseMetadataCorrection(state.db, review);
  assert.deepEqual(result, { status: "corrected", verified: true });
  assert.deepEqual(state.getData(), {
    slug: proposed.courseId,
    title: proposed.title,
    shortDescription: proposed.shortDescription,
    status: "draft",
  });
});
