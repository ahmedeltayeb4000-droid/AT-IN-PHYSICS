import { doc, runTransaction } from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import {
  AdminSessionCreationError,
  buildAdminSessionCreation,
  type AdminSessionCreationInput,
} from "./adminSessionCreationValidation";

export { AdminSessionCreationError } from "./adminSessionCreationValidation";

export async function createAdminSession(
  input: AdminSessionCreationInput,
): Promise<void> {
  const proposal = buildAdminSessionCreation(input);
  const reference = doc(
    firebaseDb,
    "courses",
    proposal.courseId,
    "modules",
    proposal.moduleId,
    "sessions",
    proposal.sessionId,
  );
  try {
    await runTransaction(firebaseDb, async (transaction) => {
      if ((await transaction.get(reference)).exists()) {
        throw new AdminSessionCreationError("conflict");
      }
      transaction.set(reference, proposal.document);
    });
  } catch (cause) {
    if (cause instanceof AdminSessionCreationError) throw cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : "";
    throw new AdminSessionCreationError(
      code === "permission-denied" || code.endsWith("/permission-denied")
        ? "unauthorized"
        : "service",
    );
  }
}
