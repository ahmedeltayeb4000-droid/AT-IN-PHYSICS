import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import { validateLessonText } from "../lessonContent/validation.js";
import {
  MAX_VIDEO_INPUT_SIZE,
  validateVideoAssetId,
} from "../tooling/videoPackaging.js";
import {
  runLessonContentPublication,
  type LessonContentPublicationResult,
} from "../tooling/lessonContentPublication.js";
import {
  runCourseCreationService,
  safeCourseCreationSummary,
} from "../tooling/courseCreation.js";
import { requireOwnerAuthority } from "../tooling/enrollmentGrant.js";
import {
  runModuleCreationService,
  safeModuleCreationSummary,
  validateModuleOrder,
} from "../tooling/moduleCreation.js";
import {
  runSessionCreationService,
  safeSessionCreationSummary,
} from "../tooling/sessionCreation.js";
import {
  runSessionPublicationService,
  safeSessionPublicationSummary,
  type SessionPublicationResult,
} from "../tooling/sessionPublication.js";
import {
  readOwnerCourses,
  readOwnerLessonContent,
  readOwnerModules,
  readOwnerSessions,
} from "./inventory.js";
import { LESSON_CLIENT_JS } from "./lessonClient.js";
import {
  prepareOwnerProtectedVideo,
  validateOwnerVideoFileName,
} from "./videoPreparation.js";
import { VIDEO_CLIENT_JS } from "./videoClient.js";
import { VIDEO_DEPLOY_CLIENT_JS } from "./videoDeployClient.js";
import {
  preflightOwnerHostingRelease,
  prepareOwnerHostingRelease,
  type OwnerPreparedVideo,
  type OwnerReleaseReview,
} from "./videoRelease.js";
import {
  createOwnerDeployReview,
  executeOwnerHostingDeployment,
  HOSTING_DEPLOY_CONFIRMATION,
  retryOwnerRemoteVerification,
  type OwnerDeployReview,
} from "./videoDeployment.js";

export const OWNER_CONSOLE_HOST = "127.0.0.1";
export const OWNER_CONSOLE_DEFAULT_PORT = 4317;
const MAX_BODY = 4096;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

export type OwnerConsoleDependencies = Readonly<{
  auth: Auth;
  db: Firestore;
  ownerUid: string;
  projectId: string;
  now?: () => Date;
  publish?: typeof runSessionPublicationService;
  createCourse?: typeof runCourseCreationService;
  createModule?: typeof runModuleCreationService;
  createSession?: typeof runSessionCreationService;
  authorize?: typeof requireOwnerAuthority;
  publishLesson?: typeof runLessonContentPublication;
  readLesson?: typeof readOwnerLessonContent;
  prepareVideo?: typeof prepareOwnerProtectedVideo;
  prepareVideoRelease?: typeof prepareOwnerHostingRelease;
  preflightVideoRelease?: typeof preflightOwnerHostingRelease;
  createDeployReview?: typeof createOwnerDeployReview;
  deployHosting?: typeof executeOwnerHostingDeployment;
  retryRemoteVerification?: typeof retryOwnerRemoteVerification;
}>;

type Review = {
  ids: { courseId: string; moduleId: string; sessionId: string };
  fingerprint: string;
  used: boolean;
};
type LessonReview = {
  target: { courseId: string; moduleId: string; sessionId: string };
  lessonText: string;
  revisionMillis: number;
  used: boolean;
};

