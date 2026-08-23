import { doc, getDoc } from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import { isValidVideoAssetId } from "./sessionMapper";
import type { Session } from "./types";
import {
  mapVideoAccessDocument,
  VIDEO_ACCESS_DOCUMENT_ID,
  type VideoAccess,
} from "./videoAccess";

const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CONTENT_ID_LENGTH = 128;

function unavailableVideoAccess(): never {
  throw new Error("Video access is unavailable.");
}

function isValidContentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_CONTENT_ID_LENGTH &&
    CONTENT_ID_PATTERN.test(value)
  );
}

export async function getSessionVideoAccess(
  session: Session,
): Promise<VideoAccess> {
  if (
    !isValidContentId(session.courseId) ||
    !isValidContentId(session.moduleId) ||
    !isValidContentId(session.id) ||
    !isValidVideoAssetId(session.videoAssetId)
  ) {
    return unavailableVideoAccess();
  }

  const snapshot = await getDoc(
    doc(
      firebaseDb,
      "courses",
      session.courseId,
      "modules",
      session.moduleId,
      "sessions",
      session.id,
      "videoAccess",
      VIDEO_ACCESS_DOCUMENT_ID,
    ),
  );
  if (!snapshot.exists()) return unavailableVideoAccess();

  return mapVideoAccessDocument(
    snapshot.id,
    session.videoAssetId,
    snapshot.data(),
  );
}
