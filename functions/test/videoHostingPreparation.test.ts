import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  encryptVideoBytes,
  VIDEO_ARTIFACT_FORMAT,
} from "../src/videoPackaging/crypto.js";
import {
  DEFAULT_HOSTING_VIDEO_STAGING_ROOT,
  HOSTING_MAX_FILE_BYTES,
  assertWithinStagingRoot,
  parseVideoHostingPreparationArgs,
  runVideoHostingPreparation,
  validateHostingFileSize,
} from "../src/tooling/videoHostingPreparation.js";

const execFileAsync = promisify(execFile);
function mp4Fixture(): Buffer {
  return Buffer.from([
    0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 105, 115,
    111, 109, 109, 112, 52, 50,
  ]);
}

async function fixture(directory: string, videoAssetId = "safe-video") {
  const plaintext = mp4Fixture();
  const encrypted = encryptVideoBytes(plaintext);
  const fileName = `${videoAssetId}.atv1`;
  const artifactPath = join(directory, fileName);
  const descriptorPath = join(directory, `${videoAssetId}.publication.json`);
  const descriptor = {
    formatVersion: VIDEO_ARTIFACT_FORMAT,
    target: {
      courseId: "course-a",
      moduleId: "module-a",
      sessionId: "session-a",
    },
    artifact: {
      fileName,
      sha256: createHash("sha256").update(encrypted.artifact).digest("hex"),
      plaintextSize: plaintext.length,
      encryptedSize: encrypted.artifact.length,
    },
    sessionPatch: { videoAssetId },
    videoAccess: { videoAssetId, contentKey: encrypted.contentKey },
  };
  await writeFile(artifactPath, encrypted.artifact);
  await writeFile(descriptorPath, JSON.stringify(descriptor));
  return { plaintext, encrypted, descriptor, artifactPath, descriptorPath };
}

async function temporary(callback: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "at-hosting-prep-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("arguments default to dry run and require explicit prepare", () => {
  assert.deepEqual(
    parseVideoHostingPreparationArgs([
      "--descriptor-file",
      "x.publication.json",
    ]),
    { descriptorFile: "x.publication.json", prepare: false },
  );
  assert.equal(
    parseVideoHostingPreparationArgs([
      "--descriptor-file",
      "x.publication.json",
      "--prepare",
    ]).prepare,
    true,
  );
  for (const args of [
    [],
    ["--prepare"],
    ["--descriptor-file", "../x.json"],
    ["--descriptor-file", "x.publication.json", "--prepare", "--prepare"],
  ])
    assert.throws(() => parseVideoHostingPreparationArgs(args));
});

test("valid dry run reports exact route and creates nothing", async () =>
  temporary(async (directory) => {
    const item = await fixture(directory);
    const staging = join(directory, "staging");
    const result = await runVideoHostingPreparation(
      { descriptorFile: item.descriptorPath, prepare: false },
      staging,
    );
    assert.equal(result.status, "preparation-required");
    assert.equal(result.hostingRoute, "/protected-media/safe-video.atv1");
    assert.equal(
      result.stagingDestination,
      join(staging, "protected-media", "safe-video.atv1"),
    );
    await assert.rejects(lstat(staging), { code: "ENOENT" });
  }));

test("explicit prepare stages only ciphertext and is idempotent", async () =>
  temporary(async (directory) => {
    const item = await fixture(directory);
    const staging = join(directory, "staging");
    const first = await runVideoHostingPreparation(
      { descriptorFile: item.descriptorPath, prepare: true },
      staging,
    );
    assert.equal(first.status, "prepared");
    const staged = await readFile(first.stagingDestination);
    assert.deepEqual(staged, item.encrypted.artifact);
    assert.deepEqual(await readdir(staging), ["protected-media"]);
    assert.deepEqual(await readdir(join(staging, "protected-media")), [
      "safe-video.atv1",
    ]);
    assert.equal(staged.includes(item.plaintext), false);
    assert.equal(
      staged.includes(Buffer.from(JSON.stringify(item.descriptor))),
      false,
    );
    assert.equal(
      staged.includes(Buffer.from(item.descriptor.videoAccess.contentKey)),
      false,
    );
    assert.equal(
      (
        await runVideoHostingPreparation(
          { descriptorFile: item.descriptorPath, prepare: true },
          staging,
        )
      ).status,
      "already-current",
    );
  }));

test("conflicting destination fails closed", async () =>
  temporary(async (directory) => {
    const item = await fixture(directory);
    const target = join(directory, "staging", "protected-media");
    await mkdir(target, { recursive: true });
    const destination = join(target, "safe-video.atv1");
    await writeFile(destination, "conflict");
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: item.descriptorPath, prepare: true },
        join(directory, "staging"),
      ),
      /conflicts/,
    );
    assert.equal(await readFile(destination, "utf8"), "conflict");
  }));

