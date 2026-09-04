import {
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
  FREE_SESSION_DISCOVERY_DOCUMENT_ID,
  mapFreeSessionDiscoveryManifest,
  mapSessionDiscoveryManifest,
} from "./sessionDiscovery";
import {
  buildCourseCurriculum,
  type CourseCurriculumModule,
} from "./courseCurriculum";
import {
  composeSessionDetail,
  SessionDetailUnavailableError,
  type SessionDetail,
} from "./sessionDetail";
import { mapSessionDocument } from "./sessionMapper";
import type { Course, Module, Session } from "./types";

type CourseDocument = Omit<Course, "id">;
type ModuleDocument = Pick<Module, "title" | "order">;
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

function toModule(snapshot: DocumentSnapshot, courseId: string): Module {
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

export async function getCourseById(courseId: string): Promise<Course | null> {
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

export async function getModuleById(
  courseId: string,
  moduleId: string,
): Promise<Module | null> {
  const snapshot = await getDoc(
    doc(firebaseDb, "courses", courseId, "modules", moduleId),
  );
  return snapshot.exists() ? toModule(snapshot, courseId) : null;
}

export async function getModuleSessions(
  courseId: string,
  moduleId: string,
): Promise<Session[]> {
  const sessionIds = await getModuleSessionIds(courseId, moduleId);
  const results = await Promise.allSettled(
    sessionIds.map((sessionId) =>
      getSessionById(courseId, moduleId, sessionId),
    ),
  );

  const unexpected = results.find(
    (result) =>
      result.status === "rejected" &&
      !String(
        typeof result.reason === "object" &&
          result.reason !== null &&
          "code" in result.reason
          ? result.reason.code
          : "",
      ).endsWith("permission-denied"),
  );
  if (unexpected?.status === "rejected") throw unexpected.reason;
  const sessions = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

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

export type PublicFreeSession = {
  readonly course: Course;
  readonly module: Module;
  readonly id: string;
  readonly title: string;
  readonly order: number;
};

export async function getPublicFreeSessions(
  course: Course,
): Promise<PublicFreeSession[]> {
  const modules = await getCourseModules(course.id);
  const manifests = await Promise.all(
    modules.map(async (module) => {
      const snapshot = await getDoc(
        doc(
          firebaseDb,
          "courses",
          course.id,
          "modules",
          module.id,
          "sessionDiscovery",
          FREE_SESSION_DISCOVERY_DOCUMENT_ID,
        ),
      );
      if (!snapshot.exists()) return [];
      return mapFreeSessionDiscoveryManifest(snapshot.data()).map(
        (session) => ({
          course,
          module,
          ...session,
        }),
      );
    }),
  );
  return manifests
    .flat()
    .sort(
      (left, right) =>
        left.module.order - right.module.order ||
        left.order - right.order ||
        left.id.localeCompare(right.id, "en"),
    );
}

export async function getPublicFreeSessionsForCourses(
  courses: readonly Course[],
): Promise<PublicFreeSession[]> {
  const sessions = await Promise.all(courses.map(getPublicFreeSessions));
  return sessions.flat().sort((left, right) => {
    const byCourse = left.course.title.localeCompare(right.course.title, "en");
    return (
      byCourse ||
      left.module.order - right.module.order ||
      left.order - right.order ||
      left.id.localeCompare(right.id, "en")
    );
  });
}

export async function getPublicFreeSessionDetail(
  course: Course,
  moduleId: string,
  sessionId: string,
): Promise<SessionDetail> {
  const module = await getModuleById(course.id, moduleId);
  if (!module) throw new SessionDetailUnavailableError("module-unavailable");
  const manifestSnapshot = await getDoc(
    doc(
      firebaseDb,
      "courses",
      course.id,
      "modules",
      moduleId,
      "sessionDiscovery",
      FREE_SESSION_DISCOVERY_DOCUMENT_ID,
    ),
  );
  if (!manifestSnapshot.exists()) {
    throw new SessionDetailUnavailableError("session-not-discovered");
  }
  const freeIds = mapFreeSessionDiscoveryManifest(manifestSnapshot.data()).map(
    (item) => item.id,
  );
  if (!freeIds.includes(sessionId)) {
    throw new SessionDetailUnavailableError("session-not-discovered");
  }
  const session = await getSessionById(course.id, moduleId, sessionId);
  const detail = composeSessionDetail(
    course,
    module,
    freeIds,
    sessionId,
    session,
  );
  if (!detail.session.isFree) {
    throw new SessionDetailUnavailableError("session-unavailable");
  }
  return detail;
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
    ? mapSessionDocument(snapshot.id, courseId, moduleId, snapshot.data())
    : null;
}

export async function getSessionDetail(
  course: Course,
  moduleId: string,
  sessionId: string,
): Promise<SessionDetail> {
  let module: Module | null;
  try {
    module = await getModuleById(course.id, moduleId);
  } catch (cause) {
    throw new SessionDetailUnavailableError("module-unavailable", { cause });
  }
  if (module === null) {
    throw new SessionDetailUnavailableError("module-unavailable");
  }

  let discoveredSessionIds: string[];
  try {
    discoveredSessionIds = await getModuleSessionIds(course.id, module.id);
  } catch (cause) {
    throw new SessionDetailUnavailableError("discovery-unavailable", { cause });
  }
  if (!discoveredSessionIds.includes(sessionId)) {
    throw new SessionDetailUnavailableError("session-not-discovered");
  }

  let session: Session | null;
  try {
    session = await getSessionById(course.id, module.id, sessionId);
  } catch (cause) {
    throw new SessionDetailUnavailableError("session-unavailable", { cause });
  }

  return composeSessionDetail(
    course,
    module,
    discoveredSessionIds,
    sessionId,
    session,
  );
}
