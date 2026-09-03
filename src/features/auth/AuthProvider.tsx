import { useEffect, useState, type ReactNode } from "react";
import { onIdTokenChanged, type User } from "firebase/auth";
import { firebaseAuth } from "../../lib/firebase";
import { AuthContext } from "./AuthContext";
import { getOwnStaffCapability } from "../staff/staffCapabilityRepository";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [staffAccessCodesCreate, setStaffAccessCodesCreate] = useState(false);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const unsubscribe = onIdTokenChanged(
      firebaseAuth,
      async (nextUser) => {
        const currentRevision = ++revision;
        setUser(nextUser);
        setLoading(false);
        setIsOwner(false);
        setStaffAccessCodesCreate(false);
        if (!nextUser) {
          setClaimsLoading(false);
          return;
        }
        setClaimsLoading(true);
        try {
          const token = await nextUser.getIdTokenResult();
          const capability = await getOwnStaffCapability(nextUser.uid);
          if (active && revision === currentRevision) {
            setIsOwner(token.claims.owner === true);
            setStaffAccessCodesCreate(Boolean(capability));
          }
        } catch {
          if (active && revision === currentRevision) setIsOwner(false);
        } finally {
          if (active && revision === currentRevision) setClaimsLoading(false);
        }
      },
      () => {
        revision += 1;
        setUser(null);
        setIsOwner(false);
        setStaffAccessCodesCreate(false);
        setLoading(false);
        setClaimsLoading(false);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, claimsLoading, isOwner, staffAccessCodesCreate }}
    >
      {children}
    </AuthContext.Provider>
  );
}
