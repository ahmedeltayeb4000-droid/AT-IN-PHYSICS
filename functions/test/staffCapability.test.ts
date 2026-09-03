import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import {
  manageStaffCapability,
  parseStaffCapabilityArgs,
} from "../src/tooling/staffCapability.js";

test("Staff capability arguments are exact and dry-run by default", () => {
  assert.deepEqual(
    parseStaffCapabilityArgs(["--uid", "staff-user", "--operation", "grant"]),
    { targetUid: "staff-user", operation: "grant", apply: false },
  );
  assert.equal(
    parseStaffCapabilityArgs([
      "--uid",
      "staff-user",
      "--operation",
      "revoke",
      "--apply",
    ]).apply,
    true,
  );
  for (const args of [
    [],
    ["--uid", "bad/path", "--operation", "grant"],
    ["--uid", "staff-user", "--operation", "other"],
    ["--uid", "staff-user", "--operation", "grant", "extra"],
  ])
    assert.throws(() => parseStaffCapabilityArgs(args));
});

function harness() {
  let stored: Record<string, unknown> | undefined;
  let writes = 0;
  const reference = {
    set: async (value: Record<string, unknown>) => {
      stored = value;
      writes += 1;
    },
    delete: async () => {
      stored = undefined;
      writes += 1;
    },
    get: async () => ({ exists: Boolean(stored), data: () => stored }),
  };
  const auth = {
    getUser: async (uid: string) => ({
      uid,
      customClaims: uid === "owner-user" ? { owner: true } : {},
    }),
  };
  const db = {
    doc: (path: string) => {
      assert.equal(path, "staffCapabilities/staff-user");
      return reference;
    },
  };
  return {
    auth,
    db,
    get stored() {
      return stored;
    },
    get writes() {
      return writes;
    },
  };
}

test("dry-run writes nothing and apply grants exact verified document", async () => {
  const h = harness();
  const now = new Date("2030-01-01T00:00:00.000Z");
  await manageStaffCapability(
    h.auth as never,
    h.db as never,
    "owner-user",
    { targetUid: "staff-user", operation: "grant", apply: false },
    now,
  );
  assert.equal(h.writes, 0);
  await manageStaffCapability(
    h.auth as never,
    h.db as never,
    "owner-user",
    { targetUid: "staff-user", operation: "grant", apply: true },
    now,
  );
  assert.deepEqual(h.stored, {
    version: 1,
    enabled: true,
    accessCodesCreate: true,
    grantedAt: Timestamp.fromDate(now),
    grantedByUid: "owner-user",
  });
});

test("revoke deletes exactly the capability and Owner target is rejected", async () => {
  const h = harness();
  await manageStaffCapability(h.auth as never, h.db as never, "owner-user", {
    targetUid: "staff-user",
    operation: "grant",
    apply: true,
  });
  await manageStaffCapability(h.auth as never, h.db as never, "owner-user", {
    targetUid: "staff-user",
    operation: "revoke",
    apply: true,
  });
  assert.equal(h.stored, undefined);
  await assert.rejects(
    manageStaffCapability(h.auth as never, h.db as never, "owner-user", {
      targetUid: "owner-user",
      operation: "grant",
      apply: true,
    }),
  );
});
