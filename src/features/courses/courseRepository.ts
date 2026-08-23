import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseDb } from "../../lib/firebase";
import {
  SESSION_DISCOVERY_DOCUMENT_ID,
  mapSessionDiscoveryManifest,
} from "./sessionDiscovery";
import { buildCourseCurriculum, type CourseCurriculumModule } from "./courseCurriculum";
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
  return {
    id: snapshot.id,
    slug: data.slug,
    title: data.title,
    shortDescription: data.shortDescription,
    status: data.status,
  };
}

function toModule(
  snapshot: QueryDocumentSnapshot,
  courseId: string,
): Module {
  const data = snapshot.data() as ModuleDocument;
  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    typeof data.order !== "number" ||
    !Number.isSafeInteger(data.order) ||
    data.order < 0
  ) {
    throw new Error("Malformed Module document.");
  }
  return {
    id: snapshot.id,
    courseId,
    title: data.title,
    order: data.order,
  };
}

function toSession(
  snapshot: DocumentSnapshot,
  courseId: string,
  moduleId: string,
): Session {
  const data = snapshot.data() as SessionDocument;
  const hasReleaseAt = Object.prototype.hasOwnProperty.call(data, "releaseAt");
  const releaseAt = data.releaseAt;
  if (
    typeof data.title !== "string" ||
    !data.title.trim() ||
    typeof data.order !== "number" ||
    !Number.isSafeInteger(data.order) ||
    data.order < 0 ||
    (data.publicationStatus !== "draft" &&
      data.publicationStatus !== "published") ||
    (hasReleaseAt && !(releaseAt instanceof Timestamp))
  ) {
    throw new Error("Malformed Session document.");
  }
  return {
    id: snapshot.id,
    courseId,
    moduleId,
    title: data.title,
    order: data.order,
    publicationStatus: data.publicationStatus,
    ...(releaseAt instanceof Timestamp
      ? { releaseAt: releaseAt.toDate().toISOString() }
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

export async function getCourseBySlug(slug: string): Promise<Course | null> {
  const courseQuery = query(
    collection(firebaseDb, "courses"),
    where("slug", "==", slug),
    where("status", "==", "published"),
    limit(1),
  );
  const snapshot = await getDocs(courseQuery);
  const course = snapshot.docs[0];
  return course ? toCourse(course) : null;
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
  const sessionIds = await getModuleSessionIds(courseId, moduleId);
  const sessions = await Promise.all(
    sessionIds.map((sessionId) =>
      getSessionById(courseId, moduleId, sessionId),
    ),
  );

  if (sessions.some((session) => session === null)) {
    throw new Error("Session discovery references an unavailable Session.");
  }

  return sessions as Session[];
}

export async function getCourseCurriculum(
  courseId: string,
): Promise<CourseCurriculumModule[]> {
  const modules = await getCourseModules(courseId);
  const sessionsByModule = await Promise.all(
    modules.map((module) => getModuleSessions(courseId, module.id)),
  );
  return buildCourseCurriculum(modules, sessionsByModule);
}

export async function getModuleSessionIds(
  courseId: string,
  moduleId: string,
): Promise<string[]> {
  const snapshot = await getDoc(
    doc(
      firebaseDb,
      "courses",
      courseId,
      "modules",
      moduleId,
      "sessionDiscovery",
      SESSION_DISCOVERY_DOCUMENT_ID,
    ),
  );
  if (!snapshot.exists()) {
    throw new Error("Session discovery manifest is unavailable.");
  }

  return [...mapSessionDiscoveryManifest(snapshot.data()).sessionIds];
}

export async function getSessionById(
  courseId: string,
  moduleId: string,
  sessionId: string,
): Promise<Session | null> {
  const snapshot = await getDoc(
    doc(
      firebaseDb,
      "courses",
      courseId,
      "modules",
      moduleId,
      "sessions",
      sessionId,
    ),
  );
  return snapshot.exists()
    ? toSession(snapshot, courseId, moduleId)
    : null;
}
