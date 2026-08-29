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

test("public UI exposes FREE navigation and explicit free-or-enrolled content without public PDF downloads", async () => {
  const [coursePage, sessionPage, repository] = await Promise.all([
    readFile(new URL("../src/pages/courses/CourseDetailPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/courses/SessionDetailPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/courses/courseRepository.ts", import.meta.url), "utf8"),
  ]);
  assert.match(coursePage, /Free sessions/);
  assert.match(coursePage, />FREE</);
  assert.match(sessionPage, /getPublicFreeSessionDetail/);
  assert.match(sessionPage, /publicFreeAccess/);
  assert.match(sessionPage, /entitled \? \(/);
  assert.match(sessionPage, /SessionResourceList/);
  assert.match(repository, /FREE_SESSION_DISCOVERY_DOCUMENT_ID/);
  assert.doesNotMatch(repository, /collectionGroup/);
  assert.doesNotMatch(coursePage + sessionPage + repository, /contentKey/);
});
