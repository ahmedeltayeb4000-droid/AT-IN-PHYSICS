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
import { requireOwnerAuthority } from "../tooling/enrollmentGrant.js";
import {
  runSessionPublicationService,
  safeSessionPublicationSummary,
  type SessionPublicationResult,
} from "../tooling/sessionPublication.js";
import {
  readOwnerCourses,
  readOwnerModules,
  readOwnerSessions,
} from "./inventory.js";

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
  authorize?: typeof requireOwnerAuthority;
}>;

type Review = {
  ids: { courseId: string; moduleId: string; sessionId: string };
  fingerprint: string;
  used: boolean;
};

function fingerprint(result: SessionPublicationResult): string {
  return createHash("sha256")
    .update(JSON.stringify(safeSessionPublicationSummary(result)))
    .digest("hex");
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

export function createOwnerConsoleServer(deps: OwnerConsoleDependencies) {
  const csrf = randomBytes(32).toString("base64url");
  const reviews = new Map<string, Review>();
  const now = deps.now ?? (() => new Date());
  const publish = deps.publish ?? runSessionPublicationService;
  const authorize = deps.authorize ?? requireOwnerAuthority;
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
        return res.end(CLIENT_JS);
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
      if (req.method === "POST") {
        if (
          req.headers.origin !== origin ||
          typeof req.headers["x-owner-control-csrf"] !== "string" ||
          !equalToken(req.headers["x-owner-control-csrf"], csrf)
        )
          return fail(res, 403);
        if (
          (req.headers["content-type"] ?? "").split(";", 1)[0] !==
          "application/json"
        )
          return fail(res, 415);
        const input = await body(req);
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner Control</title><style>body{font:16px system-ui;margin:0;background:#f4f6fa;color:#18202b}main{max-width:960px;margin:auto;padding:32px}header{display:flex;justify-content:space-between;align-items:center}section{background:white;padding:20px;margin:18px 0;border-radius:12px;box-shadow:0 2px 12px #0001}select,button{font:inherit;padding:10px;margin:4px}button{cursor:pointer}.badge{padding:3px 8px;border-radius:20px;background:#e6eaf0}.draft{background:#fff1bf}.published{background:#cef2d8}li{display:flex;gap:12px;align-items:center;padding:12px;border-bottom:1px solid #ddd;flex-wrap:wrap}.push{margin-left:auto}dialog{max-width:560px;border:0;border-radius:12px;padding:24px}#message{min-height:24px;color:#a12424}@media(max-width:650px){header{display:block}.push{margin-left:0}}</style></head><body><main><header><h1>A.T IN PHYSICS Owner Control</h1><strong>Target: ${escapeHtml(projectId)}</strong></header><p id="message" role="status"></p><section><label>Course <select id="course"><option>Select Course</option></select></label><label>Module <select id="module" disabled><option>Select Module</option></select></label></section><section><h2>Sessions</h2><ul id="sessions"><li>Select a Course and Module.</li></ul></section><dialog id="review"><h2>Review publication</h2><div id="reviewBody"></div><button id="confirm">Confirm Publish</button><button id="cancel">Cancel</button></dialog></main><script src="/app.js" defer></script></body></html>`;
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

const CLIENT_JS = `let csrf,reviewId;const q=s=>document.querySelector(s),msg=q('#message'),course=q('#course'),module=q('#module'),sessions=q('#sessions'),dialog=q('#review');async function api(path,options={}){msg.textContent='Loading…';const r=await fetch(path,{...options,headers:{'content-type':'application/json',...(options.method==='POST'?{'x-owner-control-csrf':csrf}:{}),...options.headers}});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed.');msg.textContent='';return d}function opt(x){const o=document.createElement('option');o.value=x.id;o.textContent=x.title+' ('+x.id+')';return o}async function loadCourses(){const b=await api('/api/bootstrap');csrf=b.csrf;const d=await api('/api/courses');d.courses.forEach(x=>course.append(opt(x)))}course.onchange=async()=>{module.length=1;sessions.innerHTML='<li>Select a Module.</li>';if(!course.value)return;try{const d=await api('/api/modules?courseId='+encodeURIComponent(course.value));d.modules.forEach(x=>module.append(opt(x)));module.disabled=false}catch(e){msg.textContent=e.message}};module.onchange=loadSessions;async function loadSessions(){if(!module.value)return;try{const d=await api('/api/sessions?courseId='+encodeURIComponent(course.value)+'&moduleId='+encodeURIComponent(module.value));sessions.innerHTML='';d.sessions.forEach(x=>{const li=document.createElement('li');li.textContent=x.order+' · '+x.title+' · '+x.release+' · lesson '+(x.hasLesson?'yes':'no')+' · video '+(x.hasVideo?'yes':'no');const badge=document.createElement('span');badge.className='badge '+x.publicationStatus;badge.textContent=x.publicationStatus;li.append(badge);if(x.publicationStatus==='draft'){const b=document.createElement('button');b.className='push';b.textContent='Publish Session';b.onclick=()=>review(x);li.append(b)}sessions.append(li)});if(!d.sessions.length)sessions.innerHTML='<li>No Sessions.</li>'}catch(e){msg.textContent=e.message}}async function review(x){try{const d=await api('/api/publication/review',{method:'POST',body:JSON.stringify({courseId:course.value,moduleId:module.value,sessionId:x.id})});reviewId=d.reviewId;const r=d.review;q('#reviewBody').textContent='Session: '+x.title+' | '+r.currentPublicationState+' → '+r.proposedPublicationState+' | '+r.releaseState.toLowerCase()+' | discovery '+(r.discoveryChangeRequired?'will change':'already current')+' | video '+(r.contentReadiness.includes('VIDEO')?'present':'absent');dialog.showModal()}catch(e){msg.textContent=e.message}}q('#cancel').onclick=()=>dialog.close();q('#confirm').onclick=async e=>{e.target.disabled=true;try{await api('/api/publication/apply',{method:'POST',body:JSON.stringify({reviewId})});dialog.close();msg.textContent='Session publication succeeded and was verified.';await loadSessions()}catch(x){msg.textContent=x.message;dialog.close()}finally{e.target.disabled=false}};loadCourses().catch(e=>msg.textContent=e.message);`;
