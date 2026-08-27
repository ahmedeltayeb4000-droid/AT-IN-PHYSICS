import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT } from "../tooling/videoPackaging.js";
import {
  prepareVideoPublicationPackage,
  runPreparedVideoPublication,
} from "../tooling/videoDescriptorPublication.js";
import { validateSessionForVideoPublication } from "../videoPublication/publishVideoMetadata.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";
import { validateTrustedModuleDocument } from "../tooling/moduleCreation.js";
import {
  verifyOwnerRemoteArtifact,
  type OwnerDeployReview,
} from "./videoDeployment.js";

export const VIDEO_BIND_CONFIRMATION = "BIND VERIFIED VIDEO TO SESSION";

export type OwnerVerifiedDeployment = Readonly<{
  deploymentId: string;
  status: "VERIFIED_DEPLOYED";
  review: OwnerDeployReview;
}>;

type TargetState = Readonly<{
  title: string;
  currentVideoAssetId: string | null;
  revisionMillis: number;
}>;

export type OwnerBindingReview = Readonly<{
  reviewId: string;
  deployment: OwnerVerifiedDeployment;
  revisionMillis: number;
  fingerprint: string;
  safe: {
    projectId: string;
    courseId: string;
    moduleId: string;
    sessionId: string;
    sessionTitle: string;
    currentVideoState: "ABSENT" | "PRESENT";
    videoAssetId: string;
    hostingRoute: string;
    artifactSha256: string;
    artifactSize: number;
    remoteVerification: "PASSED";
    warning: string;
  };
}>;

type Dependencies = Readonly<{
  verifyRemote?: typeof verifyOwnerRemoteArtifact;
  preparePackage?: typeof prepareVideoPublicationPackage;
  publishPrepared?: typeof runPreparedVideoPublication;
  readTarget?: typeof readTarget;
}>;

async function readTarget(db: Firestore, review: OwnerDeployReview): Promise<TargetState> {
  const { courseId, moduleId, sessionId } = review.safe.target;
  const course = db.doc(`courses/${courseId}`);
  const module = db.doc(`courses/${courseId}/modules/${moduleId}`);
  const session = db.doc(`courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`);
  const [courseSnap, moduleSnap, sessionSnap] = await db.getAll(course, module, session);
  if (!courseSnap.exists || !moduleSnap.exists || !sessionSnap.exists)
    throw new Error("Video binding target hierarchy was not found.");
  validateTrustedCourseDocument(courseSnap.data(), courseId);
  validateTrustedModuleDocument(moduleSnap.data());
  const data = validateSessionForVideoPublication(sessionSnap.data());
  const revisionMillis = sessionSnap.updateTime?.toMillis();
  if (revisionMillis === undefined) throw new Error("Session revision is unavailable.");
  return {
    title: data.title,
    currentVideoAssetId: Object.prototype.hasOwnProperty.call(data, "videoAssetId")
      ? (data.videoAssetId as string)
      : null,
    revisionMillis,
  };
}

async function revalidate(
  db: Firestore,
  deployment: OwnerVerifiedDeployment,
  projectId: string,
  dependencies: Dependencies,
) {
  const review = deployment.review;
  if (deployment.status !== "VERIFIED_DEPLOYED" || review.safe.projectId !== projectId)
    throw new Error("Verified deployment identity is invalid.");
  await (dependencies.verifyRemote ?? verifyOwnerRemoteArtifact)(review);
  const prepared = await (dependencies.preparePackage ?? prepareVideoPublicationPackage)(
    join(DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT, review.release.descriptorFileName),
  );
  if (
    prepared.input.courseId !== review.safe.target.courseId ||
    prepared.input.moduleId !== review.safe.target.moduleId ||
    prepared.input.sessionId !== review.safe.target.sessionId ||
    prepared.input.videoAssetId !== review.safe.videoAssetId ||
    prepared.summary.artifactSha256 !== review.safe.artifactSha256 ||
    prepared.summary.encryptedSize !== review.safe.artifactSize
  ) throw new Error("Verified deployment no longer matches the trusted descriptor.");
  const target = await (dependencies.readTarget ?? readTarget)(db, review);
  return { review, prepared, target };
}

function identity(deployment: OwnerVerifiedDeployment, target: TargetState) {
  const safe = deployment.review.safe;
  return {
    deploymentId: deployment.deploymentId,
    deploymentFingerprint: deployment.review.fingerprint,
    projectId: safe.projectId,
    target: safe.target,
    revisionMillis: target.revisionMillis,
    currentVideoAssetId: target.currentVideoAssetId,
    videoAssetId: safe.videoAssetId,
    artifactSha256: safe.artifactSha256,
    artifactSize: safe.artifactSize,
    hostingRoute: safe.hostingRoute,
  };
}

export async function createOwnerBindingReview(
  db: Firestore,
  deployment: OwnerVerifiedDeployment,
  projectId: string,
  reviewId: string,
  dependencies: Dependencies = {},
): Promise<OwnerBindingReview> {
  const { review, prepared, target } = await revalidate(db, deployment, projectId, dependencies);
  await (dependencies.publishPrepared ?? runPreparedVideoPublication)(db, prepared, false);
  return {
    reviewId,
    deployment,
    revisionMillis: target.revisionMillis,
    fingerprint: createHash("sha256").update(JSON.stringify(identity(deployment, target))).digest("hex"),
    safe: {
      projectId,
      courseId: review.safe.target.courseId,
      moduleId: review.safe.target.moduleId,
      sessionId: review.safe.target.sessionId,
      sessionTitle: target.title,
      currentVideoState: target.currentVideoAssetId === null ? "ABSENT" : "PRESENT",
      videoAssetId: review.safe.videoAssetId,
      hostingRoute: review.safe.hostingRoute,
      artifactSha256: review.safe.artifactSha256,
      artifactSize: review.safe.artifactSize,
      remoteVerification: "PASSED",
      warning: "This will write the trusted video binding to Firestore. It will not redeploy Hosting or publish the Session.",
    },
  };
}

export async function applyOwnerBindingReview(
  db: Firestore,
  binding: OwnerBindingReview,
  projectId: string,
  dependencies: Dependencies = {},
) {
  const { prepared, target } = await revalidate(db, binding.deployment, projectId, dependencies);
  const fresh = createHash("sha256")
    .update(JSON.stringify(identity(binding.deployment, target)))
    .digest("hex");
  if (target.revisionMillis !== binding.revisionMillis || fresh !== binding.fingerprint)
    throw new Error("Video binding review became stale.");
  const result = await (dependencies.publishPrepared ?? runPreparedVideoPublication)(
    db,
    prepared,
    true,
    binding.revisionMillis,
  );
  return {
    status: result.applyStatus,
    postApplyVerified: result.postApplyVerified,
    sessionId: binding.safe.sessionId,
    videoAssetId: binding.safe.videoAssetId,
    remoteVerified: true as const,
    firestoreBindingVerified: result.postApplyVerified,
  };
}
