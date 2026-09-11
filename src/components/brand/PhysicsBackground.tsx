export function PhysicsBackground() {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute inset-0 opacity-45 [background-image:radial-gradient(rgba(68,198,255,.65)_0.7px,transparent_0.7px)] [background-size:38px_38px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]"/>
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(22,160,220,.17),transparent_35%),radial-gradient(circle_at_88%_52%,rgba(22,160,220,.08),transparent_22%)]"/>
    <svg className="absolute -left-24 top-10 h-72 w-72 text-accent opacity-20 sm:left-4" viewBox="0 0 300 300"><ellipse cx="150" cy="150" rx="115" ry="42" fill="none" stroke="currentColor"/><ellipse cx="150" cy="150" rx="115" ry="42" fill="none" stroke="currentColor" transform="rotate(60 150 150)"/><ellipse cx="150" cy="150" rx="115" ry="42" fill="none" stroke="currentColor" transform="rotate(120 150 150)"/><circle cx="150" cy="150" r="12" fill="none" stroke="currentColor"/></svg>
    <svg className="absolute -right-24 top-24 hidden h-96 w-96 text-accent opacity-[.16] sm:block" viewBox="0 0 300 300"><path d="M150 18 282 112 232 270 68 270 18 112Z M150 18 150 210 18 112 282 112 150 210 68 270 M150 210 232 270" fill="none" stroke="currentColor"/><circle cx="210" cy="145" r="8" fill="currentColor"/></svg>
    <svg className="absolute bottom-6 left-[8%] hidden h-16 w-48 text-accent opacity-25 md:block" viewBox="0 0 200 60"><path d="M0 30c15-40 25 40 40 0s25 40 40 0 25 40 40 0 25 40 40 0 25 40 40 0" fill="none" stroke="currentColor"/></svg>
  </div>;
}
