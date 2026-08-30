import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapSessionDocument } from "../src/features/courses/sessionMapper.ts";
import { mapFreeSessionDiscoveryManifest } from "../src/features/courses/sessionDiscovery.ts";

const session = { title: "Sample", order: 1, publicationStatus: "published", lessonText: "Public sample." };

test("Session mapping defaults absent isFree to paid and preserves explicit false/true", () => {
  assert.equal(mapSessionDocument("sample", "mechanics", "motion", session).isFree, false);
  assert.equal(mapSessionDocument("sample", "mechanics", "motion", { ...session, isFree: false }).isFree, false);
  assert.equal(mapSessionDocument("sample", "mechanics", "motion", { ...session, isFree: true }).isFree, true);
  assert.throws(() => mapSessionDocument("sample", "mechanics", "motion", { ...session, isFree: "true" }));
});

test("public Free Session projection accepts only minimized deterministic display records", () => {
  assert.deepEqual(mapFreeSessionDiscoveryManifest({ sessions: [{ id: "sample", title: "Sample", order: 1 }] }), [
    { id: "sample", title: "Sample", order: 1 },
  ]);
  for (const value of [
    { sessions: [{ id: "sample", title: "Sample", order: 1, contentKey: "secret" }] },
    { sessions: [{ id: "../sample", title: "Sample", order: 1 }] },
    { sessions: [{ id: "sample", title: "Sample", order: 1 }, { id: "sample", title: "Again", order: 2 }] },
  ]) assert.throws(() => mapFreeSessionDiscoveryManifest(value));
});

test("public UI exposes Opened Sessions from Home without public PDF downloads", async () => {
  const [homePage, coursePage, sessionPage, repository, router] = await Promise.all([
    readFile(new URL("../src/pages/home/HomePage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/courses/CourseDetailPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/courses/SessionDetailPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/courses/courseRepository.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/router/AppRouter.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(homePage, /Opened Sessions/);
  assert.match(homePage, /getPublicFreeSessionsForCourses/);
  assert.match(homePage, /buildSessionDetailPath/);
  assert.doesNotMatch(coursePage, /Free sessions|getPublicFreeSessions/);
  assert.match(
    router,
    /path="courses\/:slug\/modules\/:moduleId\/sessions\/:sessionId"\s*element={<SessionDetailPage \/>}/,
  );
  assert.match(sessionPage, /getPublicFreeSessionDetail/);
  assert.match(sessionPage, /publicFreeAccess/);
  assert.match(sessionPage, /entitled \? \(/);
  assert.match(sessionPage, /SessionResourceList/);
  assert.match(sessionPage, /entitled \? \([\s\S]*?<SessionResourceList/);
  assert.match(repository, /FREE_SESSION_DISCOVERY_DOCUMENT_ID/);
  assert.doesNotMatch(repository, /collectionGroup/);
  assert.doesNotMatch(homePage + coursePage + sessionPage + repository, /contentKey/);
});

test("Home has no unverified numeric marketing claims", async () => {
  const homePage = await readFile(
    new URL("../src/pages/home/HomePage.tsx", import.meta.url),
    "utf8",
  );
  for (const claim of ["500+", 'value: "12"', "150+", "200+"]) {
    assert.doesNotMatch(homePage, new RegExp(claim.replace("+", "\\+")));
  }
  assert.match(homePage, /Concept-first/);
  assert.match(homePage, /Protected playback/);
});
