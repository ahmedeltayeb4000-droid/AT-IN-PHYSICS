/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles/index.css";
import { SessionVideoPlayer } from "../../src/features/video/SessionVideoPlayer";
import type { Session } from "../../src/features/courses/types";
import {
  artifactFixture,
  fixtureState,
  playerAudit as audit,
  type FixtureFailure,
} from "./playerTestState";

declare global {
  interface Window {
    playerAudit: {
      calls: string[];
      createdUrls: string[];
      revokedUrls: string[];
      watermarkTimers: Set<unknown>;
      mediaListeners: number;
      fullscreenListeners: number;
    };
  }
}

window.playerAudit = audit;

const nativeCreateObjectUrl = URL.createObjectURL.bind(URL);
const nativeRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob) => {
  audit.calls.push(`blob:${blob.type}`);
  const url = nativeCreateObjectUrl(blob);
  audit.createdUrls.push(url);
  return url;
};
URL.revokeObjectURL = (url: string) => {
  audit.revokedUrls.push(url);
  nativeRevokeObjectUrl(url);
};

const nativeSetInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
window.setInterval = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
  const timer = nativeSetInterval(callback, delay, ...args);
  if (delay === 12_000) audit.watermarkTimers.add(timer);
  return timer;
}) as typeof window.setInterval;
window.clearInterval = ((timer?: number) => {
  audit.watermarkTimers.delete(timer);
  nativeClearInterval(timer);
}) as typeof window.clearInterval;

const nativeMatchMedia = window.matchMedia.bind(window);
window.matchMedia = (query: string) => {
  const result = nativeMatchMedia(query);
  const nativeAdd = result.addEventListener.bind(result);
  const nativeRemove = result.removeEventListener.bind(result);
  result.addEventListener = ((type: "change", listener: EventListenerOrEventListenerObject) => {
    if (type === "change") audit.mediaListeners += 1;
    nativeAdd(type, listener);
  }) as typeof result.addEventListener;
  result.removeEventListener = ((type: "change", listener: EventListenerOrEventListenerObject) => {
    if (type === "change") audit.mediaListeners -= 1;
    nativeRemove(type, listener);
  }) as typeof result.removeEventListener;
  return result;
};

const nativeDocumentAdd = document.addEventListener.bind(document);
const nativeDocumentRemove = document.removeEventListener.bind(document);
document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
  if (type === "fullscreenchange") audit.fullscreenListeners += 1;
  nativeDocumentAdd(type, listener, options);
}) as typeof document.addEventListener;
document.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
  if (type === "fullscreenchange") audit.fullscreenListeners -= 1;
  nativeDocumentRemove(type, listener, options);
}) as typeof document.removeEventListener;

function session(id: string): Session {
  return {
    id,
    courseId: "mechanics",
    moduleId: "motion",
    title: `Session ${id}`,
    order: 0,
    publicationStatus: "published",
    videoAssetId: `${id}-video`,
  };
}

function App() {
  const [sessionId, setSessionId] = useState("lesson-one");
  const [viewer, setViewer] = useState({ uid: "viewer-one-raw-uid", email: "alice.student@example.com" });
  const [mounted, setMounted] = useState(true);
  const [, setFailureState] = useState<FixtureFailure>("none");
  const [watermarkMode, setWatermarkMode] = useState<"protected" | "none">("protected");

  function setFailure(failure: FixtureFailure) {
    fixtureState.failure = failure;
    setFailureState(failure);
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setSessionId((id) => id === "lesson-one" ? "lesson-two" : "lesson-one")}>Change session</button>
        <button onClick={() => setViewer({ uid: "viewer-two-raw-uid", email: "bob.viewer@example.com" })}>Change viewer</button>
        <button onClick={() => setMounted(false)}>Unmount player</button>
        <button onClick={() => setMounted(true)}>Mount player</button>
        <button onClick={() => setFailure("access")}>Fail access</button>
        <button onClick={() => setFailure("fetch")}>Fail fetch</button>
        <button onClick={() => setFailure("key")}>Fail key</button>
        <button onClick={() => setFailure("atv1")}>Fail atv1</button>
        <button onClick={() => setFailure("decrypt")}>Fail decrypt</button>
        <button onClick={() => setFailure("late")}>Late media</button>
        <button onClick={() => { void artifactFixture().then((artifact) => fixtureState.lateResolve?.(artifact)); }}>Resolve late</button>
        <button onClick={() => setWatermarkMode("none")}>No watermark</button>
      </div>
      {mounted ? (
        <SessionVideoPlayer
          session={session(sessionId)}
          watermark={watermarkMode === "protected" ? { mode: "protected", viewer } : { mode: "none" }}
        />
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
