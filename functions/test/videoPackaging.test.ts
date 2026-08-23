import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test from "node:test";
import {
  decodeContentKey,
  decryptVideoArtifact,
  encryptVideoBytes,
  parseEncryptedVideoArtifact,
  VIDEO_ARTIFACT_FORMAT,
  VIDEO_AUTH_TAG_LENGTH,
  VIDEO_IV_LENGTH,
  VIDEO_KEY_LENGTH,
} from "../src/videoPackaging/crypto.js";
import {
  buildVideoOutputPaths,
  buildVideoPublicationData,
  DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT,
  inspectMp4Input,
  MAX_VIDEO_INPUT_SIZE,
  parseVideoPackagingArgs,
  runVideoPackaging,
} from "../src/tooling/videoPackaging.js";

const execFileAsync = promisify(execFile);
const VALID_ARGS = [
  "--course-id",
  "mechanics",
  "--module-id",
  "mechanics-motion-basics",
  "--session-id",
  "mechanics-intro-motion",
  "--video-asset-id",
  "mechanics-intro-motion-video",
  "--input-file",
  "lesson.mp4",
] as const;

function mp4Fixture(): Buffer {
  return Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
    0x6d, 0x70, 0x34, 0x32,
  ]);
}

async function withTempDirectory(
  callback: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "at-video-package-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("AES-256-GCM package uses canonical key and IV sizes", () => {
  const packaged = encryptVideoBytes(Buffer.from("fixture video bytes"));

  assert.equal(decodeContentKey(packaged.contentKey).length, VIDEO_KEY_LENGTH);
  assert.equal(packaged.contentKey.length, 43);
  assert.match(
    packaged.contentKey,
    /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,
  );
  assert.equal(packaged.iv.length, VIDEO_IV_LENGTH);
  assert.equal(
    packaged.artifact.length,
    4 + VIDEO_IV_LENGTH + 19 + VIDEO_AUTH_TAG_LENGTH,
  );
});

test("encrypt then decrypt recovers exact original bytes", () => {
  const plaintext = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]);
  const packaged = encryptVideoBytes(plaintext);

  assert.deepEqual(
    decryptVideoArtifact(packaged.artifact, packaged.contentKey),
    plaintext,
  );
});

test("artifact parser is deterministic and exposes the exact ATV1 layout", () => {
  const packaged = encryptVideoBytes(Buffer.from("deterministic parser input"));
  const first = parseEncryptedVideoArtifact(packaged.artifact);
  const second = parseEncryptedVideoArtifact(packaged.artifact);

  assert.deepEqual(first, second);
  assert.equal(first.format, VIDEO_ARTIFACT_FORMAT);
  assert.deepEqual(first.iv, packaged.iv);
  assert.equal(first.authenticationTag.length, VIDEO_AUTH_TAG_LENGTH);
});

test("tampered ciphertext fails authenticated decryption", () => {
  const packaged = encryptVideoBytes(Buffer.from("ciphertext tamper fixture"));
  const tampered = Buffer.from(packaged.artifact);
  tampered[4 + VIDEO_IV_LENGTH] ^= 0x01;

  assert.throws(
    () => decryptVideoArtifact(tampered, packaged.contentKey),
    /authentication failed/,
  );
});

test("tampered authentication tag fails authenticated decryption", () => {
  const packaged = encryptVideoBytes(Buffer.from("tag tamper fixture"));
  const tampered = Buffer.from(packaged.artifact);
  tampered[tampered.length - 1] ^= 0x01;

  assert.throws(
    () => decryptVideoArtifact(tampered, packaged.contentKey),
    /authentication failed/,
  );
});

test("wrong key fails authenticated decryption", () => {
  const packaged = encryptVideoBytes(Buffer.from("wrong key fixture"));
  const another = encryptVideoBytes(Buffer.from("another package"));

  assert.throws(
    () => decryptVideoArtifact(packaged.artifact, another.contentKey),
    /authentication failed/,
  );
});

test("truncated artifact and invalid magic or version fail closed", () => {
  const packaged = encryptVideoBytes(Buffer.from("artifact validation fixture"));
  assert.throws(
    () => parseEncryptedVideoArtifact(packaged.artifact.subarray(0, 32)),
    /artifact is invalid/,
  );

  const invalidMagic = Buffer.from(packaged.artifact);
  invalidMagic[0] ^= 0x01;
  assert.throws(
    () => parseEncryptedVideoArtifact(invalidMagic),
    /artifact is invalid/,
  );

  const invalidVersion = Buffer.from(packaged.artifact);
  invalidVersion[3] = 0x32;
  assert.throws(
    () => parseEncryptedVideoArtifact(invalidVersion),
    /artifact is invalid/,
  );
});

test("separate packaging operations use different keys and IVs", () => {
  const first = encryptVideoBytes(Buffer.from("same plaintext"));
  const second = encryptVideoBytes(Buffer.from("same plaintext"));

  assert.notEqual(first.contentKey, second.contentKey);
  assert.notDeepEqual(first.iv, second.iv);
  assert.notDeepEqual(first.artifact, second.artifact);
});

test("publication builder returns only the bound Session and access data", () => {
  const contentKey = "A".repeat(43);
  assert.deepEqual(
    buildVideoPublicationData("mechanics-intro-motion-video", contentKey),
    {
      sessionPatch: { videoAssetId: "mechanics-intro-motion-video" },
      videoAccess: {
        videoAssetId: "mechanics-intro-motion-video",
        contentKey,
      },
    },
  );
  assert.throws(
    () => buildVideoPublicationData("mechanics-intro-motion-video", "invalid"),
    /content key/,
  );
});

