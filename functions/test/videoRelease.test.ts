import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  preflightOwnerHostingRelease,
  prepareOwnerHostingRelease,
  type OwnerPreparedVideo,
} from "../src/ownerConsole/videoRelease.js";
import type { PreparedVideoPublicationPackage } from "../src/tooling/videoDescriptorPublication.js";

const artifact = Buffer.from("ATV1-test-ciphertext");
const sha256 = createHash("sha256").update(artifact).digest("hex");
const known: OwnerPreparedVideo = {
  preparationId: "opaque-preparation",
  summary: {
    target: { courseId: "course", moduleId: "module", sessionId: "session" },
    videoAssetId: "session-video",
    inputFileName: "lesson.mp4",
    plaintextSize: 10,
    encryptedSize: artifact.length,
    artifactFileName: "session-video.atv1",
    descriptorFileName: "session-video.publication.json",
    artifactSha256: sha256,
    hostingRoute: "/protected-media/session-video.atv1",
    stagingStatus: "prepared",
    status: "LOCAL_ONLY_NOT_UPLOADED",
  },
};
const prepared = {
  descriptor: {
    artifact: { fileName: "session-video.atv1" },
    videoAccess: { contentKey: "SECRET_CONTENT_KEY" },
  },
  input: {
    courseId: "course",
    moduleId: "module",
    sessionId: "session",
    videoAssetId: "session-video",
    contentKey: "SECRET_CONTENT_KEY",
  },
  summary: {
    target: known.summary.target,
    videoAssetId: "session-video",
    artifactFileName: "session-video.atv1",
    artifactSha256: sha256,
    plaintextSize: 10,
    encryptedSize: artifact.length,
    artifactSha256Verified: true,
    artifactAuthenticated: true,
    plaintextMp4Verified: true,
  },
} as PreparedVideoPublicationPackage;

test("exact prepared item produces a ciphertext-only safe release review", async () => {
  let builds = 0;
  const review = await prepareOwnerHostingRelease(
    known,
    "at-in-physics",
    "release-review",
    {
      preparePackage: async () => prepared,
      buildFrontend: async () => {
        builds += 1;
      },
      assembleRelease: async () => ({
        releaseRoot: "ignored",
        files: ["index.html", "protected-media/session-video.atv1"],
        mediaCount: 1,
      }),
      readReleaseArtifact: async () => artifact,
    },
  );
  assert.equal(builds, 1);
  assert.equal(review.safe.state, "LOCAL_RELEASE_NOT_DEPLOYED");
  assert.equal(review.safe.artifactSha256, sha256);
  assert.doesNotMatch(
    JSON.stringify(review.safe),
    /SECRET_CONTENT_KEY|contentKey/,
  );
});

test("changed descriptor or changed release artifact is rejected", async () => {
  const base = {
    buildFrontend: async () => undefined,
    assembleRelease: async () => ({
      releaseRoot: "ignored",
      files: ["index.html", "protected-media/session-video.atv1"],
      mediaCount: 1,
    }),
    readReleaseArtifact: async () => artifact,
  };
  await assert.rejects(
    prepareOwnerHostingRelease(known, "at-in-physics", "x", {
      ...base,
      preparePackage: async () => ({
        ...prepared,
        input: { ...prepared.input, sessionId: "other" },
      }),
    }),
    /trusted identity/,
  );
  await assert.rejects(
    prepareOwnerHostingRelease(known, "at-in-physics", "x", {
      ...base,
      preparePackage: async () => prepared,
      readReleaseArtifact: async () => Buffer.from("ATV1-changed"),
    }),
    /integrity/,
  );
});

test("preflight binds exact project, route, size, and hash with truthful quota warning", async () => {
  const review = await prepareOwnerHostingRelease(known, "at-in-physics", "r", {
    preparePackage: async () => prepared,
    buildFrontend: async () => undefined,
    assembleRelease: async () => ({
      releaseRoot: "ignored",
      files: ["index.html", "protected-media/session-video.atv1"],
      mediaCount: 1,
    }),
    readReleaseArtifact: async () => artifact,
  });
  let options: unknown;
  const result = await preflightOwnerHostingRelease(review, "at-in-physics", {
    preparePackage: async () => prepared,
    runPreflight: async (value) => {
      options = value;
      return {
        reportPath: "ignored",
        report: {
          formatVersion: "hosting-preflight-v1",
          generatedAt: "2026-08-27T00:00:00.000Z",
          projectId: "at-in-physics",
          gitCommit: "0".repeat(40),
          firebaseConfigSha256: "1".repeat(64),
          firebaseRcSha256: "2".repeat(64),
          summary: {
            fileCount: 2,
            totalBytes: 100,
            frontendBytes: 80,
            protectedMediaBytes: 20,
            atv1Count: 1,
          },
          quota: { actualRemainingMonthlyTransferIsLocallyKnowable: false },
          deployment: {
            firebaseToolsVersion: "15.28.1",
            projectId: "at-in-physics",
            hostingTarget: "production",
            hostingSite: "at-in-physics",
            deploySource: "hosting-release",
            repositoryLocalCli: true,
            shellRequired: false,
          },
          files: [
            {
              path: "protected-media/session-video.atv1",
              size: artifact.length,
              sha256,
            },
          ],
          outcome: "PREFLIGHT PASSED — REVIEW REQUIRED; NOTHING DEPLOYED",
        },
      };
    },
  });
  assert.deepEqual(options, {
    projectId: "at-in-physics",
    expectedProjectId: "at-in-physics",
  });
  assert.equal(result.state, "READY_FOR_DEPLOYMENT_REVIEW_NOT_DEPLOYED");
  assert.equal(result.firebaseToolsVersion, "15.28.1");
  assert.equal(result.hostingTarget, "production");
  assert.equal(result.hostingSite, "at-in-physics");
  assert.equal(result.remainingMonthlyTransferKnown, false);
  assert.match(result.quotaWarning, /cannot be proven locally/);
});
