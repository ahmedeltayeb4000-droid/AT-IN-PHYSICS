import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from "firebase-functions/v2/https";
import {
  hasDecodedOwnerClaim,
  parseManualGrantInput,
} from "./validation.js";
import {
  ManualEnrollmentGrantError,
  runTrustedManualEnrollmentGrant,
} from "./manualEnrollmentGrant.js";

type GrantEnrollmentResponse = {
  readonly status: "created" | "already-active";
  readonly enrollmentId: string;
};

function invalidArgument(error: unknown): never {
  throw new HttpsError(
    "invalid-argument",
    error instanceof Error ? error.message : "Invalid grant request.",
  );
}

async function handleGrantEnrollment(
  request: CallableRequest<unknown>,
): Promise<GrantEnrollmentResponse> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required.");
  }
  if (!hasDecodedOwnerClaim(request.auth.token)) {
    throw new HttpsError("permission-denied", "Owner authority is required.");
  }
  const actorUserId = request.auth.uid;

  try {
    const input = parseManualGrantInput(request.data);
    const result = await runTrustedManualEnrollmentGrant(
      getAuth(),
      getFirestore(),
      { ...input, apply: true },
      actorUserId,
      new Date(),
    );
    return { status: result.applyStatus!, enrollmentId: result.enrollmentId };
  } catch (error) {
    if (error instanceof ManualEnrollmentGrantError) {
      throw new HttpsError(error.code, error.message);
    }
    invalidArgument(error);
  }
}

export const grantEnrollment = onCall(async (request) => {
  try {
    return await handleGrantEnrollment(request);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("grantEnrollment failed unexpectedly.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new HttpsError("internal", "Unable to grant enrollment.");
  }
});
