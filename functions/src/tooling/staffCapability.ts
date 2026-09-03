import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { requireOwnerAuthority } from "./enrollmentGrant.js";
import { validateTargetUserId } from "../enrollments/validation.js";

export type StaffCapabilityOperation = "grant" | "revoke";
export type StaffCapabilityOptions = Readonly<{
  targetUid: string;
  operation: StaffCapabilityOperation;
  apply: boolean;
}>;

export function parseStaffCapabilityArgs(
  args: readonly string[],
): StaffCapabilityOptions {
  let targetUid: string | undefined;
  let operation: StaffCapabilityOperation | undefined;
  let apply = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--uid" || arg === "--operation") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value.`);
      if (arg === "--uid") {
        if (targetUid) throw new Error("--uid may be provided only once.");
        targetUid = value;
      } else {
        if (operation)
          throw new Error("--operation may be provided only once.");
        if (value !== "grant" && value !== "revoke")
          throw new Error("Operation must be grant or revoke.");
        operation = value;
      }
    } else if (arg === "--apply") {
      if (apply) throw new Error("--apply may be provided only once.");
      apply = true;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return {
    targetUid: validateTargetUserId(targetUid),
    operation:
      operation ??
      (() => {
        throw new Error("--operation is required.");
      })(),
    apply,
  };
}

export async function manageStaffCapability(
  auth: Auth,
  db: Firestore,
  ownerUidValue: string,
  options: StaffCapabilityOptions,
  now = new Date(),
) {
  const ownerUid = validateTargetUserId(ownerUidValue);
  const targetUid = validateTargetUserId(options.targetUid);
  if (targetUid === ownerUid)
    throw new Error("Owner cannot be granted a Staff capability.");
  await requireOwnerAuthority(auth, ownerUid);
  await auth.getUser(targetUid);
  const reference = db.doc(`staffCapabilities/${targetUid}`);
  const proposed = {
    version: 1,
    enabled: true,
    accessCodesCreate: true,
    grantedAt: Timestamp.fromDate(now),
    grantedByUid: ownerUid,
  };
  if (!options.apply)
    return { operation: options.operation, targetUid, applied: false };
  if (options.operation === "grant") await reference.set(proposed);
  else await reference.delete();
  const verified = await reference.get();
  if (options.operation === "grant") {
    const data = verified.data();
    if (
      !verified.exists ||
      !data ||
      Object.keys(data).sort().join("|") !==
        "accessCodesCreate|enabled|grantedAt|grantedByUid|version" ||
      data.version !== 1 ||
      data.enabled !== true ||
      data.accessCodesCreate !== true ||
      data.grantedByUid !== ownerUid ||
      !(data.grantedAt instanceof Timestamp)
    )
      throw new Error("Staff capability verification failed.");
  } else if (verified.exists)
    throw new Error("Staff capability revocation verification failed.");
  return { operation: options.operation, targetUid, applied: true };
}
