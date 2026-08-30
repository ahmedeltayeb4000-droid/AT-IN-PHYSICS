import {
  collection,
  getDocs,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import type { Course } from "../courses/types";
import { mapAdminCourseDocument } from "./adminCourseMapper";
import {
  AdminCourseInventoryError,
  classifyAdminCourseInventoryFailure,
} from "./adminCourseInventoryDiagnostics";

export { AdminCourseInventoryError } from "./adminCourseInventoryDiagnostics";

function mapSnapshot(snapshot: QueryDocumentSnapshot): Course {
  try {
    return mapAdminCourseDocument(snapshot.id, snapshot.data());
  } catch {
    throw new AdminCourseInventoryError("malformed");
  }
}

export async function getAdminCourses(): Promise<Course[]> {
  try {
    const snapshot = await getDocs(collection(firebaseDb, "courses"));
    return snapshot.docs.map(mapSnapshot).sort((left, right) => {
      const byTitle =
        left.title < right.title ? -1 : left.title > right.title ? 1 : 0;
      if (byTitle !== 0) return byTitle;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  } catch (cause) {
    throw new AdminCourseInventoryError(
      classifyAdminCourseInventoryFailure(cause),
    );
  }
}
