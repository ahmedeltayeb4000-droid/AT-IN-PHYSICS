import { useEffect, useRef, useState } from "react";
import type { Session } from "../courses/types";
import { getSessionVideoAccess } from "../courses/videoAccessRepository";
import { decryptAtv1Artifact } from "./atv1";
import { fetchEncryptedMedia } from "./encryptedMediaRepository";
import { loadSessionVideo } from "./videoPlayback";
import {
  buildProtectedWatermarkLines,
  nextWatermarkPosition,
  startWatermarkPositionCycle,
  WATERMARK_POSITIONS,
  type VideoWatermarkPolicy,
} from "./watermark";

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

export function SessionVideoPlayer({
  session,
  watermark,
}: {
  readonly session: Session;
  readonly watermark: VideoWatermarkPolicy;
}) {
  const [state, setState] = useState<PlayerState>({ status: "access" });
  const [watermarkIdentity, setWatermarkIdentity] = useState<{
    readonly uid: string;
    readonly lines: readonly [string, string] | null;
  } | null>(null);
  const [position, setPosition] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    let active = true;
    if (watermark.mode === "protected") {
      void buildProtectedWatermarkLines(watermark.viewer).then((lines) => {
        if (active) setWatermarkIdentity({ uid: watermark.viewer.uid, lines });
      }).catch(() => {
        if (active) {
          setWatermarkIdentity({ uid: watermark.viewer.uid, lines: null });
        }
      });
    }
    return () => {
      active = false;
    };
  }, [watermark]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(query.matches);
      if (query.matches) setPosition(0);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(
    () =>
      startWatermarkPositionCycle(
        () => setPosition((current) => nextWatermarkPosition(current)),
        reducedMotion || watermark.mode === "none",
      ),
    [reducedMotion, watermark.mode],
  );

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  async function toggleFullscreen() {
    try {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      if (document.fullscreenElement === wrapper) await document.exitFullscreen();
      else await wrapper.requestFullscreen();
    } catch {
      // Fullscreen denial is non-fatal and does not affect protected playback.
    }
  }

  const watermarkLines =
    watermark.mode === "protected" &&
    watermarkIdentity?.uid === watermark.viewer.uid
      ? watermarkIdentity.lines
      : null;
  const watermarkFailed =
    watermark.mode === "protected" &&
    watermarkIdentity?.uid === watermark.viewer.uid &&
    watermarkIdentity.lines === null;
  const playbackCanRender = watermark.mode === "none" || watermarkLines !== null;

  return (
    <div
      ref={wrapperRef}
      className="relative mt-8 overflow-hidden rounded-xl border border-white/10 bg-black p-3"
      data-watermark-policy={watermark.mode}
    >
      {state.status === "ready" && playbackCanRender ? (
        <>
          <video
            className="aspect-video w-full rounded-lg bg-black"
            src={state.objectUrl}
            controls
            preload="metadata"
            disablePictureInPicture
            controlsList="nodownload nofullscreen"
            onContextMenu={(event) => event.preventDefault()}
          >
            Your browser does not support HTML video.
          </video>
          {watermark.mode === "protected" && watermarkLines ? (
            <div
              className={`pointer-events-none absolute z-10 max-w-[70%] rounded-md border border-white/30 bg-black/45 px-3 py-2 text-xs font-semibold tracking-wide text-white opacity-70 shadow-[0_1px_5px_rgba(0,0,0,.9)] sm:text-sm ${WATERMARK_POSITIONS[position]}`}
              aria-hidden="true"
              data-watermark-position={position}
            >
              <span className="block">{watermarkLines[0]}</span>
              <span className="block font-normal">{watermarkLines[1]}</span>
            </div>
          ) : null}
          <button
            type="button"
            className="absolute right-5 top-5 z-20 rounded-md border border-white/30 bg-black/70 px-3 py-2 text-xs font-semibold text-white hover:bg-black/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => void toggleFullscreen()}
            aria-label={isFullscreen ? "Exit video fullscreen" : "Enter video fullscreen"}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
        </>
      ) : (
        <p className="p-6 text-center text-sm text-text-muted" role="status">
          {state.status === "unavailable" || watermarkFailed
            ? "Video is unavailable. You can still read the lesson below."
            : state.status === "ready"
              ? "Preparing protected playback…"
            : STATUS_COPY[state.status]}
        </p>
      )}
    </div>
  );
}
