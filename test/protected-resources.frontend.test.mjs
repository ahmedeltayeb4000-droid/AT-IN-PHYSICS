import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { TextEncoder } from "node:util";
import {
  PROTECTED_RESOURCE_FORMAT,
  PROTECTED_RESOURCE_OVERHEAD,
} from "../functions/src/protectedResources/format.ts";
import {
  decryptAtr1Artifact,
  parseAtr1Artifact,
} from "../src/features/resources/atr1.ts";

const PDF = Buffer.from("%PDF-1.7\ncross-compatible fixture");
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const IV = Uint8Array.from({ length: 12 }, (_, index) => index + 33);
const KEY_TEXT = Buffer.from(KEY).toString("base64url");
const COMPATIBILITY_ARTIFACT_HEX =
  "415452312122232425262728292a2b2cb4cd7a1a79e90071e7a3e8c9bcd7bf6b607ff6b1128dffd3419f03303778e454df24bc4b72d65e121e13ff0507d4f72117";

async function artifactFixture() {
  const key = await webcrypto.subtle.importKey("raw", KEY, "AES-GCM", false, [
    "encrypt",
  ]);
  const magic = new TextEncoder().encode(PROTECTED_RESOURCE_FORMAT);
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: IV, additionalData: magic, tagLength: 128 },
    key,
    PDF,
  );
  const artifact = new Uint8Array(magic.length + IV.length + encrypted.byteLength);
  artifact.set(magic);
  artifact.set(IV, magic.length);
  artifact.set(new Uint8Array(encrypted), magic.length + IV.length);
  return artifact.buffer;
}

test("browser ATR1 wrapper consumes the shared format contract", async () => {
  const artifact = await artifactFixture();
  assert.equal(Buffer.from(artifact).toString("hex"), COMPATIBILITY_ARTIFACT_HEX);
  assert.equal(Buffer.from(artifact).subarray(0, 4).toString("ascii"), PROTECTED_RESOURCE_FORMAT);
  assert.equal(artifact.byteLength, PDF.length + PROTECTED_RESOURCE_OVERHEAD);
  assert.deepEqual(parseAtr1Artifact(artifact).iv, IV);
  assert.deepEqual(
    Buffer.from(
      await decryptAtr1Artifact(
        artifact,
        KEY_TEXT,
        webcrypto.subtle,
      ),
    ),
    PDF,
  );
});

test("browser ATR1 wrapper rejects wrong magic, tampering, truncation, and malformed keys", async () => {
  const artifact = await artifactFixture();
  for (const offset of [0, 16, artifact.byteLength - 1]) {
    const changed = Buffer.from(artifact);
    changed[offset] ^= 1;
    await assert.rejects(decryptAtr1Artifact(Uint8Array.from(changed).buffer, KEY_TEXT, webcrypto.subtle));
  }
  await assert.rejects(
    decryptAtr1Artifact(
      artifact,
      Buffer.alloc(32, 9).toString("base64url"),
      webcrypto.subtle,
    ),
  );
  assert.throws(() => parseAtr1Artifact(artifact.slice(0, 31)));
  assert.throws(() =>
    parseAtr1Artifact(new Uint8Array(20 * 1024 * 1024 + 33).buffer),
  );
  await assert.rejects(decryptAtr1Artifact(artifact, "bad", webcrypto.subtle));
});
