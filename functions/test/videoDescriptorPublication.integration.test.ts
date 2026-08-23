import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type DocumentReference,
  type Firestore,
} from "firebase-admin/firestore";
import {
  runVideoDescriptorPublication,
} from "../src/tooling/videoDescriptorPublication.js";
import { encryptVideoBytes, VIDEO_ARTIFACT_FORMAT } from "../src/videoPackaging/crypto.js";

const PROJECT_ID = "demo-at-in-physics";
let app: App;
let db: Firestore;

function requireEmulatorSafety(): void {
  const projectId =
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
  if (projectId !== PROJECT_ID || !process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Video descriptor publication tests require the demo Firestore emulator.",
    );
  }
}

function mp4Fixture(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);
}

function sessionPath(courseId: string, moduleId: string, sessionId: string) {
  return `courses/${courseId}/modules/${moduleId}/sessions/${sessionId}`;
}

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    title: "Introduction to Motion",
    order: 1,
    publicationStatus: "draft",
    releaseAt: Timestamp.fromDate(new Date("2030-01-01T00:00:00.000Z")),
    lessonText: "Preserved lesson text.",
    futureField: { nested: ["preserved", 7] },
    ...overrides,
  };
}

async function withTempDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "at-video-publish-int-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function packageFor(
  directory: string,
  courseId: string,
  moduleId: string,
  sessionId: string,
  videoAssetId = "lesson-video-a",
) {
  const plaintext = mp4Fixture();
  const encrypted = encryptVideoBytes(plaintext);
  const artifactFileName = `${videoAssetId}.atv1`;
  const descriptor = {
    formatVersion: VIDEO_ARTIFACT_FORMAT,
    target: { courseId, moduleId, sessionId },
    artifact: {
      fileName: artifactFileName,
      sha256: createHash("sha256").update(encrypted.artifact).digest("hex"),
      plaintextSize: plaintext.length,
      encryptedSize: encrypted.artifact.length,
    },
    sessionPatch: { videoAssetId },
    videoAccess: { videoAssetId, contentKey: encrypted.contentKey },
  };
  const artifactPath = join(directory, artifactFileName);
  const descriptorPath = join(directory, `${videoAssetId}.publication.json`);
  await writeFile(artifactPath, encrypted.artifact);
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  return { descriptor, descriptorPath, artifactPath };
}

function refs(courseId: string, moduleId: string, sessionId: string) {
  const session = db.doc(sessionPath(courseId, moduleId, sessionId));
  return { session, access: session.collection("videoAccess").doc("primary") };
}

async function snapshot(reference: DocumentReference) {
  const value = await reference.get();
  return { exists: value.exists, data: value.data(), updateTime: value.updateTime };
}

before(() => {
  requireEmulatorSafety();
  app = initializeApp({ projectId: PROJECT_ID }, "video-descriptor-publication-tests");
  db = getFirestore(app);
});

after(async () => {
  await deleteApp(app);
});

test("dry run performs exact preflight reads and zero writes", async () => {
  await withTempDirectory(async (directory) => {
    const ids = ["cli-dry-course", "cli-dry-module", "cli-dry-session"] as const;
    const packageFixture = await packageFor(directory, ...ids);
    const references = refs(...ids);
    await references.session.set(sessionData());
    const before = await snapshot(references.session);

    const result = await runVideoDescriptorPublication(db, {
      descriptorFile: packageFixture.descriptorPath,
      apply: false,
    });

    assert.equal(result.preflight.proposedStatus, "created");
    assert.equal(result.applyStatus, null);
    assert.equal(result.postApplyVerified, false);
    assert.equal(JSON.stringify(result).includes(packageFixture.descriptor.videoAccess.contentKey), false);
    const afterSnapshot = await snapshot(references.session);
    assert.deepEqual(afterSnapshot.data, before.data);
    assert.equal(afterSnapshot.updateTime?.isEqual(before.updateTime!), true);
    assert.equal((await references.access.get()).exists, false);
  });
});

test("missing or malformed Session and malformed access fail closed", async () => {
  await withTempDirectory(async (directory) => {
    const missingIds = ["cli-missing-course", "cli-missing-module", "cli-missing-session"] as const;
    const missingPackage = await packageFor(directory, ...missingIds);
    await assert.rejects(
      runVideoDescriptorPublication(db, { descriptorFile: missingPackage.descriptorPath, apply: true }),
      /Session was not found/,
    );

    const malformedIds = ["cli-malformed-course", "cli-malformed-module", "cli-malformed-session"] as const;
    const malformedPackage = await packageFor(directory, ...malformedIds, "malformed-video");
    const malformedRefs = refs(...malformedIds);
    await malformedRefs.session.set(sessionData({ order: "one" }));
    await assert.rejects(
      runVideoDescriptorPublication(db, { descriptorFile: malformedPackage.descriptorPath, apply: false }),
      /Existing Session is malformed/,
    );

    const accessIds = ["cli-access-course", "cli-access-module", "cli-access-session"] as const;
    const accessPackage = await packageFor(directory, ...accessIds, "access-video");
    const accessRefs = refs(...accessIds);
    await Promise.all([
      accessRefs.session.set(sessionData()),
      accessRefs.access.set({ videoAssetId: "access-video", contentKey: "bad", extra: true }),
    ]);
    const before = await snapshot(accessRefs.session);
    await assert.rejects(
      runVideoDescriptorPublication(db, { descriptorFile: accessPackage.descriptorPath, apply: true }),
      /Existing video access is malformed/,
    );
    assert.equal((await snapshot(accessRefs.session)).updateTime?.isEqual(before.updateTime!), true);
  });
});

