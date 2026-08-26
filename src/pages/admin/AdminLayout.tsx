import { NavLink, Outlet } from "react-router-dom";
import { PageContainer } from "../../components/layout/Primitives";

const links = [
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/courses", label: "Courses", end: false },
] as const;

export function AdminLayout() {
  return (
    <PageContainer className="py-8 sm:py-10">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-accent">
          Owner workspace
        </p>
        <h1 className="mt-2 text-2xl font-bold text-text sm:text-3xl">
          Master Control Room
        </h1>
      </div>
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label="Master Control Room"
          className="flex gap-2 overflow-x-auto rounded-xl border border-border bg-panel/60 p-2 md:flex-col md:self-start"
        >
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${isActive ? "bg-accent text-white" : "text-text-muted hover:bg-canvas hover:text-text"}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </PageContainer>
  );
}
