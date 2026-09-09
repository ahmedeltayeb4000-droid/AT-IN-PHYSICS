import { validateCourseId } from "../enrollments/validation.js";
import { validateTrustedContentText } from "./courseCreation.js";
import { readStrictJsonRequest } from "./courseRequestFile.js";
import { validateModuleOrder } from "./moduleCreation.js";

function exact(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Creation request must be a JSON object.");
  const data = value as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  if (
    keys.length !== fields.length ||
    !keys.every((field, index) => field === [...fields].sort()[index])
  ) {
    throw new Error("Creation request fields are invalid.");
  }
  return data;
}

export function parseTrustedModuleCreationRequest(value: unknown) {
  const data = exact(value, ["courseId", "moduleId", "order", "title"]);
  return {
    courseId: validateCourseId(data.courseId),
    moduleId: validateCourseId(data.moduleId),
    title: validateTrustedContentText("title", data.title, 160),
    order: validateModuleOrder(data.order),
  };
}

export function readTrustedModuleCreationRequest(path: string) {
  const loaded = readStrictJsonRequest(path);
  return {
    request: parseTrustedModuleCreationRequest(loaded.value),
    sha256: loaded.sha256,
  };
}

export function parseTrustedSessionCreationRequest(input: unknown) {
  const value = input as Record<string, unknown>;
  const hasIsFree = Boolean(
    value && Object.prototype.hasOwnProperty.call(value, "isFree"),
  );
  const data = exact(
    input,
    hasIsFree
      ? ["courseId", "isFree", "moduleId", "order", "sessionId", "title"]
      : ["courseId", "moduleId", "order", "sessionId", "title"],
  );
  if (hasIsFree && typeof data.isFree !== "boolean")
    throw new Error("isFree must be boolean.");
  return {
    courseId: validateCourseId(data.courseId),
    moduleId: validateCourseId(data.moduleId),
    sessionId: validateCourseId(data.sessionId),
    title: validateTrustedContentText("title", data.title, 160),
    order: validateModuleOrder(data.order),
    ...(hasIsFree ? { isFree: data.isFree as boolean } : {}),
  };
}

export function readTrustedSessionCreationRequest(path: string) {
  const loaded = readStrictJsonRequest(path);
  return {
    request: parseTrustedSessionCreationRequest(loaded.value),
    sha256: loaded.sha256,
  };
}
