import { createContext, useContext } from "react";
import type { User } from "firebase/auth";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => useContext(AuthContext)!;
