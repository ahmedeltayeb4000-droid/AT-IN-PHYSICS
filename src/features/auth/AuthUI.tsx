import { useState } from "react";
import type { PropsWithChildren, ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AnimatedLogo } from "../../components/brand/AnimatedLogo";
import { PhysicsBackground } from "../../components/brand/PhysicsBackground";
import { Input } from "../../components/ui/FormControls";

export function AuthFrame({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description: string }>) {
  return (
    <main className="relative grid min-h-[calc(100vh-4rem)] place-items-center overflow-x-hidden px-4 py-8 sm:px-5 sm:py-12">
      <PhysicsBackground />
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md rounded-3xl border border-border bg-panel/90 p-7 shadow-2xl backdrop-blur-xl sm:p-9"
      >
        <Link to="/" className="inline-block" aria-label="A.T IN PHYSICS home">
          <AnimatedLogo />
        </Link>
        <h1 className="mt-8 font-display text-3xl font-bold text-text">
          {title}
        </h1>
        <p className="mt-2 text-text-muted">{description}</p>
        {children}
      </motion.section>
    </main>
  );
}
export function AuthAlert({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "success";
}) {
  return (
    <div
      role={tone === "success" ? "status" : "alert"}
      aria-live={tone === "success" ? "polite" : "assertive"}
      className={
        "mt-5 rounded-xl border px-4 py-3 text-sm " +
        (tone === "success"
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-400"
          : "border-danger/25 bg-danger/10 text-danger")
      }
    >
      {children}
    </div>
  );
}
export function PasswordInput({
  label = "Password",
  value,
  onChange,
  error,
  autoComplete = "current-password",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        label={label}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={error}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className="absolute end-3 top-9 min-h-8 min-w-11 text-xs font-semibold text-accent"
      >
        {visible ? "Hide" : "Show"}
      </button>
    </div>
  );
}
export function GoogleButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-4 flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-canvas py-3 text-sm font-semibold text-text transition hover:bg-panel-hover disabled:opacity-50"
    >
      <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-xs font-bold text-blue-600">
        G
      </span>
      Continue with Google
    </button>
  );
}
export function AuthDivider() {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-text-subtle">
      <span className="h-px flex-1 bg-border" />
      OR
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
