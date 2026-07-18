import type { ComponentProps, ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "./cn";
type Props = Omit<ComponentProps<typeof motion.button>, "children"> & {
  children?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
};
export function Button({
  className,
  variant = "primary",
  size = "md",
  isLoading,
  children,
  disabled,
  ...props
}: Props) {
  return (
    <motion.button
      whileHover={!disabled ? { y: -1 } : undefined}
      whileTap={!disabled ? { scale: 0.98 } : undefined}
      disabled={disabled || isLoading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50",
        {
          primary:
            "bg-accent text-white shadow-lg shadow-accent/20 hover:bg-accent-strong",
          secondary:
            "border border-border bg-panel text-text hover:bg-panel-hover",
          ghost: "text-text-muted hover:bg-panel hover:text-text",
          danger: "bg-danger text-white hover:bg-red-600",
        }[variant],
        { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-sm", lg: "h-12 px-6" }[
          size
        ],
        className,
      )}
      {...props}
    >
      {isLoading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </motion.button>
  );
}
