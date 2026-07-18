import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const control = "mt-1.5 block w-full rounded-xl border border-border bg-canvas px-3 py-2.5 text-sm text-text outline-none transition placeholder:text-text-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }>(({ label, error, className, id, ...props }, ref) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = error ? inputId + "-error" : undefined;
  return <label className="block text-sm font-medium text-text-muted" htmlFor={inputId}>{label}<input ref={ref} id={inputId} aria-invalid={Boolean(error)} aria-describedby={errorId} className={cn(control, error && "border-danger", className)} {...props} />{error && <span id={errorId} className="mt-1 block text-xs text-danger">{error}</span>}</label>;
});
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string }>(({ label, error, className, id, children, ...props }, ref) => {
  const generatedId = useId();
  const inputId = id || generatedId;
  const errorId = error ? inputId + "-error" : undefined;
  return <label className="block text-sm font-medium text-text-muted" htmlFor={inputId}>{label}<select ref={ref} id={inputId} aria-invalid={Boolean(error)} aria-describedby={errorId} className={cn(control, error && "border-danger", className)} {...props}>{children}</select>{error && <span id={errorId} className="mt-1 block text-xs text-danger">{error}</span>}</label>;
});
Select.displayName = "Select";
