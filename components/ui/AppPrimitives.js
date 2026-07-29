import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { designTokens as t } from "../../lib/design/tokens";
import { createActionLock, getStatusColors } from "../../lib/design/semantics";
import { useTheme } from "../../providers/ThemeProvider";

export function PageShell({ children, style, contentStyle, edges = ["top", "left", "right"] }) {
  const { colors } = useTheme();
  const responsive = useResponsiveLayout();
  return (
    <SafeAreaView edges={edges} style={[styles.shell, { backgroundColor: colors.background }, style]}>
      <View
        style={[
          styles.shellContent,
          {
            width: "100%",
            maxWidth: responsive.maxContentWidth,
            alignSelf: "center",
            paddingHorizontal: responsive.gutter,
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </SafeAreaView>
  );
}

export function SectionCard({ children, style, accessibilityLabel }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.sectionCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionHeader({ title, subtitle, action, style }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={styles.sectionHeaderText}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {action ? <View style={styles.sectionAction}>{action}</View> : null}
    </View>
  );
}

function buttonColors(variant, colors) {
  if (variant === "danger") {
    return { background: colors.danger, border: colors.danger, text: colors.textOnAccent };
  }
  if (variant === "secondary") {
    return { background: colors.surfaceAlt, border: colors.border, text: colors.text };
  }
  if (variant === "ghost") {
    return { background: "transparent", border: colors.border, text: colors.accent };
  }
  return { background: colors.accent, border: colors.accent, text: colors.textOnAccent };
}

export function AppButton({
  label,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  style,
}) {
  const { colors } = useTheme();
  const [pending, setPending] = useState(false);
  const runLocked = useRef(createActionLock()).current;
  const busy = loading || pending;
  const inactive = disabled || busy;
  const tone = buttonColors(variant, colors);

  const handlePress = () => {
    if (inactive) return;
    setPending(true);
    runLocked(onPress)
      .catch(() => {})
      .finally(() => setPending(false));
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      focusable
      onPress={handlePress}
      style={({ pressed, focused }) => [
        styles.button,
        {
          backgroundColor: tone.background,
          borderColor: tone.border,
          opacity: inactive ? 0.55 : pressed ? 0.78 : 1,
        },
        focused && { borderColor: colors.focusRing, borderWidth: t.focus.width },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={tone.text} /> : null}
      {!busy && icon ? <Icon name={icon} size={17} color={tone.text} /> : null}
      <Text style={[styles.buttonText, { color: tone.text }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  hint,
  onPress,
  disabled = false,
  selected = false,
  tone = "default",
  size = 18,
  style,
}) {
  const { colors } = useTheme();
  const foreground = tone === "danger" ? colors.danger : selected ? colors.accent : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      focusable
      hitSlop={4}
      onPress={onPress}
      style={({ pressed, focused }) => [
        styles.iconButton,
        {
          backgroundColor: selected ? colors.accentSoft : colors.surfaceAlt,
          borderColor: selected ? colors.accent : colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.72 : 1,
        },
        focused && { borderColor: colors.focusRing, borderWidth: t.focus.width },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={foreground} />
    </Pressable>
  );
}

export function StatusChip({ label, tone = "neutral", icon, selected = false, style }) {
  const { colorScheme } = useTheme();
  const semantic = useMemo(() => getStatusColors(tone, colorScheme), [colorScheme, tone]);
  return (
    <View
      accessibilityLabel={`${label} status`}
      style={[
        styles.statusChip,
        {
          backgroundColor: semantic.background,
          borderColor: selected ? semantic.foreground : semantic.border,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={13} color={semantic.foreground} /> : null}
      <Text style={[styles.statusChipText, { color: semantic.foreground }]}>{label}</Text>
    </View>
  );
}

export function FormField({
  label,
  hint,
  error,
  value,
  onChangeText,
  disabled = false,
  inputProps,
  style,
}) {
  const { colors } = useTheme();
  const help = error || hint;
  return (
    <View style={[styles.formField, style]}>
      <Text style={[styles.formLabel, { color: colors.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.text,
            backgroundColor: colors.inputBackground,
            borderColor: error ? colors.danger : colors.inputBorder,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
        {...inputProps}
      />
      {help ? (
        <Text
          accessibilityRole={error ? "alert" : undefined}
          style={[styles.formHelp, { color: error ? colors.danger : colors.textMuted }]}
        >
          {help}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  shellContent: { flex: 1 },
  sectionCard: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.controls.cardPaddingLg,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: t.spacing.sm,
    flexWrap: "wrap",
    marginBottom: t.spacing.sm,
  },
  sectionHeaderText: { flex: 1, minWidth: 180 },
  sectionTitle: { ...t.typography.sectionTitle },
  sectionSubtitle: { ...t.typography.bodySmall, marginTop: t.spacing.xxs },
  sectionAction: { minHeight: t.controls.buttonHeightLg, justifyContent: "center" },
  button: {
    minHeight: t.controls.buttonHeightLg,
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
  },
  buttonText: { ...t.typography.button, flexShrink: 1, textAlign: "center" },
  iconButton: {
    width: t.controls.iconButton,
    minWidth: t.controls.iconButton,
    height: t.controls.iconButton,
    borderWidth: 1,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  statusChip: {
    minHeight: t.controls.chipMinHeight,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: t.spacing.xxs,
  },
  statusChipText: { ...t.typography.metadata, flexShrink: 1 },
  formField: { gap: t.spacing.xxs },
  formLabel: { ...t.typography.formLabel },
  input: {
    minHeight: t.controls.buttonHeightLg,
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    ...t.typography.body,
  },
  formHelp: { ...t.typography.bodySmall },
});
