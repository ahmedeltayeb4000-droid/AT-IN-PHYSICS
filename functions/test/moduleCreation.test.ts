import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrustedModuleDocument,
  getModulePath,
  inspectExistingModule,
  parseModuleCreationArgs,
  resolveModuleCreationProject,
  safeModuleCreationSummary,
  validateModuleOrder,
} from "../src/tooling/moduleCreation.js";

const VALID = [
  "--course-id",
  "mechanics",
  "--module-id",
  "mechanics-motion-basics",
  "--title",
  "Fundamentals of Motion",
  "--order",
  "0",
];

test("valid parser returns the exact Module contract and defaults to dry run", () => {
  const options = parseModuleCreationArgs(VALID);
  assert.deepEqual(options, {
    courseId: "mechanics",
    moduleId: "mechanics-motion-basics",
    title: "Fundamentals of Motion",
    order: 0,
    apply: false,
  });
  assert.deepEqual(buildTrustedModuleDocument(options), {
    title: "Fundamentals of Motion",
    order: 0,
  });
  assert.equal(parseModuleCreationArgs([...VALID, "--apply"]).apply, true);
});

test("missing, blank, unsafe, duplicate, unknown, positional, path, and authority arguments fail", () => {
  for (const args of [
    [],
    [
      "--course-id",
      "",
      "--module-id",
      "module",
      "--title",
      "Title",
      "--order",
      "0",
    ],
    [
      "--course-id",
      "Course",
      "--module-id",
      "module",
      "--title",
      "Title",
      "--order",
      "0",
    ],
    [
      "--course-id",
      "course",
      "--module-id",
      "../module",
      "--title",
      "Title",
      "--order",
      "0",
    ],
    [
      "--course-id",
      "course",
      "--module-id",
      "module",
      "--title",
      "   ",
      "--order",
      "0",
    ],
    [...VALID, "--course-id", "other"],
    [...VALID, "--module-id", "other"],
    [...VALID, "--title", "Other"],
    [...VALID, "--order", "1"],
    [...VALID, "--apply", "--apply"],
    [...VALID, "garbage"],
    [...VALID, "--path", "courses/other/modules/other"],
    [...VALID, "--status", "published"],
    [...VALID, "--owner", "true"],
    [...VALID, "--course", "forged"],
  ])
    assert.throws(() => parseModuleCreationArgs(args));
});

test("order accepts only canonical nonnegative safe integers", () => {
  for (const value of ["0", "1", "42", 0, 42])
    assert.equal(validateModuleOrder(value), Number(value));
  for (const value of [
    undefined,
    "",
    "-1",
    "+1",
    "01",
    "1.5",
    "1e2",
    " 1",
    NaN,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => validateModuleOrder(value));
});

test("Module path is deterministic from canonical IDs", () => {
  assert.equal(
    getModulePath("mechanics", "motion-basics"),
    "courses/mechanics/modules/motion-basics",
  );
  assert.throws(() => getModulePath("mechanics/other", "motion"));
  assert.throws(() => getModulePath("mechanics", "motion/other"));
});

test("exact-state inspection accepts only missing or exact trusted shape", () => {
  const expected = { title: "Motion", order: 0 };
  assert.equal(inspectExistingModule(undefined, expected), "MISSING");
  assert.equal(
    inspectExistingModule({ title: "Motion", order: 0 }, expected),
    "IDENTICAL",
  );
  for (const existing of [
    { title: "Other", order: 0 },
    { title: "Motion", order: 1 },
    { title: "Motion", order: 0, extra: true },
    { title: "Motion" },
    null,
  ])
    assert.throws(() => inspectExistingModule(existing as never, expected));
});

test("project guard reuses coherent production/demo safety", () => {
  assert.equal(
    resolveModuleCreationProject({ GCLOUD_PROJECT: "at-in-physics" }),
    "at-in-physics",
  );
  assert.equal(
    resolveModuleCreationProject({
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
  ])
    assert.throws(() => resolveModuleCreationProject(environment));
});

test("safe summary contains only intended report fields", () => {
  const summary = safeModuleCreationSummary({
    modulePath: "courses/mechanics/modules/motion",
    currentModule: "MISSING",
    proposedTitle: "Motion",
    proposedOrder: 0,
    changeRequired: true,
    applyStatus: null,
    postApplyVerified: false,
  });
  assert.deepEqual(summary, {
    modulePath: "courses/mechanics/modules/motion",
    currentModule: "MISSING",
    proposedTitle: "Motion",
    proposedOrder: 0,
    changeRequired: true,
    applyStatus: null,
    postApplyVerified: false,
  });
  const serialized = JSON.stringify(summary).toLowerCase();
  for (const sensitive of ["owner", "claim", "credential", "token", "password"])
    assert.equal(serialized.includes(sensitive), false);
});
