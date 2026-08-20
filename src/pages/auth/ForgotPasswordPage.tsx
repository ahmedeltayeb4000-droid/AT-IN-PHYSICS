import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/FormControls";
import { AuthAlert, AuthFrame } from "../../features/auth/AuthUI";
import {
  getAuthError,
  requestPasswordReset,
} from "../../features/auth/authService";
import { isValidEmail } from "../../features/auth/validation";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSent(false);
    if (!isValidEmail(email))
      return setError("Enter a valid email address.");
    setIsLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <AuthFrame
      title="Reset your password"
      description="Enter your email and we’ll send a secure reset link."
    >
      <form className="mt-7 space-y-4" onSubmit={submit}>
        <Input
          label="Email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
        <Button className="w-full" type="submit" isLoading={isLoading}>
          Send reset link
        </Button>
      </form>
      {error && <AuthAlert>{error}</AuthAlert>}
      {sent && (
        <AuthAlert tone="success">
          Check your inbox for a password reset link.
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
