import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "../../lib/firebase";
import { deriveAccessCodeId } from "../accessCodes/accessCodeFormat";
import { generateStaffAccessCode } from "./staffAccessCodeFormat";

export async function createStaffAccessCode(
  courseId: string,
  expiresAt: string | null,
) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Staff authorization is unavailable.");
  const code = generateStaffAccessCode();
  const id = await deriveAccessCodeId(code);
  const expiry = expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null;
  await setDoc(doc(firebaseDb, "accessCodes", id), {
    version: 2,
    courseId,
    status: "active",
    createdAt: serverTimestamp(),
    expiresAt: expiry,
    redeemedBy: null,
    redeemedAt: null,
    createdByUid: user.uid,
  });
  return code;
}
