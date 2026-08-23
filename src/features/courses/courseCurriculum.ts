import type { Module, Session } from "./types";

export type CourseCurriculumModule = {
  readonly module: Module;
  readonly sessions: readonly Session[];
};

export function buildCourseCurriculum(
  modules: readonly Module[],
  sessionsByModule: readonly (readonly Session[])[],
): CourseCurriculumModule[] {
  if (modules.length !== sessionsByModule.length) {
    throw new Error("Course curriculum data is incomplete.");
  }

  return modules.map((module, index) => {
    const sessions = sessionsByModule[index];
    if (
      !sessions ||
      sessions.some(
        (session) =>
          session.courseId !== module.courseId ||
          session.moduleId !== module.id,
      )
    ) {
      throw new Error("Course curriculum data is inconsistent.");
    }

    return { module, sessions: [...sessions] };
  });
}
