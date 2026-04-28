import { type ViewStyle } from "react-native";

type ThemeColors = {
  background?: string;
  surface?: string;
  surfaceAlt?: string;
  surfaceElevated?: string;
  border?: string;
  text?: string;
  textMuted?: string;
  textOnAccent?: string;
  accent?: string;
  accentSoft?: string;
  danger?: string;
  warning?: string;
  success?: string;
  inputBackground?: string;
  inputBorder?: string;
};

export function getServiceColors(colors: ThemeColors) {
  return {
    background: colors.background || "#000000",
    surface: colors.surface || "#0B0B0C",
    surfaceAlt: colors.surfaceAlt || colors.surface || "#151517",
    surfaceElevated:
      colors.surfaceElevated || colors.surfaceAlt || colors.surface || "#1D1D21",
    border: colors.border || "#2B2B31",
    text: colors.text || "#F5F5F5",
    textMuted: colors.textMuted || "#A1A1AA",
    textOnAccent: colors.textOnAccent || "#FFFFFF",
    accent: colors.accent || "#ED1C25",
    accentSoft: colors.accentSoft || "rgba(237,28,37,0.16)",
    danger: colors.danger || "#ED1C25",
    warning: colors.warning || "#F2A93B",
    success: colors.success || "#34C38F",
    inputBackground: colors.inputBackground || colors.surface || "#111114",
    inputBorder: colors.inputBorder || colors.border || "#303038",
  };
}

export function serviceCard(colors: ThemeColors): ViewStyle {
  const c = getServiceColors(colors);
  return {
    backgroundColor: c.surfaceAlt,
    borderColor: c.border,
  };
}

export function serviceInput(colors: ThemeColors): ViewStyle {
  const c = getServiceColors(colors);
  return {
    backgroundColor: c.inputBackground,
    borderColor: c.inputBorder,
    color: c.text,
  };
}
