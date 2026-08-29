import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { downloadSessionResource, type ResourceDownloadStage } from "./resourceDownload";
import { getSessionResources } from "./resourceRepository";

type DownloadState = "idle" | ResourceDownloadStage | "unavailable";

const COPY: Record<DownloadState, string> = {
  idle: "Download",
  access: "Checking access…",
  downloading: "Downloading…",
  preparing: "Preparing PDF…",
  unavailable: "Download unavailable — Retry",
};

export function SessionResourceList({
  courseId,
  moduleId,
  sessionId,
}: {
  readonly courseId: string;
  readonly moduleId: string;
  readonly sessionId: string;
}) {
  const resources = useQuery({
    queryKey: ["courses", courseId, "modules", moduleId, "sessions", sessionId, "resources"],
    queryFn: () => getSessionResources(courseId, moduleId, sessionId),
  });
  const [states, setStates] = useState<Record<string, DownloadState>>({});
  const activeDownloads = useRef(new Set<string>());

  async function download(resource: NonNullable<typeof resources.data>[number]) {
    if (activeDownloads.current.has(resource.resourceId)) return;
    activeDownloads.current.add(resource.resourceId);
    setStates((value) => ({ ...value, [resource.resourceId]: "access" }));
    try {
      await downloadSessionResource(
        { courseId, moduleId, sessionId },
        resource,
        undefined,
        (stage) => setStates((value) => ({ ...value, [resource.resourceId]: stage })),
      );
      setStates((value) => ({ ...value, [resource.resourceId]: "idle" }));
    } catch {
      setStates((value) => ({ ...value, [resource.resourceId]: "unavailable" }));
    } finally {
      activeDownloads.current.delete(resource.resourceId);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/[.03] p-6">
      <h2 className="text-xl font-bold text-text">Resources</h2>
      {resources.isPending ? (
        <p className="mt-2 text-sm text-text-muted" role="status">Loading resources…</p>
      ) : resources.isError ? (
        <p className="mt-2 text-sm text-text-muted" role="status">Resources are unavailable. Video and lesson content remain available.</p>
      ) : resources.data.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No resources are available for this lesson.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {resources.data.map((resource) => {
            const state = states[resource.resourceId] ?? "idle";
            const active = state === "access" || state === "downloading" || state === "preparing";
            return (
              <li key={resource.resourceId} className="flex flex-col gap-3 rounded-lg border border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-text">{resource.title}</p>
                  <p className="text-sm text-text-muted">{resource.originalFileName}</p>
                </div>
                <button type="button" disabled={active} onClick={() => void download(resource)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
                  {COPY[state]}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
