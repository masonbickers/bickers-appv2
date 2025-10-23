import { auth as rawAuth } from "@/firebaseConfig";
import { useRouter } from "expo-router";
import { onAuthStateChanged, type Auth, type User } from "firebase/auth";
import { useEffect, useState } from "react";

const auth = rawAuth as Auth;

export type UseEnsureAuthResult = {
  user: User | null;
  loading: boolean;
};

export default function useEnsureAuth(requireAuth = false): UseEnsureAuthResult {
  const [user, setUser] = useState<User | null>(auth.currentUser as User | null);
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);

      // If this layout requires auth and there is no user -> go to login
      if (requireAuth && !u) {
        router.replace("/(auth)/login");
      }
    });

    return () => unsub();
  }, [requireAuth]);

  return { user, loading };
}
