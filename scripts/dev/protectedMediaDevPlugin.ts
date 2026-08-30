import { createReadStream } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import type { Connect, Plugin } from "vite";
import { isCanonicalVideoAssetId } from "../hosting/releaseAssembly.mjs";

const ROUTE_PREFIX = "/protected-media/";
const ATV1_SUFFIX = ".atv1";

function sanitizedNotFound(response: ServerResponse): void {
  response.statusCode = 404;
  response.setHeader("Cache-Control", "no-store");
  response.end("Not found");
}

export function createProtectedMediaDevMiddleware(
  artifactDirectory: string,
): Connect.NextHandleFunction {
  const configuredRoot = resolve(artifactDirectory);

  return async (request, response, next) => {
    const rawUrl = request.url;
    if (typeof rawUrl !== "string") return next();
    const rawPathname = rawUrl.split(/[?#]/, 1)[0];
    const targetsProtectedMedia = rawPathname.startsWith(ROUTE_PREFIX);

    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(rawUrl, "http://localhost").pathname);
    } catch {
      if (targetsProtectedMedia) return sanitizedNotFound(response);
      return next();
    }
    if (!pathname.startsWith(ROUTE_PREFIX)) {
      if (targetsProtectedMedia) return sanitizedNotFound(response);
      return next();
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sanitizedNotFound(response);
    }

    const fileName = pathname.slice(ROUTE_PREFIX.length);
    if (!fileName.endsWith(ATV1_SUFFIX)) return sanitizedNotFound(response);
    const assetId = fileName.slice(0, -ATV1_SUFFIX.length);
    if (
      !isCanonicalVideoAssetId(assetId) ||
      fileName !== `${assetId}${ATV1_SUFFIX}`
    ) {
      return sanitizedNotFound(response);
    }

    const candidate = resolve(configuredRoot, fileName);
    if (dirname(candidate) !== configuredRoot) return sanitizedNotFound(response);

    try {
      const [rootStats, candidateStats] = await Promise.all([
        lstat(configuredRoot),
        lstat(candidate),
      ]);
      if (
        !rootStats.isDirectory() ||
        rootStats.isSymbolicLink() ||
        !candidateStats.isFile() ||
        candidateStats.isSymbolicLink()
      ) {
        return sanitizedNotFound(response);
      }
      const [trustedRoot, trustedCandidate] = await Promise.all([
        realpath(configuredRoot),
        realpath(candidate),
      ]);
      if (dirname(trustedCandidate) !== trustedRoot) {
        return sanitizedNotFound(response);
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Length", String(candidateStats.size));
      response.setHeader("Cache-Control", "no-store, max-age=0");
      if (request.method === "HEAD") return response.end();
      const stream = createReadStream(candidate);
      stream.on("error", () => {
        if (!response.headersSent) sanitizedNotFound(response);
        else response.destroy();
      });
      stream.pipe(response);
    } catch {
      return sanitizedNotFound(response);
    }
  };
}

export function protectedMediaDevPlugin(repositoryRoot: string): Plugin {
  return {
    name: "at-in-physics-protected-media-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        createProtectedMediaDevMiddleware(
          resolve(repositoryRoot, "hosting-release", "protected-media"),
        ),
      );
    },
  };
}
