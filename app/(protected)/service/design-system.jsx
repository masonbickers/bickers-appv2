import { useLocalSearchParams } from "expo-router";

import { DesignSystemVisualFixture } from "../../../components/dev/DesignSystemVisualFixtures";
import PageShell from "../../../components/layout/PageShell";
import { ThemeProvider } from "../../../providers/ThemeProvider";

const SERVICE_SCENARIOS = new Set(["service-list", "service-form"]);

export default function ServiceDesignSystemShowcase() {
  const params = useLocalSearchParams();
  const requested = Array.isArray(params.scenario) ? params.scenario[0] : params.scenario;
  const requestedTheme = Array.isArray(params.theme) ? params.theme[0] : params.theme;
  const scenario = SERVICE_SCENARIOS.has(requested) ? requested : "service-list";
  const forcedTheme = requestedTheme === "dark" ? "dark" : "light";

  return (
    <ThemeProvider forcedTheme={forcedTheme}>
      <PageShell
        contentSpacing="compact"
        header={{
          variant: "compact",
          eyebrow: "Development · Workshop",
          title: scenario === "service-form" ? "Workshop form" : "Workshop list",
          subtitle: "Deterministic compact-density visual fixture",
        }}
      >
        <DesignSystemVisualFixture scenario={scenario} />
      </PageShell>
    </ThemeProvider>
  );
}
