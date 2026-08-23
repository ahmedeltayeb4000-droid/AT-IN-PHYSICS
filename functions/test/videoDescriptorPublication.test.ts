import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  parseVideoDescriptorPublicationArgs,
  parseVideoPublicationDescriptor,
  prepareVideoPublicationPackage,
} from "../src/tooling/videoDescriptorPublication.js";
import {
  encryptVideoBytes,
  VIDEO_ARTIFACT_FORMAT,
} from "../src/videoPackaging/crypto.js";

const ASSET_ID = "mechanics-intro-motion-video";

function mp4Fixture(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x32,
  ]);
}

function descriptorFor(artifact: Buffer, contentKey: string) {
  return {
    formatVersion: VIDEO_ARTIFACT_FORMAT,
    target: {
      courseId: "mechanics",
      moduleId: "mechanics-motion-basics",
      sessionId: "mechanics-intro-motion",
    },
    artifact: {
      fileName: `${ASSET_ID}.atv1`,
      sha256: createHash("sha256").update(artifact).digest("hex"),
      plaintextSize: mp4Fixture().length,
      encryptedSize: artifact.length,
    },
    sessionPatch: { videoAssetId: ASSET_ID },
    videoAccess: { videoAssetId: ASSET_ID, contentKey },
  };
}

async function withTempDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "at-video-publish-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writePackageFixture(
  directory: string,
  plaintext = mp4Fixture(),
) {
  const encrypted = encryptVideoBytes(plaintext);
  const descriptor = descriptorFor(encrypted.artifact, encrypted.contentKey);
  descriptor.artifact.plaintextSize = plaintext.length;
  const artifactPath = join(directory, descriptor.artifact.fileName);
  const descriptorPath = join(directory, `${ASSET_ID}.publication.json`);
  await writeFile(artifactPath, encrypted.artifact);
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  return { encrypted, descriptor, artifactPath, descriptorPath };
}

test("CLI arguments default to dry run and require explicit apply", () => {
  assert.deepEqual(
    parseVideoDescriptorPublicationArgs([
      "--descriptor-file",
      "video-packages/lesson.publication.json",
    ]),
    {
      descriptorFile: "video-packages/lesson.publication.json",
      apply: false,
    },
  );
  assert.equal(
    parseVideoDescriptorPublicationArgs([
      "--descriptor-file",
      "video-packages/lesson.publication.json",
      "--apply",
    ]).apply,
    true,
  );
});

test("CLI rejects missing, duplicate, blank, unknown, and positional arguments", () => {
  for (const args of [
    [],
    ["--descriptor-file"],
    ["--descriptor-file", "--apply"],
    ["--descriptor-file", "   "],
    ["--descriptor-file", " padded.publication.json "],
    ["--descriptor-file", "descriptor.json"],
    ["--descriptor-file", "a.publication.json", "--descriptor-file", "b.publication.json"],
    ["--descriptor-file", "a.publication.json", "--apply", "--apply"],
    ["--descriptor-file", "a.publication.json", "--unknown"],
    ["--descriptor-file", "a.publication.json", "garbage"],
    ["--descriptor-file", "a.publication.json", "--apply", "true"],
  ]) {
    assert.throws(() => parseVideoDescriptorPublicationArgs(args));
  }
});

test("descriptor parser requires exact top-level and nested schemas", () => {
  const encrypted = encryptVideoBytes(mp4Fixture());
  const descriptor = descriptorFor(encrypted.artifact, encrypted.contentKey);
  assert.deepEqual(parseVideoPublicationDescriptor(descriptor), descriptor);
  assert.throws(
    () => parseVideoPublicationDescriptor({ ...descriptor, extra: true }),
    /unknown or missing fields/,
  );
  assert.throws(
    () =>
      parseVideoPublicationDescriptor({
        ...descriptor,
        target: { ...descriptor.target, extra: true },
      }),
    /unknown or missing fields/,
  );
});

test("descriptor parser rejects unsafe IDs, binding mismatch, key, filename, hash, and sizes", () => {
  const encrypted = encryptVideoBytes(mp4Fixture());
  const base = descriptorFor(encrypted.artifact, encrypted.contentKey);
  const invalidDescriptors = [
    { ...base, target: { ...base.target, courseId: "Mechanics" } },
    { ...base, sessionPatch: { videoAssetId: "INVALID" } },
    { ...base, videoAccess: { ...base.videoAccess, contentKey: "invalid" } },
    { ...base, videoAccess: { ...base.videoAccess, videoAssetId: "other-video" } },
    { ...base, artifact: { ...base.artifact, fileName: "../unsafe.atv1" } },
    { ...base, artifact: { ...base.artifact, sha256: "A".repeat(64) } },
    { ...base, artifact: { ...base.artifact, plaintextSize: 0 } },
    { ...base, artifact: { ...base.artifact, encryptedSize: 1.5 } },
  ];
  invalidDescriptors.forEach((descriptor) => {
    assert.throws(() => parseVideoPublicationDescriptor(descriptor));
  });
});

