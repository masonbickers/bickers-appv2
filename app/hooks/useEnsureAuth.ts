import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { useEffect, useState } from "react";
import { auth } from "../../firebaseConfig"; // ← adjust path if needed

/** Ensures there's a user; signs in anonymously if needed. */
export default function useEnsureAuth() {
  const [user, setUser] = useState(auth.currentUser ?? null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, setUser);
    if (!auth.currentUser) {
      signInAnonymously(auth).catch((e) => {
        console.error("Anonymous sign-in failed:", e);
      });
    }
    return unsub;
  }, []);

  return user;
}
