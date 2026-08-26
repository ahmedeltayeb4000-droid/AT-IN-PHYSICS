import { useState } from "react";
import { signOut } from "firebase/auth";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { PageContainer } from "../components/layout/Primitives";
import { useAuth } from "../features/auth/AuthContext";
import { firebaseAuth } from "../lib/firebase";

export function AppLayout() {
  const { user, loading, claimsLoading, isOwner } = useAuth();
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);

    try {
      await signOut(firebaseAuth);
      navigate("/");
    } catch (error) {
      console.error("Unable to sign out.", error);
      setIsSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-text">
      <nav className="border-b border-border bg-panel/50 backdrop-blur-md sticky top-0 z-50">
        <PageContainer className="flex items-center justify-between h-16">
          <Link to="/" className="text-xl font-bold text-accent">
            A.T IN PHYSICS
          </Link>

          <div className="flex items-center gap-6">
            <Link to="/" className="text-sm font-medium hover:text-accent">
              Home
            </Link>
            {!loading && user && (
              <>
                <Link
                  to="/dashboard"
                  className="text-sm font-medium hover:text-accent"
                >
                  Dashboard
                </Link>
                {!claimsLoading && isOwner ? (
                  <Link
                    to="/admin"
                    className="text-sm font-medium hover:text-accent"
                  >
                    Master Control Room
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="text-sm font-bold bg-accent text-white px-4 py-2 rounded-lg disabled:opacity-60"
                >
                  {isSigningOut ? "Signing Out..." : "Sign Out"}
                </button>
              </>
            )}
            {!loading && !user && (
              <Link
                to="/login"
                className="text-sm font-bold bg-accent text-white px-4 py-2 rounded-lg"
              >
                Sign In
              </Link>
            )}
          </div>
        </PageContainer>
      </nav>

      <main>
        <Outlet />
      </main>
    </div>
  );
}
