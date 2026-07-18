import type { ReactNode, TableHTMLAttributes } from "react";
import { cn } from "./cn";
export function DataTable({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-panel">
      <table
        className={cn("w-full min-w-[560px] text-left text-sm", className)}
        {...props}
      />
    </div>
  );
}
export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-panel-hover text-xs uppercase tracking-wider text-text-muted">
      {children}
    </thead>
  );
}
export function TableCell({ children }: { children: ReactNode }) {
  return <td className="px-5 py-4 text-text">{children}</td>;
}
