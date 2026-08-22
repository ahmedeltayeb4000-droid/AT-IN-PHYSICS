import {
  Timestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import {
  SESSION_DISCOVERY_DOCUMENT_ID,
  buildSessionDiscoveryManifest,
  parseSessionDiscoveryRefreshInput,
  sessionDiscoveryManifestsEqual,
  type TrustedSessionRecord,
} from "./manifest.js";

export type SessionDiscoveryRefreshResult = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly discoveredCount: number;
  readonly writeNecessary: boolean;
};

export function trustedSessionRecordFromSnapshot(
  snapshot: QueryDocumentSnapshot<DocumentData>,
): TrustedSessionRecord {
  const data = snapshot.data();
  const hasReleaseAt = Object.prototype.hasOwnProperty.call(data, "releaseAt");

  return {
    id: snapshot.id,
    order: data.order,
    publicationStatus: data.publicationStatus,
    ...(hasReleaseAt
      ? {
          releaseAt:
            data.releaseAt instanceof Timestamp
              ? data.releaseAt.toDate()
              : null,
        }
      : {}),
  };
}

export async function refreshSessionDiscoveryManifest(
  db: Firestore,
  rawInput: unknown,
  trustedNow: Date,
): Promise<SessionDiscoveryRefreshResult> {
  const input = parseSessionDiscoveryRefreshInput(rawInput);
  if (Number.isNaN(trustedNow.getTime())) {
    throw new Error("Trusted Session discovery time is invalid.");
  }

  const courseReference = db.doc(`courses/${input.courseId}`);
  const moduleReference = courseReference.collection("modules").doc(input.moduleId);
  const sessionsQuery = moduleReference.collection("sessions");
  const manifestReference = moduleReference
    .collection("sessionDiscovery")
    .doc(SESSION_DISCOVERY_DOCUMENT_ID);

  return db.runTransaction(async (transaction) => {
    const courseSnapshot = await transaction.get(courseReference);
    if (!courseSnapshot.exists) throw new Error("Course was not found.");

    const moduleSnapshot = await transaction.get(moduleReference);
    if (!moduleSnapshot.exists) throw new Error("Module was not found.");

    const sessionsSnapshot = await transaction.get(sessionsQuery);
    const manifestSnapshot = await transaction.get(manifestReference);
    const manifest = buildSessionDiscoveryManifest(
      sessionsSnapshot.docs.map(trustedSessionRecordFromSnapshot),
      trustedNow,
    );
    const writeNecessary =
      !manifestSnapshot.exists ||
      !sessionDiscoveryManifestsEqual(manifestSnapshot.data(), manifest);

    if (writeNecessary) {
      transaction.set(manifestReference, {
        sessionIds: [...manifest.sessionIds],
      });
    }

    return {
      ...input,
      discoveredCount: manifest.sessionIds.length,
      writeNecessary,
    };
  });
}
