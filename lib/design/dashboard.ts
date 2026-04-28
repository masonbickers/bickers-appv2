import { ViewStyle } from "react-native";

import { designTokens as t } from "./tokens";

type DashboardColors = {
  surface: string;
  surfaceAlt: string;
  border: string;
};

export function createDashboardCardStyles(colors: DashboardColors) {
  const sectionBase: ViewStyle = {
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
  };

  return {
    heroCard: {
      backgroundColor: "transparent",
      borderRadius: t.radius.xl,
    } satisfies ViewStyle,
    sectionCard: {
      ...sectionBase,
      backgroundColor: "transparent",
    } satisfies ViewStyle,
    nestedCard: {
      ...sectionBase,
      backgroundColor: colors.surface,
      borderRadius: t.radius.md,
      paddingHorizontal: 10,
      paddingVertical: 10,
    } satisfies ViewStyle,
    statCard: {
      ...sectionBase,
      backgroundColor: colors.surface,
      borderRadius: t.radius.md,
      paddingHorizontal: 6,
      paddingVertical: 10,
    } satisfies ViewStyle,
    quickActionCard: {
      ...sectionBase,
      backgroundColor: colors.surfaceAlt,
      borderRadius: t.radius.sm,
      ...t.shadows.sm,
    } satisfies ViewStyle,
  };
}
