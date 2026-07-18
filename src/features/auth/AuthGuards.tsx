import type { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { LoadingScreen } from "../../components/ui/LoadingScreen";

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <LoadingScreen label="Checking your session…" />;
  return user ? (
    children
  ) : (
    <Navigate to="/login" replace state={{ from: location }} />
  );
}
export function PublicOnlyRoute({ children }: PropsWithChildren) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen label="Checking your session…" />;
  return user ? <Navigate to="/" replace /> : children;
}
