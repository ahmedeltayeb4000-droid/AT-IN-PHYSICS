import { Link } from "react-router-dom";
import { PageTransition } from "../../components/ui/PageTransition";
export function NotFoundPage() {
  return (
    <PageTransition>
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center px-5 sm:px-8">
        <div>
          <p className="font-display text-8xl font-bold text-cyan">404</p>
          <h1 className="mt-3 font-display text-3xl font-bold text-white">
            This page is outside our orbit.
          </h1>
          <Link
            to="/"
            className="mt-7 inline-block rounded-lg bg-cyan px-5 py-3 font-semibold text-navy"
          >
            Return home
          </Link>
        </div>
      </section>
    </PageTransition>
  );
}
