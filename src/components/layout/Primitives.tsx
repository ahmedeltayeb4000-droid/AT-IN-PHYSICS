import type { HTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { PhysicsBackground } from "../brand/PhysicsBackground";
import { cn } from "../ui/cn";
export function Layout({ children }: PropsWithChildren) {
  return <div className="min-h-screen bg-canvas text-text">{children}</div>;
}
export function PageContainer({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-7xl px-5 sm:px-8", className)}
      {...props}
    />
  );
}
export function Section({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("py-12 sm:py-16 lg:py-20", className)} {...props}>
      {children}
    </section>
  );
}
export function Hero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden py-20 sm:py-28">
      <PhysicsBackground />
      <PageContainer className="relative">
        <div className="max-w-3xl">
          {eyebrow && (
            <p className="mb-4 text-sm font-bold uppercase tracking-[.2em] text-accent">
              {eyebrow}
            </p>
          )}
          <h1 className="font-display text-4xl font-bold tracking-tight text-text sm:text-6xl">
            {title}
          </h1>
          {description && (
            <p className="mt-6 max-w-2xl text-lg leading-8 text-text-muted">
              {description}
            </p>
          )}
          {children && <div className="mt-8">{children}</div>}
        </div>
      </PageContainer>
    </section>
  );
}
