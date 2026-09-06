const fs = require("node:fs");
const path = require("node:path");

const {
  APPROVED_TEXT_VARIANTS,
  FIXED_COLOR_RENDERERS,
  SEMANTIC_COLOR_NAMES,
  SHARED_INPUT_IMPLEMENTATIONS,
  STRUCTURAL_ROUTE_EXCEPTIONS,
} = require("../design-system/enforcement-config.cjs");

const projectRoot = path.resolve(__dirname, "../..");
const manifestPath = path.join(projectRoot, "tests/designSystemMigrationManifest.js");
const rendererPaths = new Set(FIXED_COLOR_RENDERERS.map((entry) => entry.path));
const sharedInputPaths = new Set(SHARED_INPUT_IMPLEMENTATIONS);
const structuralRoutes = new Set(STRUCTURAL_ROUTE_EXCEPTIONS.map((entry) => entry.path));
const semanticColors = new Set(SEMANTIC_COLOR_NAMES);
const textVariants = new Set(APPROVED_TEXT_VARIANTS);

function parseManifestBlock(start, end) {
  try {
    const source = fs.readFileSync(manifestPath, "utf8");
    const block = source.slice(source.indexOf(start), source.indexOf(end));
    return new Set([...block.matchAll(/["'](app\/[^"']+)["']/g)].map((match) => match[1]));
  } catch {
    return new Set();
  }
}

function completedRoutes() {
  try {
    const source = fs.readFileSync(manifestPath, "utf8");
    const block = source.match(/const completedRoutes = new Set\(\[([\s\S]*?)\]\)/)?.[1] || "";
    return new Set([...block.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]));
  } catch {
    return new Set();
  }
}

const completed = completedRoutes();
const knownRoutes = parseManifestBlock("export const MIGRATION_BATCHES", "const routeTests");
const visualProperties = new Set([
  "backgroundColor", "borderColor", "borderTopColor", "borderRightColor",
  "borderBottomColor", "borderLeftColor", "borderWidth", "borderTopWidth",
  "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderRadius",
  "borderStyle", "color", "elevation", "opacity", "shadowColor", "shadowOffset",
  "shadowOpacity", "shadowRadius", "textDecorationColor", "textDecorationLine",
  "textShadowColor", "textShadowOffset", "textShadowRadius", "tintColor",
]);
const typographyProperties = new Set([
  "fontFamily", "fontSize", "fontStyle", "fontVariant", "fontWeight",
  "letterSpacing", "lineHeight", "textTransform",
]);
const layoutProperties = new Set([
  "alignContent", "alignItems", "alignSelf", "aspectRatio", "bottom", "columnGap",
  "display", "flex", "flexBasis", "flexDirection", "flexGrow", "flexShrink",
  "flexWrap", "gap", "height", "justifyContent", "left", "margin", "marginBottom",
  "marginEnd", "marginHorizontal", "marginLeft", "marginRight", "marginStart",
  "marginTop", "marginVertical", "maxHeight", "maxWidth", "minHeight", "minWidth",
  "overflow", "padding", "paddingBottom", "paddingEnd", "paddingHorizontal",
  "paddingLeft", "paddingRight", "paddingStart", "paddingTop", "paddingVertical",
  "position", "right", "rowGap", "textAlign", "top", "transform", "width", "zIndex",
]);
const genericComponentNames = /^(?:Button|Card|Checkbox|Chip|Field|Input|Modal|Select|Status|TextArea|Toggle)(?:View|Row|Item|Field|Button|Card|Chip|Modal)?$/;
const genericChromeKeys = /^(?:button|primaryButton|secondaryButton|ghostButton|dangerButton|submitButton|saveButton|iconButton|input|textInput|textArea|field|select|selectField|card|sectionCard|chip|statusChip|banner|modal|toggle|checkbox)$/i;
const fixedColorPattern = /^(?:#[\da-f]{3,8}|rgba?\(|hsla?\()/i;
const sharedAppearanceComponents = new Set([
  "AppButton", "AppText", "Banner", "Checkbox", "DateField", "Divider", "FormField",
  "FormStep", "IconButton", "ListRow", "MediaThumbnail", "PageSection", "SectionCard",
  "SelectField", "StateView", "StatusChip", "TextArea", "ToggleRow",
]);

function relativeFilename(context) {
  return path.relative(projectRoot, context.getFilename()).split(path.sep).join("/");
}
function isAppFile(context) { return relativeFilename(context).startsWith("app/"); }
function isGrandfathered(context) {
  const relative = relativeFilename(context);
  return knownRoutes.has(relative) && !completed.has(relative);
}
function propertyName(node) {
  if (!node || node.computed) return null;
  return node.key?.name || node.key?.value || null;
}
function jsxName(node) { return node?.name?.name || node?.name || null; }
function isStyleSheetProperty(node) {
  let current = node?.parent;
  while (current) {
    if (current.type === "CallExpression") {
      const callee = current.callee;
      return callee?.type === "MemberExpression" && callee.object?.name === "StyleSheet" && callee.property?.name === "create";
    }
    if (["Program", "FunctionDeclaration", "ArrowFunctionExpression"].includes(current.type)) return false;
    current = current.parent;
  }
  return false;
}

const noRawTextInput = {
  meta: { type: "problem", schema: [], messages: { input: "Use the shared form primitives instead of React Native TextInput." } },
  create(context) {
    if (sharedInputPaths.has(relativeFilename(context))) return {};
    const aliases = new Set(["TextInput"]);
    const namespaces = new Set();
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "react-native") return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
          if (specifier.imported?.name === "TextInput") {
            aliases.add(specifier.local.name);
            context.report({ node: specifier, messageId: "input" });
          }
        }
      },
      MemberExpression(node) {
        if (namespaces.has(node.object?.name) && (node.property?.name === "TextInput" || node.property?.value === "TextInput")) {
          context.report({ node, messageId: "input" });
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && aliases.has(node.name.name)) context.report({ node, messageId: "input" });
        if (node.name.type === "JSXMemberExpression" && namespaces.has(node.name.object?.name) && node.name.property?.name === "TextInput") {
          context.report({ node, messageId: "input" });
        }
      },
    };
  },
};