function fingerprint(result: SessionPublicationResult): string {
  return createHash("sha256")
    .update(JSON.stringify(safeSessionPublicationSummary(result)))
    .digest("hex");
}
function safeLessonReview(
  current: Awaited<ReturnType<typeof readOwnerLessonContent>>,
  result: LessonContentPublicationResult,
  lessonText: string,
) {
  return {
    courseId: current.courseId,
    moduleId: current.moduleId,
    sessionId: current.sessionId,
    sessionTitle: current.sessionTitle,
    publicationStatus: current.publicationStatus,
    operation:
      result.inspection.currentState === "ABSENT" ? "ADDING" : "REPLACING",
    currentCharacterCount: result.inspection.currentCharacterCount,
    proposedCharacterCount: result.inspection.proposedCharacterCount,
    changeRequired: result.inspection.changeRequired,
    preview: lessonText.slice(0, 240),
  };
}
function equalToken(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function send(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers = JSON_HEADERS,
) {
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
function fail(res: ServerResponse, status = 400) {
  send(res, status, {
    error:
      "Owner Control could not complete the request. Refresh and verify the selected item.",
  });
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (raw.length > MAX_BODY) throw new Error("Request too large.");
  }
  const value: unknown = JSON.parse(raw || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request.");
  return value as Record<string, unknown>;
}

async function videoBody(req: IncomingMessage): Promise<Buffer> {
  const declared = Number(req.headers["content-length"]);
  if (
    !Number.isSafeInteger(declared) ||
    declared <= 0 ||
    declared > MAX_VIDEO_INPUT_SIZE
  )
    throw new Error("Video upload size is invalid.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_VIDEO_INPUT_SIZE)
      throw new Error("Video upload is too large.");
    chunks.push(bytes);
  }
  if (size !== declared) throw new Error("Video upload was incomplete.");
  return Buffer.concat(chunks);
}

function exactInput(
  input: Record<string, unknown>,
  fields: readonly string[],
): void {
  const actual = Object.keys(input).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  )
    throw new Error("Invalid creation request.");
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid creation request.");
  return value;
}

export function createOwnerConsoleServer(deps: OwnerConsoleDependencies) {
  const csrf = randomBytes(32).toString("base64url");
  const reviews = new Map<string, Review>();
  const lessonReviews = new Map<string, LessonReview>();
  const now = deps.now ?? (() => new Date());
  const publish = deps.publish ?? runSessionPublicationService;
  const createCourse = deps.createCourse ?? runCourseCreationService;
  const createModule = deps.createModule ?? runModuleCreationService;
  const createSession = deps.createSession ?? runSessionCreationService;
  const authorize = deps.authorize ?? requireOwnerAuthority;
  const publishLesson = deps.publishLesson ?? runLessonContentPublication;
  const readLesson = deps.readLesson ?? readOwnerLessonContent;
  const prepareVideo = deps.prepareVideo ?? prepareOwnerProtectedVideo;
  const prepareVideoRelease =
    deps.prepareVideoRelease ?? prepareOwnerHostingRelease;
  const preflightVideoRelease =
    deps.preflightVideoRelease ?? preflightOwnerHostingRelease;
  const createDeployReview = deps.createDeployReview ?? createOwnerDeployReview;
  const deployHosting = deps.deployHosting ?? executeOwnerHostingDeployment;
  const retryRemoteVerification =
    deps.retryRemoteVerification ?? retryOwnerRemoteVerification;
  const preparedVideos = new Map<string, OwnerPreparedVideo>();
  const videoReleases = new Map<string, OwnerReleaseReview>();
  const preflightedVideoReleases = new Set<string>();
  const deployReviews = new Map<
    string,
    { review: OwnerDeployReview; used: boolean }
  >();
  const deployedVideoReleases = new Map<string, OwnerDeployReview>();
  const server = createServer(async (req, res) => {
    const address = server.address() as AddressInfo | null;
    const origin = `http://${OWNER_CONSOLE_HOST}:${address?.port ?? OWNER_CONSOLE_DEFAULT_PORT}`;
    const host = req.headers.host;
    if (host !== `${OWNER_CONSOLE_HOST}:${address?.port}`)
      return fail(res, 403);
    const url = new URL(req.url ?? "/", origin);
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy":
            "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          "set-cookie":
            "owner-control=active; HttpOnly; SameSite=Strict; Path=/",
        });
        return res.end(renderOwnerConsole(deps.projectId));
      }
      if (req.method === "GET" && url.pathname === "/app.js") {
        res.writeHead(200, {
          ...JSON_HEADERS,
          "content-type": "text/javascript; charset=utf-8",
        });
        return res.end(
          `${CLIENT_JS}\n${LESSON_CLIENT_JS}\n${VIDEO_CLIENT_JS.replaceAll("\n", "\\n")}\n${VIDEO_DEPLOY_CLIENT_JS.replaceAll("\n", "\\n")}`,
        );
      }
      if (req.method === "GET" && url.pathname === "/api/bootstrap")
        return send(res, 200, { projectId: deps.projectId, csrf });
      if (req.method === "GET" && url.pathname === "/api/courses")
        return send(res, 200, { courses: await readOwnerCourses(deps.db) });
      if (req.method === "GET" && url.pathname === "/api/modules")
        return send(res, 200, {
          modules: await readOwnerModules(
            deps.db,
            url.searchParams.get("courseId") ?? "",
          ),
        });
      if (req.method === "GET" && url.pathname === "/api/sessions")
        return send(res, 200, {
          sessions: await readOwnerSessions(
            deps.db,
            url.searchParams.get("courseId") ?? "",
            url.searchParams.get("moduleId") ?? "",
          ),
        });
      if (req.method === "GET" && url.pathname === "/api/lesson") {
        await authorize(deps.auth, deps.ownerUid);
        const lesson = await readLesson(
          deps.db,
          url.searchParams.get("courseId") ?? "",
          url.searchParams.get("moduleId") ?? "",
          url.searchParams.get("sessionId") ?? "",
        );
        return send(res, 200, {
          lesson: {
            courseId: lesson.courseId,
            moduleId: lesson.moduleId,
            sessionId: lesson.sessionId,
            sessionTitle: lesson.sessionTitle,
            publicationStatus: lesson.publicationStatus,
            lessonText: lesson.lessonText,
            hasLesson: lesson.lessonText !== null,
          },
        });
      }
      if (req.method === "POST") {
        if (
          req.headers.origin !== origin ||
          typeof req.headers["x-owner-control-csrf"] !== "string" ||
          !equalToken(req.headers["x-owner-control-csrf"], csrf)
        )
          return fail(res, 403);
        if (url.pathname === "/api/video/prepare") {
          if (req.headers["content-type"] !== "video/mp4")
            return fail(res, 415);
          const expectedQuery = [
            "courseId",
            "moduleId",
            "sessionId",
            "videoAssetId",
          ];
          if (
            [...url.searchParams.keys()].sort().join("|") !==
            [...expectedQuery].sort().join("|")
          )
            return fail(res, 400);
          await authorize(deps.auth, deps.ownerUid);
          let originalFileName: string;
          try {
            originalFileName = decodeURIComponent(
              typeof req.headers["x-video-file-name"] === "string"
                ? req.headers["x-video-file-name"]
                : "",
            );
          } catch {
            return fail(res, 400);
          }
          const summary = await prepareVideo(deps.db, {
            courseId: validateCourseId(url.searchParams.get("courseId")),
            moduleId: validateCourseId(url.searchParams.get("moduleId")),
            sessionId: validateCourseId(url.searchParams.get("sessionId")),
            videoAssetId: validateVideoAssetId(
              url.searchParams.get("videoAssetId"),
            ),
            originalFileName: validateOwnerVideoFileName(originalFileName),
            bytes: await videoBody(req),
          });
          const preparationId = randomBytes(24).toString("base64url");
          preparedVideos.set(preparationId, { preparationId, summary });
          return send(res, 200, { preparationId, preparation: summary });
        }
        if (
          (req.headers["content-type"] ?? "").split(";", 1)[0] !==
          "application/json"
        )
          return fail(res, 415);
        const input = await body(req);
        if (url.pathname === "/api/video/release") {
          exactInput(input, ["preparationId"]);
          await authorize(deps.auth, deps.ownerUid);
          const preparationId = requiredString(input.preparationId);
          const prepared = preparedVideos.get(preparationId);
          if (!prepared) return fail(res, 409);
          const releaseId = randomBytes(24).toString("base64url");
          const release = await prepareVideoRelease(
            prepared,
            deps.projectId,
            releaseId,
          );
          videoReleases.set(releaseId, release);
          return send(res, 200, { releaseId, release: release.safe });
        }
        if (url.pathname === "/api/video/preflight") {
          exactInput(input, ["releaseId"]);
          await authorize(deps.auth, deps.ownerUid);
          const releaseId = requiredString(input.releaseId);
          const release = videoReleases.get(releaseId);
          if (!release) return fail(res, 409);
          const preflight = await preflightVideoRelease(
            release,
            deps.projectId,
          );
          preflightedVideoReleases.add(releaseId);
          return send(res, 200, { preflight });
        }
        if (url.pathname === "/api/video/deploy/review") {
          exactInput(input, ["releaseId"]);
          await authorize(deps.auth, deps.ownerUid);
          const releaseId = requiredString(input.releaseId);
          const release = videoReleases.get(releaseId);
          if (!release || !preflightedVideoReleases.has(releaseId))
            return fail(res, 409);
          const reviewId = randomBytes(24).toString("base64url");
          const review = await createDeployReview(
            release,
            deps.projectId,
            reviewId,
          );
          deployReviews.set(reviewId, { review, used: false });
          return send(res, 200, { reviewId, review: review.safe });
        }
        if (url.pathname === "/api/video/deploy/apply") {
          exactInput(input, ["reviewId", "confirmation"]);
          await authorize(deps.auth, deps.ownerUid);
          if (
            requiredString(input.confirmation) !== HOSTING_DEPLOY_CONFIRMATION
          )
            return fail(res, 400);
          const reviewId = requiredString(input.reviewId);
          const record = deployReviews.get(reviewId);
          if (!record || record.used) return fail(res, 409);
          record.used = true;
          const deploymentId = randomBytes(24).toString("base64url");
          const result = await deployHosting(
            record.review,
            deps.projectId,
            deploymentId,
          );
          deployReviews.delete(reviewId);
          if (result.deployCompleted)
            deployedVideoReleases.set(deploymentId, record.review);
          return send(res, 200, { deployment: result.safe });
        }
        if (url.pathname === "/api/video/deploy/verify") {
          exactInput(input, ["deploymentId"]);
          await authorize(deps.auth, deps.ownerUid);
          const deploymentId = requiredString(input.deploymentId);
          const review = deployedVideoReleases.get(deploymentId);
          if (!review) return fail(res, 409);
          const verification = await retryRemoteVerification(
            review,
            deploymentId,
          );
          return send(res, 200, { deployment: verification });
        }
        if (url.pathname === "/api/lesson/review") {
          exactInput(input, [
            "courseId",
            "moduleId",
            "sessionId",
            "lessonText",
          ]);
          await authorize(deps.auth, deps.ownerUid);
          const target = {
            courseId: validateCourseId(input.courseId),
            moduleId: validateCourseId(input.moduleId),
            sessionId: validateCourseId(input.sessionId),
          };
          const lessonText = validateLessonText(input.lessonText);
          const before = await readLesson(
            deps.db,
            target.courseId,
            target.moduleId,
            target.sessionId,
          );
          const result = await publishLesson(
            deps.db,
            target,
            lessonText,
            false,
          );
          const after = await readLesson(
            deps.db,
            target.courseId,
            target.moduleId,
            target.sessionId,
          );
          if (before.revisionMillis !== after.revisionMillis)
            return fail(res, 409);
          const reviewId = randomBytes(24).toString("base64url");
          lessonReviews.set(reviewId, {
            target,
            lessonText,
            revisionMillis: after.revisionMillis,
            used: false,
          });
          return send(res, 200, {
            reviewId,
            review: safeLessonReview(after, result, lessonText),
          });
        }
        if (url.pathname === "/api/lesson/apply") {
          exactInput(input, ["reviewId"]);
          await authorize(deps.auth, deps.ownerUid);
          const reviewId = requiredString(input.reviewId);
          const review = lessonReviews.get(reviewId);
          if (!review || review.used) return fail(res, 409);
          review.used = true;
          const current = await readLesson(
            deps.db,
            review.target.courseId,
            review.target.moduleId,
            review.target.sessionId,
          );
          if (current.revisionMillis !== review.revisionMillis)
            return fail(res, 409);
          const result = await publishLesson(
            deps.db,
            review.target,
            review.lessonText,
            true,
            review.revisionMillis,
          );
          lessonReviews.delete(reviewId);
          return send(res, 200, {
            result: {
              writeNecessary: result.writeNecessary,
              verified: result.verified,
            },
          });
        }
        if (url.pathname === "/api/courses/create") {
          exactInput(input, ["courseId", "title", "shortDescription"]);
          await authorize(deps.auth, deps.ownerUid);
          const result = await createCourse(
            deps.auth,
            deps.db,
            {
              courseId: validateCourseId(input.courseId),
              title: requiredString(input.title),
              shortDescription: requiredString(input.shortDescription),
              apply: true,
            },
            deps.ownerUid,
          );
          return send(res, 200, {
            result: safeCourseCreationSummary(result),
          });
        }
        if (url.pathname === "/api/modules/create") {
          exactInput(input, ["courseId", "moduleId", "title", "order"]);
          await authorize(deps.auth, deps.ownerUid);
          const result = await createModule(
            deps.auth,
            deps.db,
            {
              courseId: validateCourseId(input.courseId),
              moduleId: validateCourseId(input.moduleId),
              title: requiredString(input.title),
              order: validateModuleOrder(input.order),
              apply: true,
            },
            deps.ownerUid,
          );
          return send(res, 200, {
            result: safeModuleCreationSummary(result),
          });
        }
        if (url.pathname === "/api/sessions/create") {
          exactInput(input, [
            "courseId",
            "moduleId",
            "sessionId",
            "title",
            "order",
          ]);
          await authorize(deps.auth, deps.ownerUid);
          const result = await createSession(
            deps.auth,
            deps.db,
            {
              courseId: validateCourseId(input.courseId),
              moduleId: validateCourseId(input.moduleId),
              sessionId: validateCourseId(input.sessionId),
              title: requiredString(input.title),
              order: validateModuleOrder(input.order),
              apply: true,
            },
            deps.ownerUid,
          );
          return send(res, 200, {
            result: safeSessionCreationSummary(result),
          });
        }
        if (url.pathname === "/api/publication/review") {
          await authorize(deps.auth, deps.ownerUid);
          const ids = {
            courseId: validateCourseId(input.courseId),
            moduleId: validateCourseId(input.moduleId),
            sessionId: validateCourseId(input.sessionId),
          };
          const result = await publish(
            deps.auth,
            deps.db,
            { ...ids, apply: false },
            deps.ownerUid,
            now(),
          );
          const reviewId = randomBytes(24).toString("base64url");
          reviews.set(reviewId, {
            ids,
            fingerprint: fingerprint(result),
            used: false,
          });
          return send(res, 200, {
            reviewId,
            review: {
              ...safeSessionPublicationSummary(result),
              discoveryChangeRequired: result.discoveryChangeRequired,
            },
          });
        }
        if (url.pathname === "/api/publication/apply") {
          await authorize(deps.auth, deps.ownerUid);
          const reviewId =
            typeof input.reviewId === "string" ? input.reviewId : "";
          const review = reviews.get(reviewId);
          if (!review || review.used) return fail(res, 409);
          review.used = true;
          const fresh = await publish(
            deps.auth,
            deps.db,
            { ...review.ids, apply: false },
            deps.ownerUid,
            now(),
          );
          if (fingerprint(fresh) !== review.fingerprint) return fail(res, 409);
          const result = await publish(
            deps.auth,
            deps.db,
            { ...review.ids, apply: true },
            deps.ownerUid,
            now(),
          );
          reviews.delete(reviewId);
          return send(res, 200, {
            result: safeSessionPublicationSummary(result),
          });
        }
      }
      fail(res, 404);
    } catch {
      fail(res, 400);
    }
  });
  return { server, csrfForTests: csrf };
}

