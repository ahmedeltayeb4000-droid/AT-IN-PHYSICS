import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  browserLocalPersistence,
  browserSessionPersistence,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  updateProfile,
  verifyPasswordResetCode,
} from "firebase/auth";
import type { ConfirmationResult } from "firebase/auth";
import { firebaseAuth } from "../../lib/firebase";
import { normalizeEmail } from "./validation";

const messages: Record<string, string> = {
  "auth/invalid-email": "Enter a valid email address.",
  "auth/invalid-credential": "Your email or password is incorrect.",
  "auth/email-already-in-use": "An account already exists with this email.",
  "auth/weak-password": "Use a stronger password.",
  "auth/too-many-requests": "Too many attempts. Please try again later.",
  "auth/popup-closed-by-user": "Google sign-in was cancelled.",
  "auth/invalid-verification-code": "The verification code is invalid.",
};
export function getAuthError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  return messages[code] || "Something went wrong. Please try again.";
}
export async function signInWithEmail(
  email: string,
  password: string,
  remember: boolean,
) {
  await setPersistence(
    firebaseAuth,
    remember ? browserLocalPersistence : browserSessionPersistence,
  );
  return signInWithEmailAndPassword(firebaseAuth, normalizeEmail(email), password);
}
export async function registerWithEmail(
  name: string,
  email: string,
  password: string,
) {
  const result = await createUserWithEmailAndPassword(
    firebaseAuth,
    normalizeEmail(email),
    password,
  );
  await updateProfile(result.user, { displayName: name.trim() });
  return result;
}
export function signInWithGoogle() {
  return signInWithPopup(firebaseAuth, new GoogleAuthProvider());
}
export function requestPasswordReset(email: string) {
  return sendPasswordResetEmail(firebaseAuth, normalizeEmail(email));
}
export function applyPasswordReset(code: string, password: string) {
  return confirmPasswordReset(firebaseAuth, code, password);
}
export function validatePasswordResetCode(code: string) {
  return verifyPasswordResetCode(firebaseAuth, code);
}
export function createPhoneVerifier(container: string) {
  return new RecaptchaVerifier(firebaseAuth, container, { size: "invisible" });
}
export function requestPhoneCode(
  phoneNumber: string,
  verifier: RecaptchaVerifier,
): Promise<ConfirmationResult> {
  return signInWithPhoneNumber(firebaseAuth, phoneNumber, verifier);
}
