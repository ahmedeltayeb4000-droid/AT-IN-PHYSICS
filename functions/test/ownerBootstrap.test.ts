import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapOwner,
  parseOwnerBootstrapArgs,
  proposedOwnerClaims,
  type AuthUser,
  type CustomClaims,
} from "../src/tooling/ownerBootstrap.js";

const user: AuthUser = {
  uid: "owner-uid",
  email: "owner@example.com",
  emailVerified: true,
  disabled: false,
  customClaims: { someExistingClaim: true },
};

test("missing UID is rejected", () => {
  assert.throws(() => parseOwnerBootstrapArgs([]), /non-empty/);
});

test("whitespace-only UID is rejected", () => {
  assert.throws(() => parseOwnerBootstrapArgs(["--uid", "   "]), /non-empty/);
});

test("an option token is rejected as a missing UID value", () => {
  assert.throws(
    () => parseOwnerBootstrapArgs(["--uid", "--apply"]),
    /requires a UID value/,
  );
});

test("proposed claims preserve unrelated claims and set owner true", () => {
  assert.deepEqual(proposedOwnerClaims({ someExistingClaim: true }), {
    someExistingClaim: true,
    owner: true,
  });
});

test("dry-run is the default and does not mutate claims", async () => {
  const options = parseOwnerBootstrapArgs(["--uid", user.uid]);
  let mutationCount = 0;

  await bootstrapOwner(
    {
      getUser: async () => user,
      setCustomUserClaims: async () => {
        mutationCount += 1;
      },
    },
    options,
    { log() {} },
  );

  assert.equal(options.apply, false);
  assert.equal(mutationCount, 0);
});

test("apply mode requires the explicit apply flag", () => {
  assert.equal(parseOwnerBootstrapArgs(["--uid", user.uid]).apply, false);
  assert.equal(
    parseOwnerBootstrapArgs(["--uid", user.uid, "--apply"]).apply,
    true,
  );
  assert.throws(
    () => parseOwnerBootstrapArgs(["--uid", user.uid, "apply"]),
    /Unknown option/,
  );
});

test("apply preserves claims, writes the exact UID, and verifies the result", async () => {
  let resultingClaims: CustomClaims = user.customClaims ?? {};
  let mutatedUid = "";

  await bootstrapOwner(
    {
      getUser: async () => ({ ...user, customClaims: resultingClaims }),
      setCustomUserClaims: async (uid, claims) => {
        mutatedUid = uid;
        resultingClaims = claims;
      },
    },
    { uid: user.uid, apply: true },
    { log() {} },
  );

  assert.equal(mutatedUid, user.uid);
  assert.deepEqual(resultingClaims, {
    someExistingClaim: true,
    owner: true,
  });
});

test("apply fails when the re-fetched owner claim is not true", async () => {
  let readCount = 0;

  await assert.rejects(
    bootstrapOwner(
      {
        getUser: async () => {
          readCount += 1;
          return readCount === 1
            ? user
            : { ...user, customClaims: { someExistingClaim: true } };
        },
        setCustomUserClaims: async () => {},
      },
      { uid: user.uid, apply: true },
      { log() {} },
    ),
    /verification failed/,
  );
});
