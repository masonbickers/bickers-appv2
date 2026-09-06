import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { getContrastRatio } from "../lib/design/contrast.js";
import { resolvePageDensity } from "../lib/design/pageDensity.js";
import { getStatusColors } from "../lib/design/semantics.js";
import {
  LEGACY_EMPLOYEE_COMPACT_FILES,
  LEGACY_LOCAL_CONTROL_STYLE_FILES,
  LEGACY_LOCAL_PALETTE_FILES,
  LEGACY_STATIC_COLOR_FILES,
  LEGACY_TYPOGRAPHY_STYLE_FILES,
} from "./designSystemLegacyBaseline.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const projectRoot = new URL("..", import.meta.url).pathname;
const walk = (directory) => readdirSync(directory).flatMap((name) => {
  const absolute = path.join(directory, name);
  return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
});
const uiFiles = ["app", "components"]
  .flatMap((directory) => walk(path.join(projectRoot, directory)))
  .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file));
const uiSource = uiFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const protectedRoot = path.join(projectRoot, "app", "(protected)");
const relativePath = (file) => path.relative(projectRoot, file);
const appFiles = uiFiles.filter((file) => relativePath(file).startsWith("app/"));
const matchingFiles = (files, pattern) =>
  new Set(
    files
      .filter((file) => pattern.test(readFileSync(file, "utf8")))
      .map(relativePath)
  );
const scaffoldExceptions = new Set([
  "_layout.jsx",
  "index.js",
  "vehicles.jsx",
  "service/service-form.js",
]);

