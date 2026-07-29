// app/(protected)/index.js
import { Redirect } from "expo-router";
import { resolveWorkspaceAccess } from "../../lib/access";
import { useAuth } from "../../providers/AuthProvider"; // ← import the hook (one level up from (protected))

export default function ProtectedIndexRedirect() {
  const { loading, isAuthed, employee } = useAuth();

  // Wait for Firebase to hydrate once (prevents flicker/loop)
  if (loading) return null;

  if (isAuthed) {
    const access = resolveWorkspaceAccess(employee);
    const serviceOnly = access.service && !access.user;
    return (
      <Redirect
        href={
          serviceOnly
            ? "/(protected)/service/home"
            : "/(protected)/screens/homescreen"
        }
      />
    );
  }

  // If somehow reached here without a user, push to the auth stack:
  return <Redirect href="/(auth)/login" />;
}
