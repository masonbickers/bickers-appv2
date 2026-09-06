import { useRouter } from "expo-router";

import PageShell from "../components/layout/PageShell";
import { StateView } from "../components/ui/AppPrimitives";

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <PageShell mode="static">
      <StateView
        state="error"
        title="This screen does not exist"
        message="The link may be outdated or unavailable."
        actionLabel="Go to home screen"
        onAction={() => router.replace("/")}
      />
    </PageShell>
  );
}
