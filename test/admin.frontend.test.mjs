import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveOwnerAccessState } from "../src/features/auth/ownerAccess.ts";

const source = async (path) => readFile(new URL(path, import.meta.url), "utf8");

test("owner access fails closed for auth and claim loading", () => {
  assert.equal(
    resolveOwnerAccessState({
      authLoading: true,
      claimsLoading: true,
      authenticated: false,
      isOwner: false,
    }),
    "loading",
  );
  assert.equal(
    resolveOwnerAccessState({
      authLoading: false,
      claimsLoading: true,
      authenticated: true,
      isOwner: true,
    }),
    "loading",
  );
});

test("unauthenticated and authenticated non-owner access are denied", () => {
  assert.equal(
    resolveOwnerAccessState({
      authLoading: false,
      claimsLoading: false,
      authenticated: false,
      isOwner: false,
    }),
    "unauthenticated",
  );
  assert.equal(
    resolveOwnerAccessState({
      authLoading: false,
      claimsLoading: false,
      authenticated: true,
      isOwner: false,
    }),
    "denied",
  );
});

test("only a verified owner is allowed", () => {
  assert.equal(
    resolveOwnerAccessState({
      authLoading: false,
      claimsLoading: false,
      authenticated: true,
      isOwner: true,
    }),
    "allowed",
  );
});

test("AuthProvider derives owner authority only from ID-token claims", async () => {
  const provider = await source("../src/features/auth/AuthProvider.tsx");
  assert.match(provider, /getIdTokenResult\s*\(/);
  assert.match(provider, /token\.claims\.owner\s*===\s*true/);
  assert.doesNotMatch(
    provider,
    /localStorage|sessionStorage|@.*\.(?:com|org)|ownerUid/i,
  );
});

test("admin routes are nested beneath a mandatory OwnerGuard", async () => {
  const router = await source("../src/app/router/AppRouter.tsx");
  assert.match(router, /path="admin"[\s\S]*?<OwnerGuard>[\s\S]*?<AdminLayout/);
  assert.match(router, /<Route index element={<AdminOverviewPage/);
  assert.match(router, /path="courses" element={<AdminCoursesPage/);
  const guards = await source("../src/features/auth/AuthGuards.tsx");
  assert.match(guards, /state === "unauthenticated"[\s\S]*?to="\/login"/);
  assert.match(guards, /state === "denied"[\s\S]*?to="\/dashboard"/);
});

test("normal students cannot see the owner navigation entry and owners can", async () => {
  const layout = await source("../src/app/AppLayout.tsx");
  assert.match(layout, /!claimsLoading\s*&&\s*isOwner/);
  assert.match(layout, /to="\/admin"[\s\S]*?Master Control Room/);
});

test("admin shell exposes only Overview and Courses navigation", async () => {
  const layout = await source("../src/pages/admin/AdminLayout.tsx");
  assert.match(layout, /aria-label="Master Control Room"/);
  assert.match(layout, /label: "Overview"/);
  assert.match(layout, /label: "Courses"/);
  assert.match(layout, /md:grid-cols/);
});

test("Courses page uses the safe repository and renders status plus sanitized states", async () => {
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  assert.match(page, /queryFn:\s*getCourses/);
  assert.match(page, /Published/);
  assert.match(page, /Draft/);
  assert.match(page, /No published Courses/);
  assert.match(page, /Unable to load Courses/);
  assert.match(page, /Loading Courses/);
  assert.doesNotMatch(page, /error\.message|FirebaseError|\.stack\b/);
});

test("current Course repository legitimately exposes published Courses only", async () => {
  const repository = await source(
    "../src/features/courses/courseRepository.ts",
  );
  assert.match(repository, /where\("status",\s*"==",\s*"published"\)/);
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  assert.match(page, /Draft Courses are not available to the browser/);
});

test("admin frontend introduces no administrative write or privileged SDK API", async () => {
  const paths = [
    "../src/pages/admin/AdminLayout.tsx",
    "../src/pages/admin/AdminOverviewPage.tsx",
    "../src/pages/admin/AdminCoursesPage.tsx",
    "../src/features/auth/AuthProvider.tsx",
    "../src/features/auth/AuthGuards.tsx",
  ];
  const combined = (await Promise.all(paths.map(source))).join("\n");
  assert.doesNotMatch(
    combined,
    /\b(?:setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\b/,
  );
  assert.doesNotMatch(
    combined,
    /firebase-admin|serviceAccount|private_key|localStorage|sessionStorage/,
  );
});

test("legacy hard-coded catalogs are not imported by production frontend", async () => {
  const files = await Promise.all([
    source("../src/app/router/AppRouter.tsx"),
    source("../src/pages/admin/AdminOverviewPage.tsx"),
    source("../src/pages/admin/AdminCoursesPage.tsx"),
  ]);
  assert.doesNotMatch(files.join("\n"), /courseCatalog|curriculumCatalog/);
});
