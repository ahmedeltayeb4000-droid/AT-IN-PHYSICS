import console from "node:console";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  applicationDefault,
  deleteApp,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { requireOwnerAuthority } from "../tooling/enrollmentGrant.js";
import {
  resolveSessionPublicationOwnerUid,
  resolveSessionPublicationProject,
} from "../tooling/sessionPublication.js";
import {
  createOwnerConsoleServer,
  listenOwnerConsole,
  OWNER_CONSOLE_DEFAULT_PORT,
  OWNER_CONSOLE_HOST,
} from "./server.js";

async function main() {
  const projectId = resolveSessionPublicationProject(process.env);
  const ownerUid = resolveSessionPublicationOwnerUid(process.env);
  const port = resolvePort(process.env.AT_IN_PHYSICS_OWNER_CONTROL_PORT);
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "owner-control-local",
  );
  const auth = getAuth(app);
  const db = getFirestore(app);
  try {
    await requireOwnerAuthority(auth, ownerUid);
    const { server } = createOwnerConsoleServer({
      auth,
      db,
      ownerUid,
      projectId,
    });
    try {
      await listenOwnerConsole(server, port);
    } catch {
      throw new Error(
        `Owner Control could not bind to ${OWNER_CONSOLE_HOST}:${port}. The port may already be occupied.`,
      );
    }
    const url = `http://${OWNER_CONSOLE_HOST}:${port}`;
    console.log(`A.T IN PHYSICS Owner Control`);
    console.log(`Target project: ${projectId}`);
    console.log(`Local address: ${url}`);
    console.log("Close this window or press Ctrl+C to stop Owner Control.");
    openBrowser(url);
    await new Promise<void>((resolve) => {
      const close = () => server.close(() => resolve());
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
  } finally {
    await deleteApp(app);
  }
}

export function resolvePort(value: string | undefined) {
  if (value === undefined || value === "") return OWNER_CONSOLE_DEFAULT_PORT;
  if (!/^[1-9]\d{0,4}$/.test(value))
    throw new Error("Owner Control port is invalid.");
  const port = Number(value);
  if (port > 65535) throw new Error("Owner Control port is invalid.");
  return port;
}

function openBrowser(url: string) {
  if (process.platform !== "win32") return;
  const child = spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

main().catch(() => {
  console.error(
    "Owner Control could not start. Verify the owner UID, Firebase project, emulator/credential configuration, and local port.",
  );
  process.exitCode = 1;
});
