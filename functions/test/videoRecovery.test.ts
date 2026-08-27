import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { recoverOwnerExistingDeployment } from "../src/ownerConsole/videoRecovery.js";
import type { OwnerDeployReview } from "../src/ownerConsole/videoDeployment.js";
import type { PreparedVideoPublicationPackage } from "../src/tooling/videoDescriptorPublication.js";
import type { PreflightReport } from "../src/ownerConsole/videoRelease.js";

const target = { courseId: "course", moduleId: "module", sessionId: "session" };
const prepared = {
  input: { ...target, videoAssetId: "session-video", contentKey: "SECRET_CONTENT_KEY" },
  summary: { target, videoAssetId: "session-video", artifactFileName: "session-video.atv1", artifactSha256: "a".repeat(64), plaintextSize: 10, encryptedSize: 42, artifactSha256Verified: true, artifactAuthenticated: true, plaintextMp4Verified: true },
  descriptor: { videoAccess: { contentKey: "SECRET_CONTENT_KEY" } },
} as PreparedVideoPublicationPackage;
const report = {
  projectId: "at-in-physics",
  deployment: { projectId: "at-in-physics", hostingSite: "at-in-physics", hostingTarget: "production", firebaseToolsVersion: "15.28.1", deploySource: "hosting-release", repositoryLocalCli: true, shellRequired: false },
  summary: { fileCount: 2, totalBytes: 52, frontendBytes: 10, protectedMediaBytes: 42, atv1Count: 1 },
  files: [{ path: "index.html", size: 10, sha256: "b".repeat(64) }, { path: "protected-media/session-video.atv1", size: 42, sha256: "a".repeat(64) }],
  gitCommit: "c".repeat(40), firebaseConfigSha256: "d".repeat(64), firebaseRcSha256: "e".repeat(64), formatVersion: "hosting-preflight-v1", generatedAt: "2026-08-27T00:00:00.000Z", quota: { actualRemainingMonthlyTransferIsLocallyKnowable: false }, outcome: "PREFLIGHT PASSED",
} as PreflightReport;
const entry = (name: string) => ({ name, isFile: () => true, isSymbolicLink: () => false }) as never;

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    listPackages: async () => [entry("session-video.publication.json")],
    preparePackage: async () => prepared,
    freshPreflight: async () => ({ report, reportPath: "ignored" }),
    createDeployReview: async (release: unknown, projectId: string, reviewId: string) => ({ reviewId, release, fingerprint: "f".repeat(64), safe: { projectId, hostingSite: "at-in-physics", hostingTarget: "production", firebaseToolsVersion: "15.28.1", gitCommit: report.gitCommit, target, videoAssetId: "session-video", artifactFileName: "session-video.atv1", artifactSha256: "a".repeat(64), artifactSize: 42, hostingRoute: "/protected-media/session-video.atv1", releaseFileCount: 2, releaseTotalBytes: 52, warning: "safe", state: "PRODUCTION_DEPLOYMENT_REVIEW_NOT_DEPLOYED" } }) as OwnerDeployReview,
    verifyRemote: async () => ({ url: "trusted", size: 42, sha256: "a".repeat(64), verified: true as const }),
    ...overrides,
  };
}

test("exact trusted local and remote identity recovers only a safe VERIFIED_DEPLOYED capability", async () => {
  const result = await recoverOwnerExistingDeployment(target, "at-in-physics", "deployment", "review", dependencies());
  assert.equal(result.deployment.status, "VERIFIED_DEPLOYED");
  assert.equal(result.safe.hostingDeploymentPerformed, false);
  assert.equal(result.safe.firestoreBindingPerformed, false);
  assert.doesNotMatch(JSON.stringify(result.safe), /contentKey|SECRET|descriptor/i);
});

test("descriptor discovery fails closed for none, duplicates, malformed entries, and wrong target", async () => {
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ listPackages: async () => [] })), /Exactly one/);
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({
    listPackages: async () => [entry("a-video.publication.json"), entry("b-video.publication.json")],
    preparePackage: async (path: string) => {
      const videoAssetId = path.includes("a-video") ? "a-video" : "b-video";
      return { ...prepared, input: { ...prepared.input, videoAssetId }, summary: { ...prepared.summary, videoAssetId, artifactFileName: `${videoAssetId}.atv1` } };
    },
  })), /Exactly one/);
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ preparePackage: async () => { throw new Error("malformed"); } })), /malformed/);
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ preparePackage: async () => ({ ...prepared, input: { ...prepared.input, sessionId: "other" } }) })), /Exactly one/);
});

test("release, project, and remote mismatches create no verified identity", async () => {
  const changed = { ...report, files: report.files.map((item) => item.path.includes("session-video") ? { ...item, size: 41 } : item) };
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ freshPreflight: async () => ({ report: changed, reportPath: "ignored" }) })), /does not match/);
  const wrongHash = { ...report, files: report.files.map((item) => item.path.includes("session-video") ? { ...item, sha256: "9".repeat(64) } : item) };
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ freshPreflight: async () => ({ report: wrongHash, reportPath: "ignored" }) })), /does not match/);
  const wrongRoute = { ...report, files: report.files.map((item) => item.path.includes("session-video") ? { ...item, path: "protected-media/other-video.atv1" } : item) };
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ freshPreflight: async () => ({ report: wrongRoute, reportPath: "ignored" }) })), /does not match/);
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ freshPreflight: async () => ({ report: { ...report, projectId: "wrong" }, reportPath: "ignored" }) })), /project identity/);
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ freshPreflight: async () => ({ report: { ...report, deployment: { ...report.deployment, hostingSite: "wrong" } }, reportPath: "ignored" }) })), /project identity/);
  await assert.rejects(recoverOwnerExistingDeployment(target, "at-in-physics", "d", "r", dependencies({ verifyRemote: async () => { throw new Error("remote mismatch"); } })), /remote mismatch/);
});

test("recovery source has no deploy executor, CLI execution, or Firestore publication dependency", async () => {
  const source = await readFile(new URL("../../src/ownerConsole/videoRecovery.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /executeOwnerHostingDeployment|runProcess|deployArgs|firebase deploy|publishEncryptedVideoMetadata|runPreparedVideoPublication|Firestore/);
});
