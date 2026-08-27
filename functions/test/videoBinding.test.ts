import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { applyOwnerBindingReview, createOwnerBindingReview, type OwnerVerifiedDeployment } from "../src/ownerConsole/videoBinding.js";
import type { OwnerDeployReview } from "../src/ownerConsole/videoDeployment.js";
import type { PreparedVideoPublicationPackage } from "../src/tooling/videoDescriptorPublication.js";

const secret = "SECRET_CONTENT_KEY";
const prepared = {
  input: { courseId: "course", moduleId: "module", sessionId: "session", videoAssetId: "session-video", contentKey: secret },
  summary: { target: { courseId: "course", moduleId: "module", sessionId: "session" }, videoAssetId: "session-video", artifactFileName: "session-video.atv1", artifactSha256: "a".repeat(64), plaintextSize: 10, encryptedSize: 42, artifactSha256Verified: true, artifactAuthenticated: true, plaintextMp4Verified: true },
  descriptor: { videoAccess: { contentKey: secret } },
} as PreparedVideoPublicationPackage;
const deployment: OwnerVerifiedDeployment = {
  deploymentId: "verified-deployment",
  status: "VERIFIED_DEPLOYED",
  review: { reviewId: "deploy-review", fingerprint: "b".repeat(64), release: { descriptorFileName: "session-video.publication.json" }, safe: { projectId: "at-in-physics", target: prepared.summary.target, videoAssetId: "session-video", artifactFileName: "session-video.atv1", artifactSha256: "a".repeat(64), artifactSize: 42, hostingRoute: "/protected-media/session-video.atv1" } } as OwnerDeployReview,
};

test("verified deployment review is read-only and safe; apply revalidates then invokes trusted publication", async () => {
  const calls: boolean[] = [];
  const expectedRevisions: Array<number | undefined> = [];
  let remoteChecks = 0;
  const dependencies = {
    verifyRemote: async () => { remoteChecks += 1; return { verified: true as const, url: "trusted", size: 42, sha256: "a".repeat(64) }; },
    preparePackage: async () => prepared,
    readTarget: async () => ({ title: "Session title", currentVideoAssetId: null, revisionMillis: 100 }),
    publishPrepared: async (_db: Firestore, _prepared: PreparedVideoPublicationPackage, apply: boolean, expectedRevision?: number) => {
      calls.push(apply);
      expectedRevisions.push(expectedRevision);
      return { package: prepared.summary, preflight: { currentSessionVideoBinding: "ABSENT" as const, currentVideoAccess: "ABSENT" as const, proposedStatus: "created" as const, changeRequired: true }, applyStatus: apply ? "created" as const : null, postApplyVerified: apply };
    },
  };
  const review = await createOwnerBindingReview({} as Firestore, deployment, "at-in-physics", "binding-review", dependencies);
  assert.deepEqual(calls, [false]);
  assert.equal(review.safe.remoteVerification, "PASSED");
  assert.doesNotMatch(JSON.stringify(review.safe), /contentKey|SECRET|descriptor/i);
  const result = await applyOwnerBindingReview({} as Firestore, review, "at-in-physics", dependencies);
  assert.deepEqual(calls, [false, true]);
  assert.deepEqual(expectedRevisions, [undefined, 100]);
  assert.equal(remoteChecks, 2);
  assert.equal(result.firestoreBindingVerified, true);
  assert.doesNotMatch(JSON.stringify(result), /contentKey|SECRET|descriptor/i);
});

test("stale Session revision fails before trusted Firestore publication", async () => {
  let revision = 100;
  let writes = 0;
  const dependencies = {
    verifyRemote: async () => ({ verified: true as const, url: "trusted", size: 42, sha256: "a".repeat(64) }),
    preparePackage: async () => prepared,
    readTarget: async () => ({ title: "Session title", currentVideoAssetId: null, revisionMillis: revision }),
    publishPrepared: async (_db: Firestore, _prepared: PreparedVideoPublicationPackage, apply: boolean) => {
      if (apply) writes += 1;
      return { package: prepared.summary, preflight: { currentSessionVideoBinding: "ABSENT" as const, currentVideoAccess: "ABSENT" as const, proposedStatus: "created" as const, changeRequired: true }, applyStatus: null, postApplyVerified: false };
    },
  };
  const review = await createOwnerBindingReview({} as Firestore, deployment, "at-in-physics", "binding-review", dependencies);
  revision = 101;
  await assert.rejects(applyOwnerBindingReview({} as Firestore, review, "at-in-physics", dependencies), /stale/);
  assert.equal(writes, 0);
});

test("anything other than VERIFIED_DEPLOYED is ineligible", async () => {
  const ineligible = { ...deployment, status: "DEPLOYMENT_COMPLETED_REMOTE_VERIFICATION_FAILED" } as unknown as OwnerVerifiedDeployment;
  await assert.rejects(
    createOwnerBindingReview({} as Firestore, ineligible, "at-in-physics", "review", {}),
    /identity is invalid/,
  );
});
