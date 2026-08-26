import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrustedCourseDocument,
  getCoursePath,
  parseCourseCreationArgs,
  resolveCourseCreationProject,
  safeCourseCreationSummary,
} from "../src/tooling/courseCreation.js";

const VALID = [
  "--course-id",
  "thin-film-physics",
  "--title",
  "Thin Film Physics",
  "--short-description",
  "Surfaces, interfaces, and thin films.",
];

test("valid arguments produce the exact draft contract and default to dry run", () => {
  const options = parseCourseCreationArgs(VALID);
  assert.equal(options.apply, false);
  assert.deepEqual(buildTrustedCourseDocument(options), {
    slug: "thin-film-physics",
    title: "Thin Film Physics",
    shortDescription: "Surfaces, interfaces, and thin films.",
    status: "draft",
  });
  assert.equal(parseCourseCreationArgs([...VALID, "--apply"]).apply, true);
});

test("blank, unsafe, malformed, duplicate, unknown, positional, and authority inputs fail", () => {
  for (const args of [
    [],
    [
      "--course-id",
      "",
      "--title",
      "Title",
      "--short-description",
      "Description",
    ],
    [
      "--course-id",
      "Unsafe/Path",
      "--title",
      "Title",
      "--short-description",
      "Description",
    ],
    [
      "--course-id",
      "course",
      "--title",
      " Title",
      "--short-description",
      "Description",
    ],
    ["--course-id", "course", "--title", "Title", "--short-description", "   "],
    [...VALID, "--course-id", "other"],
    [...VALID, "--title", "Other"],
    [...VALID, "--short-description", "Other"],
    [...VALID, "--apply", "--apply"],
    [...VALID, "positional"],
    [...VALID, "--status", "published"],
    [...VALID, "--slug", "forged"],
    [...VALID, "--owner", "true"],
    [...VALID, "--path", "courses/other"],
  ])
    assert.throws(() => parseCourseCreationArgs(args));
});

test("IDs and paths are deterministic and strictly bounded", () => {
  for (const id of ["mechanics", "physics-2", "a1-b2"]) {
    assert.equal(getCoursePath(id), `courses/${id}`);
  }
  for (const id of [
    "",
    "-course",
    "course-",
    "course--two",
    "Course",
    "a/b",
    "a.b",
    "a".repeat(129),
  ]) {
    assert.throws(() => getCoursePath(id));
  }
});

test("title and description lengths are bounded", () => {
  assert.throws(() =>
    parseCourseCreationArgs([
      "--course-id",
      "course",
      "--title",
      "a".repeat(161),
      "--short-description",
      "ok",
    ]),
  );
  assert.throws(() =>
    parseCourseCreationArgs([
      "--course-id",
      "course",
      "--title",
      "ok",
      "--short-description",
      "a".repeat(1001),
    ]),
  );
});

test("project guard approves only coherent production or emulator targets", () => {
  assert.equal(
    resolveCourseCreationProject({ GCLOUD_PROJECT: "at-in-physics" }),
    "at-in-physics",
  );
  assert.equal(
    resolveCourseCreationProject({
      GCLOUD_PROJECT: "demo-at-in-physics",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    }),
    "demo-at-in-physics",
  );
  for (const environment of [
    {},
    { GCLOUD_PROJECT: "other" },
    { GCLOUD_PROJECT: "demo-at-in-physics" },
    {
      GCLOUD_PROJECT: "at-in-physics",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    },
    { GCLOUD_PROJECT: "at-in-physics", GOOGLE_CLOUD_PROJECT: "other" },
  ]) {
    assert.throws(() => resolveCourseCreationProject(environment));
  }
});

test("safe summary exposes no payload, owner, claims, credentials, or tokens", () => {
  const serialized = JSON.stringify(
    safeCourseCreationSummary({
      coursePath: "courses/mechanics",
      currentCourse: "MISSING",
      changeRequired: true,
      applyStatus: null,
      postApplyVerified: false,
    }),
  );
  for (const sensitive of [
    "title",
    "description",
    "owner",
    "claim",
    "credential",
    "token",
    "password",
  ])
    assert.equal(serialized.toLowerCase().includes(sensitive), false);
});
