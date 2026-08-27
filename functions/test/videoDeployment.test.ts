import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createOwnerDeployReview,
  executeOwnerHostingDeployment,
  HOSTING_DEPLOY_TIMEOUT_MS,
  retryOwnerRemoteVerification,
  verifyOwnerRemoteArtifact,
} from "../src/ownerConsole/videoDeployment.js";
import type {
  OwnerReleaseReview,
  PreflightReport,
} from "../src/ownerConsole/videoRelease.js";

const artifact = Buffer.from("ATV1-reviewed-ciphertext");
const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
const release = {
  releaseId: "release",
  preparationId: "preparation",
  fingerprint: "a".repeat(64),
  descriptorFileName: "session-video.publication.json",
  prepared: { input: { contentKey: "SECRET_CONTENT_KEY" } },
  safe: {
    projectId: "at-in-physics",
    target: { courseId: "course", moduleId: "module", sessionId: "session" },
    videoAssetId: "session-video",
    artifactFileName: "session-video.atv1",
    artifactSize: artifact.length,
    artifactSha256,
    hostingRoute: "/protected-media/session-video.atv1",
    releaseFileCount: 2,
    atv1Count: 1,
    state: "LOCAL_RELEASE_NOT_DEPLOYED",
  },
} as OwnerReleaseReview;

function report(overrides: Partial<PreflightReport> = {}): PreflightReport {
  return {
    formatVersion: "hosting-preflight-v1",
    generatedAt: "2026-08-27T00:00:00.000Z",
    projectId: "at-in-physics",
    gitCommit: "b".repeat(40),
    firebaseConfigSha256: "c".repeat(64),
    firebaseRcSha256: "d".repeat(64),
    deployment: {
      firebaseToolsVersion: "15.28.1",
      projectId: "at-in-physics",
      hostingTarget: "production",
      hostingSite: "at-in-physics",
      deploySource: "hosting-release",
      repositoryLocalCli: true,
      shellRequired: false,
    },
    summary: {
      fileCount: 2,
      totalBytes: 100,
      frontendBytes: 100 - artifact.length,
      protectedMediaBytes: artifact.length,
      atv1Count: 1,
    },
    quota: { actualRemainingMonthlyTransferIsLocallyKnowable: false },
    files: [
      { path: "index.html", size: 10, sha256: "e".repeat(64) },
      {
        path: "protected-media/session-video.atv1",
        size: artifact.length,
        sha256: artifactSha256,
      },
    ],
    outcome: "PREFLIGHT PASSED — REVIEW REQUIRED; NOTHING DEPLOYED",
    ...overrides,
  };
}

const inspected =
  (value = report()) =>
  async () => ({
    report: value,
    safe: {} as never,
  });

async function review(value = report()) {
  return createOwnerDeployReview(release, "at-in-physics", "review", {
    inspect: inspected(value),
  });
}

function goodResponse(bytes = artifact) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(bytes.length),
      "x-content-type-options": "nosniff",
    },
  });
}

test("review performs zero deploy and returns only exact safe identity", async () => {
  const value = await review();
  assert.equal(value.safe.projectId, "at-in-physics");
  assert.equal(value.safe.hostingTarget, "production");
  assert.equal(value.safe.hostingSite, "at-in-physics");
  assert.equal(value.safe.artifactSha256, artifactSha256);
  assert.equal(value.safe.releaseFileCount, 2);
  assert.doesNotMatch(
    JSON.stringify(value.safe),
    /contentKey|SECRET|credential|token/i,
  );
});

test("deploy uses only process.execPath, pinned script, exact Hosting-only args, fixed cwd, and shell false", async () => {
  const value = await review();
  let invocation: unknown;
  const result = await executeOwnerHostingDeployment(
    value,
    "at-in-physics",
    "deployment",
    {
      inspect: inspected(),
      resolveCli: async () => ({
        version: "15.28.1",
        nodeExecutable: process.execPath,
        cliScript:
          "C:\\trusted-repo\\node_modules\\firebase-tools\\lib\\bin\\firebase.js",
        cwd: "C:\\trusted-repo",
        shell: false,
      }),
      deployArgs: () => [
        "deploy",
        "--only",
        "hosting:production",
        "--project",
        "at-in-physics",
        "--config",
        "C:\\trusted-repo\\firebase.json",
      ],
      runProcess: async (executable, args, options) => {
        invocation = { executable, args, options };
      },
      fetchImpl: async (input, init) => {
        assert.equal(
          String(input),
          "https://at-in-physics.web.app/protected-media/session-video.atv1",
        );
        assert.equal(init?.redirect, "manual");
        return goodResponse();
      },
    },
  );
  assert.deepEqual(invocation, {
    executable: process.execPath,
    args: [
      "C:\\trusted-repo\\node_modules\\firebase-tools\\lib\\bin\\firebase.js",
      "deploy",
      "--only",
      "hosting:production",
      "--project",
      "at-in-physics",
      "--config",
      "C:\\trusted-repo\\firebase.json",
    ],
    options: {
      cwd: "C:\\trusted-repo",
      shell: false,
      windowsHide: true,
      timeout: HOSTING_DEPLOY_TIMEOUT_MS,
      maxBuffer: 512 * 1024,
    },
  });
  assert.equal(result.safe.status, "VERIFIED_DEPLOYED");
});

