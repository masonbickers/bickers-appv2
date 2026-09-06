import { useLocalSearchParams } from "expo-router";

import { DesignSystemVisualFixture } from "../../components/dev/DesignSystemVisualFixtures";
import PageShell from "../../components/layout/PageShell";
import { ThemeProvider } from "../../providers/ThemeProvider";

const EMPLOYEE_SCENARIOS = new Set(["components", "employee-list", "employee-form"]);

export default function DesignSystemShowcase() {
  const params = useLocalSearchParams();
  const requested = Array.isArray(params.scenario) ? params.scenario[0] : params.scenario;
  const requestedTheme = Array.isArray(params.theme) ? params.theme[0] : params.theme;
  const scenario = EMPLOYEE_SCENARIOS.has(requested) ? requested : "components";
  const forcedTheme = requestedTheme === "dark" ? "dark" : "light";

  return (
    <ThemeProvider forcedTheme={forcedTheme}>
      <PageShell
        contentSpacing="standard"
        header={{
          variant: "hero",
          eyebrow: "Development · Employee",
          title: scenario === "components" ? "Design system" : scenario === "employee-list" ? "Employee list" : "Employee form",
          subtitle: "Deterministic standard-density visual fixture",
        }}
      >
        <DesignSystemVisualFixture scenario={scenario} />
      </PageShell>
    </ThemeProvider>
  );
}
