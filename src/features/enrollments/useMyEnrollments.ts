import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { getEnrollmentsForUser } from "./enrollmentRepository";

export function useMyEnrollments() {
  const { user } = useAuth();
  const userId = user?.uid;

  return useQuery({
    queryKey: ["enrollments", "user", userId ?? null],
    queryFn: () => getEnrollmentsForUser(userId!),
    enabled: Boolean(userId),
  });
}
