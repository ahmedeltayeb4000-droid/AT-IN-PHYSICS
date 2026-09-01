import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import { TextEncoder } from "node:util";
import {
  encryptAtv2Object,
  decryptAtv2Object,
} from "../functions/lib/src/videoPackaging/atv2Crypto.js";
import {
  buildAtv2Aad,
  buildAtv2Nonce,
  encodeAtv2ContentKey,
  magicForAtv2Object,
} from "../functions/lib/src/videoPackaging/atv2Format.js";
import { decryptAtv2ObjectWithWebCrypto } from "../src/features/video/atv2.ts";

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PREFIX = Uint8Array.of(0xaa, 0xbb, 0xcc, 0xdd);
const KEY_TEXT = encodeAtv2ContentKey(KEY);
const ASSET = "browser-parity-video";

function identity(type, counter, plaintextSize) {
  return {
    assetId: ASSET,
    type,
    counter,
    plaintextSize,
    startTicks: type === "media" ? (counter - 2) * 6000 : 0,
    durationTicks: type === "media" ? 6000 : 0,
  };
}

test("Node ATV2 objects decrypt through browser WebCrypto for every type", async () => {
  for (const [type, counter] of [
    ["manifest", 0],
    ["initialization", 1],
    ["media", 2],
    ["media", 19],
  ]) {
    const plaintext = Uint8Array.of(0, 1, 2, counter, 255);
    const contract = identity(type, counter, plaintext.length);
    const encrypted = encryptAtv2Object(plaintext, contract, {
      contentKey: KEY,
      noncePrefix: PREFIX,
    });
    assert.deepEqual(
      new Uint8Array(
        await decryptAtv2ObjectWithWebCrypto(
          encrypted.artifact.buffer.slice(
            encrypted.artifact.byteOffset,
            encrypted.artifact.byteOffset + encrypted.artifact.byteLength,
          ),
          KEY_TEXT,
          PREFIX,
          contract,
          webcrypto.subtle,
        ),
      ),
      plaintext,
    );
  }
});

test("browser-compatible encryption decrypts through Node with identical nonce, AAD, and tag layout", async () => {
  const plaintext = Uint8Array.of(4, 3, 2, 1);
  const contract = identity("media", 7, plaintext.length);
  const key = await webcrypto.subtle.importKey("raw", KEY, "AES-GCM", false, [
    "encrypt",
  ]);
  const payload = new Uint8Array(
    await webcrypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: buildAtv2Nonce(PREFIX, contract.counter),
        additionalData: buildAtv2Aad(contract),
        tagLength: 128,
      },
      key,
      plaintext,
    ),
  );
  const magic = new TextEncoder().encode(magicForAtv2Object(contract.type));
  const artifact = new Uint8Array(magic.length + payload.length);
  artifact.set(magic);
  artifact.set(payload, magic.length);
  assert.deepEqual(
    decryptAtv2Object(artifact, KEY_TEXT, PREFIX, contract),
    Buffer.from(plaintext),
  );
});

test("fixed independent AES-256-GCM vector decrypts and encrypts identically in WebCrypto", async () => {
  // Frozen known-answer vector generated once outside production code using
  // WebCrypto with manually supplied IV and full AAD bytes.
  const fromHex = (value) =>
    Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
  const keyBytes = fromHex(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  );
  const iv = fromHex("a1b2c3d40000010203040506");
  const aad = fromHex(
    "415456322d4141440202000c766563746f722d6173736574" +
      "0000010203040506" +
      "0000000000000010" +
      "0000000102030405" +
      "0000000000001770",
  );
  const plaintext = fromHex("00112233445566778899aabbccddeeff");
  const expectedPayload = fromHex(
    "b7d3bed0d8d8188473c28d14e0212948" + "427a50bb9e8337f24500639bc77001e1",
  );
  const artifact = new Uint8Array(5 + expectedPayload.length);
  artifact.set(new TextEncoder().encode("ATV2S"));
  artifact.set(expectedPayload, 5);
  const contract = {
    assetId: "vector-asset",
    type: "media",
    counter: 0x010203040506,
    plaintextSize: 16,
    startTicks: 0x0102030405,
    durationTicks: 0x1770,
  };
  assert.deepEqual(
    new Uint8Array(
      await decryptAtv2ObjectWithWebCrypto(
        artifact.buffer,
        Buffer.from(keyBytes).toString("base64url"),
        iv.subarray(0, 4),
        contract,
        webcrypto.subtle,
      ),
    ),
    plaintext,
  );
  const key = await webcrypto.subtle.importKey(
    "raw",
    keyBytes,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  assert.deepEqual(
    new Uint8Array(
      await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
        key,
        plaintext,
      ),
    ),
    expectedPayload,
  );
});

test("WebCrypto path fails closed for tampering and identity substitution", async () => {
  const plaintext = Uint8Array.of(1, 3, 3, 7);
  const contract = identity("media", 2, plaintext.length);
  const encrypted = encryptAtv2Object(plaintext, contract, {
    contentKey: KEY,
    noncePrefix: PREFIX,
  });
  const artifact = encrypted.artifact.buffer.slice(
    encrypted.artifact.byteOffset,
    encrypted.artifact.byteOffset + encrypted.artifact.byteLength,
  );
  for (const changed of [
    { ...contract, assetId: "other-video" },
    { ...contract, counter: 3, startTicks: 6000 },
    { ...contract, durationTicks: 5999 },
  ]) {
    await assert.rejects(
      decryptAtv2ObjectWithWebCrypto(
        artifact,
        KEY_TEXT,
        PREFIX,
        changed,
        webcrypto.subtle,
      ),
      /unavailable/,
    );
  }
  const tampered = artifact.slice(0);
  new Uint8Array(tampered)[6] ^= 1;
  await assert.rejects(
    decryptAtv2ObjectWithWebCrypto(
      tampered,
      KEY_TEXT,
      PREFIX,
      contract,
      webcrypto.subtle,
    ),
    /unavailable/,
  );
});
