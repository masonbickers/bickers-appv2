import { Fragment, useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { ASYNC_STATES, resolveAsyncState } from "../lib/asyncState";
import { designTokens as t } from "../lib/design/tokens";
import { useTheme } from "../providers/ThemeProvider";

export function LoadingState({ label = "Loading…", compact = false, style }) {
  const { colors, tokens } = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[
        styles.stateCard,
        compact && styles.compactCard,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderRadius: tokens.radius.md,
        },
        style,
      ]}
    >
      <ActivityIndicator size={compact ? "small" : "large"} color={colors.accent} />
      <Text style={[styles.stateText, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  compact = false,
  style,
}) {
  const { colors, tokens } = useTheme();
  const [retryPending, setRetryPending] = useState(false);
  const retryLock = useRef(false);
  const busy = retrying || retryPending;
  const retry = useCallback(async () => {
    if (!onRetry || busy || retryLock.current) return;
    retryLock.current = true;
    setRetryPending(true);
    try {
      await onRetry();
    } catch {
      // Resource state remains in error and continues to expose the retry action.
    } finally {
      retryLock.current = false;
      setRetryPending(false);
    }
  }, [busy, onRetry]);

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.stateCard,
        compact && styles.compactCard,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.danger,
          borderRadius: tokens.radius.md,
        },
        style,
      ]}
    >
      <Icon name="alert-circle" size={compact ? 17 : 22} color={colors.danger} />
      <View style={styles.textColumn}>
        {title ? <Text style={[styles.stateTitle, { color: colors.text }]}>{title}</Text> : null}
        <Text style={[styles.stateText, { color: colors.textMuted }]}>{message}</Text>
      </View>
      {onRetry ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Retry loading data"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={retry}
          style={[
            styles.actionButton,
            {
              borderColor: colors.border,
              backgroundColor: colors.surface,
              opacity: busy ? 0.6 : 1,
              borderRadius: tokens.radius.sm,
            },
          ]}
        >
          {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          <Text style={[styles.actionText, { color: colors.accent }]}>Retry</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function RefreshingIndicator({ visible = true, label = "Updating…", style }) {
  const { colors } = useTheme();
  if (!visible) return null;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[styles.refreshing, style]}
    >
      <ActivityIndicator size="small" color={colors.accent} />
      <Text style={[styles.refreshingText, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  message,
  actionLabel,
  onAction,
  compact = false,
  style,
}) {
  const { colors, tokens } = useTheme();
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.emptyCard,
        compact && styles.compactEmpty,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderRadius: tokens.radius.md,
        },
        style,
      ]}
    >
      <Icon name={icon} size={compact ? 22 : 28} color={colors.textMuted} />
      {title ? <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text> : null}
      {message ? (
        <Text style={[styles.emptyMessage, { color: colors.textMuted }]}>{message}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={[
            styles.emptyAction,
            { backgroundColor: colors.accent, borderRadius: tokens.radius.sm },
          ]}
        >
          <Text style={[styles.emptyActionText, { color: colors.textOnAccent }]}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function AsyncContentState({
  resources = [],
  hasContent = false,
  onRetry,
  loadingLabel = "Loading…",
  initialErrorTitle = "Couldn’t load this data",
  initialErrorMessage = "Please check your connection and try again.",
  refreshErrorMessage = "Couldn’t refresh. Showing the last saved data.",
  refreshingLabel = "Updating…",
  compact = false,
  children,
  style,
}) {
  const state = resolveAsyncState(resources, { hasContent });
  const retrying = resources.some((resource) => resource?.isRefreshing === true);

  if (state === ASYNC_STATES.INITIAL_LOADING) {
    return <LoadingState label={loadingLabel} compact={compact} style={style} />;
  }
  if (state === ASYNC_STATES.INITIAL_ERROR) {
    return (
      <ErrorState
        title={initialErrorTitle}
        message={initialErrorMessage}
        onRetry={onRetry}
        retrying={retrying}
        compact={compact}
        style={style}
      />
    );
  }

  const status =
    state === ASYNC_STATES.REFRESH_ERROR ? (
      <ErrorState
        message={refreshErrorMessage}
        onRetry={onRetry}
        retrying={retrying}
        compact
        style={style}
      />
    ) : state === ASYNC_STATES.REFRESHING ? (
      <RefreshingIndicator label={refreshingLabel} style={style} />
    ) : null;

  if (children === undefined || children === null) return status;
  return (
    <Fragment>
      {status}
      {children}
    </Fragment>
  );
}

const styles = StyleSheet.create({
  stateCard: {
    minHeight: 76,
    borderWidth: 1,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    marginBottom: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  compactCard: {
    minHeight: t.controls.buttonHeightLg,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
  },
  textColumn: { flex: 1, minWidth: 0 },
  stateTitle: { fontSize: 14, lineHeight: 20, fontWeight: "800", marginBottom: 2 },
  stateText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  actionButton: {
    minHeight: t.controls.buttonHeightLg,
    borderWidth: 1,
    paddingHorizontal: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  actionText: { fontSize: 13, lineHeight: 18, fontWeight: "800" },
  refreshing: {
    minHeight: 32,
    marginBottom: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
  },
  refreshingText: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  emptyCard: {
    minHeight: 150,
    borderWidth: 1,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  compactEmpty: { minHeight: 104, paddingVertical: t.spacing.md },
  emptyTitle: { marginTop: 10, fontSize: 17, lineHeight: 22, fontWeight: "800", textAlign: "center" },
  emptyMessage: { marginTop: 5, fontSize: 13, lineHeight: 19, textAlign: "center" },
  emptyAction: {
    minHeight: t.controls.buttonHeightLg,
    marginTop: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    justifyContent: "center",
  },
  emptyActionText: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
});
