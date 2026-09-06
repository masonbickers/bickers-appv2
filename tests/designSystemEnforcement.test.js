import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { resolvePageDensity } from "../lib/design/pageDensity.js";
import { DESIGN_SYSTEM_MIGRATION_MANIFEST } from "./designSystemMigrationManifest.js";

const require = createRequire(import.meta.url);
const config = require("../scripts/design-system/enforcement-config.cjs");
const visualMatrix = require("./visual/visualMatrix.cjs");
const projectRoot = new URL("..", import.meta.url).pathname;
const relative = (file) => path.relative(projectRoot, file).split(path.sep).join("/");
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const absolute = path.join(directory, name);
  return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
});
const appFiles = walk(path.join(projectRoot, "app"))
  .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file));

test("every application route is PageShell-backed or a justified structural exception", () => {
  const registered = new Map(config.STRUCTURAL_ROUTE_EXCEPTIONS.map((entry) => [entry.path, entry.reason]));
  const withoutPageShell = appFiles
    .filter((file) => !readFileSync(file, "utf8").includes("PageShell"))
    .map(relative)
    .sort();
  assert.deepEqual(withoutPageShell, [...registered.keys()].sort());
  for (const [route, reason] of registered) {
    assert.ok(existsSync(path.join(projectRoot, route)), route);
    assert.ok(reason.trim().length >= 12, `${route} needs a useful exception reason`);
  }
});

test("PageShell routes resolve density from their workspace without overrides", () => {
  const structural = new Set(config.STRUCTURAL_ROUTE_EXCEPTIONS.map((entry) => entry.path));
  for (const file of appFiles) {
    const route = relative(file);
    if (structural.has(route)) continue;
    const source = readFileSync(file, "utf8");
    assert.match(source, /<PageShell\b/, route);
    assert.doesNotMatch(source, /<PageShell\b[^>]*\bdensity=/, route);
    const service = route.includes("/(protected)/service/");
    const pathname = service ? "/service/enforcement-check" : "/enforcement-check";
    assert.equal(resolvePageDensity(pathname), service ? "compact" : "standard", route);
  }
});

test("shared input and fixed renderer registries are exact and permanent", () => {
  const inputPaths = new Set(config.SHARED_INPUT_IMPLEMENTATIONS);
  const textInputOwners = walk(path.join(projectRoot, "components"))
    .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file))
    .filter((file) => /import\s*\{[^}]*\bTextInput\b[^}]*\}\s*from\s*["']react-native["']/.test(readFileSync(file, "utf8")))
    .map(relative);
  assert.deepEqual(new Set(textInputOwners), inputPaths);
  for (const file of inputPaths) assert.ok(existsSync(path.join(projectRoot, file)), file);

  const categories = new Set(["chart", "document", "brandArtwork"]);
  const rendererPaths = new Set();
  for (const entry of config.FIXED_COLOR_RENDERERS) {
    assert.ok(entry.path.startsWith("components/renderers/"), entry.path);
    assert.ok(!entry.path.startsWith("app/"), entry.path);
    assert.ok(existsSync(path.join(projectRoot, entry.path)), entry.path);
    assert.ok(categories.has(entry.category), entry.category);
    assert.ok(entry.justification.trim().length >= 12, entry.path);
    assert.ok(!rendererPaths.has(entry.path), `duplicate renderer ${entry.path}`);
    rendererPaths.add(entry.path);
  }
});

test("semantic colours and AppText variants match their shared implementations", () => {
  const theme = readFileSync(path.join(projectRoot, "providers/ThemeProvider.tsx"), "utf8");
  const colorsBlock = theme.match(/type Colors = \{([\s\S]*?)\n\};/)?.[1] || "";
  const themeNames = [...colorsBlock.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):\s*string;/gm)].map((match) => match[1]).sort();
  assert.deepEqual([...config.SEMANTIC_COLOR_NAMES].sort(), themeNames);

  const primitives = readFileSync(path.join(projectRoot, "components/ui/AppPrimitives.js"), "utf8");
  const variantsBlock = primitives.match(/const textVariants = \{([\s\S]*?)\n\};/)?.[1] || "";
  const implemented = [...variantsBlock.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1]).sort();
  assert.deepEqual([...config.APPROVED_TEXT_VARIANTS].sort(), implemented);
});

test("completed migration routes contain no legacy exceptions", () => {
  for (const entry of DESIGN_SYSTEM_MIGRATION_MANIFEST.filter((item) => item.status === "complete")) {
    assert.deepEqual(entry.legacyExceptions, [], entry.route);
  }
});

test("visual baselines contain the complete scenario, theme, and viewport matrix", () => {
  const expected = new Set();
  for (const scenario of visualMatrix.SCENARIOS) {
    assert.equal(resolvePageDensity(scenario.path), scenario.workspace === "service" ? "compact" : "standard");
    for (const theme of visualMatrix.THEMES) {
      for (const viewport of visualMatrix.VIEWPORTS) expected.add(`${scenario.name}-${theme}-${viewport.name}.png`);
    }
  }
  assert.equal(expected.size, 20);
  const screenshotDirectory = path.join(projectRoot, "tests/visual/__screenshots__");
  const actual = existsSync(screenshotDirectory)
    ? new Set(readdirSync(screenshotDirectory).filter((name) => name.endsWith(".png")))
    : new Set();
  assert.deepEqual(actual, expected);
});
