import type { ReactNode } from "react";
import { cn } from "../ui/cn";
export function Sidebar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "hidden w-64 shrink-0 border-e border-border bg-panel p-4 lg:block",
        className,
      )}
    >
      {children}
    </aside>
  );
}
