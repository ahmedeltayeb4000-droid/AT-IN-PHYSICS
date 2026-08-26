import { useEffect, useState } from "react";
import type { Session } from "../courses/types";
import { getSessionVideoAccess } from "../courses/videoAccessRepository";
import { decryptAtv1Artifact } from "./atv1";
import { fetchEncryptedMedia } from "./encryptedMediaRepository";
import { loadSessionVideo } from "./videoPlayback";

const browserDependencies = {
  getAccess: getSessionVideoAccess,
  fetchMedia: fetchEncryptedMedia,
  decrypt: decryptAtv1Artifact,
  createObjectUrl: (blob: Blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url: string) => URL.revokeObjectURL(url),
};

type PlayerState =
  | { readonly status: "access" | "media" | "decrypting" }
  | { readonly status: "ready"; readonly objectUrl: string }
  | { readonly status: "unavailable" };

const STATUS_COPY = {
  access: "Checking video access…",
  media: "Loading encrypted video…",
  decrypting: "Preparing video…",
} as const;

export function SessionVideoPlayer({ session }: { readonly session: Session }) {
  const [state, setState] = useState<PlayerState>({ status: "access" });

  useEffect(() => {
    let active = true;
    let release: (() => void) | undefined;
    void loadSessionVideo(session, browserDependencies, (status) => {
      if (active) setState({ status });
    })
      .then((loaded) => {
        if (!loaded) return;
        if (!active) {
          loaded.release();
          return;
        }
        release = loaded.release;
        setState({ status: "ready", objectUrl: loaded.objectUrl });
      })
      .catch(() => {
        if (active) setState({ status: "unavailable" });
      });

    return () => {
      active = false;
      release?.();
    };
  }, [session]);

  return (
    <div className="relative mt-8 overflow-hidden rounded-xl border border-white/10 bg-black/40 p-3">
      {state.status === "ready" ? (
        <video
          className="aspect-video w-full rounded-lg bg-black"
          src={state.objectUrl}
          controls
          preload="metadata"
          disablePictureInPicture
          controlsList="nodownload"
          onContextMenu={(event) => event.preventDefault()}
        >
          Your browser does not support HTML video.
        </video>
      ) : (
        <p className="p-6 text-center text-sm text-text-muted" role="status">
          {state.status === "unavailable"
            ? "Video is unavailable. You can still read the lesson below."
            : STATUS_COPY[state.status]}
        </p>
      )}
    </div>
  );
}
