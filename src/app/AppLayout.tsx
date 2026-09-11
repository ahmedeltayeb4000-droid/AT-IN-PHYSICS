import { useState } from "react";
import { signOut } from "firebase/auth";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AnimatedLogo } from "../components/brand/AnimatedLogo";
import { Footer } from "../components/layout/Footer";
import { PageContainer } from "../components/layout/Primitives";
import { useAuth } from "../features/auth/AuthContext";
import { runSignOutOperation } from "../features/auth/signOutOperation";
import { firebaseAuth } from "../lib/firebase";

const navClass = ({ isActive }: { isActive: boolean }) => `min-h-11 rounded-lg px-3 py-3 text-sm font-semibold transition ${isActive ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-white/5 hover:text-text"}`;

export function AppLayout() {
  const { user, loading, claimsLoading, isOwner, staffAccessCodesCreate } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const internalRoute = pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/staff" || pathname.startsWith("/staff/");

  const handleSignOut = async () => {
    if (isSigningOut) return;
    await runSignOutOperation({ signOut: () => signOut(firebaseAuth), navigateHome: () => navigate("/", { replace: true }), setPending: setIsSigningOut, reportError: (error) => console.error("Unable to sign out.", error) });
  };
  const closeMenu = () => setMenuOpen(false);

  if (internalRoute) {
    return <div className="min-h-screen bg-canvas text-text">
      <nav className="sticky top-0 z-50 border-b border-border bg-panel/50 backdrop-blur-md">
        <PageContainer className="flex h-16 items-center justify-between">
          <Link to="/" className="text-xl font-bold text-accent">A.T IN PHYSICS</Link>
          <div className="flex items-center gap-6">
            <Link to="/" className="text-sm font-medium hover:text-accent">Home</Link>
            {!loading && user ? <>
              <Link to="/dashboard" className="text-sm font-medium hover:text-accent">Dashboard</Link>
              {!claimsLoading && isOwner ? <Link to="/admin" className="text-sm font-medium hover:text-accent">Master Control Room</Link> : null}
              {!claimsLoading && staffAccessCodesCreate ? <Link to="/staff/access-codes" className="text-sm font-medium hover:text-accent">Staff Access Codes</Link> : null}
              <button type="button" onClick={handleSignOut} disabled={isSigningOut} className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{isSigningOut ? "Signing Out..." : "Sign Out"}</button>
            </> : null}
            {!loading && !user ? <Link to="/login" className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white">Sign In</Link> : null}
          </div>
        </PageContainer>
      </nav>
      <main><Outlet /></main>
    </div>;
  }

  return <div className="student-premium min-h-screen bg-canvas text-text">
    <header className="sticky top-0 z-50 border-b border-border bg-canvas/90 backdrop-blur-md">
      <PageContainer className="flex min-h-20 items-center justify-between gap-4">
        <Link to="/" onClick={closeMenu} aria-label="A.T IN PHYSICS home" className="shrink-0">
          <AnimatedLogo className="text-base sm:text-lg" />
          <span className="ml-[3.25rem] mt-1 hidden text-[.62rem] font-bold uppercase tracking-[.18em] text-text-muted sm:block">Physicist / Ahmed Eltayeb</span>
        </Link>
        <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-border text-accent md:hidden" aria-expanded={menuOpen} aria-controls="student-navigation" aria-label={menuOpen ? "Close navigation" : "Open navigation"} onClick={() => setMenuOpen((value) => !value)}>
          <span aria-hidden="true" className="text-xl">{menuOpen ? "×" : "☰"}</span>
        </button>
        <nav id="student-navigation" aria-label="Primary navigation" className={`${menuOpen ? "flex" : "hidden"} absolute inset-x-4 top-[calc(100%+.5rem)] flex-col gap-1 rounded-2xl border border-border bg-panel/98 p-3 shadow-2xl md:static md:flex md:flex-row md:items-center md:border-0 md:bg-transparent md:p-0 md:shadow-none`}>
          <NavLink to="/" end className={navClass} onClick={closeMenu}>Home</NavLink>
          {!loading && user ? <>
            <NavLink to="/dashboard" className={navClass} onClick={closeMenu}>Dashboard</NavLink>
            {!claimsLoading && isOwner ? <NavLink to="/admin" className={navClass} onClick={closeMenu}>Master Control Room</NavLink> : null}
            {!claimsLoading && staffAccessCodesCreate ? <NavLink to="/staff/access-codes" className={navClass} onClick={closeMenu}>Staff Access Codes</NavLink> : null}
            <button type="button" onClick={() => { closeMenu(); void handleSignOut(); }} disabled={isSigningOut} className="min-h-11 rounded-xl border border-accent/55 px-4 text-sm font-bold text-accent transition hover:bg-accent/10 disabled:opacity-60">{isSigningOut ? "Signing Out..." : "Sign Out"}</button>
          </> : null}
          {!loading && !user ? <NavLink to="/login" className="min-h-11 rounded-xl bg-accent px-5 py-3 text-center text-sm font-bold text-[#00101a] hover:bg-cyan-light" onClick={closeMenu}>Sign In</NavLink> : null}
          <span className="px-3 py-2 text-[.62rem] font-bold uppercase tracking-[.18em] text-text-subtle sm:hidden">Physicist / Ahmed Eltayeb</span>
        </nav>
      </PageContainer>
    </header>
    <main><Outlet /></main>
    <Footer />
  </div>;
}
