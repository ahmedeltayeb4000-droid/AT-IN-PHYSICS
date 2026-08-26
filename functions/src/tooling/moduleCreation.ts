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
  requireOwnerAuthority,
  resolveEnrollmentGrantProject,
  resolveTrustedOwnerUid,
  type EnrollmentGrantEnvironment,
} from "./enrollmentGrant.js";

const MODULE_TITLE_MAX_LENGTH = 160;

export type ModuleCreationOptions = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly title: string;
  readonly order: number;
  readonly apply: boolean;
};

export type TrustedModuleDocument = {
  readonly title: string;
  readonly order: number;
};

export type ModuleCreationResult = {
  readonly modulePath: string;
  readonly currentModule: "MISSING" | "IDENTICAL";
  readonly proposedTitle: string;
  readonly proposedOrder: number;
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

export function validateModuleOrder(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("order must be a nonnegative safe integer.");
    }
    return value;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error("order must be a canonical nonnegative integer.");
  }
  const order = Number(value);
  if (!Number.isSafeInteger(order)) {
    throw new Error("order must be a nonnegative safe integer.");
  }
  return order;
}

export function parseModuleCreationArgs(
  args: readonly string[],
): ModuleCreationOptions {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let title: string | undefined;
  let order: string | undefined;
  let apply = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      !["--course-id", "--module-id", "--title", "--order", "--apply"].includes(
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
    if (argument === "--module-id") moduleId = value;
    if (argument === "--title") title = value;
    if (argument === "--order") order = value;
  }
  return {
    courseId: validateCourseId(courseId),
    moduleId: validateCourseId(moduleId),
    title: validateTrustedContentText("title", title, MODULE_TITLE_MAX_LENGTH),
    order: validateModuleOrder(order),
    apply,
  };
}

export function getModulePath(courseId: string, moduleId: string): string {
  return `courses/${validateCourseId(courseId)}/modules/${validateCourseId(moduleId)}`;
}

export function buildTrustedModuleDocument(
  options: ModuleCreationOptions,
): TrustedModuleDocument {
  return {
    title: validateTrustedContentText(
      "title",
      options.title,
      MODULE_TITLE_MAX_LENGTH,
    ),
    order: validateModuleOrder(options.order),
  };
}

export function inspectExistingModule(
  data: DocumentData | undefined,
  expected: TrustedModuleDocument,
): "MISSING" | "IDENTICAL" {
  if (data === undefined) return "MISSING";
  if (!isDeepStrictEqual(data, expected)) {
    throw new Error(
      "Existing Module conflicts with the requested trusted state.",
    );
  }
  return "IDENTICAL";
}

export async function runModuleCreationService(
  auth: Auth,
  db: Firestore,
  options: ModuleCreationOptions,
  trustedOwnerUid: string,
): Promise<ModuleCreationResult> {
  const ownerUid = validateTargetUserId(trustedOwnerUid);
  await requireOwnerAuthority(auth, ownerUid);
  const expected = buildTrustedModuleDocument(options);
  const coursePath = `courses/${validateCourseId(options.courseId)}`;
  const modulePath = getModulePath(options.courseId, options.moduleId);
  const courseReference = db.doc(coursePath);
  const moduleReference = db.doc(modulePath);
  const [courseSnapshot, moduleSnapshot] = await db.getAll(
    courseReference,
    moduleReference,
  );
  if (!courseSnapshot.exists) throw new Error("Parent Course was not found.");
  validateTrustedCourseDocument(courseSnapshot.data(), options.courseId);
  const initial = inspectExistingModule(moduleSnapshot.data(), expected);
  if (!options.apply) return result(modulePath, initial, expected, null, false);

  const applyStatus = await db.runTransaction(async (transaction) => {
    const [currentCourse, currentModule] = await Promise.all([
      transaction.get(courseReference),
      transaction.get(moduleReference),
    ]);
    if (!currentCourse.exists) throw new Error("Parent Course was not found.");
    validateTrustedCourseDocument(currentCourse.data(), options.courseId);
    const state = inspectExistingModule(currentModule.data(), expected);
    if (state === "IDENTICAL") return "already-exists" as const;
    transaction.create(moduleReference, expected);
    return "created" as const;
  });
  const persisted = (await moduleReference.get()).data();
  if (inspectExistingModule(persisted, expected) !== "IDENTICAL") {
    throw new Error("Module verification failed after apply.");
  }
  return result(modulePath, initial, expected, applyStatus, true);
}

function result(
  modulePath: string,
  currentModule: "MISSING" | "IDENTICAL",
  proposed: TrustedModuleDocument,
  applyStatus: "created" | "already-exists" | null,
  postApplyVerified: boolean,
): ModuleCreationResult {
  return {
    modulePath,
    currentModule,
    proposedTitle: proposed.title,
    proposedOrder: proposed.order,
    changeRequired: currentModule === "MISSING",
    applyStatus,
    postApplyVerified,
  };
}

export function resolveModuleCreationProject(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveEnrollmentGrantProject(environment);
}

export function resolveModuleCreationOwnerUid(
  environment: EnrollmentGrantEnvironment,
): string {
  return resolveTrustedOwnerUid(environment);
}

export function safeModuleCreationSummary(result: ModuleCreationResult) {
  return {
    modulePath: result.modulePath,
    currentModule: result.currentModule === "MISSING" ? "MISSING" : "PRESENT",
    proposedTitle: result.proposedTitle,
    proposedOrder: result.proposedOrder,
    changeRequired: result.changeRequired,
    applyStatus: result.applyStatus,
    postApplyVerified: result.postApplyVerified,
  };
}