test("design tokens expose the complete shared foundation", () => {
  const source = read("lib/design/tokens.ts");
  for (const token of ["spacing", "radius", "opacity", "componentRadius", "typography", "shadows", "controls", "layout", "focus", "iconSize", "density"]) {
    assert.match(source, new RegExp(`export const ${token}\\b`));
  }
  assert.match(source, /export const opacity = \{[\s\S]*disabled:\s*0\.55/);
  assert.match(source, /standard:/);
  assert.match(source, /compact:/);
  assert.match(source, /none:\s*0,[\s\S]*xxxs:\s*2,[\s\S]*xxs:\s*4,[\s\S]*xs:\s*8,[\s\S]*sm:\s*12,[\s\S]*md:\s*16,[\s\S]*lg:\s*20,[\s\S]*xl:\s*24,[\s\S]*"2xl":\s*32,[\s\S]*"3xl":\s*40/);
  assert.match(source, /standard:[\s\S]*controlHeight:\s*48/);
  assert.match(source, /compact:[\s\S]*controlHeight:\s*44/);
  assert.match(source, /nestedControl:\s*radius\.sm/);
  assert.match(source, /control:\s*radius\.md/);
  assert.match(source, /card:\s*radius\.lg/);
  assert.match(source, /modal:\s*radius\.xl/);
  assert.match(source, /iconButton:\s*radius\.pill/);
  assert.match(source, /pill:\s*radius\.pill/);
});

test("workspace routes resolve to the locked page densities", () => {
  assert.equal(resolvePageDensity("/screens/homescreen"), "standard");
  assert.equal(resolvePageDensity("/(protected)/maintenance"), "standard");
  assert.equal(resolvePageDensity("/service/home"), "compact");
  assert.equal(resolvePageDensity("/(protected)/service/work"), "compact");
  assert.equal(resolvePageDensity("/service/home", "standard"), "standard");
});

test("theme exposes interaction and feedback semantics in both schemes", () => {
  const source = read("providers/ThemeProvider.tsx");
  for (const semantic of ["link", "disabled", "disabledText", "overlay", "mediaBackdrop", "pressed", "selected", "divider", "navigationSurface", "navigationSelected", "navigationBorder"]) {
    assert.equal((source.match(new RegExp(`${semantic}:`, "g")) || []).length, 3);
  }
  assert.equal((source.match(/primary:\s*"#ED1C25"/g) || []).length, 2);
  assert.equal((source.match(/accent:\s*"#ED1C25"/g) || []).length, 2);
});

test("locked semantic text and status pairs retain accessible contrast", () => {
  const bodyPairs = [
    ["#15202B", "#FFFFFF"],
    ["#5F6C7B", "#FFFFFF"],
    ["#F5F5F5", "#000000"],
    ["#A1A1AA", "#000000"],
  ];
  for (const [foreground, background] of bodyPairs) {
    assert.ok(getContrastRatio(foreground, background) >= 4.5);
  }
  assert.ok(getContrastRatio("#FFFFFF", "#ED1C25") >= 3);
  for (const scheme of ["light", "dark"]) {
    for (const tone of ["maintenance", "approved", "submitted", "draft", "danger", "warning", "success", "info", "neutral"]) {
      const colors = getStatusColors(tone, scheme);
      assert.ok(
        getContrastRatio(colors.foreground, colors.background) >= 4.5,
        `${scheme} ${tone} status contrast is too low`
      );
    }
  }
});

test("shared primitives cover the approved application patterns", () => {
  const source = read("components/ui/AppPrimitives.js");
  for (const component of ["AppText", "AppCalendar", "ToggleRow", "IconBadge", "Avatar", "MediaThumbnail", "AppButton", "IconButton", "SectionCard", "ListRow", "PageSection", "FormStep", "FormField", "TextArea", "SelectField", "DateField", "SegmentedControl", "AttachmentButton", "Checkbox", "Banner", "StateView", "Divider", "AppModal", "MediaViewerModal", "ConfirmDialog", "KeyboardForm"]) {
    assert.match(source, new RegExp(`export function ${component}\\b`));
  }
  assert.match(source, /paddingHorizontal:\s*iconOnly\s*\? t\.spacing\.none/);
  assert.match(source, /height: iconOnly \? t\.controls\.iconButton/);
  assert.match(source, /variant === "ghost"[\s\S]*background: "transparent", border: "transparent", text: colors\.accent/);
  assert.match(source, /borderRadius: t\.componentRadius\.card/);
  assert.match(source, /borderRadius: t\.componentRadius\.modal/);
  assert.match(source, /modalBody:\s*\{[\s\S]*?minHeight:\s*0,[\s\S]*?flexShrink:\s*1/);
  assert.match(source, /focused \? t\.focus\.width : 1/);
  assert.match(source, /presentation === "adaptive" && width < t\.layout\.tabletBreakpoint/);
  assert.match(source, /normalizeSelectOptions\(options\)/);
  assert.match(source, /isDateSelectable\(day\.dateString/);
  assert.match(source, /runConfirmation\(onConfirm, onError\)/);
  assert.match(read("components/layout/PageShell.tsx"), /export default function PageShell\b/);
  assert.match(read("components/layout/PageShell.tsx"), /resolvePageDensity\(pathname, density\)/);
});

test("application UI contains no raw colour, font-size, or radius values", () => {
  assert.doesNotMatch(uiSource, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(uiSource, /rgba?\([^)]*\)/i);
  assert.doesNotMatch(uiSource, /fontSize:\s*\d+/);
  assert.doesNotMatch(uiSource, /borderRadius:\s*\d+/);
});

test("standard spacing values use the shared scale", () => {
  const rawSpacing = [...uiSource.matchAll(/(?:padding|margin|gap)(?:Top|Right|Bottom|Left|Horizontal|Vertical)?:\s*(\d+)/g)]
    .map((match) => Number(match[1]));
  assert.ok(rawSpacing.every((value) => value > 40), `found non-token standard spacing: ${rawSpacing.filter((value) => value <= 40).join(", ")}`);
});

test("screens use shared text and touch interaction primitives", () => {
  const compatibilityImplementations = new Set(["AppPrimitives.js", "ThemedText.tsx"]);
  for (const file of uiFiles.filter((item) => !compatibilityImplementations.has(path.basename(item)))) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /import\s*\{[^}]*\bText\b[^}]*\}\s*from\s*["']react-native["']/);
    assert.doesNotMatch(source, /import\s*\{[^}]*\bTouchableOpacity\b[^}]*\}\s*from\s*["']react-native["']/);
  }
});

test("timesheet toggle help uses the shared borderless icon control", () => {
  const source = readFileSync(
    new URL("../app/(protected)/week/[id]/index.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /<IconButton[\s\S]*?icon="info"[\s\S]*?variant="ghost"[\s\S]*?compact=\{compact\}[\s\S]*?label=\{`About \$\{label\}`\}/);
  assert.doesNotMatch(source, /styles\.infoBtn/);
  assert.match(source, /<IconButton[\s\S]*?variant="ghost"[\s\S]*?compact[\s\S]*?label=\{`View overview for job/);
  assert.doesNotMatch(source, /styles\.jobInfoButton/);
});

test("login entry text stays left aligned and vertically centred", () => {
  const source = read("app/(auth)/login.jsx");
  assert.equal((source.match(/inputStyle=\{styles\.loginInput\}/g) || []).length, 2);
  assert.match(source, /loginInput:\s*\{\s*textAlignVertical:\s*"center"/);
  assert.match(source, /paddingTop:\s*t\.spacing\.xs - t\.spacing\.xxxs/);
  assert.match(source, /paddingBottom:\s*t\.spacing\.xs \+ t\.spacing\.xxxs/);
  assert.doesNotMatch(source, /loginInput:\s*\{[^}]*textAlign:\s*"center"/);
});

test("screens delegate text entry and workspace density to shared foundations", () => {
  for (const file of appFiles) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bTextInput\b/);
    assert.doesNotMatch(source, /<PageShell\b[^>]*\bdensity=/);
  }

  const primitives = read("components/ui/AppPrimitives.js");
  const selectImplementation = primitives.slice(
    primitives.indexOf("export function SelectField"),
    primitives.indexOf("export function DateField")
  );
  const selectSignature = selectImplementation.slice(0, selectImplementation.indexOf("}) {") + 4);
  assert.doesNotMatch(selectSignature, /\bonPress\b/);
  assert.match(primitives, /resolvePageDensity\(pathname, density\)/);
});

test("legacy visual exceptions are exact, named, and cannot grow", () => {
  assert.deepEqual(
    matchingFiles(appFiles, /^const COLORS\s*=\s*\{/m),
    LEGACY_LOCAL_PALETTE_FILES
  );
  assert.deepEqual(
    matchingFiles(uiFiles, /\bstaticColors\b/),
    LEGACY_STATIC_COLOR_FILES
  );
  assert.deepEqual(
    matchingFiles(
      appFiles,
      /^\s*(?:button|primaryButton|actionButton|submitButton|saveButton|card|sectionCard|input|selectField):\s*\{/m
    ),
    LEGACY_LOCAL_CONTROL_STYLE_FILES
  );
  assert.deepEqual(
    matchingFiles(appFiles, /(?:fontSize|fontWeight|lineHeight|letterSpacing):/),
    LEGACY_TYPOGRAPHY_STYLE_FILES
  );
});

test("employee compact-density overrides are frozen for migration", () => {
  const employeeRouteFiles = walk(protectedRoot)
    .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file))
    .filter((file) => !relativePath(file).includes("/(protected)/service/"));
  assert.deepEqual(
    matchingFiles(employeeRouteFiles, /<PageShell\b[^>]*\bdensity="compact"/),
    LEGACY_EMPLOYEE_COMPACT_FILES
  );
});

test("service screens do not define local general-purpose palettes", () => {
  const serviceSource = walk(path.join(projectRoot, "app", "(protected)", "service"))
    .filter((file) => /\.(?:js|jsx|tsx)$/.test(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(serviceSource, /^const COLORS\s*=\s*\{/m);
});

test("primary service tabs inherit the compact workspace density", () => {
  const routes = ["home.js", "work.js", "book-work.js", "service-list.js", "issues.jsx"];
  for (const route of routes) {
    const source = read(`app/(protected)/service/${route}`);
    assert.doesNotMatch(source, /<PageShell\b[^>]*\b(?:density|gutter)=/);
  }
});

test("fleet list uses a compact header and dense vehicle summaries", () => {
  const source = read("app/(protected)/service/service-list.js");
  assert.match(source, /variant:\s*"compact"/);
  assert.match(source, /styles\.vehicleIdentity/);
  assert.match(source, /styles\.metaSummary/);
  assert.doesNotMatch(source, /styles\.metaItem|styles\.metaLabel|styles\.metaValue/);
});

test("service home opens with the fleet overview and omits priority work", () => {
  const source = read("app/(protected)/service/home.js");
  assert.match(source, />\s*Fleet Overview\s*</);
  assert.doesNotMatch(source, /Priority work|PriorityGroup|activePriorityGroups/);
  assert.doesNotMatch(source, /AsyncStorage\.multiGet/);
});

test("service navigation uses clear task labels and an iOS material surface", () => {
  const source = read("components/app/service-footer.js");
  for (const label of ["Home", "Forms", "To-Do", "Fleet", "Issues"]) {
    assert.ok(source.includes(`label: "${label}"`), `missing ${label} service tab`);
  }
  assert.doesNotMatch(source, /<BottomNavigationBar[\s\S]*?opaque/);
  assert.doesNotMatch(read("components/app/footer.js"), /<BottomNavigationBar[\s\S]*?opaque/);
  const navigation = read("components/app/BottomNavigationBar.js");
  assert.match(navigation, /tabs\.slice\(0, 5\)/);
  assert.match(navigation, /BlurView/);
  assert.doesNotMatch(navigation, /expo-glass-effect|GlassView/);
  assert.match(navigation, /systemChromeMaterialDark/);
  assert.match(navigation, /systemChromeMaterialLight/);
  assert.match(navigation, /colors\.navigationSurface/);
  const metrics = read("lib/design/navigation.js");
  assert.match(metrics, /tabBarHeight:\s*68/);
  assert.match(metrics, /tabBarMaxWidth:\s*520/);
});

test("primary service cards use a consistent full-card action pattern", () => {
  const routes = ["home.js", "work.js", "book-work.js", "service-list.js", "issues.jsx"];
  const source = routes.map((route) => read(`app/(protected)/service/${route}`)).join("\n");
  assert.doesNotMatch(source, /Tap to view|tap to view|Open record/);
  assert.match(read("app/(protected)/service/home.js"), /<QuickActionCard/);
  assert.doesNotMatch(read("app/(protected)/service/home.js"), /statusLabel|quickStyles\.chevron/);
  assert.doesNotMatch(read("app/(protected)/service/work.js"), /statusBadge|name="chevron-right"/);
  assert.doesNotMatch(read("app/(protected)/service/issues.jsx"), /issueStatusBadge|name="chevron-right"/);
  assert.match(read("app/(protected)/service/issues.jsx"), /name="arrow-up-right"/);
  assert.doesNotMatch(read("app/(protected)/service/issues.jsx"), /<Text numberOfLines=\{2\} style=\{\[styles\.detailText/);
  assert.match(read("app/(protected)/service/service-list.js"), /chevron-right/);
  assert.match(read("app/(protected)/service/issues.jsx"), /const CardShell = item\.route \? TouchableOpacity : View/);
});

test("every standard protected route adopts the shared PageShell scaffold", () => {
  const routeFiles = walk(protectedRoot).filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file));
  const missing = routeFiles
    .filter((file) => !scaffoldExceptions.has(path.relative(protectedRoot, file)))
    .filter((file) => !readFileSync(file, "utf8").includes("components/layout/PageShell"))
    .map((file) => path.relative(protectedRoot, file));
  assert.deepEqual(missing, []);
});

test("migrated routes do not own page safe areas or keyboard avoidance", () => {
  const permittedNestedSafeArea = new Set(["receipts.js"]);
  const permittedModalKeyboardAvoidance = new Set(["screens/homescreen.js"]);
  const violations = walk(protectedRoot)
    .filter((file) => /\.(?:js|jsx|ts|tsx)$/.test(file))
    .filter((file) => readFileSync(file, "utf8").includes("components/layout/PageShell"))
    .flatMap((file) => {
      const relative = path.relative(protectedRoot, file);
      const source = readFileSync(file, "utf8");
      const issues = [];
      if (!permittedNestedSafeArea.has(relative) && /<SafeAreaView\b/.test(source)) issues.push(`${relative}: SafeAreaView`);
      if (!permittedModalKeyboardAvoidance.has(relative) && /<KeyboardAvoidingView\b/.test(source)) issues.push(`${relative}: KeyboardAvoidingView`);
      return issues;
    });
  assert.deepEqual(violations, []);
});

test("screen overlays use shared modal primitives", () => {
  const primitiveFile = path.join(projectRoot, "components", "ui", "AppPrimitives.js");
  for (const file of uiFiles.filter((item) => item !== primitiveFile)) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /<Modal\b|\bModal\s*,/);
  }
});
