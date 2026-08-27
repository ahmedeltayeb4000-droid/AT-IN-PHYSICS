import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import test from "node:test";
import type { Auth } from "firebase-admin/auth";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import {
  buildOwnerCourseInventory,
  buildOwnerModuleInventory,
  buildOwnerSessionInventory,
} from "../src/ownerConsole/inventory.js";
import {
  createOwnerConsoleServer,
  listenOwnerConsole,
  OWNER_CONSOLE_HOST,
} from "../src/ownerConsole/server.js";
import type { SessionPublicationResult } from "../src/tooling/sessionPublication.js";
import type { CourseCreationOptions } from "../src/tooling/courseCreation.js";
import type { ModuleCreationOptions } from "../src/tooling/moduleCreation.js";
import type { SessionCreationOptions } from "../src/tooling/sessionCreation.js";

const course = (id: string, title = "Course") => ({
  id,
  data: { slug: id, title, shortDescription: "Description", status: "draft" },
});
const publication = (apply: boolean): SessionPublicationResult => ({
  sessionPath: "courses/course/modules/module/sessions/session",
  currentPublicationState: apply ? "published" : "draft",
  proposedPublicationState: "published",
  releaseState: "IMMEDIATE",
  contentReadiness: "LESSON",
  currentDiscoveryState: apply ? "CURRENT" : "MISSING",
  proposedSessionIds: ["session"],
  sessionChangeRequired: !apply,
  discoveryChangeRequired: !apply,
  changeRequired: !apply,
  applyStatus: apply ? "published" : null,
  postApplyVerified: apply,
});

test("inventory DTOs validate, minimize, and deterministically order trusted state", () => {
  assert.deepEqual(
    buildOwnerCourseInventory([course("z", "Beta"), course("a", "Alpha")]).map(
      (x) => x.id,
    ),
    ["a", "z"],
  );
  assert.deepEqual(
    buildOwnerModuleInventory([
      { id: "z", data: { title: "Z", order: 1 } },
      { id: "a", data: { title: "A", order: 0 } },
    ]).map((x) => x.id),
    ["a", "z"],
  );
  const sessions = buildOwnerSessionInventory(
    [
      {
        id: "video",
        data: {
          title: "Video",
          order: 2,
          publicationStatus: "draft",
          videoAssetId: "asset",
          lessonText: "SECRET LESSON",
        },
      },
      {
        id: "future",
        data: {
          title: "Future",
          order: 1,
          publicationStatus: "published",
          releaseAt: Timestamp.fromDate(new Date("2031-01-01")),
        },
      },
    ],
    new Date("2030-01-01"),
  );
  assert.deepEqual(
    sessions.map((x) => x.id),
    ["future", "video"],
  );
  assert.equal(sessions[0]?.release, "scheduled");
  assert.deepEqual(Object.keys(sessions[1]!).sort(), [
    "hasLesson",
    "hasVideo",
    "id",
    "order",
    "publicationStatus",
    "release",
    "title",
  ]);
  assert.equal(JSON.stringify(sessions).includes("SECRET LESSON"), false);
  assert.equal(JSON.stringify(sessions).includes("asset"), false);
  assert.throws(() =>
    buildOwnerCourseInventory([
      { ...course("bad"), data: { ...course("bad").data, extra: true } },
    ]),
  );
  assert.throws(() =>
    buildOwnerModuleInventory([
      { id: "bad", data: { title: "Bad", order: -1 } },
    ]),
  );
  assert.throws(() =>
    buildOwnerSessionInventory([
      {
        id: "bad",
        data: { title: "Bad", order: 0, publicationStatus: "preview" },
      },
    ]),
  );
});

