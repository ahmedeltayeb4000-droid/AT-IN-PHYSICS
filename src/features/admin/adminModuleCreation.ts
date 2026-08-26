import { doc, runTransaction } from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import {
  AdminModuleCreationError,
  buildAdminModuleCreation,
  type AdminModuleCreationInput,
} from "./adminModuleCreationValidation";

export { AdminModuleCreationError } from "./adminModuleCreationValidation";

export async function createAdminModule(
  input: AdminModuleCreationInput,
): Promise<void> {
  const proposal = buildAdminModuleCreation(input);
  const reference = doc(
    firebaseDb,
    "courses",
    proposal.courseId,
    "modules",
    proposal.moduleId,
  );
  try {
    await runTransaction(firebaseDb, async (transaction) => {
      if ((await transaction.get(reference)).exists()) {
        throw new AdminModuleCreationError("conflict");
      }
      transaction.set(reference, proposal.document);
    });
  } catch (cause) {
    if (cause instanceof AdminModuleCreationError) throw cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : "";
    throw new AdminModuleCreationError(
      code === "permission-denied" || code.endsWith("/permission-denied")
        ? "unauthorized"
        : "service",
    );
  }
}
