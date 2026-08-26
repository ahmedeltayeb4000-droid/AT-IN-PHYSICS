import { isDeepStrictEqual } from "node:util";
import type { Auth } from "firebase-admin/auth";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import {
  validateCourseId,
  validateTargetUserId,
} from "../enrollments/validation.js";
import {
  requireOwnerAuthority,
  resolveEnrollmentGrantProject,
  resolveTrustedOwnerUid,
  type EnrollmentGrantEnvironment,
} from "./enrollmentGrant.js";

const TITLE_MAX_LENGTH = 160;
const DESCRIPTION_MAX_LENGTH = 1000;

export type CourseCreationOptions = {
  readonly courseId: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly apply: boolean;
};

export type TrustedCourseDocument = {
  readonly slug: string;
  readonly title: string;
  readonly shortDescription: string;
  readonly status: "draft";
};

export type CourseCreationResult = {
  readonly coursePath: string;
  readonly currentCourse: "MISSING" | "IDENTICAL";
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
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`The ${option} option requires a value.`);
  }
  return value;
}

export function validateTrustedContentText(
  name: string,
  value: unknown,
  maximum: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  if (value !== value.trim()) {
    throw new Error(`${name} must not contain leading or trailing whitespace.`);
  }
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (value.length > maximum || hasControlCharacter) {
    throw new Error(`${name} is invalid or exceeds ${maximum} characters.`);
  }
  return value;
}

export function parseCourseCreationArgs(
  args: readonly string[],
): CourseCreationOptions {
  let courseId: string | undefined;
  let title: string | undefined;
  let shortDescription: string | undefined;
  let apply = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      !["--course-id", "--title", "--short-description", "--apply"].includes(
        argument,
      )
    ) {
      throw new Error(`Unknown option: ${argument}`);
    }
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
    if (argument === "--title") title = value;
    if (argument === "--short-description") shortDescription = value;
  }
  return {
    courseId: validateCourseId(courseId),
    title: validateTrustedContentText("title", title, TITLE_MAX_LENGTH),
    shortDescription: validateTrustedContentText(
      "shortDescription",
      shortDescription,
      DESCRIPTION_MAX_LENGTH,
    ),
    apply,
  };
}

export function getCoursePath(courseId: string): string {
  return `courses/${validateCourseId(courseId)}`;
}

export function buildTrustedCourseDocument(
  options: CourseCreationOptions,
): TrustedCourseDocument {
  const courseId = validateCourseId(options.courseId);
  return {
    slug: courseId,
    title: validateTrustedContentText("title", options.title, TITLE_MAX_LENGTH),
    shortDescription: validateTrustedContentText(
      "shortDescription",
      options.shortDescription,
      DESCRIPTION_MAX_LENGTH,
    ),
    status: "draft",
  };
}

export function validateTrustedCourseDocument(
  value: unknown,
  courseId: string,
): asserts value is Readonly<{
  slug: string;
  title: string;
  shortDescription: string;
  status: "draft" | "published";
}> {
  const id = validateCourseId(courseId);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Parent Course is malformed.");
  }
  const data = value as Record<string, unknown>;
  if (
    !isDeepStrictEqual(Object.keys(data).sort(), [
      "shortDescription",
      "slug",
      "status",
      "title",
    ]) ||
    data.slug !== id ||
    (data.status !== "draft" && data.status !== "published")
  ) {
    throw new Error("Parent Course is malformed.");
  }
  try {
    validateTrustedContentText("title", data.title, TITLE_MAX_LENGTH);
    validateTrustedContentText(
      "shortDescription",
      data.shortDescription,
      DESCRIPTION_MAX_LENGTH,
    );
  } catch (cause) {
    throw new Error("Parent Course is malformed.", { cause });
  }
}

function inspectExisting(
  data: DocumentData | undefined,
  expected: TrustedCourseDocument,
): "MISSING" | "IDENTICAL" {
  if (data === undefined) return "MISSING";
  if (!isDeepStrictEqual(data, expected)) {
    throw new Error(
      "Existing Course conflicts with the requested trusted state.",
    );
  }
  return "IDENTICAL";
}

export async function runCourseCreationService(
  auth: Auth,
  db: Firestore,
  options: CourseCreationOptions,
  trustedOwnerUid: string,
): Promise<CourseCreationResult> {
  const ownerUid = validateTargetUserId(trustedOwnerUid);
  await requireOwnerAuthority(auth, ownerUid);
  const expected = buildTrustedCourseDocument(options);
  const coursePath = getCoursePath(options.courseId);
  const reference = db.doc(coursePath);
  const initial = inspectExisting((await reference.get()).data(), expected);
  if (!options.apply) {
    return {
      coursePath,
      currentCourse: initial,
      changeRequired: initial === "MISSING",
      applyStatus: null,
      postApplyVerified: false,
    };
  }
  const applyStatus = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const state = inspectExisting(snapshot.data(), expected);
    if (state === "IDENTICAL") return "already-exists" as const;
    transaction.create(reference, expected);
    return "created" as const;
  });
  const persisted = (await reference.get()).data();
  if (inspectExisting(persisted, expected) !== "IDENTICAL") {
    throw new Error("Course verification failed after apply.");
  }
  return {
    coursePath,
    currentCourse: initial,
    changeRequired: initial === "MISSING",
    applyStatus,
    postApplyVerified: true,
  };
}

export function resolveCourseCreationProject(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveEnrollmentGrantProject(environment);
}

export function resolveCourseCreationOwnerUid(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveTrustedOwnerUid(environment);
}

export function safeCourseCreationSummary(result: CourseCreationResult) {
  return {
    coursePath: result.coursePath,
    currentCourse: result.currentCourse,
    changeRequired: result.changeRequired,
    applyStatus: result.applyStatus,
    postApplyVerified: result.postApplyVerified,
  };
}
