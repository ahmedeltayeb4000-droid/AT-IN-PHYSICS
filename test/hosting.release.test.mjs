import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assembleHostingRelease,
  auditHostingRelease,
} from "../scripts/hosting/releaseAssembly.mjs";

async function temporary(callback) {
  const root = await mkdtemp(join(tmpdir(), "at-release-test-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function frontendFixture(root) {
  const dist = join(root, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(
    join(dist, "index.html"),
    "<!doctype html><title>fixture</title>",
  );
  await writeFile(join(dist, "assets", "app.js"), "console.log('fixture')");
  await writeFile(join(dist, "assets", "app.js.map"), "sourcemap");
  return dist;
}

test("release assembly copies frontend files, excludes source maps, and is idempotent", async () =>
  temporary(async (root) => {
    const distRoot = await frontendFixture(root);
    const stagingRoot = join(root, "staging");
    const releaseRoot = join(root, "release");
    const first = await assembleHostingRelease({
      distRoot,
      stagingRoot,
      releaseRoot,
    });
    assert.deepEqual(first.files, ["assets/app.js", "index.html"]);
    assert.equal(
      await readFile(join(releaseRoot, "index.html"), "utf8"),
      "<!doctype html><title>fixture</title>",
    );
    const second = await assembleHostingRelease({
      distRoot,
      stagingRoot,
      releaseRoot,
    });
    assert.deepEqual(second.files, first.files);
  }));

test("only canonical ATV1 ciphertext enters protected-media", async () =>
  temporary(async (root) => {
    const distRoot = await frontendFixture(root);
    const stagingRoot = join(root, "staging");
    const media = join(stagingRoot, "protected-media");
    const releaseRoot = join(root, "release");
    await mkdir(media, { recursive: true });
    const artifact = Buffer.concat([Buffer.from("ATV1"), Buffer.alloc(40, 7)]);
    await writeFile(join(media, "lesson-video.atv1"), artifact);
    const result = await assembleHostingRelease({
      distRoot,
      stagingRoot,
      releaseRoot,
    });
    assert.equal(result.mediaCount, 1);
    assert.deepEqual(
      await readFile(join(releaseRoot, "protected-media", "lesson-video.atv1")),
      artifact,
    );
    assert.deepEqual(await auditHostingRelease(releaseRoot), [
      "assets/app.js",
      "index.html",
      "protected-media/lesson-video.atv1",
    ]);
  }));

test("descriptor, MP4, malformed ATV1, and credential material fail closed", async () =>
  temporary(async (root) => {
    const distRoot = await frontendFixture(root);
    const stagingRoot = join(root, "staging");
    const media = join(stagingRoot, "protected-media");
    const releaseRoot = join(root, "release");
    await mkdir(media, { recursive: true });
    await writeFile(join(media, "lesson.publication.json"), "{}");
    await assert.rejects(
      assembleHostingRelease({ distRoot, stagingRoot, releaseRoot }),
      /Unexpected protected-media/,
    );
    await rm(join(media, "lesson.publication.json"));
    await writeFile(join(media, "lesson.mp4"), "plaintext");
    await assert.rejects(
      assembleHostingRelease({ distRoot, stagingRoot, releaseRoot }),
      /Unexpected protected-media/,
    );
    await rm(join(media, "lesson.mp4"));
    await writeFile(join(media, "lesson.atv1"), "not ciphertext");
    await assert.rejects(
      assembleHostingRelease({ distRoot, stagingRoot, releaseRoot }),
      /not an ATV1/,
    );
    await rm(join(media, "lesson.atv1"));
    await writeFile(
      join(distRoot, "credential.json"),
      '{"private_key":"secret","client_email":"x"}',
    );
    await assert.rejects(
      assembleHostingRelease({ distRoot, stagingRoot, releaseRoot }),
      /Credential material/,
    );
  }));

test("unexpected frontend types and symlinked source directories fail closed", async () =>
  temporary(async (root) => {
    const distRoot = await frontendFixture(root);
    const releaseRoot = join(root, "release");
    await writeFile(join(distRoot, "server.ts"), "source");
    await assert.rejects(
      assembleHostingRelease({ distRoot, releaseRoot }),
      /Unexpected frontend artifact/,
    );
    await rm(join(distRoot, "server.ts"));
    const real = join(root, "real-assets");
    await mkdir(real);
    const link = join(distRoot, "linked");
    try {
      await symlink(real, link, "junction");
    } catch (error) {
      if (error.code === "EPERM") return;
      else throw error;
    }
    await assert.rejects(
      assembleHostingRelease({ distRoot, releaseRoot }),
      /Symlink is forbidden/,
    );
  }));
