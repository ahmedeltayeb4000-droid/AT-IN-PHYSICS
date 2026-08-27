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

test("owner Courses page uses the dedicated inventory repository and renders both statuses", async () => {
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  assert.match(page, /queryFn:\s*getAdminCourses/);
  assert.match(page, /Published/);
  assert.match(page, /Draft/);
  assert.match(page, /No Courses/);
  assert.match(page, /Unable to load Courses/);
  assert.match(page, /Loading Courses/);
  assert.doesNotMatch(page, /error\.message|FirebaseError|\.stack\b/);
});

test("student Course repository remains published-only and admin inventory is isolated", async () => {
  const repository = await source(
    "../src/features/courses/courseRepository.ts",
  );
  assert.match(repository, /where\("status",\s*"==",\s*"published"\)/);
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  assert.doesNotMatch(page, /getCourses/);
  const adminRepository = await source(
    "../src/features/admin/adminCourseRepository.ts",
  );
  assert.match(adminRepository, /collection\(firebaseDb,\s*"courses"\)/);
  assert.doesNotMatch(adminRepository, /where\(/);
});

test("admin Course mapper returns exact data and rejects malformed documents", async () => {
  const { mapAdminCourseDocument } =
    await import("../src/features/admin/adminCourseMapper.ts");
  assert.deepEqual(
    mapAdminCourseDocument("draft-course", {
      slug: "draft-course",
      title: "Draft Course",
      shortDescription: "Draft description",
      status: "draft",
    }),
    {
      id: "draft-course",
      slug: "draft-course",
      title: "Draft Course",
      shortDescription: "Draft description",
      status: "draft",
    },
  );
  for (const [id, value] of [
    [
      "Unsafe/Path",
      {
        slug: "Unsafe/Path",
        title: "Title",
        shortDescription: "Description",
        status: "draft",
      },
    ],
    [
      "course",
      {
        slug: "other",
        title: "Title",
        shortDescription: "Description",
        status: "draft",
      },
    ],
    [
      "course",
      {
        slug: "course",
        title: "Title",
        shortDescription: "Description",
        status: "draft",
        secret: true,
      },
    ],
    [
      "course",
      {
        slug: "course",
        title: "Bad\u0000Title",
        shortDescription: "Description",
        status: "draft",
      },
    ],
  ]) {
    assert.throws(() => mapAdminCourseDocument(id, value));
  }
});

test("Course creation builder derives only canonical slug and draft status", async () => {
  const { buildAdminCourseDraft } =
    await import("../src/features/admin/adminCourseCreationValidation.ts");
  assert.deepEqual(
    buildAdminCourseDraft({
      courseId: "quantum-mechanics",
      title: "Quantum Mechanics",
      shortDescription: "A rigorous introduction.",
      status: "published",
      slug: "forged",
      path: "enrollments/target",
    }),
    {
      courseId: "quantum-mechanics",
      document: {
        slug: "quantum-mechanics",
        title: "Quantum Mechanics",
        shortDescription: "A rigorous introduction.",
        status: "draft",
      },
    },
  );
});

test("Course creation validation rejects unsafe IDs and malformed trusted text", async () => {
  const { buildAdminCourseDraft } =
    await import("../src/features/admin/adminCourseCreationValidation.ts");
  for (const input of [
    { courseId: "Unsafe", title: "Title", shortDescription: "Description" },
    { courseId: "course", title: " Title", shortDescription: "Description" },
    {
      courseId: "course",
      title: "Title",
      shortDescription: "Bad\u0000Description",
    },
    {
      courseId: "course",
      title: "a".repeat(161),
      shortDescription: "Description",
    },
  ]) {
    assert.throws(() => buildAdminCourseDraft(input));
  }
});

test("Course creation UI prevents duplicates, refreshes inventory, and sanitizes errors", async () => {
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  const repository = await source(
    "../src/features/admin/adminCourseCreation.ts",
  );
  assert.match(page, /Create Course/);
  assert.match(page, /creation\.isPending/);
  assert.match(page, /error={fieldErrors\.courseId}/);
  assert.match(page, /error={fieldErrors\.title}/);
  assert.match(page, /error={fieldErrors\.shortDescription}/);
  assert.match(page, /invalidateQueries/);
  assert.match(page, /role="alert"/);
  assert.match(page, /role="status"/);
  assert.doesNotMatch(page, /error\.message|\.stack\b/);
  assert.match(
    repository,
    /doc\(firebaseDb,\s*"courses",\s*proposal\.courseId\)/,
  );
  assert.match(repository, /runTransaction/);
  assert.match(repository, /transaction\.get/);
  assert.match(
    repository,
    /transaction\.set\(reference,\s*proposal\.document\)/,
  );
  assert.doesNotMatch(repository, /updateDoc|deleteDoc|addDoc|merge\s*:/);
});

test("Module creation builder produces the exact fixed-path payload", async () => {
  const { buildAdminModuleCreation } =
    await import("../src/features/admin/adminModuleCreationValidation.ts");
  assert.deepEqual(
    buildAdminModuleCreation({
      courseId: "mechanics",
      moduleId: "motion",
      title: "Motion",
      order: "0",
      status: "published",
      path: "enrollments/target",
    }),
    {
      courseId: "mechanics",
      moduleId: "motion",
      document: { title: "Motion", order: 0 },
    },
  );
});

test("Module creation validation matches IDs, title, and safe integer order", async () => {
  const { buildAdminModuleCreation } =
    await import("../src/features/admin/adminModuleCreationValidation.ts");
  for (const input of [
    { courseId: "Unsafe", moduleId: "module", title: "Title", order: "0" },
    { courseId: "course", moduleId: "../module", title: "Title", order: "0" },
    { courseId: "course", moduleId: "module", title: " Title", order: "0" },
    { courseId: "course", moduleId: "module", title: "Title", order: "-1" },
    { courseId: "course", moduleId: "module", title: "Title", order: "1.5" },
    {
      courseId: "course",
      moduleId: "module",
      title: "Title",
      order: "9007199254740992",
    },
  ]) {
    assert.throws(() => buildAdminModuleCreation(input));
  }
});

test("Module creation UI uses Course selection, fixed transaction, and sanitized states", async () => {
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  const repository = await source(
    "../src/features/admin/adminModuleCreation.ts",
  );
  assert.match(page, /Create Module/);
  assert.match(page, /<Select[\s\S]*label="Course"/);
  assert.match(page, /courses\.data\?\.map/);
  assert.match(page, /moduleCreation\.isPending/);
  assert.match(page, /Module created successfully/);
  assert.doesNotMatch(page, /moduleCreation\.error\.message|\.stack\b/);
  assert.match(
    repository,
    /"courses"[\s\S]*proposal\.courseId[\s\S]*"modules"[\s\S]*proposal\.moduleId/,
  );
  assert.match(repository, /runTransaction/);
  assert.match(repository, /transaction\.get/);
  assert.match(
    repository,
    /transaction\.set\(reference,\s*proposal\.document\)/,
  );
  assert.doesNotMatch(repository, /updateDoc|deleteDoc|addDoc|merge\s*:/);
});

test("admin Module mapper accepts exact data and rejects malformed documents", async () => {
  const { mapAdminModuleDocument } =
    await import("../src/features/admin/adminModuleMapper.ts");
  assert.deepEqual(
    mapAdminModuleDocument("motion", { title: "Motion", order: 0 }),
    { id: "motion", title: "Motion", order: 0 },
  );
  for (const [id, value] of [
    ["Unsafe/Path", { title: "Motion", order: 0 }],
    ["motion", { title: " Motion", order: 0 }],
    ["motion", { title: "Motion", order: -1 }],
    ["motion", { title: "Motion", order: 1.5 }],
    ["motion", { title: "Motion", order: Number.MAX_SAFE_INTEGER + 1 }],
    ["motion", { title: "Motion", order: 0, status: "published" }],
  ]) {
    assert.throws(() => mapAdminModuleDocument(id, value));
  }
});

test("admin Module repository is fixed-path, read-only, validated, and deterministic", async () => {
  const repository = await source(
    "../src/features/admin/adminModuleRepository.ts",
  );
  assert.match(repository, /isCanonicalAdminModuleId\(courseId\)/);
  assert.match(
    repository,
    /collection\(firebaseDb,\s*"courses",\s*courseId,\s*"modules"\)/,
  );
  assert.match(repository, /mapAdminModuleDocument/);
  assert.match(repository, /left\.order\s*-\s*right\.order/);
  assert.match(repository, /left\.id\s*<\s*right\.id/);
  assert.doesNotMatch(
    repository,
    /\b(?:setDoc|updateDoc|addDoc|deleteDoc|runTransaction|writeBatch)\b/,
  );
});

test("owner-selected Course loads a sanitized read-only Module inventory", async () => {
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  assert.match(
    page,
    /queryFn:\s*\(\)\s*=>\s*getAdminModules\(moduleCourseId\)/,
  );
  assert.match(page, /enabled:\s*moduleCourseId\s*!==\s*""/);
  assert.match(page, /Loading Modules/);
  assert.match(page, /No Modules/);
  assert.match(page, /Unable to load Modules/);
  assert.match(page, /Owner authorization is required to view Modules/);
  assert.match(page, /Module inventory data is malformed/);
  assert.match(page, /modules\.data\.map/);
  assert.match(page, /module\.title/);
  assert.match(page, /module\.id/);
  assert.match(page, /module\.order/);
  assert.doesNotMatch(page, /modules\.error\.message|modules\.error\.stack/);
  assert.doesNotMatch(page, /Edit Module|Delete Module|Reorder Module/);
});

test("successful Module creation refreshes only the selected Course inventory", async () => {
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  assert.match(
    page,
    /moduleCreation[\s\S]*?onSuccess:\s*async[\s\S]*?invalidateQueries\([\s\S]*?"admin"[\s\S]*?moduleCourseId[\s\S]*?"modules"[\s\S]*?"inventory"/,
  );
});

test("admin Session mapper returns sanitized metadata and validates known schema", async () => {
  const { Timestamp } = await import("firebase/firestore");
  const { mapAdminSessionDocument } =
    await import("../src/features/admin/adminSessionMapper.ts");
  const releaseAt = Timestamp.fromDate(new Date("2030-01-01T00:00:00.000Z"));
  assert.deepEqual(
    mapAdminSessionDocument("introduction", "mechanics", "motion", {
      title: "Introduction",
      order: 1,
      publicationStatus: "published",
      releaseAt,
      lessonText: "Protected lesson.",
      videoAssetId: "motion-video",
      futureOptionalField: "preserved-by-established-contract",
    }),
    {
      id: "introduction",
      title: "Introduction",
      order: 1,
      publicationStatus: "published",
      releaseAt: "2030-01-01T00:00:00.000Z",
      hasLessonText: true,
      hasVideo: true,
    },
  );
  for (const [id, value] of [
    ["Unsafe/Path", { title: "Session", order: 0, publicationStatus: "draft" }],
    ["session", { title: "", order: 0, publicationStatus: "draft" }],
    ["session", { title: "Session", order: -1, publicationStatus: "draft" }],
    ["session", { title: "Session", order: 0, publicationStatus: "preview" }],
    [
      "session",
      {
        title: "Session",
        order: 0,
        publicationStatus: "draft",
        releaseAt: null,
      },
    ],
    [
      "session",
      {
        title: "Session",
        order: 0,
        publicationStatus: "draft",
        lessonText: " trimmed ",
      },
    ],
    [
      "session",
      {
        title: "Session",
        order: 0,
        publicationStatus: "draft",
        videoAssetId: "INVALID",
      },
    ],
  ]) {
    assert.throws(() =>
      mapAdminSessionDocument(id, "mechanics", "motion", value),
    );
  }
});

test("admin Session repository is fixed-path, read-only, isolated, and deterministic", async () => {
  const repository = await source(
    "../src/features/admin/adminSessionRepository.ts",
  );
  assert.match(repository, /isCanonicalAdminModuleId\(courseId\)/);
  assert.match(repository, /isCanonicalAdminModuleId\(moduleId\)/);
  assert.match(
    repository,
    /collection\([\s\S]*firebaseDb[\s\S]*"courses"[\s\S]*courseId[\s\S]*"modules"[\s\S]*moduleId[\s\S]*"sessions"/,
  );
  assert.match(repository, /mapAdminSessionDocument/);
  assert.match(repository, /left\.order\s*-\s*right\.order/);
  assert.match(repository, /left\.id\s*<\s*right\.id/);
  assert.doesNotMatch(repository, /sessionDiscovery|videoAccess/);
  assert.doesNotMatch(
    repository,
    /\b(?:setDoc|updateDoc|addDoc|deleteDoc|runTransaction|writeBatch)\b/,
  );
});

test("admin Session UI scopes selection and renders only safe inventory states", async () => {
  const page = await source("../src/pages/admin/AdminCoursesPage.tsx");
  assert.match(page, /getAdminSessions\(moduleCourseId,\s*selectedModuleId\)/);
  assert.match(
    page,
    /setModuleCourseId\(event\.target\.value\)[\s\S]*setSelectedModuleId\(""\)/,
  );
  assert.match(
    page,
    /enabled:[\s\S]*moduleCourseId\s*!==\s*""[\s\S]*selectedModuleId\s*!==\s*""/,
  );
  assert.match(page, /Select a Course before viewing Sessions/);
  assert.match(page, /Select a Module to view its Sessions/);
  assert.match(page, /Loading Sessions/);
  assert.match(page, /No Sessions/);
  assert.match(page, /Unable to load Sessions/);
  assert.match(page, /Session inventory data is malformed/);
  assert.match(page, /session\.hasLessonText/);
  assert.match(page, /session\.hasVideo/);
  assert.match(page, /session\.releaseAt/);
  assert.doesNotMatch(page, /session\.lessonText|session\.videoAssetId/);
  assert.doesNotMatch(
    page,
    /Edit Session|Delete Session|Publish Session|Upload Video|Edit Lesson/,
  );
  assert.doesNotMatch(page, /sessions\.error\.message|sessions\.error\.stack/);
});

test("admin frontend introduces no update, delete, random-ID, or privileged SDK API", async () => {
  const paths = [
    "../src/pages/admin/AdminLayout.tsx",
    "../src/pages/admin/AdminOverviewPage.tsx",
    "../src/pages/admin/AdminCoursesPage.tsx",
    "../src/features/admin/adminCourseRepository.ts",
    "../src/features/admin/adminCourseMapper.ts",
    "../src/features/admin/adminCourseCreation.ts",
    "../src/features/admin/adminCourseCreationValidation.ts",
    "../src/features/admin/adminModuleCreation.ts",
    "../src/features/admin/adminModuleCreationValidation.ts",
    "../src/features/admin/adminModuleRepository.ts",
    "../src/features/admin/adminModuleMapper.ts",
    "../src/features/admin/adminSessionRepository.ts",
    "../src/features/admin/adminSessionMapper.ts",
    "../src/features/auth/AuthProvider.tsx",
    "../src/features/auth/AuthGuards.tsx",
  ];
  const combined = (await Promise.all(paths.map(source))).join("\n");
  assert.doesNotMatch(
    combined,
    /\b(?:updateDoc|addDoc|deleteDoc|writeBatch)\b/,
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
