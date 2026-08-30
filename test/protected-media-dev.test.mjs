import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { createProtectedMediaDevMiddleware } from "../scripts/dev/protectedMediaDevPlugin.ts";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "at-physics-media-"));
  roots.push(root);
  const media = join(root, "hosting-release", "protected-media");
  await mkdir(media, { recursive: true });
  const bytes = Buffer.concat([Buffer.from("ATV1"), Buffer.alloc(32, 7)]);
  await writeFile(join(media, "lesson-video.atv1"), bytes);
  await writeFile(join(media, "plaintext.mp4"), Buffer.from("plaintext"));
  return { root, media, bytes };
}

async function withServer(media, run) {
  const middleware = createProtectedMediaDevMiddleware(media);
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.statusCode = 418;
      response.end("next");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  }
}

async function rawRequestStatus(origin, path) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        method: "GET",
        path,
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end();
  });
}

test("canonical local ATV1 is served with exact development headers", async () => {
  const { media, bytes } = await fixture();
  await withServer(media, async (origin) => {
    const response = await fetch(`${origin}/protected-media/lesson-video.atv1`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-length"), String(bytes.length));
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  });
});

test("missing, malformed, traversal, encoded traversal, and plaintext paths are denied", async () => {
  const { media } = await fixture();
  await withServer(media, async (origin) => {
    for (const path of [
      "/protected-media/missing.atv1",
      "/protected-media/Uppercase.atv1",
      "/protected-media/%2e%2e%2flesson-video.atv1",
      "/protected-media/%252e%252e%252flesson-video.atv1",
      "/protected-media/plaintext.mp4",
    ]) {
      const response = await fetch(`${origin}${path}`, { redirect: "manual" });
      assert.equal(response.status, 404, path);
    }
    assert.equal(
      await rawRequestStatus(origin, "/protected-media/../lesson-video.atv1"),
      404,
    );
  });
});

test("unrelated non-ATV1 routes are not handled", async () => {
  const { media } = await fixture();
  await withServer(media, async (origin) => {
    assert.equal((await fetch(`${origin}/app.js`)).status, 418);
  });
});

test("symlinked ATV1 files cannot escape the trusted release directory", async (context) => {
  const { root, media } = await fixture();
  const outside = join(root, "outside.atv1");
  await writeFile(outside, Buffer.concat([Buffer.from("ATV1"), Buffer.alloc(32)]));
  try {
    await symlink(outside, join(media, "linked-video.atv1"), "file");
  } catch (error) {
    if (error?.code === "EPERM") return context.skip("File symlinks require Windows Developer Mode.");
    throw error;
  }
  await withServer(media, async (origin) => {
    assert.equal((await fetch(`${origin}/protected-media/linked-video.atv1`)).status, 404);
  });
});
