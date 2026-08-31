import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import {
  validateProtectedResourceAccess,
  validateProtectedResourceId,
  validateProtectedResourceMetadata,
  validateProtectedResourcePair,
  type ProtectedResourceAccess,
  type ProtectedResourceMetadata,
  type ProtectedResourceScope,
} from "../protectedResources/format.js";
import {
  validateExistingVideoAccess,
  validateSessionForVideoPublication,
  type TrustedVideoAccess,
} from "../videoPublication/publishVideoMetadata.js";
import { validateOwnerVerifiedVideoDeployment, type OwnerVerifiedDeployment } from "./videoBinding.js";
import { verifyOwnerResourceDeployment, type OwnerVerifiedResourceDeployment } from "./resourceLifecycle.js";

export const VIDEO_REPLACE_CONFIRMATION = "REPLACE SESSION VIDEO";
export const VIDEO_UNBIND_CONFIRMATION = "REMOVE VIDEO FROM SESSION";
export const RESOURCE_REPLACE_CONFIRMATION = "REPLACE SESSION RESOURCE";
export const RESOURCE_REMOVE_CONFIRMATION = "REMOVE RESOURCE FROM SESSION";
export const LIFECYCLE_REVIEW_LIMIT = 64;
export const LIFECYCLE_REVIEW_TTL_MS = 10 * 60 * 1000;
export const SESSION_RESOURCE_INVENTORY_LIMIT = 100;

