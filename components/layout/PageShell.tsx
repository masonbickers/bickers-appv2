import { usePathname } from "expo-router";
import React, { ReactNode, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  FlatListProps,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { getPageShellBottomPadding, resolveAppChrome } from "../../lib/appChrome";
import { ASYNC_STATES, resolveAsyncState } from "../../lib/asyncState";
import { resolvePageDensity } from "../../lib/design/pageDensity";
import { designTokens as t, type PageDensity } from "../../lib/design/tokens";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useTheme } from "../../providers/ThemeProvider";
import {
  EmptyState as RawEmptyState,
  ErrorState as RawErrorState,
  LoadingState as RawLoadingState,
  RefreshingIndicator as RawRefreshingIndicator,
} from "../AsyncState";
import PageHeaderCard from "../PageHeaderCard";
import { AppButton as RawAppButton } from "../ui/AppPrimitives";

const AppButton = RawAppButton as React.ComponentType<any>;
const EmptyState = RawEmptyState as React.ComponentType<any>;
const ErrorState = RawErrorState as React.ComponentType<any>;
const LoadingState = RawLoadingState as React.ComponentType<any>;
const RefreshingIndicator = RawRefreshingIndicator as React.ComponentType<any>;

export type AsyncResource = {
  data?: unknown;
  error?: unknown;
  isInitialLoading?: boolean;
  isRefreshing?: boolean;
};

export type PageHeaderConfig = {
  variant: "hero" | "compact";
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: {
    label: string;
    icon?: string;
    iconOnly?: boolean;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
  };
  metadata?: ReactNode;
  topSlot?: ReactNode;
};

export type PageStateConfig = {
  resources: AsyncResource[];
  hasContent: boolean;
  onRetry?: () => void | Promise<void>;
  loadingLabel?: string;
  errorTitle?: string;
  errorMessage?: string;
  refreshErrorMessage?: string;
  empty?: {
    when: boolean;
    icon?: string;
    title: string;
    message?: string;
    actionLabel?: string;
    onAction?: () => void;
  };
};

type HeaderChoice =
  | {
      header?: PageHeaderConfig;
      customHeader?: never;
      customHeaderPlacement?: never;
    }
  | {
      header?: never;
      customHeader: ReactNode;
      customHeaderPlacement: "scroll" | "fixed";
    };

type SharedPageShellProps = {
  density?: PageDensity;
  contentSpacing?: "none" | "compact" | "standard";
  gutter?: "standard" | "compact";
  width?: "content" | "form" | "full";
  state?: PageStateConfig;
  refresh?: {
    refreshing: boolean;
    onRefresh: () => void | Promise<void>;
  };
  scrollProps?: Omit<ScrollViewProps, "contentContainerStyle" | "refreshControl">;
  stickyAction?: ReactNode;
};

type OwnedListProps<ItemT> = Omit<
  FlatListProps<ItemT>,
  "contentContainerStyle" | "ListEmptyComponent" | "ListHeaderComponent" | "refreshControl"
>;

export type PageShellProps<ItemT> = HeaderChoice & SharedPageShellProps & ({
  mode: "list";
  listProps: OwnedListProps<ItemT>;
  scrollProps?: never;
  children?: never;
} | {
  mode?: "scroll" | "form" | "static";
  listProps?: never;
  children?: ReactNode;
});

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  return visible;
}

