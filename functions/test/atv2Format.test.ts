import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptAtv2Object,
  encryptAtv2Object,
} from "../src/videoPackaging/atv2Crypto.js";
import {
  ATV2_MAX_INITIALIZATION_PLAINTEXT_BYTES,
  ATV2_MAX_MANIFEST_CIPHERTEXT_BYTES,
  ATV2_MAX_MEDIA_SEGMENT_PLAINTEXT_BYTES,
  ATV2_TAG_BYTES,
  buildAtv2Aad,
  buildAtv2Nonce,
  decodeAtv2ContentKey,
  encodeAtv2ContentKey,
  parseCanonicalAtv2Manifest,
  serializeAtv2Manifest,
  validateAtv2Manifest,
  type Atv2Manifest,
  type Atv2ObjectIdentity,
} from "../src/videoPackaging/atv2Format.js";

const KEY = Uint8Array.from({ length: 32 }, (_, index) => index);
const PREFIX = Uint8Array.of(0x10, 0x20, 0x30, 0x40);
const HASH = Buffer.alloc(32, 7).toString("base64url");
const ASSET = "mechanics-long-lecture-v1";

function identity(
  type: Atv2ObjectIdentity["type"],
  counter: number,
  plaintextSize = 4,
): Atv2ObjectIdentity {
  return {
    assetId: ASSET,
    type,
    counter,
    plaintextSize,
    startTicks: type === "media" ? (counter - 2) * 6000 : 0,
    durationTicks: type === "media" ? 6000 : 0,
  };
}

function manifest(): Atv2Manifest {
  return {
    formatVersion: "ATV2",
    assetId: ASSET,
    media: {
      container: "video/mp4",
      codecs: "avc1.4d401f,mp4a.40.2",
      timescale: 1000,
      durationTicks: 12000,
    },
    noncePrefix: Buffer.from(PREFIX).toString("base64url"),
    initialization: {
      path: "init.atv2i",
      counter: 1,
      plaintextSize: 100,
      encryptedSize: 121,
      ciphertextSha256: HASH,
    },
    segments: [0, 1].map((index) => ({
      index,
      path: `segments/${index.toString().padStart(6, "0")}.atv2s`,
      counter: index + 2,
      startTicks: index * 6000,
      durationTicks: 6000,
      plaintextSize: 400,
      encryptedSize: 421,
      ciphertextSha256: HASH,
    })),
  };
}