export class LifecycleReviewRegistry<T> {
  readonly #records = new Map<string, { value: T; expiresAt: number; used: boolean }>();
  constructor(
    readonly limit = LIFECYCLE_REVIEW_LIMIT,
    readonly ttlMs = LIFECYCLE_REVIEW_TTL_MS,
    readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(ttlMs) || ttlMs <= 0)
      throw new Error("Lifecycle review registry configuration is invalid.");
  }
  #purge() {
    const now = this.now();
    for (const [id, record] of this.#records) if (record.expiresAt <= now) this.#records.delete(id);
  }
  add(id: string, value: T) {
    this.#purge();
    if (this.#records.size >= this.limit) throw new Error("Lifecycle review capacity is unavailable.");
    this.#records.set(id, { value, expiresAt: this.now() + this.ttlMs, used: false });
  }
  acquire(id: string): T | null {
    this.#purge();
    const record = this.#records.get(id);
    if (!record || record.used) return null;
    record.used = true;
    return record.value;
  }
  release(id: string) {
    const record = this.#records.get(id);
    if (record) record.used = false;
  }
  consume(id: string) { this.#records.delete(id); }
  get size() { this.#purge(); return this.#records.size; }
}

export async function runLifecycleReview<T, R>(
  registry: LifecycleReviewRegistry<T>,
  reviewId: string,
  apply: (review: T) => Promise<R>,
): Promise<R | null> {
  const review = registry.acquire(reviewId);
  if (!review) return null;
  try {
    const result = await apply(review);
    registry.consume(reviewId);
    return result;
  } catch (error) {
    registry.release(reviewId);
    throw error;
  }
}

type Target = Readonly<{ courseId: string; moduleId: string; sessionId: string }>;
type Revision = number;
type VideoState = Readonly<{
  sessionTitle: string;
  sessionRevision: Revision;
  accessRevision: Revision;
  videoAssetId: string;
  access: TrustedVideoAccess;
}>;
type ResourceState = Readonly<{
  metadataRevision: Revision;
  accessRevision: Revision;
  metadata: ProtectedResourceMetadata;
  access: ProtectedResourceAccess;
}>;

export type VideoReplaceReview = Readonly<{
  operation: "video-replace";
  target: Target;
  current: VideoState;
  deployment: OwnerVerifiedDeployment;
  proposed: TrustedVideoAccess;
  safe: Readonly<{ courseId: string; moduleId: string; sessionId: string; sessionTitle: string; currentVideoAssetId: string; newVideoAssetId: string; warning: string }>;
}>;
export type VideoUnbindReview = Readonly<{
  operation: "video-unbind";
  target: Target;
  current: VideoState;
  safe: Readonly<{ sessionTitle: string; videoAssetId: string; warning: string }>;
}>;
export type ResourceReplaceReview = Readonly<{
  operation: "resource-replace";
  target: Target;
  current: ResourceState;
  deployment: OwnerVerifiedResourceDeployment;
  safe: Readonly<{ courseId: string; moduleId: string; sessionId: string; oldResourceId: string; oldTitle: string; newResourceId: string; newTitle: string; warning: string }>;
}>;
export type ResourceRemoveReview = Readonly<{
  operation: "resource-remove";
  target: Target;
  current: ResourceState;
  safe: Readonly<{ resourceId: string; title: string; warning: string }>;
}>;

function target(value: Target): Target {
  return {
    courseId: validateCourseId(value.courseId),
    moduleId: validateCourseId(value.moduleId),
    sessionId: validateCourseId(value.sessionId),
  };
}
function sessionPath(value: Target) {
  return `courses/${value.courseId}/modules/${value.moduleId}/sessions/${value.sessionId}`;
}
function resourcePath(value: Target, resourceId: string) {
  return `${sessionPath(value)}/resources/${validateProtectedResourceId(resourceId)}`;
}
function revision(snapshot: { updateTime?: { toMillis(): number } }) {
  const value = snapshot.updateTime?.toMillis();
  if (value === undefined) throw new Error("Protected content revision is unavailable.");
  return value;
}
function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function normalizeMetadata(value: unknown, scope: ProtectedResourceScope) {
  const data = value as Record<string, unknown>;
  const timestamp = (candidate: unknown) => candidate instanceof Timestamp
    ? { seconds: candidate.seconds, nanoseconds: candidate.nanoseconds }
    : candidate;
  return validateProtectedResourceMetadata({
    ...data,
    createdAt: timestamp(data.createdAt),
    boundAt: timestamp(data.boundAt),
  }, scope);
}

async function readVideoState(db: Firestore, rawTarget: Target): Promise<VideoState> {
  const selected = target(rawTarget);
  const sessionRef = db.doc(sessionPath(selected));
  const accessRef = db.doc(`${sessionPath(selected)}/videoAccess/primary`);
  const [sessionSnap, accessSnap] = await db.getAll(sessionRef, accessRef);
  if (!sessionSnap.exists || !accessSnap.exists) throw new Error("A valid bound video was not found.");
  const session = validateSessionForVideoPublication(sessionSnap.data());
  if (!Object.prototype.hasOwnProperty.call(session, "videoAssetId"))
    throw new Error("A valid bound video was not found.");
  const access = validateExistingVideoAccess(accessSnap.data());
  if (session.videoAssetId !== access.videoAssetId)
    throw new Error("The current video binding is malformed.");
  return {
    sessionTitle: session.title as string,
    sessionRevision: revision(sessionSnap),
    accessRevision: revision(accessSnap),
    videoAssetId: access.videoAssetId,
    access,
  };
}

async function readResourceState(db: Firestore, rawTarget: Target, rawResourceId: string): Promise<ResourceState> {
  const selected = target(rawTarget);
  const resourceId = validateProtectedResourceId(rawResourceId);
  const prefix = resourcePath(selected, resourceId);
  const [metadataSnap, accessSnap] = await db.getAll(db.doc(prefix), db.doc(`${prefix}/access/primary`));
  if (!metadataSnap.exists || !accessSnap.exists) throw new Error("A valid protected resource was not found.");
  const scope = { type: "session", ...selected } as const;
  const metadata = normalizeMetadata(metadataSnap.data(), scope);
  const access = validateProtectedResourceAccess(accessSnap.data());
  validateProtectedResourcePair(metadata, access);
  return { metadataRevision: revision(metadataSnap), accessRevision: revision(accessSnap), metadata, access };
}

export async function readSessionProtectedContentInventory(db: Firestore, rawTarget: Target) {
  const selected = target(rawTarget);
  const sessionRef = db.doc(sessionPath(selected));
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) throw new Error("Session was not found.");
  const session = validateSessionForVideoPublication(sessionSnap.data());
  let video: { bound: false } | { bound: true; videoAssetId: string } = { bound: false };
  const hasVideo = Object.prototype.hasOwnProperty.call(session, "videoAssetId");
  const accessSnap = await sessionRef.collection("videoAccess").doc("primary").get();
  if (hasVideo !== accessSnap.exists) throw new Error("The current video binding is malformed.");
  if (hasVideo) {
    const access = validateExistingVideoAccess(accessSnap.data());
    if (access.videoAssetId !== session.videoAssetId) throw new Error("The current video binding is malformed.");
    video = { bound: true, videoAssetId: access.videoAssetId };
  }
  const resourcesSnap = await sessionRef.collection("resources").limit(SESSION_RESOURCE_INVENTORY_LIMIT + 1).get();
  if (resourcesSnap.docs.length > SESSION_RESOURCE_INVENTORY_LIMIT)
    throw new Error("Protected resource inventory exceeds the supported limit.");
  const scope = { type: "session", ...selected } as const;
  const resources = await Promise.all(resourcesSnap.docs.map(async (document) => {
    const metadata = normalizeMetadata(document.data(), scope);
    if (metadata.resourceId !== document.id) throw new Error("Protected resource inventory is malformed.");
    const accessSnap = await document.ref.collection("access").doc("primary").get();
    if (!accessSnap.exists) throw new Error("Protected resource inventory is malformed.");
    const access = validateProtectedResourceAccess(accessSnap.data());
    validateProtectedResourcePair(metadata, access);
    return {
      resourceId: metadata.resourceId,
      title: metadata.title,
      originalFileName: metadata.originalFileName,
      plaintextSize: metadata.plaintextSize,
      status: "BOUND" as const,
    };
  }));
  resources.sort((a, b) => a.title.localeCompare(b.title) || a.resourceId.localeCompare(b.resourceId));
  return { courseId: selected.courseId, moduleId: selected.moduleId, sessionId: selected.sessionId, sessionTitle: session.title as string, video, resources };
}

export async function reviewVideoReplacement(db: Firestore, deployment: OwnerVerifiedDeployment, projectId: string): Promise<VideoReplaceReview> {
  const validated = await validateOwnerVerifiedVideoDeployment(deployment, projectId);
  const selected = target(validated.review.safe.target);
  const current = await readVideoState(db, selected);
  if (current.videoAssetId === validated.review.safe.videoAssetId) throw new Error("Video replacement requires a new immutable asset ID.");
  const proposed = validated.prepared.input;
  const access = validateExistingVideoAccess({ videoAssetId: proposed.videoAssetId, contentKey: proposed.contentKey });
  return { operation: "video-replace", target: selected, current, deployment, proposed: access, safe: { ...selected, sessionTitle: current.sessionTitle, currentVideoAssetId: current.videoAssetId, newVideoAssetId: access.videoAssetId, warning: "The old encrypted artifact will remain. Already-open playback may continue until its browser lifecycle ends." } };
}

export async function reviewVideoUnbind(db: Firestore, rawTarget: Target): Promise<VideoUnbindReview> {
  const selected = target(rawTarget);
  const current = await readVideoState(db, selected);
  return { operation: "video-unbind", target: selected, current, safe: { sessionTitle: current.sessionTitle, videoAssetId: current.videoAssetId, warning: "This removes only the Firestore video binding. The encrypted Hosting artifact remains, and already-open playback may continue." } };
}

async function applyVideo(db: Firestore, review: VideoReplaceReview | VideoUnbindReview) {
  const sessionRef = db.doc(sessionPath(review.target));
  const accessRef = db.doc(`${sessionPath(review.target)}/videoAccess/primary`);
  await db.runTransaction(async (transaction) => {
    const sessionSnap = await transaction.get(sessionRef);
    const accessSnap = await transaction.get(accessRef);
    if (!sessionSnap.exists || !accessSnap.exists) throw new Error("Protected video review became stale.");
    const session = validateSessionForVideoPublication(sessionSnap.data());
    const access = validateExistingVideoAccess(accessSnap.data());
    if (revision(sessionSnap) !== review.current.sessionRevision || revision(accessSnap) !== review.current.accessRevision || session.videoAssetId !== review.current.videoAssetId || !same(access, review.current.access))
      throw new Error("Protected video review became stale.");
    if (review.operation === "video-replace") {
      if (review.proposed.videoAssetId === review.current.videoAssetId) throw new Error("Video replacement requires a new immutable asset ID.");
      transaction.update(sessionRef, { videoAssetId: review.proposed.videoAssetId });
      transaction.set(accessRef, review.proposed);
    } else {
      transaction.update(sessionRef, { videoAssetId: FieldValue.delete() });
      transaction.delete(accessRef);
    }
  });
  try {
    const [sessionSnap, accessSnap] = await db.getAll(sessionRef, accessRef);
    if (!sessionSnap.exists) throw new Error();
    const session = validateSessionForVideoPublication(sessionSnap.data());
    if (review.operation === "video-replace") {
      if (!accessSnap.exists || session.videoAssetId !== review.proposed.videoAssetId || !same(validateExistingVideoAccess(accessSnap.data()), review.proposed)) throw new Error();
    } else if (Object.prototype.hasOwnProperty.call(session, "videoAssetId") || accessSnap.exists) throw new Error();
    return { status: "COMMITTED_AND_VERIFIED" as const, postApplyVerified: true };
  } catch {
    return { status: "COMMITTED_VERIFICATION_UNCERTAIN" as const, postApplyVerified: false };
  }
}

export async function applyVideoReplacement(
  db: Firestore,
  review: VideoReplaceReview,
  dependencies: Readonly<{ validateDeployment?: () => Promise<unknown> }> = {},
) {
  await (dependencies.validateDeployment ?? (() => validateOwnerVerifiedVideoDeployment(review.deployment, review.deployment.review.safe.projectId)))();
  return applyVideo(db, review);
}
export async function applyVideoUnbind(db: Firestore, review: VideoUnbindReview) { return applyVideo(db, review); }

function resourceIdentity(deployment: OwnerVerifiedResourceDeployment) {
  if (deployment.status !== "VERIFIED_DEPLOYED") throw new Error("Verified resource deployment is invalid.");
  const prepared = deployment.review.release.preparation;
  const identity = prepared.identity;
  if (identity.scope.type !== "session") throw new Error("Only Session resources are supported.");
  const access = validateProtectedResourceAccess({ version: 1, resourceId: identity.resourceId, formatVersion: identity.formatVersion, ciphertextSha256: identity.ciphertextSha256, contentKey: prepared.contentKey });
  return { identity, access, target: target(identity.scope) };
}

export async function reviewResourceReplacement(db: Firestore, deployment: OwnerVerifiedResourceDeployment, projectId: string, oldResourceId: string): Promise<ResourceReplaceReview> {
  if (deployment.review.safe.projectId !== projectId) throw new Error("Verified resource deployment identity is invalid.");
  await verifyOwnerResourceDeployment(deployment);
  const proposed = resourceIdentity(deployment);
  const current = await readResourceState(db, proposed.target, oldResourceId);
  if (proposed.identity.resourceId === current.metadata.resourceId) throw new Error("Resource replacement requires a new immutable resource ID.");
  const newPrefix = resourcePath(proposed.target, proposed.identity.resourceId);
  const [metadata, access] = await db.getAll(db.doc(newPrefix), db.doc(`${newPrefix}/access/primary`));
  if (metadata.exists || access.exists) throw new Error("The new protected resource is already bound.");
  return { operation: "resource-replace", target: proposed.target, current, deployment, safe: { ...proposed.target, oldResourceId: current.metadata.resourceId, oldTitle: current.metadata.title, newResourceId: proposed.identity.resourceId, newTitle: proposed.identity.title, warning: "The old encrypted artifact will remain after its Firestore binding is removed." } };
}

export async function reviewResourceRemoval(db: Firestore, rawTarget: Target, resourceId: string): Promise<ResourceRemoveReview> {
  const selected = target(rawTarget);
  const current = await readResourceState(db, selected, resourceId);
  return { operation: "resource-remove", target: selected, current, safe: { resourceId: current.metadata.resourceId, title: current.metadata.title, warning: "This removes only the Firestore resource pair. The encrypted Hosting artifact remains, and an already-downloaded PDF cannot be revoked." } };
}

function firestoreMetadata(identity: ReturnType<typeof resourceIdentity>["identity"], timestamp: Timestamp) {
  const contract = { seconds: timestamp.seconds, nanoseconds: timestamp.nanoseconds };
  return validateProtectedResourceMetadata({
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
    createdAt: contract,
    boundAt: contract,
  }, identity.scope);
}

async function applyResource(db: Firestore, review: ResourceReplaceReview | ResourceRemoveReview) {
  const oldPrefix = resourcePath(review.target, review.current.metadata.resourceId);
  const oldMetadataRef = db.doc(oldPrefix);
  const oldAccessRef = db.doc(`${oldPrefix}/access/primary`);
  let expectedNew: { metadata: ProtectedResourceMetadata; access: ProtectedResourceAccess } | null = null;
  await db.runTransaction(async (transaction) => {
    const oldMetadataSnap = await transaction.get(oldMetadataRef);
    const oldAccessSnap = await transaction.get(oldAccessRef);
    if (!oldMetadataSnap.exists || !oldAccessSnap.exists) throw new Error("Protected resource review became stale.");
    const scope = { type: "session", ...review.target } as const;
    const metadata = normalizeMetadata(oldMetadataSnap.data(), scope);
    const access = validateProtectedResourceAccess(oldAccessSnap.data());
    validateProtectedResourcePair(metadata, access);
    if (revision(oldMetadataSnap) !== review.current.metadataRevision || revision(oldAccessSnap) !== review.current.accessRevision || !same(metadata, review.current.metadata) || !same(access, review.current.access))
      throw new Error("Protected resource review became stale.");
    if (review.operation === "resource-replace") {
      const proposed = resourceIdentity(review.deployment);
      if (proposed.identity.resourceId === metadata.resourceId) throw new Error("Resource replacement requires a new immutable resource ID.");
      const newPrefix = resourcePath(review.target, proposed.identity.resourceId);
      const newMetadataRef = db.doc(newPrefix);
      const newAccessRef = db.doc(`${newPrefix}/access/primary`);
      const newMetadataSnap = await transaction.get(newMetadataRef);
      const newAccessSnap = await transaction.get(newAccessRef);
      if (newMetadataSnap.exists || newAccessSnap.exists) throw new Error("Protected resource review became stale.");
      const now = Timestamp.now();
      const newMetadata = firestoreMetadata(proposed.identity, now);
      expectedNew = { metadata: newMetadata, access: proposed.access };
      transaction.create(newMetadataRef, { ...newMetadata, createdAt: now, boundAt: now });
      transaction.create(newAccessRef, proposed.access);
    }
    transaction.delete(oldAccessRef);
    transaction.delete(oldMetadataRef);
  });
  try {
    const [oldMetadata, oldAccess] = await db.getAll(oldMetadataRef, oldAccessRef);
    if (oldMetadata.exists || oldAccess.exists) throw new Error();
    if (review.operation === "resource-replace") {
      const proposed = resourceIdentity(review.deployment);
      const newPrefix = resourcePath(review.target, proposed.identity.resourceId);
      const [metadataSnap, accessSnap] = await db.getAll(db.doc(newPrefix), db.doc(`${newPrefix}/access/primary`));
      const verifiedExpected = expectedNew as unknown as { metadata: ProtectedResourceMetadata; access: ProtectedResourceAccess } | null;
      if (!metadataSnap.exists || !accessSnap.exists || !verifiedExpected) throw new Error();
      const mapped = normalizeMetadata(metadataSnap.data(), { type: "session", ...review.target });
      const access = validateProtectedResourceAccess(accessSnap.data());
      validateProtectedResourcePair(mapped, access);
      if (!same(mapped, verifiedExpected.metadata) || !same(access, verifiedExpected.access)) throw new Error();
    }
    return { status: "COMMITTED_AND_VERIFIED" as const, postApplyVerified: true };
  } catch {
    return { status: "COMMITTED_VERIFICATION_UNCERTAIN" as const, postApplyVerified: false };
  }
}

export async function applyResourceReplacement(
  db: Firestore,
  review: ResourceReplaceReview,
  dependencies: Readonly<{ verifyDeployment?: () => Promise<unknown> }> = {},
) {
  await (dependencies.verifyDeployment ?? (() => verifyOwnerResourceDeployment(review.deployment)))();
  return applyResource(db, review);
}
export async function applyResourceRemoval(db: Firestore, review: ResourceRemoveReview) { return applyResource(db, review); }
