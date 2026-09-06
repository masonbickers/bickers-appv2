const SHARED_INPUT_IMPLEMENTATIONS = Object.freeze([
  "components/ui/AppPrimitives.js",
]);

const FIXED_COLOR_RENDERERS = Object.freeze([
  {
    path: "components/renderers/BrandArtwork.tsx",
    category: "brandArtwork",
    justification: "Preserves supplied Bickers brand artwork without exposing interface colours.",
  },
]);

const STRUCTURAL_ROUTE_EXCEPTIONS = Object.freeze([
  { path: "app/_layout.jsx", reason: "Expo root provider and navigation layout." },
  { path: "app/(auth)/_layout.tsx", reason: "Expo authentication stack layout." },
  { path: "app/(protected)/_layout.jsx", reason: "Expo protected stack layout." },
  { path: "app/index.js", reason: "Authentication-aware redirect route." },
  { path: "app/(protected)/index.js", reason: "Workspace redirect route." },
  { path: "app/(protected)/service/service-form.js", reason: "Legacy form redirect alias." },
  { path: "app/(protected)/vehicles.jsx", reason: "Legacy null route alias." },
]);

const SEMANTIC_COLOR_NAMES = Object.freeze([
  "background", "surface", "surfaceAlt", "surfaceElevated", "border",
  "text", "textMuted", "textOnAccent", "primary", "accent", "accentSoft",
  "danger", "dangerSoft", "warning", "warningSoft", "success", "successSoft",
  "info", "infoSoft", "focusRing", "inputBackground", "inputBorder", "link",
  "disabled", "disabledText", "overlay", "mediaBackdrop", "pressed", "selected",
  "divider", "navigationSurface", "navigationSelected", "navigationBorder",
]);

const APPROVED_TEXT_VARIANTS = Object.freeze([
  "micro", "display", "tabLabel", "button", "pageTitle", "titleSmall",
  "sectionTitle", "body", "bodyStrong", "bodySmall", "bodyLarge", "formLabel",
  "label", "metadata", "caption", "link",
]);

module.exports = {
  APPROVED_TEXT_VARIANTS,
  FIXED_COLOR_RENDERERS,
  SEMANTIC_COLOR_NAMES,
  SHARED_INPUT_IMPLEMENTATIONS,
  STRUCTURAL_ROUTE_EXCEPTIONS,
};