test("server is loopback-only and enforces Host, Origin, CSRF, one-time review, and sanitized responses", async () => {
  let authorizeCalls = 0;
  let publishCalls = 0;
  let mutationCalls = 0;
  const fakeDb = {
    collection: () => ({ get: async () => ({ docs: [] }) }),
  } as unknown as Firestore;
  const fakeAuth = {} as Auth;
  const publish = (async (_a, _d, options) => {
    publishCalls += 1;
    if (options.apply) mutationCalls += 1;
    return publication(options.apply);
  }) as NonNullable<Parameters<typeof createOwnerConsoleServer>[0]["publish"]>;
  const { server, csrfForTests } = createOwnerConsoleServer({
    auth: fakeAuth,
    db: fakeDb,
    ownerUid: "owner",
    projectId: "demo-at-in-physics",
    authorize: async () => {
      authorizeCalls += 1;
    },
    publish,
  });
  const address = await listenOwnerConsole(server, 0);
  assert.equal(address.address, OWNER_CONSOLE_HOST);
  const origin = `http://${OWNER_CONSOLE_HOST}:${address.port}`;
  try {
    const badHostStatus = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          hostname: OWNER_CONSOLE_HOST,
          port: address.port,
          path: "/",
          headers: { host: `localhost:${address.port}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(badHostStatus, 403);
    const inventory = await fetch(`${origin}/api/courses`);
    assert.equal(inventory.status, 200);
    assert.equal(mutationCalls, 0);
    assert.equal(inventory.headers.get("access-control-allow-origin"), null);
    const missing = await fetch(`${origin}/api/publication/review`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(missing.status, 403);
    const invalid = await fetch(`${origin}/api/publication/review`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-owner-control-csrf": "wrong",
      },
      body: "{}",
    });
    assert.equal(invalid.status, 403);
    const reviewResponse = await fetch(`${origin}/api/publication/review`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-owner-control-csrf": csrfForTests,
      },
      body: JSON.stringify({
        courseId: "course",
        moduleId: "module",
        sessionId: "session",
      }),
    });
    assert.equal(reviewResponse.status, 200);
    assert.equal(mutationCalls, 0);
    const review = (await reviewResponse.json()) as {
      reviewId: string;
      review: unknown;
    };
    assert.equal(JSON.stringify(review).includes(csrfForTests), false);
    const apply = () =>
      fetch(`${origin}/api/publication/apply`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-owner-control-csrf": csrfForTests,
        },
        body: JSON.stringify({ reviewId: review.reviewId }),
      });
    assert.equal((await apply()).status, 200);
    assert.equal(mutationCalls, 1);
    assert.equal((await apply()).status, 409);
    assert.equal(mutationCalls, 1);
    assert.equal(authorizeCalls, 3);
    assert.equal(publishCalls, 3);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("authority failure and stale review fail closed before apply", async () => {
  const fakeDb = {
    collection: () => ({ get: async () => ({ docs: [] }) }),
  } as unknown as Firestore;
  let permitted = false;
  let revision = 0;
  let applies = 0;
  const publish = (async (_a, _d, options) => {
    if (options.apply) applies += 1;
    const result = publication(options.apply);
    return {
      ...result,
      proposedSessionIds: revision++ === 0 ? ["session"] : ["changed"],
    };
  }) as NonNullable<Parameters<typeof createOwnerConsoleServer>[0]["publish"]>;
  const { server, csrfForTests } = createOwnerConsoleServer({
    auth: {} as Auth,
    db: fakeDb,
    ownerUid: "owner",
    projectId: "demo-at-in-physics",
    authorize: async () => {
      if (!permitted) throw new Error("not owner");
    },
    publish,
  });
  const address = await listenOwnerConsole(server, 0);
  const origin = `http://${OWNER_CONSOLE_HOST}:${address.port}`;
  const post = (path: string, value: unknown) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-owner-control-csrf": csrfForTests,
      },
      body: JSON.stringify(value),
    });
  try {
    assert.equal(
      (
        await post("/api/publication/review", {
          courseId: "course",
          moduleId: "module",
          sessionId: "session",
        })
      ).status,
      400,
    );
    permitted = true;
    const review = (await (
      await post("/api/publication/review", {
        courseId: "course",
        moduleId: "module",
        sessionId: "session",
      })
    ).json()) as { reviewId: string };
    assert.equal(
      (await post("/api/publication/apply", { reviewId: review.reviewId }))
        .status,
      409,
    );
    assert.equal(applies, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("creation endpoints pass only validated minimum contracts to trusted services", async () => {
  const courses: CourseCreationOptions[] = [];
  const modules: ModuleCreationOptions[] = [];
  const createdSessions: SessionCreationOptions[] = [];
  const fakeDb = {} as Firestore;
  const { server, csrfForTests } = createOwnerConsoleServer({
    auth: {} as Auth,
    db: fakeDb,
    ownerUid: "trusted-owner",
    projectId: "demo-at-in-physics",
    authorize: async () => {},
    createCourse: async (_auth, _db, options, uid) => {
      assert.equal(uid, "trusted-owner");
      courses.push(options);
      return {
        coursePath: `courses/${options.courseId}`,
        currentCourse: "MISSING",
        changeRequired: true,
        applyStatus: "created",
        postApplyVerified: true,
      };
    },
    createModule: async (_auth, _db, options, uid) => {
      assert.equal(uid, "trusted-owner");
      modules.push(options);
      return {
        modulePath: `courses/${options.courseId}/modules/${options.moduleId}`,
        currentModule: "MISSING",
        proposedTitle: options.title,
        proposedOrder: options.order,
        changeRequired: true,
        applyStatus: "created",
        postApplyVerified: true,
      };
    },
    createSession: async (_auth, _db, options, uid) => {
      assert.equal(uid, "trusted-owner");
      createdSessions.push(options);
      return {
        sessionPath: `courses/${options.courseId}/modules/${options.moduleId}/sessions/${options.sessionId}`,
        currentSession: "MISSING",
        proposedTitle: options.title,
        proposedOrder: options.order,
        proposedPublicationStatus: "draft",
        changeRequired: true,
        applyStatus: "created",
        postApplyVerified: true,
      };
    },
  });
  const address = await listenOwnerConsole(server, 0);
  const origin = `http://${OWNER_CONSOLE_HOST}:${address.port}`;
  const post = (
    path: string,
    value: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(origin + path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-owner-control-csrf": csrfForTests,
        ...headers,
      },
      body: JSON.stringify(value),
    });
  try {
    assert.equal(
      (
        await post("/api/courses/create", {
          courseId: "physics",
          title: "Physics",
          shortDescription: "Core course",
        })
      ).status,
      200,
    );
    assert.deepEqual(courses, [
      {
        courseId: "physics",
        title: "Physics",
        shortDescription: "Core course",
        apply: true,
      },
    ]);
    assert.equal(
      (
        await post("/api/modules/create", {
          courseId: "physics",
          moduleId: "motion",
          title: "Motion",
          order: "0",
        })
      ).status,
      200,
    );
    assert.deepEqual(modules, [
      {
        courseId: "physics",
        moduleId: "motion",
        title: "Motion",
        order: 0,
        apply: true,
      },
    ]);
    assert.equal(
      (
        await post("/api/sessions/create", {
          courseId: "physics",
          moduleId: "motion",
          sessionId: "speed",
          title: "Speed",
          order: "1",
        })
      ).status,
      200,
    );
    assert.deepEqual(createdSessions, [
      {
        courseId: "physics",
        moduleId: "motion",
        sessionId: "speed",
        title: "Speed",
        order: 1,
        apply: true,
      },
    ]);
    for (const injected of [
      { courseId: "bad/path", title: "Bad", shortDescription: "Bad" },
      {
        courseId: "physics",
        title: "Physics",
        shortDescription: "Core",
        status: "published",
      },
      {
        courseId: "physics",
        title: "Physics",
        shortDescription: "Core",
        ownerUid: "attacker",
      },
      {
        courseId: "physics",
        title: "Physics",
        shortDescription: "Core",
        projectId: "other",
      },
      {
        courseId: "physics",
        title: "Physics",
        shortDescription: "Core",
        path: "courses/other",
      },
    ])
      assert.equal((await post("/api/courses/create", injected)).status, 400);
    assert.equal(courses.length, 1);
    assert.equal(
      (
        await post("/api/modules/create", {
          courseId: "physics",
          moduleId: "motion",
          title: "Motion",
          order: "-1",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/api/sessions/create", {
          courseId: "physics",
          moduleId: "motion",
          sessionId: "speed",
          title: "Speed",
          order: "1",
          publicationStatus: "published",
        })
      ).status,
      400,
    );
    assert.equal(modules.length, 1);
    assert.equal(createdSessions.length, 1);
    assert.equal(
      (
        await post(
          "/api/courses/create",
          { courseId: "x", title: "X", shortDescription: "X" },
          { origin: "http://evil.example" },
        )
      ).status,
      403,
    );
    const nonJson = await fetch(origin + "/api/courses/create", {
      method: "POST",
      headers: {
        origin,
        "content-type": "text/plain",
        "x-owner-control-csrf": csrfForTests,
      },
      body: "{}",
    });
    assert.equal(nonJson.status, 415);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("creation failures are sanitized and existing forms refresh inventories without page reload", async () => {
  let authorized = false;
  let creationCalls = 0;
  const { server, csrfForTests } = createOwnerConsoleServer({
    auth: {} as Auth,
    db: {} as Firestore,
    ownerUid: "owner",
    projectId: "demo-at-in-physics",
    authorize: async () => {
      if (!authorized) throw new Error("not owner");
    },
    createCourse: async () => {
      creationCalls += 1;
      throw new Error("RAW_FIREBASE_SECRET_ERROR");
    },
  });
  const address = await listenOwnerConsole(server, 0);
  const origin = `http://${OWNER_CONSOLE_HOST}:${address.port}`;
  try {
    const create = () =>
      fetch(origin + "/api/courses/create", {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-owner-control-csrf": csrfForTests,
        },
        body: JSON.stringify({
          courseId: "course",
          title: "Course",
          shortDescription: "Description",
        }),
      });
    assert.equal((await create()).status, 400);
    assert.equal(creationCalls, 0);
    authorized = true;
    const response = await create();
    const text = await response.text();
    assert.equal(response.status, 400);
    assert.equal(text.includes("RAW_FIREBASE_SECRET_ERROR"), false);
    const html = await (await fetch(origin)).text();
    const js = await (await fetch(origin + "/app.js")).text();
    assert.match(html, /id="courseForm"/);
    assert.match(html, /id="moduleForm"/);
    assert.match(html, /id="sessionForm"/);
    assert.match(js, /loadCourses\(x\.courseId\)/);
    assert.match(js, /loadModules\(x\.moduleId\)/);
    assert.match(js, /await loadSessions\(\)/);
    assert.doesNotMatch(js, /location\.reload|window\.location/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Windows launcher is local-only and contains no credentials, deploy, or service commands", async () => {
  const launcher = await readFile(
    new URL("../../../START-OWNER-CONTROL.cmd", import.meta.url),
    "utf8",
  );
  assert.match(launcher, /npm run owner:control/);
  assert.doesNotMatch(
    launcher,
    /service-account|private[-_ ]key|owner[_-]uid|firebase deploy|functions:config|0\.0\.0\.0/i,
  );
});
