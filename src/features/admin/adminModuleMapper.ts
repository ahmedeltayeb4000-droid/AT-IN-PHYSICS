export type AdminModule = Readonly<{
  id: string;
  title: string;
  order: number;
}>;

const CANONICAL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MODULE_FIELDS = ["order", "title"];

export function isCanonicalAdminModuleId(value: string): boolean {
  return value.length <= 128 && CANONICAL_ID_PATTERN.test(value);
}

function isTrustedTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Boolean(value.trim()) &&
    value === value.trim() &&
    value.length <= 160 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  );
}

export function mapAdminModuleDocument(
  id: string,
  value: unknown,
): AdminModule {
  if (
    !isCanonicalAdminModuleId(id) ||
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error("Malformed Module inventory response.");
  }
  const data = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(data).sort()) !==
      JSON.stringify(MODULE_FIELDS) ||
    !isTrustedTitle(data.title) ||
    typeof data.order !== "number" ||
    !Number.isSafeInteger(data.order) ||
    data.order < 0
  ) {
    throw new Error("Malformed Module inventory response.");
  }
  return { id, title: data.title, order: data.order };
}
