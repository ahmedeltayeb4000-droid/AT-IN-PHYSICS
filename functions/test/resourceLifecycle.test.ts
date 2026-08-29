import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { Auth } from "firebase-admin/auth";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { createOwnerConsoleServer, listenOwnerConsole, OWNER_CONSOLE_HOST } from "../src/ownerConsole/server.js";
import {
  applyOwnerResourceBinding,
  createOwnerResourceBindingReview,
  createOwnerResourceDeployReview,
  prepareOwnerResourceRelease,
  prepareOwnerSessionResource,
  retryOwnerResourceVerification,
  type OwnerPreparedResource,
  type OwnerVerifiedResourceDeployment,
} from "../src/ownerConsole/resourceLifecycle.js";
import { verifyOwnerRemoteArtifact } from "../src/ownerConsole/videoDeployment.js";
import type { PreflightReport } from "../src/ownerConsole/videoRelease.js";

const key = Buffer.alloc(32).toString("base64url");
const artifact = Buffer.concat([Buffer.from("ATR1"), Buffer.alloc(28, 7), Buffer.from("ciphertext")]);
const sha256 = createHash("sha256").update(artifact).digest("hex");
const identity = {
  version: 1 as const,
  scope: { type: "session" as const, courseId: "mechanics", moduleId: "motion", sessionId: "displacement" },
  resourceId: "displacement-notes",
  title: "Displacement Notes",
  originalFileName: "Displacement Notes.pdf",
  mimeType: "application/pdf" as const,
  plaintextSize: artifact.length - 32,
  formatVersion: "ATR1" as const,
  ciphertextRoute: "/protected-resources/courses/mechanics/modules/motion/sessions/displacement/resources/displacement-notes.atr1",
  ciphertextSha256: sha256,
  ciphertextSize: artifact.length,
};

const prepared: OwnerPreparedResource = {
  preparationId: "preparation",
  identity,
  contentKey: key,
  safe: { ...identity, status: "LOCAL_PACKAGED" },
};

function report(): PreflightReport {
  return {
    formatVersion: "hosting-preflight-v1",
    generatedAt: "2026-08-30T00:00:00.000Z",
    projectId: "at-in-physics",
    gitCommit: "a".repeat(40),
    firebaseConfigSha256: "b".repeat(64),
    firebaseRcSha256: "c".repeat(64),
    summary: { fileCount: 2, totalBytes: 100, frontendBytes: 50, protectedMediaBytes: 0, atv1Count: 0 },
    quota: { actualRemainingMonthlyTransferIsLocallyKnowable: false },
    deployment: { firebaseToolsVersion: "15.28.1", projectId: "at-in-physics", hostingTarget: "production", hostingSite: "at-in-physics", deploySource: "hosting-release", repositoryLocalCli: true, shellRequired: false },
    files: [{ path: identity.ciphertextRoute.slice(1), size: artifact.length, sha256 }],
    outcome: "PREFLIGHT PASSED",
  };
}

async function release() {
  return prepareOwnerResourceRelease(prepared, "at-in-physics", "release", {
    buildFrontend: async () => undefined,
    assemble: async () => ({ files: [identity.ciphertextRoute.slice(1)], resourceCount: 1 }),
    readArtifact: async () => artifact,
    preflight: async () => ({ report: report() }),
  });
}

test("Session preparation uses the Sprint 3 packager and exposes only safe identity", async () => {
  let packageCalls = 0;
  const result = await prepareOwnerSessionResource({} as Firestore, {
    courseId: "mechanics", moduleId: "motion", sessionId: "displacement", resourceId: identity.resourceId,
    title: identity.title, originalFileName: identity.originalFileName, mimeType: "application/pdf", bytes: Buffer.from("%PDF-fixture"),
  }, "preparation", {
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 1 }),
    packageResource: async (input) => {
      packageCalls += 1;
      assert.equal(input.scope && (input.scope as { type: string }).type, "session");
      assert.equal(input.inputFile.endsWith(identity.originalFileName), true);
      return { identity, contentKey: key, stagingDestination: "trusted", descriptorPath: "trusted" };
    },
  });
  assert.equal(packageCalls, 1);
  assert.equal(result.contentKey, key);
  assert.doesNotMatch(JSON.stringify(result.safe), /contentKey|${key}/);
  assert.equal(result.safe.ciphertextRoute, identity.ciphertextRoute);
});

