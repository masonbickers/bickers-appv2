import { Fragment, useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { ASYNC_STATES, resolveAsyncState } from "../lib/asyncState";
import { designTokens as t } from "../lib/design/tokens";
import { useTheme } from "../providers/ThemeProvider";
import { AppButton, AppText } from "./ui/AppPrimitives";

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
      <AppText variant="bodySmall" tone="secondary" style={styles.stateText}>{label}</AppText>
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
        {title ? <AppText variant="bodyStrong" style={styles.stateTitle}>{title}</AppText> : null}
        <AppText variant="bodySmall" tone="secondary" style={styles.stateText}>{message}</AppText>
      </View>
      {onRetry ? (
        <AppButton
          label="Retry"
          accessibilityLabel="Retry loading data"
          disabled={busy}
          onPress={retry}
          loading={busy}
          variant="secondary"
          density="compact"
          size="small"
          style={styles.actionButton}
        />
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
      <AppText variant="metadata" tone="secondary">{label}</AppText>
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
      {title ? <AppText variant="sectionTitle" align="center" style={styles.emptyTitle}>{title}</AppText> : null}
      {message ? (
        <AppText variant="bodySmall" tone="secondary" align="center" style={styles.emptyMessage}>{message}</AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton label={actionLabel} onPress={onAction} density={compact ? "compact" : "standard"} style={styles.emptyAction} />
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
  stateTitle: { marginBottom: t.spacing.xxs },
  stateText: { flexShrink: 1 },
  actionButton: {
    minHeight: t.controls.buttonHeightLg,
    flexShrink: 0,
  },
  refreshing: {
    minHeight: 32,
    marginBottom: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
  },
  emptyCard: {
    minHeight: 150,
    borderWidth: 1,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  compactEmpty: { minHeight: 104, paddingVertical: t.spacing.md },
  emptyTitle: { marginTop: t.spacing.sm },
  emptyMessage: { marginTop: t.spacing.xs },
  emptyAction: {
    minHeight: t.controls.buttonHeightLg,
    marginTop: t.spacing.sm,
    alignSelf: "center",
  },
});