test("descriptor file rejects missing, empty, BOM, malformed JSON, and unknown fields", async () => {
  await withTempDirectory(async (directory) => {
    const missing = join(directory, "missing.publication.json");
    await assert.rejects(prepareVideoPublicationPackage(missing), /could not be inspected/);

    for (const [name, contents] of [
      ["empty", ""],
      ["bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")])],
      ["malformed", "{"],
      ["unknown", JSON.stringify({ unexpected: true })],
    ] as const) {
      const path = join(directory, `${name}.publication.json`);
      await writeFile(path, contents);
      await assert.rejects(prepareVideoPublicationPackage(path));
    }
  });
});

test("valid descriptor and authenticated ATV1 package produce only a redacted safe summary", async () => {
  await withTempDirectory(async (directory) => {
    const fixture = await writePackageFixture(directory);
    const prepared = await prepareVideoPublicationPackage(fixture.descriptorPath);
    assert.equal(prepared.summary.artifactSha256Verified, true);
    assert.equal(prepared.summary.artifactAuthenticated, true);
    assert.equal(prepared.summary.plaintextMp4Verified, true);
    assert.equal(
      JSON.stringify(prepared.summary).includes(fixture.encrypted.contentKey),
      false,
    );
  });
});

test("missing or modified artifact fails integrity verification", async () => {
  await withTempDirectory(async (directory) => {
    const fixture = await writePackageFixture(directory);
    await rm(fixture.artifactPath);
    await assert.rejects(
      prepareVideoPublicationPackage(fixture.descriptorPath),
      /could not be inspected/,
    );

    const replacement = await writePackageFixture(directory);
    const artifact = await readFile(replacement.artifactPath);
    artifact[20] ^= 1;
    await writeFile(replacement.artifactPath, artifact);
    await assert.rejects(
      prepareVideoPublicationPackage(replacement.descriptorPath),
      /integrity verification failed/,
    );
  });
});

test("truncated artifact fails closed even with matching descriptor hash and size", async () => {
  await withTempDirectory(async (directory) => {
    const fixture = await writePackageFixture(directory);
    const truncated = fixture.encrypted.artifact.subarray(0, 20);
    fixture.descriptor.artifact.encryptedSize = truncated.length;
    fixture.descriptor.artifact.sha256 = createHash("sha256").update(truncated).digest("hex");
    await writeFile(fixture.artifactPath, truncated);
    await writeFile(fixture.descriptorPath, JSON.stringify(fixture.descriptor));
    await assert.rejects(
      prepareVideoPublicationPackage(fixture.descriptorPath),
      /sizes are inconsistent/,
    );
  });
});

test("wrong key and altered authentication tag fail authenticated verification", async () => {
  await withTempDirectory(async (directory) => {
    const wrongKeyFixture = await writePackageFixture(directory);
    wrongKeyFixture.descriptor.videoAccess.contentKey = encryptVideoBytes(mp4Fixture()).contentKey;
    await writeFile(
      wrongKeyFixture.descriptorPath,
      JSON.stringify(wrongKeyFixture.descriptor),
    );
    await assert.rejects(
      prepareVideoPublicationPackage(wrongKeyFixture.descriptorPath),
      /authentication failed/,
    );

    await rm(directory, { recursive: true, force: true });
    const recreated = await mkdtemp(join(tmpdir(), "at-video-publish-tag-"));
    try {
      const tagFixture = await writePackageFixture(recreated);
      const altered = Buffer.from(tagFixture.encrypted.artifact);
      altered[altered.length - 1] ^= 1;
      tagFixture.descriptor.artifact.sha256 = createHash("sha256").update(altered).digest("hex");
      await writeFile(tagFixture.artifactPath, altered);
      await writeFile(tagFixture.descriptorPath, JSON.stringify(tagFixture.descriptor));
      await assert.rejects(
        prepareVideoPublicationPackage(tagFixture.descriptorPath),
        /authentication failed/,
      );
    } finally {
      await rm(recreated, { recursive: true, force: true });
    }
  });
});

test("plaintext size mismatch and decrypted non-MP4 content fail verification", async () => {
  await withTempDirectory(async (directory) => {
    const sizeFixture = await writePackageFixture(directory);
    sizeFixture.descriptor.artifact.plaintextSize += 1;
    await writeFile(sizeFixture.descriptorPath, JSON.stringify(sizeFixture.descriptor));
    await assert.rejects(
      prepareVideoPublicationPackage(sizeFixture.descriptorPath),
      /sizes are inconsistent/,
    );

    await rm(directory, { recursive: true, force: true });
    const recreated = await mkdtemp(join(tmpdir(), "at-video-publish-mp4-"));
    try {
      const invalid = await writePackageFixture(
        recreated,
        Buffer.from("this is not an mp4 container"),
      );
      await assert.rejects(
        prepareVideoPublicationPackage(invalid.descriptorPath),
        /supported MP4/,
      );
    } finally {
      await rm(recreated, { recursive: true, force: true });
    }
  });
});
