import console from "node:console";
import process from "node:process";
import {
  applicationDefault,
  deleteApp,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  resolveSessionPublicationOwnerUid,
  resolveSessionPublicationProject,
} from "./sessionPublication.js";
import {
  manageStaffCapability,
  parseStaffCapabilityArgs,
} from "./staffCapability.js";

async function main() {
  const options = parseStaffCapabilityArgs(process.argv.slice(2));
  const projectId = resolveSessionPublicationProject(process.env);
  const ownerUid = resolveSessionPublicationOwnerUid(process.env);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "staff-capability-local",
  );
  try {
    const result = await manageStaffCapability(
      getAuth(app),
      getFirestore(app),
      ownerUid,
      options,
    );
    console.log(
      result.applied
        ? `Staff capability ${result.operation} verified.`
        : `Dry run: Staff capability ${result.operation} would target the supplied UID.`,
    );
  } finally {
    await deleteApp(app);
  }
}
main().catch(() => {
  console.error("Staff capability operation failed.");
  process.exitCode = 1;
});
