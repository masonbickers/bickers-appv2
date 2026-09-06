import { Redirect } from "expo-router";
import { resolveWorkspaceAccess } from "../lib/access";
import { useAuth } from "../providers/AuthProvider";

export default function Index() {
  const { loading, isAuthed, employee, workingTermsAccepted } = useAuth();

  if (loading) return null;

  if (isAuthed) {
    if (!workingTermsAccepted) {
      return <Redirect href="/(protected)/working-terms" />;
    }
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

  return <Redirect href="/(auth)/login" />;
}
