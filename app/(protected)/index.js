// app/(protected)/index.js
import { Redirect } from "expo-router";
import { useAuth } from "../providers/AuthProvider"; // ← import the hook (one level up from (protected))

export default function ProtectedIndexRedirect() {
  const { user, loading } = useAuth();

  // Wait for Firebase to hydrate once (prevents flicker/loop)
  if (loading) return null;

  if (user) {
    // You’re already inside the (protected) group, so use a RELATIVE path:
    return <Redirect href="./screens/homescreen" />;
    // (If you prefer absolute, include the group: href="/(protected)/screens/homescreen")
  }

  // If somehow reached here without a user, push to the auth stack:
  return <Redirect href="/(auth)/login" />;
}
