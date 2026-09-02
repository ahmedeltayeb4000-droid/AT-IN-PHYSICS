import { AnimatedLogo } from "../brand/AnimatedLogo";
import { Link } from "react-router-dom";
import {
  contactAvailabilityMessage,
  getContactChannels,
} from "../../config/contact";
export function Footer() {
  const contactChannels = getContactChannels();
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
            <Link to="/terms">Terms of Service</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </div>
        </div>
        <div>
          <p className="font-bold text-text">Connect</p>
          {contactChannels.length ? (
            <div className="mt-3 grid gap-2">
              {contactChannels.map((channel) => (
                <a key={channel.href} href={channel.href}>
                  {channel.label}
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-3 leading-6">{contactAvailabilityMessage}</p>
          )}
        </div>
      </div>
      <div className="border-t border-border px-5 py-5 text-center text-xs text-text-subtle">
        © {new Date().getFullYear()} A.T IN PHYSICS. All rights reserved.
      </div>
    </footer>
  );
}
