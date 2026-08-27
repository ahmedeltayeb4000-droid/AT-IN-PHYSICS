import {
  collection,
  getDocs,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import {
  isCanonicalAdminModuleId,
  mapAdminModuleDocument,
  type AdminModule,
} from "./adminModuleMapper";

export type AdminModuleInventoryErrorCode =
  "validation" | "unauthorized" | "service" | "malformed";

export class AdminModuleInventoryError extends Error {
  readonly code: AdminModuleInventoryErrorCode;

  constructor(code: AdminModuleInventoryErrorCode) {
    super(code);
    this.code = code;
    this.name = "AdminModuleInventoryError";
  }
}

function mapSnapshot(snapshot: QueryDocumentSnapshot): AdminModule {
  try {
    return mapAdminModuleDocument(snapshot.id, snapshot.data());
  } catch {
    throw new AdminModuleInventoryError("malformed");
  }
}

export async function getAdminModules(
  courseId: string,
): Promise<AdminModule[]> {
  if (!isCanonicalAdminModuleId(courseId)) {
    throw new AdminModuleInventoryError("validation");
  }
  try {
    const snapshot = await getDocs(
      collection(firebaseDb, "courses", courseId, "modules"),
    );
    return snapshot.docs.map(mapSnapshot).sort((left, right) => {
      const byOrder = left.order - right.order;
      if (byOrder !== 0) return byOrder;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  } catch (cause) {
    if (cause instanceof AdminModuleInventoryError) throw cause;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? String(cause.code)
        : "";
    throw new AdminModuleInventoryError(
      code === "permission-denied" || code.endsWith("/permission-denied")
        ? "unauthorized"
        : "service",
    );
  }
}
