import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import {
  AuthAlert,
  AuthFrame,
  PasswordInput,
} from "../../features/auth/AuthUI";
import {
  applyPasswordReset,
  getAuthError,
  validatePasswordResetCode,
} from "../../features/auth/authService";
import { passwordError } from "../../features/auth/validation";

type CodeValidation = {
  code: string;
  status: "valid" | "invalid";
  message?: string;
};

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const code = params.get("oobCode") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [codeValidation, setCodeValidation] = useState<CodeValidation | null>(
    null,
  );

  useEffect(() => {
    if (!code) return;

    let cancelled = false;

    validatePasswordResetCode(code)
      .then(() => {
        if (!cancelled) setCodeValidation({ code, status: "valid" });
      })
      .catch((validationError: unknown) => {
        if (!cancelled) {
          setCodeValidation({
            code,
            status: "invalid",
            message: getAuthError(validationError),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!code || codeValidation?.code !== code || codeValidation.status !== "valid")
      return setError("This password reset link is invalid or incomplete.");
    const nextPasswordError = passwordError(password);
    if (nextPasswordError) return setError(nextPasswordError);
    if (password !== confirmPassword)
      return setError("Passwords do not match.");
    setIsLoading(true);
    try {
      await applyPasswordReset(code, password);
      setSuccess(true);
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <AuthFrame
      title="Choose a new password"
      description="Use a strong password you do not use elsewhere."
    >
      {!code && (
        <AuthAlert>This password reset link is invalid or incomplete.</AuthAlert>
      )}
      {code && codeValidation?.code !== code && (
        <p className="mt-7 text-sm text-text-muted" role="status">
          Checking your password reset link...
        </p>
      )}
      {codeValidation?.code === code && codeValidation.status === "invalid" && (
        <AuthAlert>
          {codeValidation.message || "This password reset link is invalid or expired."}
        </AuthAlert>
      )}
      {codeValidation?.code === code && codeValidation.status === "valid" && !success && (
        <>
          <form className="mt-7 space-y-4" onSubmit={submit}>
            <PasswordInput
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
            <PasswordInput
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
            />
            <p className="text-xs leading-5 text-text-subtle">
              Use 10+ characters with at least three of: uppercase, lowercase,
              number, symbol.
            </p>
            <Button className="w-full" type="submit" isLoading={isLoading}>
              Save new password
            </Button>
          </form>
          {error && <AuthAlert>{error}</AuthAlert>}
        </>
      )}
      {success && (
        <AuthAlert tone="success">
          Your password has been reset. You can now log in.
        </AuthAlert>
      )}
      <p className="mt-6 text-center text-sm text-text-muted">
        <Link
          className="font-semibold text-accent"
          to={success ? "/login" : "/forgot-password"}
        >
          {success ? "Back to login" : "Request a new reset link"}
        </Link>
      </p>
    </AuthFrame>
  );
}