const noScreenPalette = {
  meta: { type: "problem", schema: [], messages: { palette: "Screens must use semantic theme APIs and approved fixed renderers, not {{name}}." } },
  create(context) {
    if (isGrandfathered(context) || rendererPaths.has(relativeFilename(context))) return {};
    return {
      ImportDeclaration(node) {
        const source = String(node.source.value || "");
        if (!/staticColors|design\/color|design\/semantics/.test(source)) return;
        const names = node.specifiers.map((item) => item.imported?.name || item.local?.name).filter(Boolean);
        const prohibited = names.filter((name) => ["staticColors", "servicePalette", "withAlpha"].includes(name));
        if (prohibited.length) context.report({ node, messageId: "palette", data: { name: prohibited.join(", ") } });
      },
      VariableDeclarator(node) {
        if (node.id?.type === "Identifier" && /^(?:COLORS|.*Palette)$/.test(node.id.name)) {
          context.report({ node, messageId: "palette", data: { name: node.id.name } });
        }
      },
      Literal(node) {
        if (typeof node.value === "string" && fixedColorPattern.test(node.value)) {
          context.report({ node, messageId: "palette", data: { name: "a fixed colour literal" } });
        }
      },
    };
  },
};

const noScreenPresentation = {
  meta: { type: "problem", schema: [], messages: {
    visual: "Screen styles may contain layout only; move {{property}} into a shared semantic component.",
    typography: "Use an AppText variant instead of setting {{property}} in a screen.",
    escape: "Use layoutStyle and semantic props instead of the visual style escape hatch on {{component}}.",
  } },
  create(context) {
    if (!isAppFile(context) || isGrandfathered(context)) return {};
    return {
      JSXAttribute(node) {
        if (node.name?.name !== "style") return;
        const component = jsxName(node.parent);
        if (sharedAppearanceComponents.has(component)) context.report({ node, messageId: "escape", data: { component } });
      },
      Property(node) {
        const name = propertyName(node);
        if (visualProperties.has(name)) context.report({ node, messageId: "visual", data: { property: name } });
        if (typographyProperties.has(name)) context.report({ node, messageId: "typography", data: { property: name } });
      },
    };
  },
};