test("nonce is exact, deterministic, big-endian, and counter-separated", () => {
  assert.deepEqual(
    buildAtv2Nonce(PREFIX, 0),
    Uint8Array.of(0x10, 0x20, 0x30, 0x40, 0, 0, 0, 0, 0, 0, 0, 0),
  );
  assert.deepEqual(
    buildAtv2Nonce(PREFIX, 1),
    Uint8Array.of(0x10, 0x20, 0x30, 0x40, 0, 0, 0, 0, 0, 0, 0, 1),
  );
  assert.notDeepEqual(buildAtv2Nonce(PREFIX, 1), buildAtv2Nonce(PREFIX, 2));
  const maximum = buildAtv2Nonce(PREFIX, Number.MAX_SAFE_INTEGER);
  assert.equal(maximum.byteLength, 12);
  assert.throws(() => buildAtv2Nonce(PREFIX, -1));
  assert.throws(() => buildAtv2Nonce(PREFIX, Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => buildAtv2Nonce(Uint8Array.of(1, 2, 3), 0));
  assert.throws(() => buildAtv2Nonce(PREFIX, -0));
});

test("nonce fixed vectors cover multibyte and maximum supported counters", () => {
  // Independently specified wire vectors; expected bytes are not produced by
  // another encoder. Counter bytes occupy the final eight big-endian bytes.
  assert.equal(
    Buffer.from(
      buildAtv2Nonce(Uint8Array.of(0xa1, 0xb2, 0xc3, 0xd4), 0x010203040506),
    ).toString("hex"),
    "a1b2c3d40000010203040506",
  );
  assert.equal(
    Buffer.from(
      buildAtv2Nonce(
        Uint8Array.of(0x10, 0x20, 0x30, 0x40),
        Number.MAX_SAFE_INTEGER,
      ),
    ).toString("hex"),
    "10203040001fffffffffffff",
  );
});

test("AAD has the exact canonical byte layout and validates type contracts", () => {
  const aad = buildAtv2Aad(identity("media", 2));
  assert.equal(Buffer.from(aad.subarray(0, 8)).toString("ascii"), "ATV2-AAD");
  assert.equal(aad[8], 2);
  assert.equal(aad[9], 2);
  assert.equal(new DataView(aad.buffer).getUint16(10, false), ASSET.length);
  assert.equal(
    Buffer.from(aad.subarray(12, 12 + ASSET.length)).toString(),
    ASSET,
  );
  assert.throws(() => buildAtv2Aad(identity("manifest", 1)));
  assert.throws(() =>
    buildAtv2Aad({ ...identity("initialization", 1), startTicks: 1 }),
  );
  assert.throws(() =>
    buildAtv2Aad({ ...identity("media", 2), durationTicks: 0 }),
  );
  assert.throws(() =>
    buildAtv2Aad({ ...identity("media", 2), assetId: "../bad" }),
  );
});

test("AAD fixed vector covers every byte with independent expected hex", () => {
  const aad = buildAtv2Aad({
    assetId: "vector-asset",
    type: "media",
    counter: 0x010203040506,
    plaintextSize: 0x10,
    startTicks: 0x0102030405,
    durationTicks: 0x1770,
  });
  assert.equal(
    Buffer.from(aad).toString("hex"),
    // ATV2-AAD | v2 | media | 12-byte asset | four uint64 BE fields.
    "415456322d4141440202000c766563746f722d6173736574" +
      "0000010203040506" +
      "0000000000000010" +
      "0000000102030405" +
      "0000000000001770",
  );
});

test("all unsigned object identity fields reject negative zero", () => {
  const base = identity("media", 2);
  for (const changed of [
    { ...identity("manifest", 0), counter: -0 },
    { ...base, plaintextSize: -0 },
    { ...base, startTicks: -0 },
    { ...base, durationTicks: -0 },
  ])
    assert.throws(() => buildAtv2Aad(changed));
});

test("content keys are canonical Base64url", () => {
  const encoded = encodeAtv2ContentKey(KEY);
  assert.equal(encoded.length, 43);
  assert.deepEqual(decodeAtv2ContentKey(encoded), KEY);
  for (const invalid of [
    encoded + "=",
    encoded.slice(0, -1),
    `${encoded.slice(0, -1)}B`,
    "!",
  ])
    assert.throws(() => decodeAtv2ContentKey(invalid));
});

test("all ATV2 object types round-trip and use their exact wire headers", () => {
  for (const [type, counter, magic] of [
    ["manifest", 0, "ATV2M"],
    ["initialization", 1, "ATV2I"],
    ["media", 2, "ATV2S"],
  ] as const) {
    const plaintext = Uint8Array.of(1, 2, 3, counter);
    const objectIdentity = identity(type, counter, plaintext.length);
    const encrypted = encryptAtv2Object(plaintext, objectIdentity, {
      contentKey: KEY,
      noncePrefix: PREFIX,
    });
    assert.equal(encrypted.artifact.subarray(0, 5).toString("ascii"), magic);
    assert.deepEqual(
      decryptAtv2Object(
        encrypted.artifact,
        encrypted.contentKey,
        PREFIX,
        objectIdentity,
      ),
      Buffer.from(plaintext),
    );
  }
});

test("fixed independent AES-256-GCM vector matches and decrypts in Node", () => {
  // Generated once outside production code with Node WebCrypto from the
  // hard-coded key/IV/AAD/plaintext, then frozen here as a known-answer vector.
  const key = Buffer.from(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "hex",
  );
  const prefix = Buffer.from("a1b2c3d4", "hex");
  const plaintext = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const contract: Atv2ObjectIdentity = {
    assetId: "vector-asset",
    type: "media",
    counter: 0x010203040506,
    plaintextSize: 16,
    startTicks: 0x0102030405,
    durationTicks: 0x1770,
  };
  const expectedBody = Buffer.from(
    "b7d3bed0d8d8188473c28d14e0212948" + "427a50bb9e8337f24500639bc77001e1",
    "hex",
  );
  const expectedArtifact = Buffer.concat([Buffer.from("ATV2S"), expectedBody]);
  assert.deepEqual(
    encryptAtv2Object(plaintext, contract, {
      contentKey: key,
      noncePrefix: prefix,
    }).artifact,
    expectedArtifact,
  );
  assert.deepEqual(
    decryptAtv2Object(
      expectedArtifact,
      encodeAtv2ContentKey(key),
      prefix,
      contract,
    ),
    plaintext,
  );
});

test("authentication rejects wrong key, bytes, magic, identity, timing, and substitution", () => {
  const plaintext = Uint8Array.of(9, 8, 7, 6);
  const original = identity("media", 3, plaintext.length);
  const encrypted = encryptAtv2Object(plaintext, original, {
    contentKey: KEY,
    noncePrefix: PREFIX,
  });
  assert.throws(() =>
    decryptAtv2Object(
      encrypted.artifact,
      encodeAtv2ContentKey(Buffer.alloc(32, 9)),
      PREFIX,
      original,
    ),
  );
  for (const offset of [0, 6, encrypted.artifact.length - 1]) {
    const modified = Buffer.from(encrypted.artifact);
    modified[offset] ^= 1;
    assert.throws(() =>
      decryptAtv2Object(modified, encrypted.contentKey, PREFIX, original),
    );
  }
  for (const changed of [
    { ...original, assetId: "other-asset" },
    {
      ...original,
      type: "initialization" as const,
      counter: 1,
      startTicks: 0,
      durationTicks: 0,
    },
    { ...original, counter: 2, startTicks: 0 },
    { ...original, plaintextSize: 5 },
    { ...original, startTicks: original.startTicks + 1 },
    { ...original, durationTicks: original.durationTicks + 1 },
  ])
    assert.throws(() =>
      decryptAtv2Object(
        encrypted.artifact,
        encrypted.contentKey,
        PREFIX,
        changed,
      ),
    );
});

test("object type, counter, and timing authentication failures are isolated", () => {
  const plaintext = Uint8Array.of(4, 5, 6, 7);
  const original = identity("media", 2, plaintext.length);
  const encrypted = encryptAtv2Object(plaintext, original, {
    contentKey: KEY,
    noncePrefix: PREFIX,
  });
  const contentKey = encrypted.contentKey;

  const asInitialization = Buffer.from(encrypted.artifact);
  asInitialization.set(Buffer.from("ATV2I"), 0);
  assert.throws(
    () =>
      decryptAtv2Object(
        asInitialization,
        contentKey,
        PREFIX,
        identity("initialization", 1, plaintext.length),
      ),
    /authentication/,
  );
  assert.throws(
    () =>
      decryptAtv2Object(encrypted.artifact, contentKey, PREFIX, {
        ...original,
        counter: 3,
      }),
    /authentication/,
  );
  assert.throws(
    () =>
      decryptAtv2Object(encrypted.artifact, contentKey, PREFIX, {
        ...original,
        startTicks: 1,
      }),
    /authentication/,
  );
  assert.throws(
    () =>
      decryptAtv2Object(encrypted.artifact, contentKey, PREFIX, {
        ...original,
        durationTicks: 6001,
      }),
    /authentication/,
  );
});

test("manifest prefix mutation reaches authentication and truncation is structural", () => {
  const plaintext = Uint8Array.of(1, 2, 3, 4);
  const contract = identity("manifest", 0, plaintext.length);
  const encrypted = encryptAtv2Object(plaintext, contract, {
    contentKey: KEY,
    noncePrefix: PREFIX,
  });
  const mutated = Buffer.from(encrypted.artifact);
  mutated[5] ^= 1;
  const mutatedPrefix = mutated.subarray(5, 9);
  assert.throws(
    () =>
      decryptAtv2Object(mutated, encrypted.contentKey, mutatedPrefix, contract),
    /authentication/,
  );
  assert.throws(
    () =>
      decryptAtv2Object(
        encrypted.artifact.subarray(0, 8),
        encrypted.contentKey,
        PREFIX,
        contract,
      ),
    /invalid/,
  );
});

test("size limits accept exact maxima, reject plus one, and crypto enforces bounded payloads", () => {
  const cases = [
    ["manifest", 0, ATV2_MAX_MANIFEST_CIPHERTEXT_BYTES - ATV2_TAG_BYTES],
    ["initialization", 1, ATV2_MAX_INITIALIZATION_PLAINTEXT_BYTES],
    ["media", 2, ATV2_MAX_MEDIA_SEGMENT_PLAINTEXT_BYTES],
  ] as const;
  for (const [type, counter, maximum] of cases) {
    const contract = identity(type, counter, maximum);
    assert.doesNotThrow(() => buildAtv2Aad(contract));
    assert.throws(() =>
      buildAtv2Aad({ ...contract, plaintextSize: maximum + 1 }),
    );
  }
  const small = identity("media", 2, 4);
  const encrypted = encryptAtv2Object(Uint8Array.of(1, 2, 3, 4), small, {
    contentKey: KEY,
    noncePrefix: PREFIX,
  });
  assert.throws(() =>
    decryptAtv2Object(encrypted.artifact, encrypted.contentKey, PREFIX, {
      ...small,
      plaintextSize: 5,
    }),
  );
});

test("manifest validation and canonical serialization are strict", () => {
  const value = manifest();
  const serialized = serializeAtv2Manifest(value);
  assert.deepEqual(parseCanonicalAtv2Manifest(serialized), value);
  assert.throws(() => parseCanonicalAtv2Manifest(` ${serialized}`));
  assert.throws(() =>
    parseCanonicalAtv2Manifest(
      serialized.replace(
        '{"formatVersion":"ATV2",',
        '{"formatVersion":"ATV2","formatVersion":"ATV2",',
      ),
    ),
  );
  const mutations: unknown[] = [
    { ...value, unknown: true },
    {
      formatVersion: value.formatVersion,
      assetId: value.assetId,
      media: value.media,
      noncePrefix: value.noncePrefix,
      initialization: value.initialization,
    },
    { ...value, formatVersion: "ATV3" },
    { ...value, media: { ...value.media, timescale: 0 } },
    { ...value, media: { ...value.media, timescale: -0 } },
    { ...value, noncePrefix: "AAAA" },
    {
      ...value,
      initialization: {
        ...value.initialization,
        plaintextSize: ATV2_MAX_INITIALIZATION_PLAINTEXT_BYTES + 1,
      },
    },
    {
      ...value,
      segments: value.segments.map((segment, index) =>
        index ? { ...segment, index: 2 } : segment,
      ),
    },
    {
      ...value,
      segments: value.segments.map((segment, index) =>
        index ? segment : { ...segment, index: -0 },
      ),
    },
    {
      ...value,
      segments: value.segments.map((segment, index) =>
        index ? segment : { ...segment, startTicks: -0 },
      ),
    },
    {
      ...value,
      segments: value.segments.map((segment, index) =>
        index ? { ...segment, path: "../escape.atv2s" } : segment,
      ),
    },
    {
      ...value,
      segments: value.segments.map((segment, index) =>
        index
          ? { ...segment, encryptedSize: segment.encryptedSize + 1 }
          : segment,
      ),
    },
    {
      ...value,
      segments: value.segments.map((segment, index) =>
        index ? { ...segment, startTicks: 5999 } : segment,
      ),
    },
    {
      ...value,
      segments: value.segments.map((segment) => ({
        ...segment,
        plaintextSize: ATV2_MAX_MEDIA_SEGMENT_PLAINTEXT_BYTES + 1,
      })),
    },
    {
      ...value,
      media: { ...value.media, durationTicks: Number.MAX_SAFE_INTEGER },
      segments: value.segments.map((segment, index) =>
        index
          ? {
              ...segment,
              startTicks: Number.MAX_SAFE_INTEGER - 1,
              durationTicks: 2,
            }
          : segment,
      ),
    },
  ];
  for (const mutation of mutations)
    assert.throws(() => validateAtv2Manifest(mutation));
});
