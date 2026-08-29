import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  packageProtectedResource,
  type ProtectedResourcePackageIdentity,
} from "../tooling/protectedResourcePackaging.js";
import {
  validateProtectedResourceAccess,
  validateProtectedResourceFileName,
  validateProtectedResourceMetadata,
  validateProtectedResourceMimeType,
  validateProtectedResourcePair,
  type ProtectedResourceAccess,
  type ProtectedResourceMetadata,
} from "../protectedResources/format.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";
import { validateTrustedModuleDocument } from "../tooling/moduleCreation.js";
import { validateSessionForVideoPublication } from "../videoPublication/publishVideoMetadata.js";
import {
  createOwnerDeployReview,
  executeOwnerHostingDeployment,
  retryOwnerRemoteVerification,
  verifyOwnerRemoteArtifact,
  type OwnerDeployReview,
} from "./videoDeployment.js";
import { buildOwnerFrontend, type OwnerReleaseReview, type PreflightReport } from "./videoRelease.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const RELEASE_ROOT = join(REPOSITORY_ROOT, "hosting-release");
export const RESOURCE_BIND_CONFIRMATION = "BIND VERIFIED RESOURCE TO SESSION";

export type OwnerPreparedResource = Readonly<{
  preparationId: string;
  identity: ProtectedResourcePackageIdentity;
  contentKey: string;
  safe: ProtectedResourcePackageIdentity & {
    status: "LOCAL_PACKAGED";
  };
}>;

export type OwnerResourceRelease = Readonly<{
  releaseId: string;
  preparation: OwnerPreparedResource;
  report: PreflightReport;
  fingerprint: string;
  adapter: OwnerReleaseReview;
  safe: ProtectedResourcePackageIdentity & {
    projectId: string;
    releaseFileCount: number;
    state: "RELEASE_PREPARED";
  };
}>;

export type OwnerResourceDeployReview = Readonly<{
  reviewId: string;
  release: OwnerResourceRelease;
  adapter: OwnerDeployReview;
  safe: OwnerDeployReview["safe"] & ProtectedResourcePackageIdentity;
}>;

export type OwnerVerifiedResourceDeployment = Readonly<{
  deploymentId: string;
  status: "VERIFIED_DEPLOYED";
  review: OwnerResourceDeployReview;
}>;

export type OwnerResourceBindingReview = Readonly<{
  reviewId: string;
  deployment: OwnerVerifiedResourceDeployment;
  revisionMillis: number;
  fingerprint: string;
  safe: Readonly<{
    projectId: string;
    metadataPath: string;
    accessPath: string;
    sessionTitle: string;
    resourceId: string;
    title: string;
    originalFileName: string;
    ciphertextRoute: string;
    ciphertextSha256: string;
    ciphertextSize: number;
    remoteVerification: "PASSED";
    warning: string;
  }>;
}>;

type ReleaseAssembly = Readonly<{ files: string[]; resourceCount: number }>;

async function importHosting(path: string) {
  return import(pathToFileURL(join(REPOSITORY_ROOT, path)).href);
}

async function assembleRelease(): Promise<ReleaseAssembly> {
  return (await importHosting("scripts/hosting/releaseAssembly.mjs")).assembleHostingRelease();
}

