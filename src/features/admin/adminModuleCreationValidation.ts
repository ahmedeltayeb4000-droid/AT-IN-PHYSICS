import {
  AdminCourseCreationError,
  buildAdminCourseDraft,
  type AdminCourseCreationField,
} from "./adminCourseCreationValidation.ts";

export type AdminModuleCreationInput = Readonly<{
  courseId: string;
  moduleId: string;
  title: string;
  order: string;
}>;

export type AdminModuleCreationField =
  "courseId" | "moduleId" | "title" | "order";
export type AdminModuleCreationErrorCode =
  "conflict" | "validation" | "unauthorized" | "service";

export class AdminModuleCreationError extends Error {
  readonly code: AdminModuleCreationErrorCode;
  readonly field?: AdminModuleCreationField;

  constructor(
    code: AdminModuleCreationErrorCode,
    field?: AdminModuleCreationField,
  ) {
    super(code);
    this.code = code;
    this.field = field;
    this.name = "AdminModuleCreationError";
  }
}

function validateId(field: "courseId" | "moduleId", value: string): string {
  try {
    buildAdminCourseDraft({
      courseId: value,
      title: "Validation",
      shortDescription: "Validation",
    });
    return value;
  } catch (cause) {
    if (
      cause instanceof AdminCourseCreationError &&
      cause.field === ("courseId" satisfies AdminCourseCreationField)
    ) {
      throw new AdminModuleCreationError("validation", field);
    }
    throw cause;
  }
}

function validateTitle(value: string): string {
  const hasControlCharacter = [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point < 32 || point === 127;
  });
  if (
    !value.trim() ||
    value !== value.trim() ||
    value.length > 160 ||
    hasControlCharacter
  ) {
    throw new AdminModuleCreationError("validation", "title");
  }
  return value;
}

function validateOrder(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new AdminModuleCreationError("validation", "order");
  }
  const order = Number(value);
  if (!Number.isSafeInteger(order)) {
    throw new AdminModuleCreationError("validation", "order");
  }
  return order;
}

export function buildAdminModuleCreation(input: AdminModuleCreationInput) {
  return {
    courseId: validateId("courseId", input.courseId),
    moduleId: validateId("moduleId", input.moduleId),
    document: {
      title: validateTitle(input.title),
      order: validateOrder(input.order),
    },
  } as const;
}
