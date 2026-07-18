import { AnimatedLogo } from "../brand/AnimatedLogo";
export function Footer() {
  return (
    <footer className="border-t border-border bg-panel">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-sm text-text-muted sm:px-8 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <AnimatedLogo className="text-sm" />
          <p className="mt-4 max-w-sm leading-6">
            A modern home for clear, ambitious physics learning.
          </p>
          <p className="mt-3 text-xs font-semibold tracking-wider text-accent">
            PHYSICIST | AHMED ELTAYEB
          </p>
        </div>
        <div>
          <p className="font-bold text-text">Explore</p>
          <div className="mt-3 grid gap-2">
            <a href="#about">About</a>
            <a href="#features">Features</a>
            <a href="#faq">FAQ</a>
          </div>
        </div>
        <div>
          <p className="font-bold text-text">Connect</p>
          <div className="mt-3 grid gap-2">
            <a href="mailto:hello@atinphysics.com">Email us</a>
            <a href="https://wa.me/201000000000">WhatsApp</a>
            <a href="#contact">Contact</a>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-5 text-center text-xs text-text-subtle">
        © {new Date().getFullYear()} A.T IN PHYSICS. All rights reserved.
      </div>
    </footer>
  );
}
