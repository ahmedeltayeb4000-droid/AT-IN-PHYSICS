import { mapSessionDocument } from "../courses/sessionMapper.ts";
import type { SessionPublicationStatus } from "../courses/types.ts";
import { isCanonicalAdminModuleId } from "./adminModuleMapper.ts";

export type AdminSession = Readonly<{
  id: string;
  title: string;
  order: number;
  publicationStatus: SessionPublicationStatus;
  releaseAt?: string;
  hasLessonText: boolean;
  hasVideo: boolean;
}>;

export function mapAdminSessionDocument(
  id: string,
  courseId: string,
  moduleId: string,
  value: unknown,
): AdminSession {
  if (
    !isCanonicalAdminModuleId(id) ||
    !isCanonicalAdminModuleId(courseId) ||
    !isCanonicalAdminModuleId(moduleId)
  ) {
    throw new Error("Malformed Session inventory response.");
  }

  let session;
  try {
    session = mapSessionDocument(id, courseId, moduleId, value);
  } catch {
    throw new Error("Malformed Session inventory response.");
  }

  return {
    id: session.id,
    title: session.title,
    order: session.order,
    publicationStatus: session.publicationStatus,
    ...(session.releaseAt ? { releaseAt: session.releaseAt } : {}),
    hasLessonText: session.lessonText !== undefined,
    hasVideo: session.videoAssetId !== undefined,
  };
}
