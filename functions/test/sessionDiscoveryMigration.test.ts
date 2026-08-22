import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSessionDiscoveryMigrationArgs,
  resolveSessionDiscoveryProjectId,
} from "../src/tooling/sessionDiscoveryMigration.js";

test("valid arguments default to dry run", () => {
  assert.deepEqual(
    parseSessionDiscoveryMigrationArgs([
      "--course-id",
      "mechanics",
      "--module-id",
      "mechanics-motion-basics",
    ]),
    {
      courseId: "mechanics",
      moduleId: "mechanics-motion-basics",
      apply: false,
    },
  );
});

test("explicit apply arguments enable apply mode", () => {
  assert.equal(
    parseSessionDiscoveryMigrationArgs([
      "--course-id",
      "mechanics",
      "--module-id",
      "mechanics-motion-basics",
      "--apply",
    ]).apply,
    true,
  );
});

test("missing required IDs are rejected", () => {
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--module-id",
        "mechanics-motion-basics",
      ]),
    /courseId/,
  );
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs(["--course-id", "mechanics"]),
    /moduleId/,
  );
});

test("missing and blank option values are rejected", () => {
  assert.throws(
    () => parseSessionDiscoveryMigrationArgs(["--course-id", "--apply"]),
    /requires a value/,
  );
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "   ",
        "--module-id",
        "module-one",
      ]),
    /courseId/,
  );
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "mechanics",
        "--module-id",
        "   ",
      ]),
    /moduleId/,
  );
});

test("unknown flags and positional garbage are rejected", () => {
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "mechanics",
        "--module-id",
        "module-one",
        "--unknown",
      ]),
    /Unknown option/,
  );
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "mechanics",
        "--module-id",
        "module-one",
        "garbage",
      ]),
    /Unknown option/,
  );
});

test("unsafe IDs are rejected by the canonical input validator", () => {
  for (const courseId of [
    "UPPERCASE",
    "nested/path",
    "leading-",
    "two--hyphens",
  ]) {
    assert.throws(
      () =>
        parseSessionDiscoveryMigrationArgs([
          "--course-id",
          courseId,
          "--module-id",
          "module-one",
        ]),
      /courseId/,
    );
  }
});

test("apply takes no value and duplicate apply is rejected", () => {
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "mechanics",
        "--module-id",
        "module-one",
        "--apply",
        "true",
      ]),
    /Unknown option/,
  );
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "mechanics",
        "--module-id",
        "module-one",
        "--apply",
        "--apply",
      ]),
    /only once/,
  );
});

test("duplicate ID options are rejected", () => {
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "mechanics",
        "--course-id",
        "thermodynamics",
        "--module-id",
        "module-one",
      ]),
    /only once/,
  );
  assert.throws(
    () =>
      parseSessionDiscoveryMigrationArgs([
        "--course-id",
        "mechanics",
        "--module-id",
        "module-one",
        "--module-id",
        "module-two",
      ]),
    /only once/,
  );
});

test("project identity requires one matching usable environment value", () => {
  assert.equal(
    resolveSessionDiscoveryProjectId({ GCLOUD_PROJECT: "demo-at-in-physics" }),
    "demo-at-in-physics",
  );
  assert.equal(
    resolveSessionDiscoveryProjectId({
      GCLOUD_PROJECT: "demo-at-in-physics",
      GOOGLE_CLOUD_PROJECT: "demo-at-in-physics",
    }),
    "demo-at-in-physics",
  );
  assert.throws(() => resolveSessionDiscoveryProjectId({}), /required/);
  assert.throws(
    () =>
      resolveSessionDiscoveryProjectId({
        GCLOUD_PROJECT: "demo-one",
        GOOGLE_CLOUD_PROJECT: "demo-two",
      }),
    /do not match/,
  );
});
