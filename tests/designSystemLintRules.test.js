import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { Linter } from "eslint";

const require = createRequire(import.meta.url);
const plugin = require("../scripts/eslint/design-system-rules.cjs");
const projectRoot = new URL("..", import.meta.url).pathname;

const rules = {
  "bickers-design/layout-style-only": "error",
  "bickers-design/no-local-generic-component": "error",
  "bickers-design/no-raw-text-input": "error",
  "bickers-design/no-screen-palette": "error",
  "bickers-design/no-screen-presentation": "error",
  "bickers-design/require-page-shell": "error",
  "bickers-design/semantic-colors-and-typography": "error",
};

function verify(source, filename = "app/(protected)/new-route.jsx") {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(source, [{
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "bickers-design": plugin },
    rules,
  }], { filename: path.join(projectRoot, filename) });
}

test("layout-only screen styles pass the design-system lint boundary", () => {
  const messages = verify(`
    import { StyleSheet, View } from "react-native";
    import { AppText } from "../../components/ui/AppPrimitives";
    import PageShell from "../../components/layout/PageShell";
    const styles = StyleSheet.create({ row: { flex: 1, gap: 8, alignItems: "center" } });
    export default function Route() { return <PageShell><View style={styles.row}><AppText variant="body">Hello</AppText></View></PageShell>; }
  `);
  assert.deepEqual(messages, []);
});

test("screen palettes, presentation styles, and generic controls fail immediately", () => {
  const messages = verify(`
    import { StyleSheet } from "react-native";
    import { staticColors } from "../../lib/design/staticColors";
    const COLORS = { card: "#fff" };
    const styles = StyleSheet.create({ card: { backgroundColor: COLORS.card, borderRadius: 12, fontSize: 14 } });
    const Button = () => null;
    export default Button;
  `);
  const ruleIds = new Set(messages.map((message) => message.ruleId));
  assert.ok(ruleIds.has("bickers-design/no-screen-palette"));
  assert.ok(ruleIds.has("bickers-design/no-screen-presentation"));
  assert.ok(ruleIds.has("bickers-design/no-local-generic-component"));
});

test("layoutStyle rejects presentation properties", () => {
  const messages = verify(`export default function Route() { return <Thing layoutStyle={{ flex: 1, color: "red" }} />; }`);
  assert.ok(messages.some((message) => message.ruleId === "bickers-design/layout-style-only"));
});

test("completed screens cannot use shared visual style escape hatches", () => {
  const messages = verify(`
    import { AppButton } from "../../components/ui/AppPrimitives";
    export default function Route() { return <AppButton label="Save" style={{ marginTop: 8 }} />; }
  `);
  assert.ok(messages.some((message) => message.ruleId === "bickers-design/no-screen-presentation"));
});

test("dedicated renderers may own fixed artwork palettes", () => {
  const messages = verify(
    `const artwork = { ink: "#000000" }; export default artwork;`,
    "components/renderers/BrandArtwork.tsx"
  );
  assert.deepEqual(messages, []);
});

test("raw TextInput imports, aliases, and namespaces are rejected", () => {
  const direct = verify(`import { TextInput as NativeInput } from "react-native"; export default () => <NativeInput />;`);
  const namespace = verify(`import * as RN from "react-native"; export default () => <RN.TextInput />;`);
  assert.ok(direct.some((message) => message.ruleId === "bickers-design/no-raw-text-input"));
  assert.ok(namespace.some((message) => message.ruleId === "bickers-design/no-raw-text-input"));
});

test("generic control chrome fails while named layout containers pass", () => {
  const generic = verify(`
    import { StyleSheet } from "react-native";
    import PageShell from "../../components/layout/PageShell";
    const styles = StyleSheet.create({ button: { padding: 8 } });
    export default function Route() { return <PageShell />; }
  `);
  const layout = verify(`
    import { StyleSheet, View } from "react-native";
    import PageShell from "../../components/layout/PageShell";
    const styles = StyleSheet.create({ buttonRow: { flexDirection: "row" }, cardGrid: { gap: 8 } });
    export default function Route() { return <PageShell><View style={styles.buttonRow} /></PageShell>; }
  `);
  assert.ok(generic.some((message) => message.ruleId === "bickers-design/no-local-generic-component"));
  assert.deepEqual(layout, []);
});

test("semantic colour members and approved AppText variants are enforced", () => {
  const valid = verify(`
    import PageShell from "../../components/layout/PageShell";
    import { AppText as Text } from "../../components/ui/AppPrimitives";
    export default function Route({ colors }) { return <PageShell><Text variant="metadata">{colors.text}</Text></PageShell>; }
  `);
  const invalid = verify(`
    import PageShell from "../../components/layout/PageShell";
    import { AppText } from "../../components/ui/AppPrimitives";
    export default function Route({ colors, variant }) { return <PageShell><AppText variant={variant}>{colors.brandBlue}</AppText></PageShell>; }
  `);
  assert.deepEqual(valid, []);
  assert.ok(invalid.filter((message) => message.ruleId === "bickers-design/semantic-colors-and-typography").length >= 2);
});

test("UI routes require PageShell and forbid explicit density overrides", () => {
  const missing = verify(`export default function Route() { return null; }`);
  const override = verify(`
    import PageShell from "../../components/layout/PageShell";
    export default function Route() { return <PageShell density="compact" />; }
  `);
  assert.ok(missing.some((message) => message.ruleId === "bickers-design/require-page-shell"));
  assert.ok(override.some((message) => message.ruleId === "bickers-design/require-page-shell"));
});

test("fixed colours are limited to the exact permanent renderer registry", () => {
  const allowed = verify(`export default { ink: "#000000" };`, "components/renderers/BrandArtwork.tsx");
  const denied = verify(`export default { ink: "#000000" };`, "components/renderers/UnregisteredArtwork.tsx");
  assert.deepEqual(allowed, []);
  assert.ok(denied.some((message) => message.ruleId === "bickers-design/no-screen-palette"));
});
