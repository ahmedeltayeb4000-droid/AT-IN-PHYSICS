import {
  validateProtectedResourceId,
  type ProtectedResourceAccess,
  type ProtectedResourceMetadata,
  type ProtectedResourceScope,
} from "../../../functions/src/protectedResources/format.ts";
import {
  mapProtectedResourceAccessDocument,
  mapProtectedResourceMetadataDocument,
  sortProtectedResourceMetadata,
} from "./resourceMapper.ts";

type ResourceDocumentSnapshot = Readonly<{
  id: string;
  exists(): boolean;
  data(): unknown;
}>;

type ResourceQuerySnapshot = Readonly<{
  docs: readonly ResourceDocumentSnapshot[];
}>;

export type ProtectedResourceReadDependencies = Readonly<{
  list(path: readonly string[]): Promise<ResourceQuerySnapshot>;
  get(path: readonly string[]): Promise<ResourceDocumentSnapshot>;
}>;

let defaultDependenciesPromise:
  | Promise<ProtectedResourceReadDependencies>
  | undefined;

function defaultDependencies(): Promise<ProtectedResourceReadDependencies> {
  defaultDependenciesPromise ??= Promise.all([
    import("firebase/firestore"),
    import("../../lib/firebase"),
  ]).then(([firestore, firebase]) => ({
    async list(path) {
      return firestore.getDocs(
        firestore.collection(firebase.firebaseDb, path.join("/")),
      );
    },
    async get(path) {
      return firestore.getDoc(
        firestore.doc(firebase.firebaseDb, path.join("/")),
      );
    },
  }));
  return defaultDependenciesPromise;
}

export type ProtectedResourceRepositoryErrorCode =
  | "validation"
  | "unauthorized"
  | "unavailable"
  | "malformed";

export class ProtectedResourceRepositoryError extends Error {
  readonly code: ProtectedResourceRepositoryErrorCode;

  constructor(code: ProtectedResourceRepositoryErrorCode) {
    super("Protected resource is unavailable.");
    this.code = code;
    this.name = "ProtectedResourceRepositoryError";
  }
}

function validatedId(value: unknown): string {
  try {
    return validateProtectedResourceId(value);
  } catch {
    throw new ProtectedResourceRepositoryError("validation");
  }
}

function malformed(): never {
  throw new ProtectedResourceRepositoryError("malformed");
}

function mapMetadata(
  documentId: string,
  data: unknown,
  scope: ProtectedResourceScope,
): ProtectedResourceMetadata {
  try {
    return mapProtectedResourceMetadataDocument(documentId, data, scope);
  } catch (cause) {
    if (cause instanceof ProtectedResourceRepositoryError) throw cause;
    return malformed();
  }
}

function mapSnapshot(
  snapshot: ResourceDocumentSnapshot,
  scope: ProtectedResourceScope,
): ProtectedResourceMetadata {
  return mapMetadata(snapshot.id, snapshot.data(), scope);
}

function mapAccess(
  snapshot: ResourceDocumentSnapshot,
  metadata: ProtectedResourceMetadata,
): ProtectedResourceAccess {
  try {
    return mapProtectedResourceAccessDocument(
      snapshot.id,
      snapshot.data(),
      metadata,
    );
  } catch {
    return malformed();
  }
}

function repositoryFailure(cause: unknown): never {
  if (cause instanceof ProtectedResourceRepositoryError) throw cause;
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? String(cause.code)
      : "";
  throw new ProtectedResourceRepositoryError(
    code === "permission-denied" || code.endsWith("/permission-denied")
      ? "unauthorized"
      : "unavailable",
  );
}

export async function getCourseResources(
  courseIdValue: unknown,
  dependencies?: ProtectedResourceReadDependencies,
): Promise<ProtectedResourceMetadata[]> {
  const courseId = validatedId(courseIdValue);
  const scope = { type: "course", courseId } as const;
  try {
    const reads = dependencies ?? (await defaultDependencies());
    const snapshot = await reads.list(
      ["courses", courseId, "resources"],
    );
    return sortProtectedResourceMetadata(
      snapshot.docs.map((document) => mapSnapshot(document, scope)),
    );
  } catch (cause) {
    return repositoryFailure(cause);
  }
}

export async function getSessionResources(
  courseIdValue: unknown,
  moduleIdValue: unknown,
  sessionIdValue: unknown,
  dependencies?: ProtectedResourceReadDependencies,
): Promise<ProtectedResourceMetadata[]> {
  const courseId = validatedId(courseIdValue);
  const moduleId = validatedId(moduleIdValue);
  const sessionId = validatedId(sessionIdValue);
  const scope = { type: "session", courseId, moduleId, sessionId } as const;
  try {
    const reads = dependencies ?? (await defaultDependencies());
    const snapshot = await reads.list(
      [
        "courses",
        courseId,
        "modules",
        moduleId,
        "sessions",
        sessionId,
        "resources",
      ],
    );
    return sortProtectedResourceMetadata(
      snapshot.docs.map((document) => mapSnapshot(document, scope)),
    );
  } catch (cause) {
    return repositoryFailure(cause);
  }
}

function getResourceAccess(
  scope: ProtectedResourceScope,
  dependencies: ProtectedResourceReadDependencies,
): (resourceId: string) => Promise<ProtectedResourceAccess> {
  const prefix =
    scope.type === "course"
      ? ["courses", scope.courseId, "resources"]
      : [
          "courses",
          scope.courseId,
          "modules",
          scope.moduleId,
          "sessions",
          scope.sessionId,
          "resources",
        ];
  return async (resourceId: string) => {
    try {
      const metadataSnapshot = await dependencies.get([...prefix, resourceId]);
      if (!metadataSnapshot.exists()) return malformed();
      const metadata = mapMetadata(
        metadataSnapshot.id,
        metadataSnapshot.data(),
        scope,
      );
      const accessSnapshot = await dependencies.get(
        [...prefix, resourceId, "access", "primary"],
      );
      if (!accessSnapshot.exists() || accessSnapshot.id !== "primary") {
        return malformed();
      }
      return mapAccess(accessSnapshot, metadata);
    } catch (cause) {
      return repositoryFailure(cause);
    }
  };
}

export async function getCourseResourceAccess(
  courseIdValue: unknown,
  resourceIdValue: unknown,
  dependencies?: ProtectedResourceReadDependencies,
): Promise<ProtectedResourceAccess> {
  const courseId = validatedId(courseIdValue);
  const resourceId = validatedId(resourceIdValue);
  try {
    const reads = dependencies ?? (await defaultDependencies());
    const read = getResourceAccess({ type: "course", courseId }, reads);
    return await read(resourceId);
  } catch (cause) {
    return repositoryFailure(cause);
  }
}

export async function getSessionResourceAccess(
  courseIdValue: unknown,
  moduleIdValue: unknown,
  sessionIdValue: unknown,
  resourceIdValue: unknown,
  dependencies?: ProtectedResourceReadDependencies,
): Promise<ProtectedResourceAccess> {
  const courseId = validatedId(courseIdValue);
  const moduleId = validatedId(moduleIdValue);
  const sessionId = validatedId(sessionIdValue);
  const resourceId = validatedId(resourceIdValue);
  try {
    const reads = dependencies ?? (await defaultDependencies());
    const read = getResourceAccess(
      { type: "session", courseId, moduleId, sessionId },
      reads,
    );
    return await read(resourceId);
  } catch (cause) {
    return repositoryFailure(cause);
  }
}
