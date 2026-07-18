import type { HTMLAttributes } from "react";
import { cn } from "./cn";
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-panel p-5 shadow-xl shadow-black/10 backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}
export function GlassCard({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/15 bg-white/5 p-5 shadow-2xl backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}
