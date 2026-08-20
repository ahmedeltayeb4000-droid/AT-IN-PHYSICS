import type { Course } from "./types";

export const courseCatalog = [
  {
    id: "mechanics",
    slug: "mechanics",
    title: "Mechanics",
    shortDescription: "Basic laws of motion.",
    status: "published",
  },
  {
    id: "thermodynamics",
    slug: "thermodynamics",
    title: "Thermodynamics",
    shortDescription: "Heat and energy.",
    status: "published",
  },
  {
    id: "quantum-physics",
    slug: "quantum-physics",
    title: "Quantum Physics",
    shortDescription: "The study of particles.",
    status: "published",
  },
] as const satisfies readonly Course[];
