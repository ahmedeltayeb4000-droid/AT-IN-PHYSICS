import { dirname, extname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const normalize = (path: string) => path.replace(/\\/g, "/").split("?", 1)[0];
const absolute = (path: string) => normalize(resolve(path));

const playerModule = absolute("src/features/video/SessionVideoPlayer.tsx");
const productionModules = new Set([
  absolute("src/features/courses/videoAccessRepository.ts"),
  absolute("src/features/video/encryptedMediaRepository.ts"),
  absolute("src/lib/firebase.ts"),
]);

const testBoundaries = new Map([
  ["../courses/videoAccessRepository", absolute("test/browser/mocks/videoAccessRepository.ts")],
  ["./encryptedMediaRepository", absolute("test/browser/mocks/encryptedMediaRepository.ts")],
]);

function resolvedCandidates(source: string, importer: string) {
  const candidate = normalize(resolve(dirname(importer), source));
  return extname(candidate) ? [candidate] : [candidate, `${candidate}.ts`, `${candidate}.tsx`];
}

function isFirebaseSdkImport(source: string) {
  return source === "firebase" || source.startsWith("firebase/") || source.startsWith("@firebase/");
}

function browserSafetyBoundary(): Plugin {
  const blocked = (id: string) =>
    new Error(`Browser harness safety boundary blocked production Firebase dependency: ${id}`);

  return {
    name: "protected-player-fail-closed-boundaries",
    enforce: "pre",
    resolveId(source, importer) {
      if (isFirebaseSdkImport(source)) throw blocked(source);

      if (importer && normalize(importer) === playerModule) {
        const testDouble = testBoundaries.get(source);
        if (testDouble) return testDouble;
      }

      if (importer) {
        const forbidden = resolvedCandidates(source, normalize(importer)).find((candidate) =>
          productionModules.has(candidate),
        );
        if (forbidden) throw blocked(forbidden);
      }
      return null;
    },
    load(id) {
      const normalizedId = normalize(id);
      if (productionModules.has(normalizedId) || isFirebaseSdkImport(normalizedId)) {
        throw blocked(normalizedId);
      }
      return null;
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    entries: ["test/browser/player.fixture.html"],
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  plugins: [browserSafetyBoundary(), react(), tailwindcss()],
});