async function runPreflight(projectId: string) {
  return (await importHosting("scripts/hosting/deployPreflight.mjs")).runHostingDeployPreflight({
    projectId,
    expectedProjectId: projectId,
  }) as Promise<{ report: PreflightReport }>;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safePreparation(identity: ProtectedResourcePackageIdentity) {
  return { ...identity, status: "LOCAL_PACKAGED" as const };
}

export async function prepareOwnerSessionResource(
  db: Firestore,
  input: Readonly<{
    courseId: string;
    moduleId: string;
    sessionId: string;
    resourceId: string;
    title: string;
    originalFileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }>,
  preparationId: string,
  dependencies: Readonly<{
    packageResource?: typeof packageProtectedResource;
    readHierarchy?: typeof readHierarchy;
  }> = {},
): Promise<OwnerPreparedResource> {
  const originalFileName = validateProtectedResourceFileName(input.originalFileName);
  validateProtectedResourceMimeType(input.mimeType);
  await (dependencies.readHierarchy ?? readHierarchy)(db, input.courseId, input.moduleId, input.sessionId);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "at-owner-resource-"));
  const inputPath = join(temporaryRoot, originalFileName);
  try {
    await writeFile(inputPath, input.bytes, { flag: "wx", mode: 0o600 });
    const packaged = await (dependencies.packageResource ?? packageProtectedResource)({
      scope: { type: "session", courseId: input.courseId, moduleId: input.moduleId, sessionId: input.sessionId },
      resourceId: input.resourceId,
      title: input.title,
      originalFileName,
      mimeType: input.mimeType,
      inputFile: inputPath,
    });
    return {
      preparationId,
      identity: packaged.identity,
      contentKey: packaged.contentKey,
      safe: safePreparation(packaged.identity),
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function readHierarchy(db: Firestore, courseId: string, moduleId: string, sessionId: string) {
  const course = db.doc(`courses/${courseId}`);
  const module = db.doc(`courses/${courseId}/modules/${moduleId}`);
  const session = db.doc(`courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`);
  const [courseSnap, moduleSnap, sessionSnap] = await db.getAll(course, module, session);
  if (!courseSnap.exists || !moduleSnap.exists || !sessionSnap.exists)
    throw new Error("Resource target hierarchy was not found.");
  validateTrustedCourseDocument(courseSnap.data(), courseId);
  validateTrustedModuleDocument(moduleSnap.data());
  const sessionData = validateSessionForVideoPublication(sessionSnap.data());
  const revisionMillis = sessionSnap.updateTime?.toMillis();
  if (revisionMillis === undefined) throw new Error("Session revision is unavailable.");
  return { title: sessionData.title as string, revisionMillis };
}

function requireArtifact(report: PreflightReport, identity: ProtectedResourcePackageIdentity) {
  const artifact = report.files.find((entry) => entry.path === identity.ciphertextRoute.slice(1));
  if (!artifact || artifact.size !== identity.ciphertextSize || artifact.sha256 !== identity.ciphertextSha256)
    throw new Error("Hosting release no longer matches the protected resource.");
  return artifact;
}

function asVideoRelease(
  prepared: OwnerPreparedResource,
  projectId: string,
  releaseId: string,
  report: PreflightReport,
  releaseFingerprint: string,
): OwnerReleaseReview {
  const identity = prepared.identity;
  return {
    releaseId,
    preparationId: prepared.preparationId,
    fingerprint: releaseFingerprint,
    descriptorFileName: `${identity.resourceId}.package.json`,
    // Deployment helpers consume only the immutable safe release identity.
    // The memory-only resource key remains exclusively on `preparation`.
    prepared: {} as never,
    safe: {
      projectId,
      target: identity.scope.type === "session" ? identity.scope : (() => { throw new Error("Only Session resources are supported."); })(),
      videoAssetId: identity.resourceId,
      artifactFileName: `${identity.resourceId}.atr1`,
      artifactSize: identity.ciphertextSize,
      artifactSha256: identity.ciphertextSha256,
      hostingRoute: identity.ciphertextRoute,
      releaseFileCount: report.summary.fileCount,
      atv1Count: report.summary.atv1Count,
      state: "LOCAL_RELEASE_NOT_DEPLOYED",
    },
  };
}

export async function prepareOwnerResourceRelease(
  prepared: OwnerPreparedResource,
  projectId: string,
  releaseId: string,
  dependencies: Readonly<{ buildFrontend?: typeof buildOwnerFrontend; assemble?: typeof assembleRelease; preflight?: typeof runPreflight; readArtifact?: (path: string) => Promise<Buffer> }> = {},
): Promise<OwnerResourceRelease> {
  await (dependencies.buildFrontend ?? buildOwnerFrontend)();
  const assembly = await (dependencies.assemble ?? assembleRelease)();
  if (!assembly.files.includes(prepared.identity.ciphertextRoute.slice(1)))
    throw new Error("Protected resource is absent from the Hosting release.");
  const bytes = await (dependencies.readArtifact ?? readFile)(join(RELEASE_ROOT, prepared.identity.ciphertextRoute.slice(1)));
  if (bytes.length !== prepared.identity.ciphertextSize || createHash("sha256").update(bytes).digest("hex") !== prepared.identity.ciphertextSha256)
    throw new Error("Protected resource release integrity verification failed.");
  const { report } = await (dependencies.preflight ?? runPreflight)(projectId);
  requireArtifact(report, prepared.identity);
  const releaseFingerprint = fingerprint({ projectId, identity: prepared.identity, files: report.files });
  return {
    releaseId,
    preparation: prepared,
    report,
    fingerprint: releaseFingerprint,
    adapter: asVideoRelease(prepared, projectId, releaseId, report, releaseFingerprint),
    safe: { ...prepared.identity, projectId, releaseFileCount: report.summary.fileCount, state: "RELEASE_PREPARED" },
  };
}

function inspectRelease(release: OwnerResourceRelease, projectId: string) {
  return async () => {
    const { report } = await runPreflight(projectId);
    requireArtifact(report, release.preparation.identity);
    if (fingerprint({ projectId, identity: release.preparation.identity, files: report.files }) !== release.fingerprint)
      throw new Error("Protected resource release review became stale.");
    return { report, safe: {} as never };
  };
}

export async function preflightOwnerResourceRelease(
  release: OwnerResourceRelease,
  projectId: string,
) {
  const { report } = await inspectRelease(release, projectId)();
  return {
    projectId: report.projectId,
    hostingTarget: report.deployment.hostingTarget,
    hostingSite: report.deployment.hostingSite,
    firebaseToolsVersion: report.deployment.firebaseToolsVersion,
    gitCommit: report.gitCommit,
    releaseFileCount: report.summary.fileCount,
    totalBytes: report.summary.totalBytes,
    atr1Count: (report.summary as PreflightReport["summary"] & { atr1Count?: number }).atr1Count ?? 0,
    ciphertextRoute: release.preparation.identity.ciphertextRoute,
    ciphertextSha256: release.preparation.identity.ciphertextSha256,
    ciphertextSize: release.preparation.identity.ciphertextSize,
    state: "PREFLIGHT_PASSED" as const,
  };
}

export async function createOwnerResourceDeployReview(
  release: OwnerResourceRelease,
  projectId: string,
  reviewId: string,
  dependencies: Readonly<{ inspect?: () => Promise<{ report: PreflightReport; safe: never }> }> = {},
): Promise<OwnerResourceDeployReview> {
  const adapter = await createOwnerDeployReview(release.adapter, projectId, reviewId, {
    inspect: dependencies.inspect ?? inspectRelease(release, projectId),
  });
  return { reviewId, release, adapter, safe: { ...adapter.safe, ...release.preparation.identity } };
}

export async function deployOwnerResource(
  review: OwnerResourceDeployReview,
  projectId: string,
  deploymentId: string,
  dependencies: Parameters<typeof executeOwnerHostingDeployment>[3] = {},
) {
  const result = await executeOwnerHostingDeployment(review.adapter, projectId, deploymentId, {
    ...dependencies,
    inspect: dependencies.inspect ?? inspectRelease(review.release, projectId),
  });
  return result;
}

export async function retryOwnerResourceVerification(
  review: OwnerResourceDeployReview,
  deploymentId: string,
  dependencies: Parameters<typeof retryOwnerRemoteVerification>[2] = {},
) {
  return retryOwnerRemoteVerification(review.adapter, deploymentId, dependencies);
}

async function verifyResourceRemote(deployment: OwnerVerifiedResourceDeployment) {
  return verifyOwnerRemoteArtifact(deployment.review.adapter);
}

function paths(identity: ProtectedResourcePackageIdentity) {
  if (identity.scope.type !== "session") throw new Error("Only Session resources are supported.");
  const prefix = `courses/${identity.scope.courseId}/modules/${identity.scope.moduleId}/sessions/${identity.scope.sessionId}/resources/${identity.resourceId}`;
  return { metadata: prefix, access: `${prefix}/access/primary` };
}

function bindingIdentity(deployment: OwnerVerifiedResourceDeployment, revisionMillis: number) {
  return { deploymentId: deployment.deploymentId, deploymentFingerprint: deployment.review.adapter.fingerprint, identity: deployment.review.release.preparation.identity, revisionMillis };
}

export async function createOwnerResourceBindingReview(
  db: Firestore,
  deployment: OwnerVerifiedResourceDeployment,
  projectId: string,
  reviewId: string,
  dependencies: Readonly<{ verifyRemote?: typeof verifyResourceRemote; readHierarchy?: typeof readHierarchy; inspectTargets?: typeof inspectTargets }> = {},
): Promise<OwnerResourceBindingReview> {
  if (deployment.status !== "VERIFIED_DEPLOYED" || deployment.review.safe.projectId !== projectId)
    throw new Error("Verified resource deployment identity is invalid.");
  await (dependencies.verifyRemote ?? verifyResourceRemote)(deployment);
  const identity = deployment.review.release.preparation.identity;
  if (identity.scope.type !== "session") throw new Error("Only Session resources are supported.");
  const hierarchy = await (dependencies.readHierarchy ?? readHierarchy)(db, identity.scope.courseId, identity.scope.moduleId, identity.scope.sessionId);
  await (dependencies.inspectTargets ?? inspectTargets)(db, identity);
  const targetPaths = paths(identity);
  return {
    reviewId,
    deployment,
    revisionMillis: hierarchy.revisionMillis,
    fingerprint: fingerprint(bindingIdentity(deployment, hierarchy.revisionMillis)),
    safe: {
      projectId,
      metadataPath: targetPaths.metadata,
      accessPath: targetPaths.access,
      sessionTitle: hierarchy.title,
      resourceId: identity.resourceId,
      title: identity.title,
      originalFileName: identity.originalFileName,
      ciphertextRoute: identity.ciphertextRoute,
      ciphertextSha256: identity.ciphertextSha256,
      ciphertextSize: identity.ciphertextSize,
      remoteVerification: "PASSED",
      warning: "This will atomically create the protected Session resource metadata and access documents. It will not deploy Hosting or publish the Session.",
    },
  };
}

async function inspectTargets(db: Firestore, identity: ProtectedResourcePackageIdentity) {
  const targetPaths = paths(identity);
  const [metadata, access] = await db.getAll(db.doc(targetPaths.metadata), db.doc(targetPaths.access));
  if (metadata.exists || access.exists) throw new Error("Protected resource binding target already exists.");
}

function timestampContract(timestamp: Timestamp) {
  return { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
}

export async function applyOwnerResourceBinding(
  db: Firestore,
  review: OwnerResourceBindingReview,
  projectId: string,
  dependencies: Readonly<{
    verifyRemote?: typeof verifyResourceRemote;
    readHierarchy?: typeof readHierarchy;
    now?: () => Timestamp;
    transact?: typeof transactBinding;
    verifyApplied?: typeof verifyApplied;
  }> = {},
) {
  const deployment = review.deployment;
  if (deployment.review.safe.projectId !== projectId) throw new Error("Resource binding project identity is invalid.");
  await (dependencies.verifyRemote ?? verifyResourceRemote)(deployment);
  const identity = deployment.review.release.preparation.identity;
  if (identity.scope.type !== "session") throw new Error("Only Session resources are supported.");
  const hierarchy = await (dependencies.readHierarchy ?? readHierarchy)(db, identity.scope.courseId, identity.scope.moduleId, identity.scope.sessionId);
  if (hierarchy.revisionMillis !== review.revisionMillis || fingerprint(bindingIdentity(deployment, hierarchy.revisionMillis)) !== review.fingerprint)
    throw new Error("Resource binding review became stale.");
  const timestamp = (dependencies.now ?? Timestamp.now)();
  const contractTimestamp = timestampContract(timestamp);
  const metadata = validateProtectedResourceMetadata({
    version: identity.version,
    resourceId: identity.resourceId,
    title: identity.title,
    originalFileName: identity.originalFileName,
    mimeType: identity.mimeType,
    plaintextSize: identity.plaintextSize,
    formatVersion: identity.formatVersion,
    ciphertextRoute: identity.ciphertextRoute,
    ciphertextSha256: identity.ciphertextSha256,
    ciphertextSize: identity.ciphertextSize,
    createdAt: contractTimestamp,
    boundAt: contractTimestamp,
  }, identity.scope);
  const access = validateProtectedResourceAccess({ version: 1, resourceId: identity.resourceId, formatVersion: identity.formatVersion, ciphertextSha256: identity.ciphertextSha256, contentKey: deployment.review.release.preparation.contentKey });
  validateProtectedResourcePair(metadata, access);
  await (dependencies.transact ?? transactBinding)(db, metadata, access, timestamp, review.revisionMillis);
  await (dependencies.verifyApplied ?? verifyApplied)(db, metadata, access);
  return { status: "BOUND_AND_VERIFIED" as const, resourceId: identity.resourceId, metadataPath: review.safe.metadataPath, accessPath: review.safe.accessPath, remoteVerified: true, firestoreBindingVerified: true };
}

async function transactBinding(db: Firestore, metadata: ProtectedResourceMetadata, access: ProtectedResourceAccess, timestamp: Timestamp, revisionMillis: number) {
  // The validated route unambiguously contains the trusted Session hierarchy.
  const route = metadata.ciphertextRoute.match(/^\/protected-resources\/courses\/([^/]+)\/modules\/([^/]+)\/sessions\/([^/]+)\/resources\/([^/]+)\.atr1$/);
  if (!route) throw new Error("Protected resource route is invalid.");
  const prefix = `courses/${route[1]}/modules/${route[2]}/sessions/${route[3]}`;
  const sessionRef = db.doc(prefix);
  const metadataRef = db.doc(`${prefix}/resources/${route[4]}`);
  const accessRef = db.doc(`${prefix}/resources/${route[4]}/access/primary`);
  await db.runTransaction(async (transaction) => {
    const [session, existingMetadata, existingAccess] = await Promise.all([transaction.get(sessionRef), transaction.get(metadataRef), transaction.get(accessRef)]);
    if (!session.exists || session.updateTime?.toMillis() !== revisionMillis) throw new Error("Session changed after resource binding review.");
    validateSessionForVideoPublication(session.data());
    if (existingMetadata.exists || existingAccess.exists) throw new Error("Protected resource binding target already exists.");
    transaction.create(metadataRef, { ...metadata, createdAt: timestamp, boundAt: timestamp });
    transaction.create(accessRef, access);
  });
}

async function verifyApplied(db: Firestore, metadata: ProtectedResourceMetadata, access: ProtectedResourceAccess) {
  const route = metadata.ciphertextRoute.match(/^\/protected-resources\/courses\/([^/]+)\/modules\/([^/]+)\/sessions\/([^/]+)\/resources\/([^/]+)\.atr1$/);
  if (!route) throw new Error("Protected resource route is invalid.");
  const prefix = `courses/${route[1]}/modules/${route[2]}/sessions/${route[3]}/resources/${route[4]}`;
  const [metadataSnap, accessSnap] = await db.getAll(db.doc(prefix), db.doc(`${prefix}/access/primary`));
  if (!metadataSnap.exists || !accessSnap.exists) throw new Error("Protected resource binding verification failed.");
  const rawMetadata = metadataSnap.data() as Record<string, unknown>;
  const normalizeTimestamp = (value: unknown) => {
    if (!(value instanceof Timestamp)) return value;
    return { seconds: value.seconds, nanoseconds: value.nanoseconds };
  };
  const mappedMetadata = validateProtectedResourceMetadata({
    ...rawMetadata,
    createdAt: normalizeTimestamp(rawMetadata.createdAt),
    boundAt: normalizeTimestamp(rawMetadata.boundAt),
  }, { type: "session", courseId: route[1], moduleId: route[2], sessionId: route[3] });
  const mappedAccess = validateProtectedResourceAccess(accessSnap.data());
  validateProtectedResourcePair(mappedMetadata, mappedAccess);
  if (JSON.stringify(mappedMetadata) !== JSON.stringify(metadata) || JSON.stringify(mappedAccess) !== JSON.stringify(access))
    throw new Error("Protected resource binding verification failed.");
}
