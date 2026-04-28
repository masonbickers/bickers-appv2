import { Platform, TextStyle, ViewStyle } from "react-native";

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
  "3xl": 40,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const typography = {
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
  } satisfies TextStyle,
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "400",
  } satisfies TextStyle,
  bodyStrong: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  } satisfies TextStyle,
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } satisfies TextStyle,
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "800",
  } satisfies TextStyle,
  pageTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  } satisfies TextStyle,
} as const;

const iosShadow = (
  shadowOpacity: number,
  shadowRadius: number,
  height: number
): ViewStyle => ({
  shadowColor: "#000",
  shadowOpacity,
  shadowRadius,
  shadowOffset: { width: 0, height },
});

export const shadows = {
  none: {} satisfies ViewStyle,
  sm: Platform.select<ViewStyle>({
    ios: iosShadow(0.12, 4, 2),
    android: { elevation: 2 },
    default: {},
  }) as ViewStyle,
  md: Platform.select<ViewStyle>({
    ios: iosShadow(0.16, 8, 4),
    android: { elevation: 6 },
    default: {},
  }) as ViewStyle,
  lg: Platform.select<ViewStyle>({
    ios: iosShadow(0.2, 14, 8),
    android: { elevation: 10 },
    default: {},
  }) as ViewStyle,
} as const;

export const controls = {
  buttonHeight: 40,
  buttonHeightLg: 44,
  iconButton: 40,
  iconButtonSm: 32,
  chipMinHeight: 32,
  cardPadding: 12,
  cardPaddingLg: 16,
} as const;

export const designTokens = {
  spacing,
  radius,
  typography,
  shadows,
  controls,
} as const;

export type DesignTokens = typeof designTokens;
