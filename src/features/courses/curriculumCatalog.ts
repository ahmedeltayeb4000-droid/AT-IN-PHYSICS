import type { Module, Session } from "./types";

export const curriculumModules = [
  {
    id: "mechanics-motion-basics",
    courseId: "mechanics",
    title: "Fundamentals of Motion",
    order: 1,
  },
] as const satisfies readonly Module[];

export const curriculumSessions = [
  {
    id: "mechanics-intro-motion",
    courseId: "mechanics",
    moduleId: "mechanics-motion-basics",
    title: "Introduction to Motion",
    order: 1,
    publicationStatus: "published",
    lessonText:
      "Motion describes how an object's position changes over time.\n\nIn this lesson, begin by identifying a reference point, then describe the object's position relative to it.",
  },
  {
    id: "mechanics-displacement",
    courseId: "mechanics",
    moduleId: "mechanics-motion-basics",
    title: "Position, Distance, and Displacement",
    order: 2,
    publicationStatus: "draft",
  },
] as const satisfies readonly Session[];