test("stale Git, config, release inventory, and artifact identity reject before deploy", async () => {
  for (const changed of [
    report({ gitCommit: "9".repeat(40) }),
    report({ firebaseConfigSha256: "9".repeat(64) }),
    report({ firebaseRcSha256: "9".repeat(64) }),
    report({
      files: [
        ...report().files,
        { path: "extra.js", size: 1, sha256: "9".repeat(64) },
      ],
    }),
  ]) {
    const value = await review();
    let deployed = false;
    await assert.rejects(
      executeOwnerHostingDeployment(value, "at-in-physics", "deployment", {
        inspect: inspected(changed),
        runProcess: async () => {
          deployed = true;
        },
      }),
      /stale/,
    );
    assert.equal(deployed, false);
  }
});

test("only one deploy runs at a time and failed process output is never surfaced", async () => {
  const value = await review();
  let releaseFirst!: () => void;
  const blocked = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const dependencies = {
    inspect: inspected(),
    resolveCli: async () => ({
      version: "15.28.1",
      nodeExecutable: process.execPath,
      cliScript: "trusted.js",
      cwd: "trusted",
      shell: false as const,
    }),
    deployArgs: () => ["fixed"],
    runProcess: async () => blocked,
    fetchImpl: async () => goodResponse(),
  };
  const first = executeOwnerHostingDeployment(
    value,
    "at-in-physics",
    "one",
    dependencies,
  );
  await assert.rejects(
    executeOwnerHostingDeployment(value, "at-in-physics", "two", dependencies),
    /already active/,
  );
  releaseFirst();
  await first;
  const failure = executeOwnerHostingDeployment(
    value,
    "at-in-physics",
    "three",
    {
      ...dependencies,
      runProcess: async () => {
        throw new Error("oauth_token=SECRET service-account.json");
      },
    },
  );
  await assert.rejects(failure, /Pinned Firebase Hosting deployment failed/);
  await assert.rejects(
    failure,
    (error: Error) => !error.message.includes("SECRET"),
  );
  await assert.rejects(
    executeOwnerHostingDeployment(value, "at-in-physics", "timeout", {
      ...dependencies,
      runProcess: async (_executable, _args, options) => {
        assert.equal(options.timeout, HOSTING_DEPLOY_TIMEOUT_MS);
        throw new Error("process timed out");
      },
    }),
    /Pinned Firebase Hosting deployment failed/,
  );
});

test("remote verifier accepts exact bytes and rejects hash, size, 404, redirects, oversized body, and timeout", async () => {
  const value = await review();
  const verify = (fetchImpl: typeof fetch, remoteVerifyTimeoutMs?: number) =>
    verifyOwnerRemoteArtifact(value, { fetchImpl, remoteVerifyTimeoutMs });
  assert.equal((await verify(async () => goodResponse())).verified, true);
  const wrongHash = Buffer.from(artifact);
  wrongHash[wrongHash.length - 1] ^= 1;
  await assert.rejects(
    verify(async () => goodResponse(wrongHash)),
    /bytes/,
  );
  await assert.rejects(
    verify(async () => goodResponse(Buffer.from("wrong-size"))),
    /size/,
  );
  await assert.rejects(
    verify(async () => new Response("missing", { status: 404 })),
    /not available/,
  );
  await assert.rejects(
    verify(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/video.atv1" },
        }),
    ),
    /outside/,
  );
  await assert.rejects(
    verify(
      async () =>
        new Response(Buffer.concat([artifact, Buffer.from("extra")]), {
          status: 200,
          headers: {
            "content-type": "application/octet-stream",
            "x-content-type-options": "nosniff",
          },
        }),
    ),
    /exceeded/,
  );
  await assert.rejects(
    verify(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      5,
    ),
    /aborted/,
  );
});

test("verification retry uses stored reviewed identity without redeploy", async () => {
  const value = await review();
  let fetches = 0;
  const result = await retryOwnerRemoteVerification(value, "deployment", {
    fetchImpl: async () => {
      fetches += 1;
      return goodResponse();
    },
  });
  assert.equal(fetches, 1);
  assert.equal(result.status, "VERIFIED_DEPLOYED");
  assert.equal(result.deploymentId, "deployment");
});

test("successful deploy with failed remote verification reports the split state truthfully", async () => {
  const value = await review();
  let deploys = 0;
  const result = await executeOwnerHostingDeployment(
    value,
    "at-in-physics",
    "deployment",
    {
      inspect: inspected(),
      resolveCli: async () => ({
        version: "15.28.1",
        nodeExecutable: process.execPath,
        cliScript: "trusted.js",
        cwd: "trusted",
        shell: false,
      }),
      deployArgs: () => ["fixed"],
      runProcess: async () => {
        deploys += 1;
      },
      fetchImpl: async () => new Response("missing", { status: 404 }),
    },
  );
  assert.equal(deploys, 1);
  assert.equal(result.deployCompleted, true);
  assert.equal(
    result.safe.status,
    "DEPLOYMENT_COMPLETED_REMOTE_VERIFICATION_FAILED",
  );
  assert.equal(result.safe.remoteVerified, false);
});

test("deployment implementation has no Firestore or binding dependency", async () => {
  const source = await readFile(
    new URL("../../src/ownerConsole/videoDeployment.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /firebase-admin|Firestore|videoAccess|publishEncryptedVideoMetadata|lessonText|sessionDiscovery/,
  );
});
