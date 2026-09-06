import React, { ReactNode, useMemo } from "react";
import {
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";

import { createDashboardCardStyles } from "../lib/design/dashboard";
import { designTokens as t } from "../lib/design/tokens";
import { useTheme } from "../providers/ThemeProvider";
import {
  AppButton as RawAppButton,
  AppText as RawText,
  IconButton as RawIconButton,
} from "./ui/AppPrimitives";

const AppButton = RawAppButton as React.ComponentType<any>;
const Text = RawText as React.ComponentType<any>;
const IconButton = RawIconButton as React.ComponentType<any>;

type Props = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  topSlot?: ReactNode;
  action?: ReactNode;
  metadata?: ReactNode;
  compact?: boolean;
  density?: "standard" | "compact";
  align?: "left" | "center";
  onBack?: () => void;
  actionLabel?: string;
  actionIcon?: string;
  onAction?: () => void;
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
  density = "standard",
  align = "left",
  onBack,
  actionLabel,
  actionIcon = "plus",
  onAction,
  children,
  style,
  contentStyle,
  eyebrowStyle,
  titleStyle,
  subtitleStyle,
}: Props) {
  const { colors } = useTheme();
  const dashboardCards = useMemo(() => createDashboardCardStyles(colors), [colors]);

  const actionNode = action || (actionLabel && onAction ? (
    <AppButton
      label={actionLabel}
      icon={actionIcon}
      onPress={onAction}
      density={density}
      size={compact ? "small" : "medium"}
      iconOnly={compact && Boolean(actionIcon)}
    />
  ) : null);

  if (compact) {
    return (
      <View style={[styles.compactCard, style]}>
        {topSlot ? <View style={styles.topSlot}>{topSlot}</View> : null}
        <View style={[styles.compactNavigation, contentStyle]}>
          {onBack ? (
            <IconButton icon="arrow-left" label="Go back" onPress={onBack} style={styles.headerIcon} />
          ) : null}
          <View style={styles.compactCopy}>
            {eyebrow ? (
              <Text numberOfLines={1} style={[styles.compactEyebrow, { color: colors.textMuted }, eyebrowStyle]}>
                {eyebrow}
              </Text>
            ) : null}
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={[styles.compactTitle, { color: colors.text }, align === "center" && styles.centerText, titleStyle]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={[styles.compactSubtitle, { color: colors.textMuted }, subtitleStyle]}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {actionNode ? <View style={styles.compactAction}>{actionNode}</View> : null}
        </View>
        {metadata ? <View style={styles.compactMetadata}>{metadata}</View> : null}
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        dashboardCards.heroCard,
        density === "compact" && styles.compactCard,
        style,
      ]}
    >
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

        <View style={[styles.titleRow, align === "center" && styles.centerTitleRow]}>
          {onBack ? (
            <IconButton icon="arrow-left" label="Go back" onPress={onBack} style={styles.headerIcon} />
          ) : null}
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              compact && styles.compactTitle,
              { color: colors.text },
              align === "center" && styles.centerText,
              titleStyle,
            ]}
          >
            {title}
          </Text>
          {actionNode ? <View style={styles.action}>{actionNode}</View> : null}
          {align === "center" && onBack && !actionNode ? (
            <View style={styles.headerIcon} />
          ) : null}
        </View>

        {subtitle ? (
          <Text style={[styles.subtitle, align === "center" && styles.centerText, { color: colors.textMuted }, subtitleStyle]}>
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
  compactCard: {
    width: "100%",
  },
  compactNavigation: {
    minHeight: t.controls.iconButton,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.sm,
  },
  compactCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  compactEyebrow: {
    ...t.typography.micro,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  compactTitle: {
    ...t.typography.titleSmall,
  },
  compactSubtitle: {
    ...t.typography.caption,
    marginTop: t.spacing.none,
  },
  compactAction: {
    flexShrink: 0,
    alignSelf: "flex-start",
  },
  compactMetadata: {
    marginTop: t.spacing.xxs,
  },
  eyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },
  title: {
    ...t.typography.pageTitle,
    marginTop: t.spacing.xxs,
    letterSpacing: 0.2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: t.spacing.sm,
  },
  centerTitleRow: { alignItems: "center" },
  centerText: { textAlign: "center" },
  headerIcon: {
    flexShrink: 0,
    borderRadius: t.radius.pill,
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
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: "600",
  },
});
