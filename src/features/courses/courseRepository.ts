import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import type { Course, Module, Session } from "./types";

type CourseDocument = Omit<Course, "id">;
type ModuleDocument = Pick<Module, "title" | "order">;
type SessionDocument = Pick<
  Session,
  "title" | "order" | "publicationStatus"
> & {
  readonly releaseAt?: Timestamp;
};

function toCourse(snapshot: QueryDocumentSnapshot): Course {
  const data = snapshot.data() as CourseDocument;
  return { id: snapshot.id, ...data };
}

function toModule(
  snapshot: QueryDocumentSnapshot,
  courseId: string,
): Module {
  const data = snapshot.data() as ModuleDocument;
  return { id: snapshot.id, courseId, ...data };
}

function toSession(
  snapshot: QueryDocumentSnapshot,
  courseId: string,
  moduleId: string,
): Session {
  const data = snapshot.data() as SessionDocument;
  return {
    id: snapshot.id,
    courseId,
    moduleId,
    title: data.title,
    order: data.order,
    publicationStatus: data.publicationStatus,
    ...(data.releaseAt
      ? { releaseAt: data.releaseAt.toDate().toISOString() }
      : {}),
  };
}

export async function getCourses(): Promise<Course[]> {
  const coursesQuery = query(
    collection(firebaseDb, "courses"),
    where("status", "==", "published"),
  );
  const snapshot = await getDocs(coursesQuery);
  return snapshot.docs.map(toCourse).sort((left, right) => {
    const titleOrder = left.title.localeCompare(right.title, "en");
    return titleOrder || left.id.localeCompare(right.id, "en");
  });
}

export async function getCourseById(
  courseId: string,
): Promise<Course | null> {
  const snapshot = await getDoc(doc(firebaseDb, "courses", courseId));
  return snapshot.exists() ? toCourse(snapshot) : null;
}

export async function getCourseModules(courseId: string): Promise<Module[]> {
  const modulesQuery = query(
    collection(firebaseDb, "courses", courseId, "modules"),
    orderBy("order", "asc"),
  );
  const snapshot = await getDocs(modulesQuery);
  return snapshot.docs.map((item) => toModule(item, courseId));
}

export async function getModuleSessions(
  courseId: string,
  moduleId: string,
): Promise<Session[]> {
  const sessionsQuery = query(
    collection(
      firebaseDb,
      "courses",
      courseId,
      "modules",
      moduleId,
      "sessions",
    ),
    orderBy("order", "asc"),
  );
  const snapshot = await getDocs(sessionsQuery);
  return snapshot.docs.map((item) => toSession(item, courseId, moduleId));
}
