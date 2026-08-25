import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  DEFAULT_PREFLIGHT_REPORT_ROOT,
  HOSTING_MAX_FILE_BYTES,
  HOSTING_STORAGE_NO_COST_BYTES,
  parseDeployPreflightArgs,
  resolveExplicitProjectTarget,
  runHostingDeployPreflight,
  validateHostingConfiguration,
  validateHostingQuota,
} from "../scripts/hosting/deployPreflight.mjs";

const execFileAsync = promisify(execFile);
const COMMIT = "a".repeat(40);
const CLEAN_GIT = async () => ({ status: "", commit: COMMIT });
const NOW = () => new Date("2026-08-26T00:00:00.000Z");

async function temporary(callback) {
  const root = await mkdtemp(join(tmpdir(), "at-deploy-preflight-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function fixture(root, index = "<!doctype html><title>safe</title>") {
  const releaseRoot = join(root, "hosting-release");
  const reportRoot = join(root, "hosting-deploy-preflight");
  const firebaseConfigPath = join(root, "firebase.json");
  await mkdir(join(releaseRoot, "assets"), { recursive: true });
  await writeFile(join(releaseRoot, "index.html"), index);
  await writeFile(join(releaseRoot, "assets", "app.js"), "console.log('safe')");
  await writeFile(
    firebaseConfigPath,
    JSON.stringify({
      hosting: {
        public: "hosting-release",
        rewrites: [
          { source: "!/@(protected-media)/**", destination: "/index.html" },
        ],
      },
    }),
  );
  return { releaseRoot, reportRoot, firebaseConfigPath };
}

function options(paths, overrides = {}) {
  return {
    projectId: "at-in-physics",
    expectedProjectId: "at-in-physics",
    environment: {},
    gitInspector: CLEAN_GIT,
    now: NOW,
    ...paths,
    ...overrides,
  };
}

test("clean release produces a complete deterministic local report", async () =>
  temporary(async (root) => {
    const paths = await fixture(root);
    const result = await runHostingDeployPreflight(options(paths));
    assert.equal(result.report.projectId, "at-in-physics");
    assert.equal(result.report.gitCommit, COMMIT);
    assert.equal(result.report.summary.fileCount, 2);
    assert.equal(result.report.summary.protectedMediaBytes, 0);
    assert.equal(result.report.summary.atv1Count, 0);
    assert.equal(
      result.report.quota.actualRemainingMonthlyTransferIsLocallyKnowable,
      false,
    );
    assert.deepEqual(
      result.report.files.map((entry) => entry.path),
      ["assets/app.js", "index.html"],
    );
    const persisted = JSON.parse(await readFile(result.reportPath, "utf8"));
    assert.deepEqual(persisted, result.report);
  }));

test("missing, wrong, and conflicting project targets fail closed", () => {
  assert.throws(() => parseDeployPreflightArgs([]), /Explicit target/);
  assert.throws(
    () =>
      resolveExplicitProjectTarget({
        projectId: "at-in-physics",
        expectedProjectId: "another-project",
        environment: {},
      }),
    /differ/,
  );
  assert.throws(
    () =>
      resolveExplicitProjectTarget({
        projectId: "at-in-physics",
        expectedProjectId: "at-in-physics",
        environment: {
          GCLOUD_PROJECT: "at-in-physics",
          GOOGLE_CLOUD_PROJECT: "other-project",
        },
      }),
    /Conflicting/,
  );
  assert.throws(
    () =>
      resolveExplicitProjectTarget({
        projectId: "at-in-physics",
        expectedProjectId: "at-in-physics",
        environment: { FIREBASE_PROJECT_ID: "other-project" },
      }),
    /differs/,
  );
});

test("dirty Git tree fails before creating a report", async () =>
  temporary(async (root) => {
    const paths = await fixture(root);
    await assert.rejects(
      runHostingDeployPreflight(
        options(paths, {
          gitInspector: async () => ({
            status: " M package.json\n",
            commit: COMMIT,
          }),
        }),
      ),
      /must be clean/,
    );
    await assert.rejects(readFile(join(paths.reportRoot, "preflight.json")), {
      code: "ENOENT",
    });
  }));

test("descriptor, MP4, and noncanonical protected-media paths fail", async () =>
  temporary(async (root) => {
    for (const fileName of [
      "lesson.publication.json",
      "lesson.mp4",
      "nested/lesson.atv1",
    ]) {
      const caseRoot = join(root, fileName.replaceAll("/", "-"));
      await mkdir(caseRoot);
      const paths = await fixture(caseRoot);
      const destination = join(paths.releaseRoot, "protected-media", fileName);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(
        destination,
        Buffer.concat([Buffer.from("ATV1"), Buffer.alloc(40)]),
      );
      await assert.rejects(
        runHostingDeployPreflight(options(paths)),
        /Forbidden|not ATV1|not canonical/,
      );
    }
  }));

test("symlinked release entries fail closed where supported", async () =>
  temporary(async (root) => {
    const paths = await fixture(root);
    const real = join(root, "real-directory");
    await mkdir(real);
    await writeFile(join(real, "file.js"), "safe");
    try {
      await symlink(real, join(paths.releaseRoot, "linked"), "junction");
    } catch (error) {
      if (error.code === "EPERM") return;
      throw error;
    }
    await assert.rejects(runHostingDeployPreflight(options(paths)), /symlink/i);
  }));

test("quota checks reject oversized files and synthetic storage footprints", () => {
  assert.throws(
    () =>
      validateHostingQuota([
        { path: "huge.bin", size: HOSTING_MAX_FILE_BYTES + 1 },
      ]),
    /2 GiB/,
  );
  const entries = Array.from({ length: 6 }, (_, index) => ({
    path: `protected-media/video-${index}.atv1`,
    size: 2 * 1024 ** 3,
  }));
  assert.equal(
    entries.reduce((sum, entry) => sum + entry.size, 0) >
      HOSTING_STORAGE_NO_COST_BYTES,
    true,
  );
  assert.throws(() => validateHostingQuota(entries), /10 GiB/);
});

test("hashes are deterministic and release mutation changes only affected hash", async () =>
  temporary(async (root) => {
    const paths = await fixture(root, "first");
    const first = await runHostingDeployPreflight(options(paths));
    const second = await runHostingDeployPreflight(options(paths));
    assert.deepEqual(first.report.files, second.report.files);
    await writeFile(join(paths.releaseRoot, "index.html"), "second");
    const third = await runHostingDeployPreflight(options(paths));
    const firstIndex = first.report.files.find(
      (entry) => entry.path === "index.html",
    );
    const thirdIndex = third.report.files.find(
      (entry) => entry.path === "index.html",
    );
    assert.notEqual(firstIndex.sha256, thirdIndex.sha256);
    assert.equal(
      thirdIndex.sha256,
      createHash("sha256").update("second").digest("hex"),
    );
  }));

test("report contains no file contents, content key, or credentials", async () =>
  temporary(async (root) => {
    const sentinel = "contentKey-super-secret-sentinel";
    const paths = await fixture(root, sentinel);
    const result = await runHostingDeployPreflight(options(paths));
    const serialized = JSON.stringify(result.report);
    assert.equal(serialized.includes(sentinel), false);
    assert.equal(serialized.includes("contentKey"), false);
    assert.equal(serialized.includes("private_key"), false);
    assert.equal(serialized.includes("client_email"), false);
  }));

test("Hosting config rejects unsafe public roots and dynamic rewrites", () => {
  for (const hosting of [
    { public: ".", rewrites: [] },
    {
      public: "hosting-release",
      rewrites: [{ source: "**", function: "app" }],
    },
    {
      public: "hosting-release",
      rewrites: [{ source: "**", run: { serviceId: "app" } }],
    },
  ]) {
    assert.throws(() => validateHostingConfiguration({ hosting }));
  }
});

test("preflight is offline, contains no deploy invocation, and report root is ignored", async () => {
  const moduleSource = await readFile(
    new URL("../scripts/hosting/deployPreflight.mjs", import.meta.url),
    "utf8",
  );
  const cliSource = await readFile(
    new URL("../scripts/hosting/deploy-preflight.mjs", import.meta.url),
    "utf8",
  );
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const networkOrDeploy =
    /execFileAsync\(\s*["']firebase|fetch\(|https?:|firebase deploy/;
  assert.equal(networkOrDeploy.test(moduleSource), false);
  assert.equal(networkOrDeploy.test(cliSource), false);
  assert.equal(
    packageJson.scripts["hosting:deploy:preflight"].includes("firebase"),
    false,
  );
  await execFileAsync(
    "git",
    [
      "check-ignore",
      "--quiet",
      "--no-index",
      join(DEFAULT_PREFLIGHT_REPORT_ROOT, "preflight.json"),
    ],
    { cwd: dirname(DEFAULT_PREFLIGHT_REPORT_ROOT) },
  );
});