test("release and deployment review remain tied to the exact package without deploying", async () => {
  const value = await release();
  assert.equal(value.safe.ciphertextSha256, sha256);
  let inspections = 0;
  const review = await createOwnerResourceDeployReview(value, "at-in-physics", "review", {
    inspect: async () => { inspections += 1; return { report: report(), safe: undefined as never }; },
  });
  assert.equal(inspections, 1);
  assert.equal(review.safe.resourceId, identity.resourceId);
  assert.doesNotMatch(JSON.stringify(review.safe), /contentKey|${key}/);
});

test("resource remote verification requires ATR1 and exact reviewed bytes", async () => {
  const value = await release();
  const review = await createOwnerResourceDeployReview(value, "at-in-physics", "review", { inspect: async () => ({ report: report(), safe: undefined as never }) });
  const response = (bytes: Buffer) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length), "x-content-type-options": "nosniff" } });
  assert.equal((await verifyOwnerRemoteArtifact(review.adapter, { fetchImpl: async () => response(artifact) })).verified, true);
  const wrongMagic = Buffer.from(artifact); wrongMagic[0] = 0;
  const wrongReview = { ...review.adapter, safe: { ...review.adapter.safe, artifactSha256: createHash("sha256").update(wrongMagic).digest("hex") } };
  await assert.rejects(verifyOwnerRemoteArtifact(wrongReview, { fetchImpl: async () => response(wrongMagic) }), /bytes/);
  await assert.rejects(verifyOwnerRemoteArtifact(review.adapter, { fetchImpl: async () => new Response("missing", { status: 404 }) }), /not available/);
  await assert.rejects(verifyOwnerRemoteArtifact(review.adapter, { fetchImpl: async () => new Response(new Uint8Array(artifact), { status: 200, headers: { "content-type": "application/pdf", "content-length": String(artifact.length), "x-content-type-options": "nosniff" } }) }), /content type/);
  await assert.rejects(verifyOwnerRemoteArtifact(review.adapter, { fetchImpl: async () => new Response(new Uint8Array(artifact), { status: 200, headers: { "content-type": "application/octet-stream", "content-length": String(artifact.length) } }) }), /security headers/);
  await assert.rejects(verifyOwnerRemoteArtifact(review.adapter, { fetchImpl: async () => new Response(new Uint8Array(artifact.subarray(0, -1)), { status: 200, headers: { "content-type": "application/octet-stream", "x-content-type-options": "nosniff" } }) }), /bytes/);
  await assert.rejects(verifyOwnerRemoteArtifact(review.adapter, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.example/resource.atr1" } }) }), /outside/);
  const crossOrigin = response(artifact);
  Object.defineProperty(crossOrigin, "url", { value: "https://evil.example/resource.atr1" });
  await assert.rejects(verifyOwnerRemoteArtifact(review.adapter, { fetchImpl: async () => crossOrigin }), /final URL/);
});

test("verification retry performs no deployment and preserves verified identity", async () => {
  const value = await release();
  const review = await createOwnerResourceDeployReview(value, "at-in-physics", "review", { inspect: async () => ({ report: report(), safe: undefined as never }) });
  let fetches = 0;
  const result = await retryOwnerResourceVerification(review, "deployment", { fetchImpl: async () => { fetches += 1; return new Response(new Uint8Array(artifact), { status: 200, headers: { "content-type": "application/octet-stream", "content-length": String(artifact.length), "x-content-type-options": "nosniff" } }); } });
  assert.equal(fetches, 1);
  assert.equal(result.status, "VERIFIED_DEPLOYED");
});

