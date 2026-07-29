import React, { ReactNode, useMemo } from "react";
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from "react-native";

import { createDashboardCardStyles } from "../lib/design/dashboard";
import { designTokens as t } from "../lib/design/tokens";
import { useTheme } from "../providers/ThemeProvider";

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  topSlot?: ReactNode;
  action?: ReactNode;
  metadata?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  eyebrowStyle?: StyleProp<TextStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
};

export default function PageHeaderCard({
  eyebrow,
  title,
  subtitle,
  topSlot,
  action,
  metadata,
  compact = false,
  children,
  style,
  contentStyle,
  eyebrowStyle,
  titleStyle,
  subtitleStyle,
}: Props) {
  const { colors } = useTheme();
  const dashboardCards = useMemo(() => createDashboardCardStyles(colors), [colors]);

  return (
    <View style={[styles.card, dashboardCards.heroCard, style]}>
      {topSlot ? <View style={styles.topSlot}>{topSlot}</View> : null}

      <View
        style={[
          styles.content,
          topSlot ? styles.contentAfterTopSlot : null,
          contentStyle,
        ]}
      >
        {eyebrow ? (
          <Text style={[styles.eyebrow, { color: colors.textMuted }, eyebrowStyle]}>
            {eyebrow}
          </Text>
        ) : null}

        <View style={styles.titleRow}>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              compact && styles.compactTitle,
              { color: colors.text },
              titleStyle,
            ]}
          >
            {title}
          </Text>
          {action ? <View style={styles.action}>{action}</View> : null}
        </View>

        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.textMuted }, subtitleStyle]}>
            {subtitle}
          </Text>
        ) : null}

        {metadata ? <View style={styles.metadata}>{metadata}</View> : null}

        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
  },
  topSlot: {
    width: "100%",
  },
  content: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
  },
  contentAfterTopSlot: {
    paddingTop: t.spacing.xs,
  },
  eyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },
  title: {
    ...t.typography.pageTitle,
    marginTop: 3,
    letterSpacing: 0.2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: t.spacing.sm,
  },
  compactTitle: {
    fontSize: 21,
    lineHeight: 27,
  },
  action: {
    minHeight: t.controls.buttonHeightLg,
    justifyContent: "center",
  },
  metadata: {
    marginTop: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  },
  subtitle: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
});
