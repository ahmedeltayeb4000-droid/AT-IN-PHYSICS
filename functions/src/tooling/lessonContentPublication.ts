import { isDeepStrictEqual } from "node:util";
import type { DocumentData, Firestore } from "firebase-admin/firestore";
import {
  validateContentId,
  validateLessonText,
} from "../lessonContent/validation.js";

export type LessonContentPublicationOptions = {
  readonly courseId: string;
  readonly moduleId: string;
  readonly sessionId: string;
  readonly lessonFile: string;
  readonly apply: boolean;
};

export type ValidatedLessonContentTarget = Pick<
  LessonContentPublicationOptions,
  "courseId" | "moduleId" | "sessionId"
>;

export type LessonContentPublicationInspection = {
  readonly currentState: "ABSENT" | "PRESENT";
  readonly currentCharacterCount: number | null;
  readonly proposedCharacterCount: number;
  readonly changeRequired: boolean;
};

export type LessonContentPublicationResult = {
  readonly inspection: LessonContentPublicationInspection;
  readonly writeNecessary: boolean;
  readonly verified: boolean;
};

function optionValue(
  args: readonly string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`The ${option} option requires a value.`);
  }
  return value;
}

export function parseLessonContentPublicationArgs(
  args: readonly string[],
): LessonContentPublicationOptions {
  let courseId: string | undefined;
  let moduleId: string | undefined;
  let sessionId: string | undefined;
  let lessonFile: string | undefined;
  let apply = false;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (
      argument === "--course-id" ||
      argument === "--module-id" ||
      argument === "--session-id" ||
      argument === "--lesson-file"
    ) {
      if (seen.has(argument)) {
        throw new Error(`The ${argument} option may be provided only once.`);
      }
      seen.add(argument);
      const value = optionValue(args, index, argument);
      if (argument === "--course-id") courseId = value;
      if (argument === "--module-id") moduleId = value;
      if (argument === "--session-id") sessionId = value;
      if (argument === "--lesson-file") lessonFile = value;
      index += 1;
      continue;
    }

    if (argument === "--apply") {
      if (apply) {
        throw new Error("The --apply option may be provided only once.");
      }
      apply = true;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  const target = validateLessonContentTarget({ courseId, moduleId, sessionId });
  if (typeof lessonFile !== "string" || !lessonFile.trim()) {
    throw new Error("A non-empty lesson file path is required with --lesson-file.");
  }
  return { ...target, lessonFile, apply };
}

export function validateLessonContentTarget(value: {
  readonly courseId?: unknown;
  readonly moduleId?: unknown;
  readonly sessionId?: unknown;
}): ValidatedLessonContentTarget {
  return {
    courseId: validateContentId("courseId", value.courseId),
    moduleId: validateContentId("moduleId", value.moduleId),
    sessionId: validateContentId("sessionId", value.sessionId),
  };
}

function sessionPath(target: ValidatedLessonContentTarget): string {
  return `courses/${target.courseId}/modules/${target.moduleId}/sessions/${target.sessionId}`;
}

function inspectSessionData(
  data: DocumentData,
  proposedLessonText: string,
): LessonContentPublicationInspection {
  const hasLessonText = Object.prototype.hasOwnProperty.call(data, "lessonText");
  let currentLessonText: string | undefined;
  if (hasLessonText) {
    try {
      currentLessonText = validateLessonText(data.lessonText);
    } catch {
      throw new Error("Existing Session lessonText is malformed.");
    }
  }

  return {
    currentState: hasLessonText ? "PRESENT" : "ABSENT",
    currentCharacterCount: currentLessonText?.length ?? null,
    proposedCharacterCount: proposedLessonText.length,
    changeRequired: currentLessonText !== proposedLessonText,
  };
}

function withoutLessonText(data: DocumentData): DocumentData {
  const result = { ...data };
  delete result.lessonText;
  return result;
}

export async function runLessonContentPublication(
  db: Firestore,
  rawTarget: ValidatedLessonContentTarget,
  proposedValue: unknown,
  apply: boolean,
): Promise<LessonContentPublicationResult> {
  const target = validateLessonContentTarget(rawTarget);
  const proposedLessonText = validateLessonText(proposedValue);
  const reference = db.doc(sessionPath(target));

  if (!apply) {
    const snapshot = await reference.get();
    if (!snapshot.exists) throw new Error("Session was not found.");
    const inspection = inspectSessionData(snapshot.data()!, proposedLessonText);
    return { inspection, writeNecessary: false, verified: false };
  }

  const transactionResult = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error("Session was not found.");
    const before = snapshot.data()!;
    const inspection = inspectSessionData(before, proposedLessonText);
    if (inspection.changeRequired) {
      transaction.update(reference, { lessonText: proposedLessonText });
    }
    return {
      before,
      inspection,
      writeNecessary: inspection.changeRequired,
    };
  });

  const verifiedSnapshot = await reference.get();
  const verifiedData = verifiedSnapshot.data();
  const verified =
    verifiedSnapshot.exists &&
    verifiedData !== undefined &&
    verifiedData.lessonText === proposedLessonText &&
    isDeepStrictEqual(
      withoutLessonText(verifiedData),
      withoutLessonText(transactionResult.before),
    );
  if (!verified) {
    throw new Error("Session lesson content verification failed after apply.");
  }

  return {
    inspection: transactionResult.inspection,
    writeNecessary: transactionResult.writeNecessary,
    verified: true,
  };
}