async function deployment(): Promise<OwnerVerifiedResourceDeployment> {
  const value = await release();
  const review = await createOwnerResourceDeployReview(value, "at-in-physics", "review", { inspect: async () => ({ report: report(), safe: undefined as never }) });
  return { deploymentId: "deployment", status: "VERIFIED_DEPLOYED", review };
}

test("binding review is read-only, collision-aware, and key-redacted", async () => {
  let targetChecks = 0;
  const review = await createOwnerResourceBindingReview({} as Firestore, await deployment(), "at-in-physics", "binding", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    inspectTargets: async () => { targetChecks += 1; },
  });
  assert.equal(targetChecks, 1);
  assert.equal(review.safe.metadataPath, "courses/mechanics/modules/motion/sessions/displacement/resources/displacement-notes");
  assert.equal(review.safe.accessPath, `${review.safe.metadataPath}/access/primary`);
  assert.doesNotMatch(JSON.stringify(review.safe), /contentKey|${key}/);
});

test("binding apply validates paired documents, one timestamp, and exact post-read verification", async () => {
  const verified = await deployment();
  const review = await createOwnerResourceBindingReview({} as Firestore, verified, "at-in-physics", "binding", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    inspectTargets: async () => undefined,
  });
  const timestamp = Timestamp.fromMillis(1234);
  let transactionCalls = 0;
  let postChecks = 0;
  const result = await applyOwnerResourceBinding({} as Firestore, review, "at-in-physics", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    now: () => timestamp,
    transact: async (_db, metadata, access, receivedTimestamp, revision) => {
      transactionCalls += 1;
      assert.equal(receivedTimestamp, timestamp);
      assert.equal(metadata.createdAt.seconds, metadata.boundAt.seconds);
      assert.equal(access.contentKey, key);
      assert.equal(revision, 50);
    },
    verifyApplied: async (_db, metadata, access) => {
      postChecks += 1;
      assert.equal(metadata.ciphertextSha256, access.ciphertextSha256);
    },
  });
  assert.equal(transactionCalls, 1);
  assert.equal(postChecks, 1);
  assert.equal(result.status, "BOUND_AND_VERIFIED");
  assert.doesNotMatch(JSON.stringify(result), /contentKey|${key}/);
});

test("default binding transaction atomically creates the exact metadata and access paths only", async () => {
  const verified = await deployment();
  const review = await createOwnerResourceBindingReview({} as Firestore, verified, "at-in-physics", "binding", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    inspectTargets: async () => undefined,
  });
  const creates: Array<{ path: string; data: Record<string, unknown> }> = [];
  const fakeDb = {
    doc: (path: string) => ({ path }),
    runTransaction: async (callback: (transaction: {
      get(reference: { path: string }): Promise<unknown>;
      create(reference: { path: string }, data: Record<string, unknown>): void;
    }) => Promise<void>) => callback({
      get: async (reference) => reference.path.endsWith("/sessions/displacement")
        ? { exists: true, updateTime: { toMillis: () => 50 }, data: () => ({ title: "Displacement", order: 0, publicationStatus: "draft" }) }
        : { exists: false },
      create: (reference, data) => creates.push({ path: reference.path, data }),
    }),
  } as unknown as Firestore;
  await applyOwnerResourceBinding(fakeDb, review, "at-in-physics", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    now: () => Timestamp.fromMillis(1234),
    verifyApplied: async () => undefined,
  });
  assert.deepEqual(creates.map((entry) => entry.path), [
    "courses/mechanics/modules/motion/sessions/displacement/resources/displacement-notes",
    "courses/mechanics/modules/motion/sessions/displacement/resources/displacement-notes/access/primary",
  ]);
  assert.equal(creates[0]!.data.createdAt, creates[0]!.data.boundAt);
  assert.equal(creates[1]!.data.contentKey, key);
  assert.equal(creates.some((entry) => entry.path.endsWith("/sessions/displacement")), false);
});

