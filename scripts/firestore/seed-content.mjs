import console from "node:console";
import process from "node:process";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { courseCatalog } from "../../src/features/courses/courseCatalog.ts";
import {
  curriculumModules,
  curriculumSessions,
} from "../../src/features/courses/curriculumCatalog.ts";
import {
  SESSION_DISCOVERY_DOCUMENT_ID,
  buildSessionDiscoveryManifest,
} from "../../src/features/courses/sessionDiscovery.ts";

const EXPECTED_PROJECT_ID = "at-in-physics";
const DATABASE_ID = "(default)";

function parseMode() {
  const args = process.argv.slice(2);
  const unknownArgs = args.filter((arg) => arg !== "--apply");

  if (unknownArgs.length > 0 || args.filter((arg) => arg === "--apply").length > 1) {
    throw new Error("Usage: npm run firestore:seed [-- --apply]");
  }

  return args.includes("--apply") ? "apply" : "dry-run";
}

function resolvedProjectId() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
}

function releaseTimestamp(releaseAt) {
  const date = new Date(releaseAt);

  if (Number.isNaN(date.getTime())) {
    throw new Error("A curriculum session contains an invalid releaseAt value.");
  }

  return Timestamp.fromDate(date);
}

function buildSeedPlan() {
  const courseIds = new Set(courseCatalog.map((course) => course.id));
  const moduleCourses = new Map();
  const paths = new Set();
  const plan = [];

  const add = (path, data) => {
    if (paths.has(path)) throw new Error(`Duplicate seed path: ${path}`);
    paths.add(path);
    plan.push({ path, data });
  };

  for (const course of courseCatalog) {
    add(`courses/${course.id}`, {
      slug: course.slug,
      title: course.title,
      shortDescription: course.shortDescription,
      status: course.status,
    });
  }

  for (const module of curriculumModules) {
    if (!courseIds.has(module.courseId)) {
      throw new Error(`Module ${module.id} references an unknown course.`);
    }
    if (moduleCourses.has(module.id)) {
      throw new Error(`Duplicate module ID: ${module.id}`);
    }
    moduleCourses.set(module.id, module.courseId);
    add(`courses/${module.courseId}/modules/${module.id}`, {
      title: module.title,
      order: module.order,
    });
  }

  for (const session of curriculumSessions) {
    if (
      !courseIds.has(session.courseId) ||
      moduleCourses.get(session.moduleId) !== session.courseId
    ) {
      throw new Error(`Session ${session.id} has an invalid course/module relationship.`);
    }

    const data = {
      title: session.title,
      order: session.order,
      publicationStatus: session.publicationStatus,
      ...(session.releaseAt
        ? { releaseAt: releaseTimestamp(session.releaseAt) }
        : {}),
    };

    add(
      `courses/${session.courseId}/modules/${session.moduleId}/sessions/${session.id}`,
      data,
    );
  }

  const discoveryTime = new Date();
  for (const module of curriculumModules) {
    add(
      `courses/${module.courseId}/modules/${module.id}/sessionDiscovery/${SESSION_DISCOVERY_DOCUMENT_ID}`,
      buildSessionDiscoveryManifest(
        curriculumSessions,
        module.courseId,
        module.id,
        discoveryTime,
      ),
    );
  }

  return plan;
}

function printableData(data) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      value instanceof Timestamp ? value.toDate().toISOString() : value,
    ]),
  );
}

function intendedDataMatches(expected, actual) {
  if (!actual) return false;

  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (
    expectedKeys.length !== actualKeys.length ||
    expectedKeys.some((key, index) => key !== actualKeys[index])
  ) {
    return false;
  }

  return expectedKeys.every((key) => {
    const expectedValue = expected[key];
    const actualValue = actual[key];
    return expectedValue instanceof Timestamp
      ? actualValue instanceof Timestamp && expectedValue.isEqual(actualValue)
      : Object.is(expectedValue, actualValue);
  });
}

function printPlan(plan, mode, projectId, projectSource) {
  console.log(`Mode: ${mode}`);
  console.log(`Target project: ${projectId} (${projectSource})`);
  console.log(`Firestore database: ${DATABASE_ID}`);
  console.log(`Derived documents: ${plan.length}`);
  for (const item of plan) {
    console.log(`- ${item.path} ${JSON.stringify(printableData(item.data))}`);
  }
}

async function applyPlan(plan, projectId) {
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "firestore-content-seed",
  );

  try {
    const db = getFirestore(app, DATABASE_ID);
    const references = plan.map((item) => db.doc(item.path));
    const snapshots = await db.getAll(...references);
    const missing = [];
    const unchanged = [];
    const conflicts = [];

    snapshots.forEach((snapshot, index) => {
      const item = plan[index];
      if (!snapshot.exists) missing.push(item);
      else if (intendedDataMatches(item.data, snapshot.data())) unchanged.push(item);
      else conflicts.push(item);
    });

    console.log(`Preflight: ${missing.length} missing, ${unchanged.length} unchanged, ${conflicts.length} conflicts.`);

    if (conflicts.length > 0) {
      for (const item of conflicts) console.error(`Conflict: ${item.path}`);
      throw new Error("Conflicts found; zero writes performed.");
    }

    if (missing.length > 0) {
      const batch = db.batch();
      for (const item of missing) batch.create(db.doc(item.path), item.data);
      await batch.commit();
    }

    console.log(`Created: ${missing.length}`);
    console.log(`Unchanged: ${unchanged.length}`);
    console.log("Conflicts: 0");
  } finally {
    await deleteApp(app);
  }
}

async function main() {
  const mode = parseMode();
  const plan = buildSeedPlan();
  const configuredProjectId = resolvedProjectId();

  if (configuredProjectId && configuredProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error("Configured Firebase project does not match the expected production project.");
  }

  if (mode === "dry-run") {
    printPlan(
      plan,
      mode,
      configuredProjectId || EXPECTED_PROJECT_ID,
      configuredProjectId ? "environment" : "offline expected target",
    );
    console.log("Dry run complete: zero Firestore reads or writes performed.");
    return;
  }

  if (configuredProjectId !== EXPECTED_PROJECT_ID) {
    throw new Error(
      "Apply mode requires GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT to equal at-in-physics.",
    );
  }

  printPlan(plan, mode, configuredProjectId, "verified environment");
  try {
    await applyPlan(plan, configuredProjectId);
  } catch {
    throw new Error(
      "Apply did not complete cleanly. Review Firestore state before retrying.",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed tooling failed.");
  process.exitCode = 1;
});
