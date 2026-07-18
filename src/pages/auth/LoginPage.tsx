import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ConfirmationResult, RecaptchaVerifier } from "firebase/auth";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  createPhoneVerifier,
  getAuthError,
  requestPhoneCode,
  signInWithEmail,
  signInWithGoogle,
} from "../../features/auth/authService";
import { isValidEmail, isValidInternationalPhone, safeReturnPath } from "../../features/auth/validation";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname;
  const returnPath = safeReturnPath(from);
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(
    null,
  );
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => () => verifier.current?.clear(), []);
  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isValidEmail(email)) return setError("Enter a valid email address.");
    if (!password) return setError("Enter your password.");
    setIsLoading(true);
    try {
      await signInWithEmail(email, password, remember);
      navigate(returnPath, { replace: true });
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  async function submitGoogle() {
    setError("");
    setIsLoading(true);
    try {
      await signInWithGoogle();
      navigate(returnPath, { replace: true });
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!isValidInternationalPhone(phone))
      return setError(
        "Use a full international number, for example +201000000000.",
      );
    setIsLoading(true);
    try {
      verifier.current?.clear();
      verifier.current = createPhoneVerifier("login-recaptcha");
      setConfirmation(await requestPhoneCode(phone.replace(/[\s()-]/g, ""), verifier.current));
      setNotice("We sent a verification code to your phone.");
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(code) || !confirmation)
      return setError("Enter the six-digit verification code.");
    setIsLoading(true);
    try {
      await confirmation.confirm(code);
      navigate(returnPath, { replace: true });
    } catch (nextError) {
      setError(getAuthError(nextError));
    } finally {
      setIsLoading(false);
    }
  }
  return (
    <AuthFrame
      title="Welcome back"
      description="Continue your physics learning journey."
    >
      <div className="mt-7 flex rounded-xl bg-canvas p-1" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={method === "email"}
          onClick={() => {
            setMethod("email");
            setError("");
            setNotice("");
          }}
          className={
            "flex-1 rounded-lg py-2 text-sm font-semibold " +
            (method === "email"
              ? "bg-panel text-text shadow"
              : "text-text-muted")
          }
        >
          Email
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "phone"}
          onClick={() => {
            setMethod("phone");
            setError("");
            setNotice("");
          }}
          className={
            "flex-1 rounded-lg py-2 text-sm font-semibold " +
            (method === "phone"
              ? "bg-panel text-text shadow"
              : "text-text-muted")
          }
        >
          Phone OTP
        </button>
      </div>
      {method === "email" ? (
        <>
          <form className="mt-6 space-y-4" onSubmit={submitEmail}>
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
            <PasswordInput value={password} onChange={setPassword} />
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 text-text-muted">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="accent-accent"
                />
                Remember me
              </label>
              <Link to="/forgot-password" className="font-medium text-accent">
                Forgot password?
              </Link>
            </div>
            <Button className="w-full" type="submit" isLoading={isLoading}>
              Login
            </Button>
          </form>
          <AuthDivider />
          <GoogleButton onClick={submitGoogle} disabled={isLoading} />
        </>
      ) : (
        <>
          {!confirmation ? (
            <form className="mt-6 space-y-4" onSubmit={sendCode}>
              <Input
                label="Phone number"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+201000000000"
                autoComplete="tel"
                required
              />
              <p className="text-xs leading-5 text-text-subtle">
                Use your country code. Firebase may ask you to complete a
                security check.
              </p>
              <Button className="w-full" type="submit" isLoading={isLoading}>
                Send verification code
              </Button>
            </form>
          ) : (
            <form className="mt-6 space-y-4" onSubmit={verifyCode}>
              <Input
                label="Verification code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
              />
              <Button className="w-full" type="submit" isLoading={isLoading}>
                Verify and login
              </Button>
              <button
                type="button"
                onClick={() => { verifier.current?.clear(); setConfirmation(null); setCode(""); setNotice(""); }}
                className="w-full text-sm text-accent"
              >
                Use a different number
              </button>
            </form>
          )}
          <div id="login-recaptcha" />
        </>
      )}
      {error && <AuthAlert>{error}</AuthAlert>}
      {notice && <AuthAlert tone="success">{notice}</AuthAlert>}
      <p className="mt-6 text-center text-sm text-text-muted">
        New to A.T IN PHYSICS?{" "}
        <Link className="font-semibold text-accent" to="/register">
          Create an account
        </Link>
      </p>
    </AuthFrame>
  );
}
