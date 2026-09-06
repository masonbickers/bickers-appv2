import { StyleSheet, View } from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { AppPressable, AppText } from "../ui/AppPrimitives";
import { designTokens as t } from "../../lib/design/tokens";
import { useTheme } from "../../providers/ThemeProvider";

export default function OperationalPageHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
  actionLabel,
  actionIcon = "plus",
  onAction,
  children,
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <AppPressable
          style={[
            styles.roundButton,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
            },
          ]}
          onPress={onBack}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="arrow-left" size={t.iconSize.md} color={colors.text} />
        </AppPressable>

        <View style={styles.titleWrap}>
          {eyebrow ? <AppText variant="label" tone="muted" layoutStyle={styles.centerText}>{eyebrow}</AppText> : null}
          <AppText variant="pageTitle" layoutStyle={styles.centerText}>{title}</AppText>
          {subtitle ? <AppText variant="metadata" tone="muted" layoutStyle={styles.subtitle}>{subtitle}</AppText> : null}
        </View>

        <View style={styles.roundButtonSpacer} />
      </View>

      {children}

      {actionLabel && onAction ? (
        <View style={styles.actionRow}>
          <AppPressable
            style={[styles.primaryButton, { backgroundColor: colors.accent, borderColor: colors.accent }]}
            onPress={onAction}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Icon name={actionIcon} size={t.iconSize.sm} color={colors.textOnAccent} />
            <AppText variant="button" tone="inverse">{actionLabel}</AppText>
          </AppPressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.md },
  topRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: t.componentRadius.iconButton,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  roundButtonSpacer: { width: 44, height: 44 },
  titleWrap: { flex: 1, alignItems: "center", minWidth: 0 },
  centerText: { textAlign: "center" },
  subtitle: { marginTop: t.spacing.xxs, textAlign: "center" },
  actionRow: { marginTop: t.spacing.sm, flexDirection: "row", justifyContent: "center" },
  primaryButton: {
    minHeight: 42,
    minWidth: 132,
    paddingHorizontal: t.spacing.lg,
    borderRadius: t.componentRadius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
  },
});
