import { collection, getDocs, query, where } from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import { mapEnrollmentDocument } from "./enrollmentMapper";
import type { Enrollment } from "./types";

export async function getEnrollmentsForUser(
  userId: string,
): Promise<Enrollment[]> {
  if (!userId.trim()) {
    throw new RangeError("Enrollment userId must not be empty.");
  }

  const ownEnrollmentsQuery = query(
    collection(firebaseDb, "enrollments"),
    where("userId", "==", userId),
  );
  const snapshot = await getDocs(ownEnrollmentsQuery);

  return snapshot.docs
    .map((item) => mapEnrollmentDocument(item.id, item.data()))
    .sort((left, right) => {
      const courseOrder = left.courseId.localeCompare(right.courseId, "en");
      return courseOrder || left.id.localeCompare(right.id, "en");
    });
}
