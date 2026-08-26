import type { Firestore } from "firebase-admin/firestore";
import { validateCourseId } from "../enrollments/validation.js";
import { validateTrustedCourseDocument } from "../tooling/courseCreation.js";

export type CourseInventoryDto = Readonly<{
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  status: "draft" | "published";
}>;

export type TrustedCourseRecord = Readonly<{
  id: string;
  data: unknown;
}>;

/**
 * Validates and sanitizes authoritative Course documents. Inventory order is
 * title ascending, then canonical document ID, using code-point comparison so
 * the result is deterministic across server runtimes and locales.
 */
export function buildTrustedCourseInventory(
  records: readonly TrustedCourseRecord[],
): CourseInventoryDto[] {
  return records
    .map(({ id: untrustedId, data }) => {
      const id = validateCourseId(untrustedId);
      validateTrustedCourseDocument(data, id);
      return {
        id,
        slug: data.slug,
        title: data.title,
        shortDescription: data.shortDescription,
        status: data.status,
      } satisfies CourseInventoryDto;
    })
    .sort((left, right) => {
      const byTitle =
        left.title < right.title ? -1 : left.title > right.title ? 1 : 0;
      if (byTitle !== 0) return byTitle;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
}

/** Reads only the fixed authoritative top-level Course collection. */
export async function readTrustedCourseInventory(
  db: Firestore,
): Promise<CourseInventoryDto[]> {
  const snapshot = await db.collection("courses").get();
  return buildTrustedCourseInventory(
    snapshot.docs.map((document) => ({
      id: document.id,
      data: document.data(),
    })),
  );
}
