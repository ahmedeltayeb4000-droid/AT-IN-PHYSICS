import {
  collection,
  getDocs,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import { isCanonicalAdminModuleId } from "./adminModuleMapper";
import {
  mapAdminSessionDocument,
  type AdminSession,
} from "./adminSessionMapper";

export type AdminSessionInventoryErrorCode =
  "validation" | "unauthorized" | "service" | "malformed";

export class AdminSessionInventoryError extends Error {
  readonly code: AdminSessionInventoryErrorCode;

  constructor(code: AdminSessionInventoryErrorCode) {
    super(code);
    this.code = code;
    this.name = "AdminSessionInventoryError";
  }
}

function mapSnapshot(
  snapshot: QueryDocumentSnapshot,
  courseId: string,
  moduleId: string,
): AdminSession {
  try {
    return mapAdminSessionDocument(
      snapshot.id,
      courseId,
      moduleId,
      snapshot.data(),
    );
  } catch {
    throw new AdminSessionInventoryError("malformed");
  }
}

export async function getAdminSessions(
  courseId: string,
  moduleId: string,
): Promise<AdminSession[]> {
  if (
    !isCanonicalAdminModuleId(courseId) ||
    !isCanonicalAdminModuleId(moduleId)
  ) {
    throw new AdminSessionInventoryError("validation");
  }
  try {
    const snapshot = await getDocs(
      collection(
        firebaseDb,
        "courses",
        courseId,
        "modules",
        moduleId,
        "sessions",
      ),
    );
    return snapshot.docs
      .map((item) => mapSnapshot(item, courseId, moduleId))
      .sort((left, right) => {
        const byOrder = left.order - right.order;
        if (byOrder !== 0) return byOrder;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });
  } catch (cause) {
    if (cause instanceof AdminSessionInventoryError) throw cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : "";
    throw new AdminSessionInventoryError(
      code === "permission-denied" || code.endsWith("/permission-denied")
        ? "unauthorized"
        : "service",
    );
  }
}