export default function PageShell<ItemT = unknown>({
  mode = "scroll",
  density,
  contentSpacing = "none",
  gutter = "standard",
  width = "content",
  header,
  customHeader,
  customHeaderPlacement,
  state,
  refresh,
  listProps,
  scrollProps,
  stickyAction,
  children,
}: PageShellProps<ItemT>) {
  const pathname = usePathname();
  const resolvedDensity = resolvePageDensity(pathname, density) as PageDensity;
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const responsive = useResponsiveLayout();
  const { colors } = useTheme();
  const [stickyActionHeight, setStickyActionHeight] = useState(0);
  const chrome = resolveAppChrome(pathname, { keyboardVisible });
  const maxWidth =
    width === "full"
      ? undefined
      : width === "form"
        ? responsive.maxFormWidth
        : responsive.maxContentWidth;
  const standardBottomPadding = getPageShellBottomPadding({
    safeAreaBottom: insets.bottom,
    tabsVisible: chrome.tabsVisible,
    floatingAccessoryHeight:
      chrome.tabsVisible && pathname?.startsWith("/service")
        ? t.controls.buttonHeight + t.spacing.xs
        : 0,
  });
  const contentBottomPadding =
    standardBottomPadding +
    (stickyAction ? stickyActionHeight + t.spacing.sm : 0);
  const contentGap =
    contentSpacing === "standard"
      ? t.spacing.md
      : contentSpacing === "compact"
        ? t.spacing.xs
        : t.spacing.none;
  const horizontalGutter =
    width === "full"
      ? 0
      : gutter === "compact" && responsive.isCompact
        ? t.spacing.sm
        : responsive.pageGutter;

  const headerNode = useMemo(() => {
    if (customHeader) return customHeader;
    if (!header) return null;
    const action = header.action ? (
      <AppButton
        label={header.action.label}
        icon={header.action.icon}
        variant={header.action.variant}
        onPress={header.action.onPress}
        disabled={header.action.disabled}
        loading={header.action.loading}
        density={resolvedDensity}
        size={header.variant === "compact" ? "small" : "medium"}
        iconOnly={
          header.action.iconOnly ??
          (header.variant === "compact" && Boolean(header.action.icon))
        }
        accessibilityLabel={header.action.label}
      />
    ) : null;
    return (
      <PageHeaderCard
        eyebrow={header.eyebrow}
        title={header.title}
        subtitle={header.subtitle}
        onBack={header.onBack}
        action={action}
        metadata={header.metadata}
        topSlot={header.topSlot}
        compact={header.variant === "compact"}
        density={resolvedDensity}
        contentStyle={header.variant === "hero" ? styles.heroHeaderContent : undefined}
      />
    );
  }, [customHeader, header, resolvedDensity]);

  const headerPlacement = customHeader
    ? customHeaderPlacement
    : header?.variant === "hero"
      ? "scroll"
      : "fixed";
  const fixedHeader = headerPlacement === "fixed" ? headerNode : null;
  const scrollingHeader = headerPlacement === "scroll" ? headerNode : null;

  const asyncState = state
    ? resolveAsyncState(state.resources, { hasContent: state.hasContent })
    : ASYNC_STATES.READY;
  const retrying = state?.resources.some(
    (resource) => resource?.isRefreshing === true
  );

  let stateRegion: ReactNode = null;
  if (asyncState === ASYNC_STATES.INITIAL_LOADING) {
    stateRegion = (
      <LoadingState label={state?.loadingLabel} style={styles.stateRegion} />
    );
  } else if (asyncState === ASYNC_STATES.INITIAL_ERROR) {
    stateRegion = (
      <ErrorState
        title={state?.errorTitle || "Couldn’t load this data"}
        message={state?.errorMessage || "Please check your connection and try again."}
        onRetry={state?.onRetry}
        retrying={retrying}
        style={styles.stateRegion}
      />
    );
  } else if (state?.empty?.when) {
    stateRegion = (
      <EmptyState
        icon={state.empty.icon}
        title={state.empty.title}
        message={state.empty.message}
        actionLabel={state.empty.actionLabel}
        onAction={state.empty.onAction}
        style={styles.stateRegion}
      />
    );
  }

  const refreshStatus =
    asyncState === ASYNC_STATES.REFRESH_ERROR ? (
      <ErrorState
        message={state?.refreshErrorMessage || "Couldn’t refresh. Showing the last saved data."}
        onRetry={state?.onRetry}
        retrying={retrying}
        compact
      />
    ) : asyncState === ASYNC_STATES.REFRESHING ? (
      <RefreshingIndicator />
    ) : null;

  const showContent = !stateRegion;
  const refreshControl = refresh ? (
    <RefreshControl
      refreshing={refresh.refreshing}
      onRefresh={refresh.onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
    />
  ) : undefined;
  const constrainedStyle = {
    width: "100%" as const,
    maxWidth,
    alignSelf: "center" as const,
    paddingHorizontal: horizontalGutter,
  };
  const headerConstrainedStyle = {
    width: "100%" as const,
    maxWidth: responsive.maxContentWidth,
    alignSelf: "center" as const,
    paddingHorizontal: responsive.pageGutter,
  };
  const scrollContentStyle = [
    styles.scrollContent,
    constrainedStyle,
    {
      gap: contentGap,
      paddingBottom: contentBottomPadding,
    },
  ];

  const standardBody = (
    <>
      {scrollingHeader}
      {refreshStatus}
      {stateRegion || children}
    </>
  );

  let body: ReactNode;
  if (mode === "static") {
    body = <View style={scrollContentStyle}>{standardBody}</View>;
  } else if (mode === "list") {
    body = (
      <FlatList
        {...listProps}
        data={showContent ? listProps?.data || [] : []}
        renderItem={listProps?.renderItem || (() => null)}
        contentContainerStyle={scrollContentStyle}
        refreshControl={refreshControl}
        ListHeaderComponent={
          <>
            {scrollingHeader}
            {refreshStatus}
          </>
        }
        ListEmptyComponent={stateRegion}
      />
    );
  } else {
    const scrollView = (
      <ScrollView
        {...scrollProps}
        contentContainerStyle={scrollContentStyle}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps={mode === "form" ? "handled" : "never"}
        keyboardDismissMode={mode === "form" && Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
        {standardBody}
      </ScrollView>
    );
    body =
      mode === "form" ? (
        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {scrollView}
        </KeyboardAvoidingView>
      ) : (
        scrollView
      );
  }

  const stickyBottom = chrome.tabsVisible
    ? t.navigation.tabBarHeight +
      Math.max(
        t.navigation.tabBarMinBottomGap,
        insets.bottom - t.navigation.tabBarBottomOffset
      ) +
      t.spacing.xs
    : insets.bottom + t.spacing.xs;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.shell, { backgroundColor: colors.background }]}
    >
      {fixedHeader ? (
        <View style={[styles.fixedHeader, headerConstrainedStyle]}>{fixedHeader}</View>
      ) : null}
      <View style={styles.body}>{body}</View>
      {stickyAction ? (
        <View
          onLayout={(event) => setStickyActionHeight(event.nativeEvent.layout.height)}
          style={[
            styles.stickyAction,
            constrainedStyle,
            { bottom: stickyBottom },
          ]}
        >
          {stickyAction}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  body: { flex: 1 },
  fixedHeader: {
    paddingTop: t.spacing.xs,
    paddingBottom: t.spacing.xxs,
  },
  heroHeaderContent: {
    paddingHorizontal: t.spacing.none,
  },
  scrollContent: {
    flexGrow: 1,
    paddingTop: t.spacing.sm,
  },
  stateRegion: {
    alignSelf: "stretch",
  },
  stickyAction: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 30,
  },
});