test("apply creates exact binding, verifies it, and preserves all isolation", async () => {
  await withTempDirectory(async (directory) => {
    const ids = ["cli-create-course", "cli-create-module", "cli-create-session"] as const;
    const packageFixture = await packageFor(directory, ...ids);
    const references = refs(...ids);
    const sibling = db.doc(sessionPath(ids[0], ids[1], "cli-create-sibling"));
    const otherModule = db.doc(sessionPath(ids[0], "cli-other-module", ids[2]));
    const otherCourse = db.doc(sessionPath("cli-other-course", ids[1], ids[2]));
    const initial = sessionData();
    await Promise.all([
      references.session.set(initial),
      sibling.set(sessionData({ title: "Sibling" })),
      otherModule.set(sessionData({ title: "Other module" })),
      otherCourse.set(sessionData({ title: "Other course" })),
    ]);
    const isolatedBefore = await Promise.all([
      snapshot(sibling), snapshot(otherModule), snapshot(otherCourse),
    ]);

    const result = await runVideoDescriptorPublication(db, {
      descriptorFile: packageFixture.descriptorPath,
      apply: true,
    });

    assert.equal(result.applyStatus, "created");
    assert.equal(result.postApplyVerified, true);
    assert.deepEqual((await references.session.get()).data(), {
      ...initial,
      videoAssetId: packageFixture.descriptor.sessionPatch.videoAssetId,
    });
    assert.deepEqual((await references.access.get()).data(), packageFixture.descriptor.videoAccess);
    const isolatedAfter = await Promise.all([
      snapshot(sibling), snapshot(otherModule), snapshot(otherCourse),
    ]);
    isolatedAfter.forEach((value, index) => {
      assert.deepEqual(value.data, isolatedBefore[index].data);
      assert.equal(value.updateTime?.isEqual(isolatedBefore[index].updateTime!), true);
    });
  });
});

test("apply rotates an existing valid binding", async () => {
  await withTempDirectory(async (directory) => {
    const ids = ["cli-rotate-course", "cli-rotate-module", "cli-rotate-session"] as const;
    const packageFixture = await packageFor(directory, ...ids, "lesson-video-new");
    const references = refs(...ids);
    await Promise.all([
      references.session.set(sessionData({ videoAssetId: "lesson-video-old" })),
      references.access.set({ videoAssetId: "lesson-video-old", contentKey: "A".repeat(43) }),
    ]);

    const result = await runVideoDescriptorPublication(db, {
      descriptorFile: packageFixture.descriptorPath,
      apply: true,
    });
    assert.equal(result.applyStatus, "updated");
    assert.equal((await references.session.get()).data()?.videoAssetId, "lesson-video-new");
    assert.deepEqual((await references.access.get()).data(), packageFixture.descriptor.videoAccess);
  });
});

test("exact apply no-op preserves Session and access update times", async () => {
  await withTempDirectory(async (directory) => {
    const ids = ["cli-noop-course", "cli-noop-module", "cli-noop-session"] as const;
    const packageFixture = await packageFor(directory, ...ids);
    const references = refs(...ids);
    await Promise.all([
      references.session.set(sessionData({ videoAssetId: packageFixture.descriptor.sessionPatch.videoAssetId })),
      references.access.set(packageFixture.descriptor.videoAccess),
    ]);
    const beforeSession = await snapshot(references.session);
    const beforeAccess = await snapshot(references.access);

    const result = await runVideoDescriptorPublication(db, {
      descriptorFile: packageFixture.descriptorPath,
      apply: true,
    });
    assert.equal(result.applyStatus, "already-current");
    assert.equal((await snapshot(references.session)).updateTime?.isEqual(beforeSession.updateTime!), true);
    assert.equal((await snapshot(references.access)).updateTime?.isEqual(beforeAccess.updateTime!), true);
  });
});

test("artifact mismatch prevents all Firestore mutation", async () => {
  await withTempDirectory(async (directory) => {
    const ids = ["cli-integrity-course", "cli-integrity-module", "cli-integrity-session"] as const;
    const packageFixture = await packageFor(directory, ...ids);
    const references = refs(...ids);
    await references.session.set(sessionData());
    const before = await snapshot(references.session);
    await writeFile(packageFixture.artifactPath, Buffer.from("tampered"));

    await assert.rejects(
      runVideoDescriptorPublication(db, { descriptorFile: packageFixture.descriptorPath, apply: true }),
      /integrity verification failed/,
    );
    assert.equal((await snapshot(references.session)).updateTime?.isEqual(before.updateTime!), true);
    assert.equal((await references.access.get()).exists, false);
  });
});
