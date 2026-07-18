import type { HTMLAttributes } from "react";
import { cn } from "./cn";
export function Badge({
  className,
  tone = "info",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "info" | "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold",
        {
          info: "bg-accent/15 text-accent",
          success: "bg-emerald-400/15 text-emerald-400",
          warning: "bg-amber-400/15 text-amber-400",
          danger: "bg-danger/15 text-danger",
          neutral: "bg-panel-hover text-text-muted",
        }[tone],
        className,
      )}
      {...props}
    />
  );
}
