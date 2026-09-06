const { expect, test } = require("@playwright/test");
const { SCENARIOS, THEMES, VIEWPORTS } = require("./visualMatrix.cjs");

for (const scenario of SCENARIOS) {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${scenario.name} · ${theme} · ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${scenario.path}?scenario=${scenario.name}&theme=${theme}`);
        await expect(page.getByTestId("visual-test-shell")).toBeVisible();
        await expect(page.getByTestId("visual-scenario-ready")).toBeVisible();
        await expect(page.getByRole("tab")).toHaveCount(scenario.name === "components" ? 5 : 0);
        await page.evaluate(() => document.fonts?.ready);
        await expect(page).toHaveScreenshot(`${scenario.name}-${theme}-${viewport.name}.png`, {
          fullPage: false,
        });
      });
    }
  }
}
