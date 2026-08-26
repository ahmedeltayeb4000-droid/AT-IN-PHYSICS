import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrustedCourseInventory,
  type TrustedCourseRecord,
} from "../src/courses/courseInventory.js";

function course(
  id: string,
  title: string,
  status: "draft" | "published",
): TrustedCourseRecord {
  return {
    id,
    data: {
      slug: id,
      title,
      shortDescription: `${title} description`,
      status,
    },
  };
}

test("returns valid draft and published Courses as the exact sanitized DTO", () => {
  const inventory = buildTrustedCourseInventory([
    course("draft-course", "Draft Course", "draft"),
    course("published-course", "Published Course", "published"),
  ]);
  assert.deepEqual(inventory, [
    {
      id: "draft-course",
      slug: "draft-course",
      title: "Draft Course",
      shortDescription: "Draft Course description",
      status: "draft",
    },
    {
      id: "published-course",
      slug: "published-course",
      title: "Published Course",
      shortDescription: "Published Course description",
      status: "published",
    },
  ]);
  assert.deepEqual(Object.keys(inventory[0] ?? {}).sort(), [
    "id",
    "shortDescription",
    "slug",
    "status",
    "title",
  ]);
});

test("mixed inventory sorts by title and then canonical document ID", () => {
  const inventory = buildTrustedCourseInventory([
    course("z-course", "Beta", "published"),
    course("b-course", "Alpha", "draft"),
    course("a-course", "Alpha", "published"),
  ]);
  assert.deepEqual(
    inventory.map(({ id }) => id),
    ["a-course", "b-course", "z-course"],
  );
});

test("empty inventory is supported", () => {
  assert.deepEqual(buildTrustedCourseInventory([]), []);
});

test("malformed, mismatched, extra-field, and noncanonical Courses fail closed", () => {
  const cases: TrustedCourseRecord[] = [
    { id: "course", data: null },
    {
      id: "course",
      data: {
        slug: "other",
        title: "Course",
        shortDescription: "Description",
        status: "draft",
      },
    },
    {
      id: "course",
      data: {
        slug: "course",
        title: "Course",
        shortDescription: "Description",
        status: "published",
        internal: true,
      },
    },
    course("Unsafe/Path", "Course", "draft"),
  ];
  for (const record of cases) {
    assert.throws(() => buildTrustedCourseInventory([record]));
  }
});
