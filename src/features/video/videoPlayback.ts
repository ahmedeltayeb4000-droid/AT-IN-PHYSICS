import type { Session } from "../courses/types.ts";
import type { VideoAccess } from "../courses/videoAccess.ts";

export type VideoPlaybackDependencies = {
  readonly getAccess: (session: Session) => Promise<VideoAccess>;
  readonly fetchMedia: (videoAssetId: string) => Promise<ArrayBuffer>;
  readonly decrypt: (artifact: ArrayBuffer, key: string) => Promise<ArrayBuffer>;
  readonly createObjectUrl: (blob: Blob) => string;
  readonly revokeObjectUrl: (url: string) => void;
};

export type LoadedVideo = {
  readonly objectUrl: string;
  readonly release: () => void;
};

export async function loadSessionVideo(
  session: Session,
  dependencies: VideoPlaybackDependencies,
  onStage?: (stage: "access" | "media" | "decrypting") => void,
): Promise<LoadedVideo | null> {
  if (session.videoAssetId === undefined) return null;

  onStage?.("access");
  const access = await dependencies.getAccess(session);
  if (access.videoAssetId !== session.videoAssetId) {
    throw new Error("Video is unavailable.");
  }
  onStage?.("media");
  const artifact = await dependencies.fetchMedia(session.videoAssetId);
  onStage?.("decrypting");
  const plaintext = await dependencies.decrypt(artifact, access.contentKey);
  const objectUrl = dependencies.createObjectUrl(
    new Blob([plaintext], { type: "video/mp4" }),
  );
  let released = false;
  return {
    objectUrl,
    release: () => {
      if (!released) dependencies.revokeObjectUrl(objectUrl);
      released = true;
    },
  };
}
