import { doc, runTransaction } from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import {
  AdminCourseCreationError,
  buildAdminCourseDraft,
  type AdminCourseCreationInput,
} from "./adminCourseCreationValidation";

export { AdminCourseCreationError } from "./adminCourseCreationValidation";

export async function createAdminCourse(
  input: AdminCourseCreationInput,
): Promise<void> {
  const proposal = buildAdminCourseDraft(input);
  const reference = doc(firebaseDb, "courses", proposal.courseId);
  try {
    await runTransaction(firebaseDb, async (transaction) => {
      if ((await transaction.get(reference)).exists()) {
        throw new AdminCourseCreationError("conflict");
      }
      transaction.set(reference, proposal.document);
    });
  } catch (cause) {
    if (cause instanceof AdminCourseCreationError) throw cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : "";
    throw new AdminCourseCreationError(
      code === "permission-denied" || code.endsWith("/permission-denied")
        ? "unauthorized"
        : "service",
    );
  }
}
