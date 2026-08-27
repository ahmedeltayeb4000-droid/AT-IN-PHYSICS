import {
  AdminModuleCreationError,
  buildAdminModuleCreation,
} from "./adminModuleCreationValidation.ts";

export type AdminSessionCreationInput = Readonly<{
  courseId: string;
  moduleId: string;
  sessionId: string;
  title: string;
  order: string;
}>;

export type AdminSessionCreationField =
  "courseId" | "moduleId" | "sessionId" | "title" | "order";
export type AdminSessionCreationErrorCode =
  "conflict" | "validation" | "unauthorized" | "service";

export class AdminSessionCreationError extends Error {
  readonly code: AdminSessionCreationErrorCode;
  readonly field?: AdminSessionCreationField;

  constructor(
    code: AdminSessionCreationErrorCode,
    field?: AdminSessionCreationField,
  ) {
    super(code);
    this.code = code;
    this.field = field;
    this.name = "AdminSessionCreationError";
  }
}

function validationField(
  cause: AdminModuleCreationError,
): AdminSessionCreationField {
  return cause.field ?? "courseId";
}

export function buildAdminSessionCreation(input: AdminSessionCreationInput) {
  let validated;
  try {
    validated = buildAdminModuleCreation({
      courseId: input.courseId,
      moduleId: input.moduleId,
      title: input.title,
      order: input.order,
    });
    buildAdminModuleCreation({
      courseId: input.courseId,
      moduleId: input.sessionId,
      title: input.title,
      order: input.order,
    });
  } catch (cause) {
    if (cause instanceof AdminModuleCreationError) {
      const field =
        cause.field === "moduleId" && validated
          ? "sessionId"
          : validationField(cause);
      throw new AdminSessionCreationError("validation", field);
    }
    throw cause;
  }

  return {
    courseId: validated.courseId,
    moduleId: validated.moduleId,
    sessionId: input.sessionId,
    document: {
      title: validated.document.title,
      order: validated.document.order,
      publicationStatus: "draft" as const,
    },
  };
}
