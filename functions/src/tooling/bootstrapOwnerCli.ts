import console from "node:console";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { bootstrapOwner, parseOwnerBootstrapArgs } from "./ownerBootstrap.js";

const EXPECTED_PROJECT_ID = "at-in-physics";

async function main() {
  const options = parseOwnerBootstrapArgs(process.argv.slice(2));
  const app = initializeApp(
    {
      credential: applicationDefault(),
      projectId: EXPECTED_PROJECT_ID,
    },
    "owner-bootstrap",
  );

  try {
    await bootstrapOwner(getAuth(app), options, console);
  } finally {
    await deleteApp(app);
  }
}

main().catch((error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  console.error(
    code === "auth/user-not-found"
      ? "No Firebase Authentication user exists for the supplied UID."
      : error instanceof Error
        ? error.message
        : "Owner bootstrap failed.",
  );
  process.exitCode = 1;
});
