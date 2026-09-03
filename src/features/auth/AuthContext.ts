import { createContext, useContext } from "react";
import type { User } from "firebase/auth";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  claimsLoading: boolean;
  isOwner: boolean;
  staffAccessCodesCreate: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => useContext(AuthContext)!;
