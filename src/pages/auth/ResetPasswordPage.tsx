import { useState } from "react";
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
} from "../../features/auth/authService";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const code = params.get("oobCode") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!code)
      return setError("This password reset link is invalid or incomplete.");
    if (password.length < 6)
      return setError("Use a password of at least 6 characters.");
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
        <Button className="w-full" type="submit" isLoading={isLoading}>
          Save new password
        </Button>
      </form>
      {error && <AuthAlert>{error}</AuthAlert>}
      {success && (
        <AuthAlert tone="success">
          Your password has been reset. You can now log in.
        </AuthAlert>
      )}
      <p className="mt-6 text-center text-sm text-text-muted">
        <Link className="font-semibold text-accent" to="/login">
          Back to login
        </Link>
      </p>
    </AuthFrame>
  );
}
