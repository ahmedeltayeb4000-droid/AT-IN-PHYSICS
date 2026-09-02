import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageContainer } from "../layout/Primitives";
import { PageTransition } from "../ui/PageTransition";
import {
  contactAvailabilityMessage,
  getContactChannels,
} from "../../config/contact";

export function LegalPage({
  title,
  introduction,
  children,
}: {
  readonly title: string;
  readonly introduction: string;
  readonly children: ReactNode;
}) {
  const channels = getContactChannels();
  return (
    <PageTransition>
      <PageContainer className="py-16 sm:py-20">
        <article className="mx-auto max-w-3xl text-text">
          <p className="text-sm font-bold uppercase tracking-[.2em] text-accent">
            A.T IN PHYSICS
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-6 text-lg leading-8 text-text-muted">
            {introduction}
          </p>
          <div className="mt-12 space-y-10 leading-7 text-text-muted">
            {children}
            <section aria-labelledby="contact-heading">
              <h2 id="contact-heading" className="text-2xl font-bold text-text">
                Contact
              </h2>
              {channels.length ? (
                <ul className="mt-3 space-y-2">
                  {channels.map((channel) => (
                    <li key={channel.href}>
                      <a
                        className="font-semibold text-accent"
                        href={channel.href}
                      >
                        {channel.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3">{contactAvailabilityMessage}</p>
              )}
            </section>
          </div>
          <Link className="mt-12 inline-flex font-semibold text-accent" to="/">
            Return home
          </Link>
        </article>
      </PageContainer>
    </PageTransition>
  );
}

export function LegalSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  const id = `legal-${title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-2xl font-bold text-text">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
