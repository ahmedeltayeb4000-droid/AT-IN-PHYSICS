import { isDeepStrictEqual } from "node:util";
import type { Auth } from "firebase-admin/auth";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import {
  validateCourseId,
  validateTargetUserId,
} from "../enrollments/validation.js";
import {
  validateTrustedContentText,
  validateTrustedCourseDocument,
} from "./courseCreation.js";
import {
  validateModuleOrder,
  validateTrustedModuleDocument,
} from "./moduleCreation.js";
import {
  requireOwnerAuthority,
  resolveEnrollmentGrantProject,
  resolveTrustedOwnerUid,
  type EnrollmentGrantEnvironment,
} from "./enrollmentGrant.js";

const SESSION_TITLE_MAX_LENGTH = 160;

export type SessionCreationOptions = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly order: number;
  readonly apply: boolean;
  readonly isFree?: boolean;
};

export type TrustedSessionCreationDocument = {
  readonly title: string;
  readonly order: number;
  readonly publicationStatus: "draft";
  readonly isFree?: boolean;
};

export type SessionCreationResult = {
  readonly sessionPath: string;
  readonly currentSession: "MISSING" | "IDENTICAL";
  readonly proposedTitle: string;
  readonly proposedOrder: number;
  readonly proposedPublicationStatus: "draft";
  readonly changeRequired: boolean;
  readonly applyStatus: "created" | "already-exists" | null;
  readonly postApplyVerified: boolean;
};

function optionValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new Error(`The ${option} option requires a value.`);
  return value;
}

export function parseSessionCreationArgs(
  args: readonly string[],
): SessionCreationOptions {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let sessionId: string | undefined;
  let title: string | undefined;
  let order: string | undefined;
  let apply = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      ![
        "--course-id",
        "--module-id",
        "--session-id",
        "--title",
        "--order",
        "--apply",
      ].includes(argument)
    )
      throw new Error(`Unknown option: ${argument}`);
    if (seen.has(argument))
      throw new Error(`${argument} may be provided only once.`);
    seen.add(argument);
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    const value = optionValue(args, index, argument);
    index += 1;
    if (argument === "--course-id") courseId = value;
    if (argument === "--module-id") moduleId = value;
    if (argument === "--session-id") sessionId = value;
    if (argument === "--title") title = value;
    if (argument === "--order") order = value;
  }
  return {
    courseId: validateCourseId(courseId),
    moduleId: validateCourseId(moduleId),
    sessionId: validateCourseId(sessionId),
    title: validateTrustedContentText("title", title, SESSION_TITLE_MAX_LENGTH),
    order: validateModuleOrder(order),
    apply,
  };
}

export function getSessionPath(
  courseId: string,
  moduleId: string,
  sessionId: string,
): string {
  return `courses/${validateCourseId(courseId)}/modules/${validateCourseId(moduleId)}/sessions/${validateCourseId(sessionId)}`;
}

export function buildTrustedSessionCreationDocument(
  options: SessionCreationOptions,
): TrustedSessionCreationDocument {
  return {
    title: validateTrustedContentText(
      "title",
      options.title,
      SESSION_TITLE_MAX_LENGTH,
    ),
    order: validateModuleOrder(options.order),
    publicationStatus: "draft",
    isFree: options.isFree === true,
  };
}

export function inspectExistingSession(
  data: DocumentData | undefined,
  expected: TrustedSessionCreationDocument,
): "MISSING" | "IDENTICAL" {
  if (data === undefined) return "MISSING";
  const normalized =
    expected.isFree === false &&
    !Object.prototype.hasOwnProperty.call(data, "isFree")
      ? { ...data, isFree: false }
      : data;
  if (!isDeepStrictEqual(normalized, expected))
    throw new Error(
      "Existing Session conflicts with the requested trusted state.",
    );
  return "IDENTICAL";
}

export async function runSessionCreationService(
  auth: Auth,
  db: Firestore,
  options: SessionCreationOptions,
  trustedOwnerUid: string,
): Promise<SessionCreationResult> {
  const ownerUid = validateTargetUserId(trustedOwnerUid);
  await requireOwnerAuthority(auth, ownerUid);
  const expected = buildTrustedSessionCreationDocument(options);
  const courseReference = db.doc(
    `courses/${validateCourseId(options.courseId)}`,
  );
  const moduleReference = db.doc(
    `courses/${validateCourseId(options.courseId)}/modules/${validateCourseId(options.moduleId)}`,
  );
  const sessionPath = getSessionPath(
    options.courseId,
    options.moduleId,
    options.sessionId,
  );
  const sessionReference = db.doc(sessionPath);
  const [courseSnapshot, moduleSnapshot, sessionSnapshot] = await db.getAll(
    courseReference,
    moduleReference,
    sessionReference,
  );
  validateParents(
    courseSnapshot.exists,
    courseSnapshot.data(),
    moduleSnapshot.exists,
    moduleSnapshot.data(),
    options.courseId,
  );
  const initial = inspectExistingSession(sessionSnapshot.data(), expected);
  if (!options.apply)
    return result(sessionPath, initial, expected, null, false);

  const applyStatus = await db.runTransaction(async (transaction) => {
    const [course, module, session] = await Promise.all([
      transaction.get(courseReference),
      transaction.get(moduleReference),
      transaction.get(sessionReference),
    ]);
    validateParents(
      course.exists,
      course.data(),
      module.exists,
      module.data(),
      options.courseId,
    );
    const state = inspectExistingSession(session.data(), expected);
    if (state === "IDENTICAL") return "already-exists" as const;
    transaction.create(sessionReference, expected);
    return "created" as const;
  });
  if (
    inspectExistingSession((await sessionReference.get()).data(), expected) !==
    "IDENTICAL"
  )
    throw new Error("Session verification failed after apply.");
  return result(sessionPath, initial, expected, applyStatus, true);
}

function validateParents(
  courseExists: boolean,
  courseData: DocumentData | undefined,
  moduleExists: boolean,
  moduleData: DocumentData | undefined,
  courseId: string,
): void {
  if (!courseExists) throw new Error("Parent Course was not found.");
  validateTrustedCourseDocument(courseData, courseId);
  if (!moduleExists) throw new Error("Parent Module was not found.");
  validateTrustedModuleDocument(moduleData);
}

function result(
  sessionPath: string,
  currentSession: "MISSING" | "IDENTICAL",
  proposed: TrustedSessionCreationDocument,
  applyStatus: "created" | "already-exists" | null,
  postApplyVerified: boolean,
): SessionCreationResult {
  return {
    sessionPath,
    currentSession,
    proposedTitle: proposed.title,
    proposedOrder: proposed.order,
    proposedPublicationStatus: proposed.publicationStatus,
    changeRequired: currentSession === "MISSING",
    applyStatus,
    postApplyVerified,
  };
}

export function resolveSessionCreationProject(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveEnrollmentGrantProject(environment);
}

export function resolveSessionCreationOwnerUid(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveTrustedOwnerUid(environment);
}

export function safeSessionCreationSummary(result: SessionCreationResult) {
  return {
    sessionPath: result.sessionPath,
    currentSession: result.currentSession === "MISSING" ? "MISSING" : "PRESENT",
    proposedTitle: result.proposedTitle,
    proposedOrder: result.proposedOrder,
    proposedPublicationStatus: result.proposedPublicationStatus,
    changeRequired: result.changeRequired,
    applyStatus: result.applyStatus,
    postApplyVerified: result.postApplyVerified,
  };
}