test("unverified deployment, stale review, and transaction failure fail closed", async () => {
  const verified = await deployment();
  await assert.rejects(createOwnerResourceBindingReview({} as Firestore, { ...verified, status: "FAILED" } as never, "at-in-physics", "binding"), /invalid/);
  await assert.rejects(createOwnerResourceBindingReview({} as Firestore, verified, "at-in-physics", "binding", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    inspectTargets: async () => { throw new Error("Protected resource binding target already exists."); },
  }), /already exists/);
  const review = await createOwnerResourceBindingReview({} as Firestore, verified, "at-in-physics", "binding", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    inspectTargets: async () => undefined,
  });
  let writes = 0;
  await assert.rejects(applyOwnerResourceBinding({} as Firestore, review, "at-in-physics", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 51 }),
    transact: async () => { writes += 1; },
  }), /stale/);
  assert.equal(writes, 0);
  await assert.rejects(applyOwnerResourceBinding({} as Firestore, review, "at-in-physics", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    transact: async () => { throw new Error("transaction failed"); },
  }), /transaction failed/);
  await assert.rejects(applyOwnerResourceBinding({} as Firestore, review, "at-in-physics", {
    verifyRemote: async () => ({ verified: true, url: "trusted", size: artifact.length, sha256 }),
    readHierarchy: async () => ({ title: "Displacement", revisionMillis: 50 }),
    transact: async () => undefined,
    verifyApplied: async () => { throw new Error("post-bind mismatch"); },
  }), /post-bind mismatch/);
});

test("no resource recovery API exists and safe source contains no secret logging", async () => {
  const serverSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../src/ownerConsole/server.ts", import.meta.url), "utf8"));
  const clientSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../src/ownerConsole/resourceClient.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(serverSource, /resource\/session\/deploy\/recover/);
  assert.doesNotMatch(clientSource, /contentKey|localStorage|sessionStorage|indexedDB/i);
});

