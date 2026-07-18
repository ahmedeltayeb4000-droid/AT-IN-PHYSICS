import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/FormControls";
import {
  AuthAlert,
  AuthDivider,
  AuthFrame,
  GoogleButton,
  PasswordInput,
} from "../../features/auth/AuthUI";
import {
  getAuthError,
  registerWithEmail,
  signInWithGoogle,
} from "../../features/auth/authService";
import { isValidEmail, passwordError } from "../../features/auth/validation";

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Enter your full name.");
    if (!isValidEmail(email))
      return setError("Enter a valid email address.");
    const nextPasswordError = passwordError(password);
    if (nextPasswordError) return setError(nextPasswordError);
    if (!accepted)
      return setError("Please accept the Terms and Privacy Policy.");
    setIsLoading(true);
    try {
      await registerWithEmail(name, email, password);
      navigate("/", { replace: true });
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  async function google() {
    setError("");
    setIsLoading(true);
    try {
      await signInWithGoogle();
      navigate("/", { replace: true });
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <AuthFrame
      title="Create your account"
      description="Start learning physics with confidence."
    >
      <form className="mt-7 space-y-4" onSubmit={submit}>
        <Input
          label="Full name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          minLength={2}
          maxLength={80}
          required
        />
        <Input
          label="Email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          required
        />
        <PasswordInput
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <p className="text-xs leading-5 text-text-subtle">Use 10+ characters with at least three of: uppercase, lowercase, number, symbol.</p>
        <label className="flex items-start gap-2 text-sm leading-5 text-text-muted">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-1 accent-accent"
            required
          />
          I agree to the{" "}
          <a className="text-accent" href="/terms">
            Terms &amp; Conditions
          </a>{" "}
          and{" "}
          <a className="text-accent" href="/privacy">
            Privacy Policy
          </a>
          .
        </label>
        <Button className="w-full" type="submit" isLoading={isLoading}>
          Create account
        </Button>
      </form>
      <AuthDivider />
      <GoogleButton onClick={google} disabled={isLoading} />
      {error && <AuthAlert>{error}</AuthAlert>}
      <p className="mt-6 text-center text-sm text-text-muted">
        Already have an account?{" "}
        <Link className="font-semibold text-accent" to="/login">
          Login
        </Link>
      </p>
    </AuthFrame>
  );
}