export async function listenOwnerConsole(
  server: ReturnType<typeof createServer>,
  port = OWNER_CONSOLE_DEFAULT_PORT,
) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, OWNER_CONSOLE_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address() as AddressInfo;
}

function renderOwnerConsole(projectId: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner Control</title><style>body{font:16px system-ui;margin:0;background:#f4f6fa;color:#18202b}main{max-width:960px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;align-items:center}section{background:white;padding:20px;margin:18px 0;border-radius:12px;box-shadow:0 2px 12px #0001}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}.grid label{display:flex;flex-direction:column;gap:5px}input,textarea,select,button{font:inherit;padding:10px}button{cursor:pointer;align-self:end}.badge{padding:3px 8px;border-radius:20px;background:#e6eaf0}.draft{background:#fff1bf}.published{background:#cef2d8}li{display:flex;gap:12px;align-items:center;padding:12px;border-bottom:1px solid #ddd;flex-wrap:wrap}.push{margin-left:auto}dialog{max-width:640px;width:calc(100% - 48px);border:0;border-radius:12px;padding:24px}dialog textarea{width:100%;min-height:300px;box-sizing:border-box}pre{white-space:pre-wrap;max-height:220px;overflow:auto;background:#f4f6fa;padding:12px}#message{min-height:24px;color:#a12424}.hint{color:#56606d;font-size:.9rem}@media(max-width:650px){header{display:block}.push{margin-left:0}}</style></head><body><main><header><h1>A.T IN PHYSICS Owner Control</h1><strong>Target: ${escapeHtml(projectId)}</strong></header><p id="message" role="status"></p><section><h2>Courses</h2><label>Existing Course <select id="course"><option value="">Select Course</option></select></label><h3>Create Course</h3><form id="courseForm" class="grid"><label>Course ID<input name="courseId" required maxlength="128" autocomplete="off"><span class="hint">Lowercase letters, numbers and hyphens.</span></label><label>Title<input name="title" required maxlength="160"></label><label>Short Description<textarea name="shortDescription" required maxlength="1000"></textarea></label><button>Create Course</button></form></section><section><h2>Modules</h2><label>Existing Module <select id="module" disabled><option value="">Select Module</option></select></label><h3>Create Module</h3><form id="moduleForm" class="grid"><label>Module ID<input name="moduleId" required maxlength="128" autocomplete="off"></label><label>Module Title<input name="title" required maxlength="160"></label><label>Order<input name="order" required type="number" min="0" step="1"></label><button disabled>Create Module</button></form></section><section><h2>Sessions</h2><ul id="sessions"><li>Select a Course and Module.</li></ul><h3>Create Session</h3><form id="sessionForm" class="grid"><label>Session ID<input name="sessionId" required maxlength="128" autocomplete="off"></label><label>Session Title<input name="title" required maxlength="160"></label><label>Order<input name="order" required type="number" min="0" step="1"></label><button disabled>Create Session</button></form></section><dialog id="lessonEditor"><h2>Edit Lesson</h2><p id="lessonTarget"></p><label>Lesson Content<textarea id="lessonText" required maxlength="20000"></textarea></label><p id="lessonCount" class="hint"></p><button id="lessonReviewButton">Review Changes</button><button id="lessonCancel">Cancel</button></dialog><dialog id="lessonReview"><h2>Review Lesson Changes</h2><p id="lessonReviewSummary"></p><pre id="lessonPreview"></pre><button id="lessonConfirm">Confirm Save</button><button id="lessonReviewCancel">Cancel</button></dialog><dialog id="review"><h2>Review publication</h2><div id="reviewBody"></div><button id="confirm">Confirm Publish</button><button id="cancel">Cancel</button></dialog></main><script src="/app.js" defer></script></body></html>`;
}
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

const CLIENT_JS = `let csrf,reviewId;const q=s=>document.querySelector(s),msg=q('#message'),course=q('#course'),module=q('#module'),sessions=q('#sessions'),dialog=q('#review'),courseForm=q('#courseForm'),moduleForm=q('#moduleForm'),sessionForm=q('#sessionForm');async function api(path,options={}){msg.textContent='Loading…';const r=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.method==='POST'?{'x-owner-control-csrf':csrf}:{}),...options.headers}});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed.');msg.textContent='';return d}function opt(x){const o=document.createElement('option');o.value=x.id;o.textContent=x.title+' ('+x.id+')';return o}async function loadCourses(selected=course.value){const d=await api('/api/courses');course.length=1;d.courses.forEach(x=>course.append(opt(x)));course.value=selected;if(selected)await loadModules()}async function loadModules(selected=module.value){module.length=1;sessions.innerHTML='<li>Select a Module.</li>';moduleForm.querySelector('button').disabled=!course.value;sessionForm.querySelector('button').disabled=true;if(!course.value){module.disabled=true;return}const d=await api('/api/modules?courseId='+encodeURIComponent(course.value));d.modules.forEach(x=>module.append(opt(x)));module.disabled=false;module.value=selected;sessionForm.querySelector('button').disabled=!module.value;if(module.value)await loadSessions()}course.onchange=()=>loadModules().catch(showError);module.onchange=()=>{sessionForm.querySelector('button').disabled=!module.value;loadSessions().catch(showError)};async function loadSessions(){if(!module.value)return;const d=await api('/api/sessions?courseId='+encodeURIComponent(course.value)+'&moduleId='+encodeURIComponent(module.value));sessions.innerHTML='';d.sessions.forEach(x=>{const li=document.createElement('li');li.textContent=x.order+' · '+x.title+' · '+x.release+' · lesson '+(x.hasLesson?'yes':'no')+' · video '+(x.hasVideo?'yes':'no');const badge=document.createElement('span');badge.className='badge '+x.publicationStatus;badge.textContent=x.publicationStatus;li.append(badge);if(x.publicationStatus==='draft'){const b=document.createElement('button');b.className='push';b.textContent='Publish Session';b.onclick=()=>review(x);li.append(b)}sessions.append(li)});if(!d.sessions.length)sessions.innerHTML='<li>No Sessions.</li>'}function formData(form){return Object.fromEntries(new FormData(form))}function showError(e){msg.textContent=e instanceof Error?e.message:'Owner Control could not complete the request.'}async function submit(form,path,payload,success,refresh){const button=form.querySelector('button');button.disabled=true;try{await api(path,{method:'POST',body:JSON.stringify(payload)});form.reset();await refresh();msg.textContent=success}catch(e){showError(e)}finally{button.disabled=false}}courseForm.onsubmit=e=>{e.preventDefault();const x=formData(courseForm);submit(courseForm,'/api/courses/create',x,'Course created as Draft.',()=>loadCourses(x.courseId))};moduleForm.onsubmit=e=>{e.preventDefault();const x=formData(moduleForm);submit(moduleForm,'/api/modules/create',{courseId:course.value,...x},'Module created.',()=>loadModules(x.moduleId))};sessionForm.onsubmit=e=>{e.preventDefault();const x=formData(sessionForm);submit(sessionForm,'/api/sessions/create',{courseId:course.value,moduleId:module.value,...x},'Session created as Draft.',loadSessions)};async function review(x){try{const d=await api('/api/publication/review',{method:'POST',body:JSON.stringify({courseId:course.value,moduleId:module.value,sessionId:x.id})});reviewId=d.reviewId;const r=d.review;q('#reviewBody').textContent='Session: '+x.title+' | '+r.currentPublicationState+' → '+r.proposedPublicationState+' | '+r.releaseState.toLowerCase()+' | discovery '+(r.discoveryChangeRequired?'will change':'already current')+' | video '+(r.contentReadiness.includes('VIDEO')?'present':'absent');dialog.showModal()}catch(e){showError(e)}}q('#cancel').onclick=()=>dialog.close();q('#confirm').onclick=async e=>{e.target.disabled=true;try{await api('/api/publication/apply',{method:'POST',body:JSON.stringify({reviewId})});dialog.close();await loadSessions();msg.textContent='Session publication succeeded and was verified.'}catch(x){showError(x);dialog.close()}finally{e.target.disabled=false}};(async()=>{const b=await api('/api/bootstrap');csrf=b.csrf;await loadCourses()})().catch(showError);`;
