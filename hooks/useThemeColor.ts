// hooks/useThemeColor.ts
import { useTheme } from "../app/providers/ThemeProvider";

// Match the props signature Expo expects
type ThemeProps = {
  light?: string;
  dark?: string;
};

/**
 * Bridge between Expo's "ThemedView/ThemedText" helpers and your ThemeProvider.
 *
 * Any Expo component that calls useThemeColor("background" | "text" | "tint" | ...)
 * will now resolve via ThemeProvider.colors instead of the old Colors constant.
 */
export function useThemeColor(
  props: ThemeProps,
  colorName:
    | "background"
    | "surface"
    | "surfaceAlt"
    | "border"
    | "text"
    | "textMuted"
    | "accent"
    | "accentSoft"
    | "danger"
    | "success"
    // expo-style extra names so ThemedView/Text don’t crash
    | "tint"
    | "tabIconDefault"
    | "tabIconSelected"
) {
  const { colors, colorScheme } = useTheme();

  // If caller passes an explicit override (lightColor/darkColor), honour it
  const colorFromProps = props[colorScheme];
  if (colorFromProps) {
    return colorFromProps;
  }

  // Direct mapping if the colour exists on your palette
  if (colorName in colors) {
    return (colors as any)[colorName];
  }

  // Fallback mappings for Expo’s default keys
  if (colorName === "tint") return colors.accent;
  if (colorName === "tabIconDefault") return colors.textMuted;
  if (colorName === "tabIconSelected") return colors.accent;

  // Final fallback
  return colors.text;
}