test("valid CLI arguments default to dry run and require explicit package mode", () => {
  assert.deepEqual(parseVideoPackagingArgs(VALID_ARGS), {
    courseId: "mechanics",
    moduleId: "mechanics-motion-basics",
    sessionId: "mechanics-intro-motion",
    videoAssetId: "mechanics-intro-motion-video",
    inputFile: "lesson.mp4",
    package: false,
  });
  assert.equal(
    parseVideoPackagingArgs([...VALID_ARGS, "--package"]).package,
    true,
  );
});

test("missing values, duplicate flags, unknown flags, and positional input fail", () => {
  for (const args of [
    VALID_ARGS.slice(0, -2),
    [...VALID_ARGS.slice(0, -1), "--package"],
    [...VALID_ARGS, "--course-id", "other"],
    [...VALID_ARGS, "--video-asset-id", "other-video"],
    [...VALID_ARGS, "--input-file", "other.mp4"],
    [...VALID_ARGS, "--package", "--package"],
    [...VALID_ARGS, "--unknown"],
    [...VALID_ARGS, "garbage"],
    [...VALID_ARGS, "--package", "true"],
  ]) {
    assert.throws(() => parseVideoPackagingArgs(args));
  }
});

test("unsafe target IDs and invalid videoAssetId fail", () => {
  for (const [option, value] of [
    ["--course-id", "UPPERCASE"],
    ["--module-id", "nested/path"],
    ["--session-id", "two--hyphens"],
    ["--video-asset-id", " leading"],
    ["--video-asset-id", "video_underscore"],
    ["--video-asset-id", "video/asset"],
    ["--video-asset-id", "x".repeat(129)],
  ]) {
    const args: string[] = [...VALID_ARGS];
    args[args.indexOf(option) + 1] = value;
    assert.throws(() => parseVideoPackagingArgs(args));
  }
});

test("MP4 inspection rejects missing, empty, oversized, and obvious non-MP4 input", async () => {
  await withTempDirectory(async (directory) => {
    const missing = join(directory, "missing.mp4");
    const empty = join(directory, "empty.mp4");
    const oversized = join(directory, "oversized.mp4");
    const invalid = join(directory, "invalid.mp4");
    await writeFile(empty, Buffer.alloc(0));
    await writeFile(oversized, Buffer.from([0]));
    await truncate(oversized, MAX_VIDEO_INPUT_SIZE + 1);
    await writeFile(invalid, Buffer.from("not an mp4 file"));

    await assert.rejects(inspectMp4Input(missing), /could not be inspected/);
    await assert.rejects(inspectMp4Input(empty), /must not be empty/);
    await assert.rejects(inspectMp4Input(oversized), /50 MiB/);
    await assert.rejects(inspectMp4Input(invalid), /supported MP4/);
  });
});

test("dry run validates input without generating key or output files", async () => {
  await withTempDirectory(async (directory) => {
    const inputFile = join(directory, "lesson.mp4");
    const outputRoot = join(directory, "packages");
    await writeFile(inputFile, mp4Fixture());
    let randomCallCount = 0;

    const result = await runVideoPackaging(
      {
        ...parseVideoPackagingArgs(VALID_ARGS),
        inputFile,
      },
      {
        outputRoot,
        randomBytesProvider: (size) => {
          randomCallCount += 1;
          return Buffer.alloc(size);
        },
      },
    );

    assert.equal(result.mode, "dry-run");
    assert.equal(result.contentKeySummary.present, false);
    assert.equal(randomCallCount, 0);
    await assert.rejects(lstat(outputRoot), { code: "ENOENT" });
  });
});

test("explicit package mode writes only encrypted artifact and bound descriptor", async () => {
  await withTempDirectory(async (directory) => {
    const inputFile = join(directory, "lesson.mp4");
    const outputRoot = join(directory, "packages");
    const plaintext = mp4Fixture();
    await writeFile(inputFile, plaintext);

    const result = await runVideoPackaging(
      {
        ...parseVideoPackagingArgs([...VALID_ARGS, "--package"]),
        inputFile,
      },
      { outputRoot },
    );
    const paths = buildVideoOutputPaths(result.videoAssetId, outputRoot);
    const descriptor = JSON.parse(
      await readFile(paths.descriptorPath, "utf8"),
    );
    const artifact = await readFile(paths.artifactPath);

    assert.equal(result.mode, "package");
    assert.equal(result.contentKeySummary.present, true);
    assert.equal(result.contentKeySummary.length, 43);
    assert.equal(result.contentKeySummary.fingerprintPrefix?.length, 12);
    assert.deepEqual(descriptor.sessionPatch, {
      videoAssetId: "mechanics-intro-motion-video",
    });
    assert.equal(
      descriptor.videoAccess.videoAssetId,
      descriptor.sessionPatch.videoAssetId,
    );
    assert.deepEqual(
      decryptVideoArtifact(artifact, descriptor.videoAccess.contentKey),
      plaintext,
    );
    assert.equal(JSON.stringify(result).includes(descriptor.videoAccess.contentKey), false);
  });
});

test("output paths remain inside the trusted root and are Git-ignored", async () => {
  const paths = buildVideoOutputPaths(
    "mechanics-intro-motion-video",
    DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT,
  );
  assert.equal(dirname(paths.artifactPath), paths.outputRoot);
  assert.equal(dirname(paths.descriptorPath), paths.outputRoot);

  const repositoryRoot = dirname(DEFAULT_VIDEO_PACKAGE_OUTPUT_ROOT);
  await execFileAsync(
    "git",
    ["check-ignore", "--quiet", "--no-index", paths.artifactPath],
    { cwd: repositoryRoot },
  );
  await execFileAsync(
    "git",
    ["check-ignore", "--quiet", "--no-index", paths.descriptorPath],
    { cwd: repositoryRoot },
  );
});