const layoutStyleOnly = {
  meta: { type: "problem", schema: [], messages: { layout: "layoutStyle only accepts approved layout properties; found {{property}}." } },
  create(context) {
    return { JSXAttribute(node) {
      if (node.name?.name !== "layoutStyle") return;
      const expression = node.value?.expression;
      if (expression?.type !== "ObjectExpression") return;
      for (const property of expression.properties) {
        const name = propertyName(property);
        if (name && !layoutProperties.has(name)) context.report({ node: property, messageId: "layout", data: { property: name } });
      }
    } };
  },
};

const noLocalGenericComponent = {
  meta: { type: "problem", schema: [], messages: { generic: "Replace local {{name}} with the shared design-system primitive." } },
  create(context) {
    if (!isAppFile(context) || isGrandfathered(context)) return {};
    const check = (node, name) => { if (name && genericComponentNames.test(name)) context.report({ node, messageId: "generic", data: { name } }); };
    return {
      FunctionDeclaration(node) { check(node, node.id?.name); },
      VariableDeclarator(node) { if (["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)) check(node, node.id?.name); },
      Property(node) {
        const name = propertyName(node);
        if (name && genericChromeKeys.test(name) && isStyleSheetProperty(node)) context.report({ node, messageId: "generic", data: { name } });
      },
    };
  },
};

const semanticColorsAndTypography = {
  meta: { type: "problem", schema: [], messages: {
    color: "{{name}} is not an approved semantic theme colour.",
    computed: "Theme colours must use a named colors.semanticToken member.",
    variant: "{{name}} is not an approved AppText variant.",
    dynamicVariant: "Screen AppText variants must be literal approved values.",
  } },
  create(context) {
    if (!isAppFile(context) || isGrandfathered(context)) return {};
    const appTextAliases = new Set(["AppText"]);
    return {
      ImportDeclaration(node) {
        if (!/components\/ui\/AppPrimitives/.test(String(node.source.value))) return;
        for (const specifier of node.specifiers) if (specifier.imported?.name === "AppText") appTextAliases.add(specifier.local.name);
      },
      MemberExpression(node) {
        if (node.object?.name !== "colors") return;
        if (node.computed) return context.report({ node, messageId: "computed" });
        const name = node.property?.name;
        if (name && !semanticColors.has(name)) context.report({ node, messageId: "color", data: { name } });
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !appTextAliases.has(node.name.name)) return;
        const attribute = node.attributes.find((item) => item.type === "JSXAttribute" && item.name?.name === "variant");
        if (!attribute) return;
        if (attribute.value?.type === "Literal") {
          const value = String(attribute.value.value);
          if (!textVariants.has(value)) context.report({ node: attribute, messageId: "variant", data: { name: value } });
          return;
        }
        const expression = attribute.value?.expression;
        if (expression?.type === "Literal" && textVariants.has(String(expression.value))) return;
        context.report({ node: attribute, messageId: "dynamicVariant" });
      },
    };
  },
};

const requirePageShell = {
  meta: { type: "problem", schema: [], messages: {
    missing: "Every UI route must import and render PageShell or be a documented structural exception.",
    density: "PageShell density is resolved from the route; remove the explicit density override.",
  } },
  create(context) {
    if (!isAppFile(context) || isGrandfathered(context) || structuralRoutes.has(relativeFilename(context))) return {};
    const aliases = new Set();
    let rendered = false;
    return {
      ImportDeclaration(node) {
        if (!/components\/layout\/PageShell/.test(String(node.source.value))) return;
        for (const specifier of node.specifiers) if (specifier.type === "ImportDefaultSpecifier") aliases.add(specifier.local.name);
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !aliases.has(node.name.name)) return;
        rendered = true;
        const density = node.attributes.find((item) => item.type === "JSXAttribute" && item.name?.name === "density");
        if (density) context.report({ node: density, messageId: "density" });
      },
      "Program:exit"(node) {
        if (!rendered) context.report({ node, messageId: "missing" });
      },
    };
  },
};

module.exports = { rules: {
  "layout-style-only": layoutStyleOnly,
  "no-local-generic-component": noLocalGenericComponent,
  "no-raw-text-input": noRawTextInput,
  "no-screen-palette": noScreenPalette,
  "no-screen-presentation": noScreenPresentation,
  "require-page-shell": requirePageShell,
  "semantic-colors-and-typography": semanticColorsAndTypography,
} };
