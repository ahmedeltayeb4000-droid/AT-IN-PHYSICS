import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { resolveOwnerAccessState } from "./ownerAccess";

function AuthLoadingState() {
  return (
    <div
      className="grid min-h-64 place-items-center text-sm text-text-muted"
      role="status"
    >
      Checking your account...
    </div>
  );
}

export function AuthGuard({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingState />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export function OwnerGuard({ children }: { children: ReactElement }) {
  const { user, loading, claimsLoading, isOwner } = useAuth();
  const location = useLocation();
  const state = resolveOwnerAccessState({
    authLoading: loading,
    claimsLoading,
    authenticated: user !== null,
    isOwner,
  });

  if (state === "loading") {
    return (
      <div
        className="grid min-h-64 place-items-center text-sm text-text-muted"
        role="status"
      >
        Verifying owner access...
      </div>
    );
  }
  if (state === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (state === "denied") return <Navigate to="/dashboard" replace />;
  return children;
}

export function StaffAccessCodeGuard({ children }: { children: ReactElement }) {
  const { user, loading, claimsLoading, staffAccessCodesCreate } = useAuth();
  const location = useLocation();
  if (loading || claimsLoading) return <AuthLoadingState />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!staffAccessCodesCreate) return <Navigate to="/dashboard" replace />;
  return children;
}

export function PublicOnlyRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <AuthLoadingState />;
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
