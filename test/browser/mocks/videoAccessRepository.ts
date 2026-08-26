import type { Session } from "../../../src/features/courses/types";
import type { VideoAccess } from "../../../src/features/courses/videoAccess";
import { contentKey, fixtureState, playerAudit } from "../playerTestState";

export async function getSessionVideoAccess(session: Session): Promise<VideoAccess> {
  playerAudit.calls.push(`access:${session.id}`);
  if (fixtureState.failure === "access") {
    throw new Error("Firestore permission denied SECRET");
  }
  return {
    videoAssetId: session.videoAssetId!,
    contentKey: fixtureState.failure === "key" ? "invalid-key" : contentKey,
  };
}
