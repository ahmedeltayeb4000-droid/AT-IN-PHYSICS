import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ORIGIN = "http://127.0.0.1:5000";
const index = await readFile(
  new URL("../hosting-release/index.html", import.meta.url),
  "utf8",
);

test("Hosting serves the application index and SPA routes", async () => {
  for (const path of [
    "/",
    "/dashboard",
    "/courses/mechanics",
    "/courses/mechanics/modules/module-a/sessions/session-a",
  ]) {
    const response = await fetch(`${ORIGIN}${path}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), index);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      response.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
    );
  }
});

test("Hosting serves ATV1 as binary with conservative caching", async () => {
  const response = await fetch(
    `${ORIGIN}/protected-media/emulator-fixture.atv1`,
  );
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/octet-stream",
  );
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=3600, must-revalidate, no-transform",
  );
  assert.equal(response.headers.get("content-disposition"), null);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "ATV1");
});

test("missing media, descriptors, and MP4 files return 404 instead of the SPA", async () => {
  for (const path of [
    "/protected-media/missing.atv1",
    "/protected-media/emulator-fixture.publication.json",
    "/protected-media/plaintext.mp4",
  ]) {
    const response = await fetch(`${ORIGIN}${path}`);
    assert.equal(response.status, 404);
    assert.notEqual(await response.text(), index);
  }
});