test("Owner Control enforces the complete resource capability order, confirmations, redaction, and cleanup", async () => {
  const released = await release();
  let bindingApplies = 0;
  const { server, csrfForTests } = createOwnerConsoleServer({
    auth: {} as Auth,
    db: {} as Firestore,
    ownerUid: "owner",
    projectId: "at-in-physics",
    authorize: async () => undefined,
    prepareResource: async (_db, _input, preparationId) => ({ ...prepared, preparationId }),
    prepareResourceRelease: async (known, _projectId, releaseId) => ({ ...released, releaseId, preparation: known }),
    preflightResourceRelease: async () => ({ projectId: "at-in-physics", hostingTarget: "production", hostingSite: "at-in-physics", firebaseToolsVersion: "15.28.1", gitCommit: "a".repeat(40), releaseFileCount: 2, totalBytes: 100, atr1Count: 1, ciphertextRoute: identity.ciphertextRoute, ciphertextSha256: sha256, ciphertextSize: artifact.length, state: "PREFLIGHT_PASSED" }),
    createResourceDeployReview: async (resourceRelease, _projectId, reviewId) => {
      const value = await createOwnerResourceDeployReview(resourceRelease, "at-in-physics", reviewId, { inspect: async () => ({ report: report(), safe: undefined as never }) });
      return value;
    },
    deployResource: async (review, _projectId, deploymentId) => ({ deployCompleted: true, safe: { deploymentId, status: "VERIFIED_DEPLOYED", projectId: "at-in-physics", hostingSite: "at-in-physics", hostingRoute: review.safe.ciphertextRoute, artifactSha256: review.safe.ciphertextSha256, artifactSize: review.safe.ciphertextSize, remoteVerified: true } }),
    retryResourceVerification: async (review, deploymentId) => ({ deploymentId, status: "VERIFIED_DEPLOYED", projectId: "at-in-physics", hostingSite: "at-in-physics", hostingRoute: review.safe.ciphertextRoute, artifactSha256: review.safe.ciphertextSha256, artifactSize: review.safe.ciphertextSize, remoteVerified: true }),
    createResourceBindingReview: async (_db, verified, _projectId, reviewId) => ({ reviewId, deployment: verified, revisionMillis: 50, fingerprint: "f".repeat(64), safe: { projectId: "at-in-physics", metadataPath: "metadata", accessPath: "access", sessionTitle: "Displacement", resourceId: identity.resourceId, title: identity.title, originalFileName: identity.originalFileName, ciphertextRoute: identity.ciphertextRoute, ciphertextSha256: sha256, ciphertextSize: artifact.length, remoteVerification: "PASSED", warning: "safe" } }),
    applyResourceBinding: async () => { bindingApplies += 1; return { status: "BOUND_AND_VERIFIED", resourceId: identity.resourceId, metadataPath: "metadata", accessPath: "access", remoteVerified: true, firestoreBindingVerified: true }; },
  });
  const address = await listenOwnerConsole(server, 0);
  const origin = `http://${OWNER_CONSOLE_HOST}:${address.port}`;
  const postJson = (path: string, value: unknown) => fetch(origin + path, { method: "POST", headers: { origin, "content-type": "application/json", "x-owner-control-csrf": csrfForTests }, body: JSON.stringify(value) });
  try {
    assert.equal((await postJson("/api/resource/session/bind/review", { deploymentId: "missing" })).status, 409);
    const query = new URLSearchParams({ courseId: "mechanics", moduleId: "motion", sessionId: "displacement", resourceId: identity.resourceId, title: identity.title });
    const preparationResponse = await fetch(`${origin}/api/resource/session/prepare?${query}`, { method: "POST", headers: { origin, "content-type": "application/pdf", "content-length": "12", "x-owner-control-csrf": csrfForTests, "x-resource-file-name": encodeURIComponent(identity.originalFileName) }, body: Buffer.from("%PDF-fixture") });
    const preparationText = await preparationResponse.text();
    assert.equal(preparationResponse.status, 200);
    assert.doesNotMatch(preparationText, /contentKey|${key}/);
    const preparationId = JSON.parse(preparationText).preparationId as string;
    const releaseResponse = await postJson("/api/resource/session/release", { preparationId });
    const releaseId = (await releaseResponse.json()).releaseId as string;
    assert.equal((await postJson("/api/resource/session/deploy/review", { releaseId })).status, 409);
    assert.equal((await postJson("/api/resource/session/preflight", { releaseId })).status, 200);
    const deployReviewResponse = await postJson("/api/resource/session/deploy/review", { releaseId });
    const deployReviewText = await deployReviewResponse.text();
    assert.doesNotMatch(deployReviewText, /contentKey|${key}/);
    const deployReviewId = JSON.parse(deployReviewText).reviewId as string;
    assert.equal((await postJson("/api/resource/session/deploy/apply", { reviewId: deployReviewId, confirmation: "wrong" })).status, 400);
    const deployResponse = await postJson("/api/resource/session/deploy/apply", { reviewId: deployReviewId, confirmation: "DEPLOY HOSTING TO PRODUCTION" });
    const deploymentId = (await deployResponse.json()).deployment.deploymentId as string;
    const bindReviewResponse = await postJson("/api/resource/session/bind/review", { deploymentId });
    const bindReviewText = await bindReviewResponse.text();
    assert.doesNotMatch(bindReviewText, /contentKey|${key}/);
    const bindingReviewId = JSON.parse(bindReviewText).reviewId as string;
    assert.equal((await postJson("/api/resource/session/bind/apply", { reviewId: bindingReviewId, confirmation: "wrong" })).status, 400);
    assert.equal((await postJson("/api/resource/session/bind/apply", { reviewId: bindingReviewId, confirmation: "BIND VERIFIED RESOURCE TO SESSION" })).status, 200);
    assert.equal(bindingApplies, 1);
    assert.equal((await postJson("/api/resource/session/bind/review", { deploymentId })).status, 409);
    assert.equal((await postJson("/api/resource/session/deploy/recover", identity.scope)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
