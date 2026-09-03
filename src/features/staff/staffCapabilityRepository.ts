import { doc, getDoc, Timestamp } from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";

export type StaffCapability = Readonly<{ accessCodesCreate: true }>;

export async function getOwnStaffCapability(
  uid: string,
): Promise<StaffCapability | null> {
  try {
    const snapshot = await getDoc(doc(firebaseDb, "staffCapabilities", uid));
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (
      Object.keys(data).sort().join("|") !==
        "accessCodesCreate|enabled|grantedAt|grantedByUid|version" ||
      data.version !== 1 ||
      data.enabled !== true ||
      data.accessCodesCreate !== true ||
      !(data.grantedAt instanceof Timestamp) ||
      typeof data.grantedByUid !== "string" ||
      !data.grantedByUid
    )
      return null;
    return { accessCodesCreate: true };
  } catch {
    return null;
  }
}
