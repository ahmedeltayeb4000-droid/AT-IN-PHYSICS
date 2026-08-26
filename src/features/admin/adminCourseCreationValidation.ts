const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AdminCourseCreationInput = Readonly<{
  courseId: string;
  title: string;
  shortDescription: string;
}>;

export type AdminCourseDraft = Readonly<{
  slug: string;
  title: string;
  shortDescription: string;
  status: "draft";
}>;

export type AdminCourseCreationErrorCode =
  "conflict" | "validation" | "unauthorized" | "service";
export type AdminCourseCreationField =
  "courseId" | "title" | "shortDescription";

export class AdminCourseCreationError extends Error {
  readonly code: AdminCourseCreationErrorCode;
  readonly field?: AdminCourseCreationField;

  constructor(
    code: AdminCourseCreationErrorCode,
    field?: AdminCourseCreationField,
  ) {
    super(code);
    this.code = code;
    this.field = field;
    this.name = "AdminCourseCreationError";
  }
}

function validateText(
  field: "title" | "shortDescription",
  value: string,
  maximum: number,
): string {
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (
    !value.trim() ||
    value !== value.trim() ||
    value.length > maximum ||
    hasControlCharacter
  ) {
    throw new AdminCourseCreationError("validation", field);
  }
  return value;
}

export function buildAdminCourseDraft(
  input: AdminCourseCreationInput,
): Readonly<{ courseId: string; document: AdminCourseDraft }> {
  if (!COURSE_ID_PATTERN.test(input.courseId) || input.courseId.length > 128) {
    throw new AdminCourseCreationError("validation", "courseId");
  }
  return {
    courseId: input.courseId,
    document: {
      slug: input.courseId,
      title: validateText("title", input.title, 160),
      shortDescription: validateText(
        "shortDescription",
        input.shortDescription,
        1000,
      ),
      status: "draft",
    },
  };
}