test("traversal and noncanonical IDs fail closed", async () =>
  temporary(async (directory) => {
    assert.throws(
      () =>
        assertWithinStagingRoot(
          join(directory, "root"),
          join(directory, "outside.atv1"),
        ),
      /unsafe/,
    );
    const item = await fixture(directory);
    item.descriptor.sessionPatch.videoAssetId = "../escape";
    item.descriptor.videoAccess.videoAssetId = "../escape";
    await writeFile(item.descriptorPath, JSON.stringify(item.descriptor));
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: item.descriptorPath, prepare: false },
        join(directory, "staging"),
      ),
    );
  }));

test("symlink inputs and staging directories fail closed", async () =>
  temporary(async (directory) => {
    const item = await fixture(directory);
    const descriptorLink = join(directory, "linked.publication.json");
    try {
      await symlink(item.descriptorPath, descriptorLink, "file");
      await assert.rejects(
        runVideoHostingPreparation(
          { descriptorFile: descriptorLink, prepare: false },
          join(directory, "s1"),
        ),
        /regular file/,
      );
      const realArtifact = join(directory, "real-artifact");
      await writeFile(realArtifact, item.encrypted.artifact);
      await rm(item.artifactPath);
      await symlink(realArtifact, item.artifactPath, "file");
      await assert.rejects(
        runVideoHostingPreparation(
          { descriptorFile: item.descriptorPath, prepare: false },
          join(directory, "s2"),
        ),
        /regular file/,
      );
      await rm(item.artifactPath);
      await writeFile(item.artifactPath, item.encrypted.artifact);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
    const realStaging = join(directory, "real-staging");
    await mkdir(realStaging);
    const stagingLink = join(directory, "staging-link");
    await symlink(realStaging, stagingLink, "junction");
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: item.descriptorPath, prepare: false },
        stagingLink,
      ),
      /real directory/,
    );
  }));

test("malformed descriptor, wrong hash, tampered ATV1, wrong key, and size mismatch fail", async () =>
  temporary(async (directory) => {
    const malformed = await fixture(directory, "malformed-video");
    await writeFile(malformed.descriptorPath, "{");
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: malformed.descriptorPath, prepare: false },
        join(directory, "s1"),
      ),
      /malformed JSON/,
    );
    const wrongHash = await fixture(directory, "wrong-hash-video");
    wrongHash.descriptor.artifact.sha256 = "0".repeat(64);
    await writeFile(
      wrongHash.descriptorPath,
      JSON.stringify(wrongHash.descriptor),
    );
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: wrongHash.descriptorPath, prepare: false },
        join(directory, "s2"),
      ),
      /integrity/,
    );
    const tampered = await fixture(directory, "tampered-video");
    tampered.encrypted.artifact[20] ^= 1;
    tampered.descriptor.artifact.sha256 = createHash("sha256")
      .update(tampered.encrypted.artifact)
      .digest("hex");
    await writeFile(tampered.artifactPath, tampered.encrypted.artifact);
    await writeFile(
      tampered.descriptorPath,
      JSON.stringify(tampered.descriptor),
    );
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: tampered.descriptorPath, prepare: false },
        join(directory, "s3"),
      ),
      /authentication/,
    );
    const wrongKey = await fixture(directory, "wrong-key-video");
    wrongKey.descriptor.videoAccess.contentKey =
      encryptVideoBytes(mp4Fixture()).contentKey;
    await writeFile(
      wrongKey.descriptorPath,
      JSON.stringify(wrongKey.descriptor),
    );
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: wrongKey.descriptorPath, prepare: false },
        join(directory, "s4"),
      ),
      /authentication/,
    );
    const mismatch = await fixture(directory, "mismatch-video");
    mismatch.descriptor.artifact.plaintextSize += 1;
    mismatch.descriptor.artifact.encryptedSize += 1;
    await writeFile(
      mismatch.descriptorPath,
      JSON.stringify(mismatch.descriptor),
    );
    await assert.rejects(
      runVideoHostingPreparation(
        { descriptorFile: mismatch.descriptorPath, prepare: false },
        join(directory, "s5"),
      ),
      /integrity|size/,
    );
  }));

test("quota helper enforces 2 GiB and default staging is ignored", async () => {
  validateHostingFileSize(HOSTING_MAX_FILE_BYTES);
  assert.throws(
    () => validateHostingFileSize(HOSTING_MAX_FILE_BYTES + 1),
    /2 GiB/,
  );
  const repositoryRoot = dirname(DEFAULT_HOSTING_VIDEO_STAGING_ROOT);
  await execFileAsync(
    "git",
    [
      "check-ignore",
      "--quiet",
      "--no-index",
      DEFAULT_HOSTING_VIDEO_STAGING_ROOT,
    ],
    { cwd: repositoryRoot },
  );
});
