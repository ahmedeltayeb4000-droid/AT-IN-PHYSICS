import { Link } from "react-router-dom";
import { PageTransition } from "../../components/ui/PageTransition";
import { PhysicsBackground } from "../../components/brand/PhysicsBackground";
export function NotFoundPage() {
  return (
    <PageTransition>
      <section className="student-premium relative flex min-h-screen items-center overflow-hidden bg-canvas px-5 text-text sm:px-8">
        <PhysicsBackground />
        <div className="relative mx-auto w-full max-w-7xl">
          <p className="font-display text-8xl font-bold text-cyan">404</p>
          <h1 className="mt-3 font-display text-3xl font-bold text-white">
            This page is outside our orbit.
          </h1>
          <Link
            to="/"
            className="at-link-button mt-7"
          >
            Return home
          </Link>
        </div>
      </section>
    </PageTransition>
  );
}
