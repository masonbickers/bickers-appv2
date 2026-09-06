import { AppText as Text } from "../ui/AppPrimitives";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { useEffect,
  useRef,
  useState } from "react";
import { Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "react-native-vector-icons/Ionicons";

import { designTokens as t } from "../../lib/design/tokens";
import { useTheme } from "../../providers/ThemeProvider";

const TAB_INDICATOR_INSET = t.spacing.xxs;

export default function BottomNavigationBar({
  tabs,
  activeIndex,
  onSelect,
  floatingContent,
}) {
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const usesIOSMaterial = Platform.OS === "ios";
  const navigationTabs = tabs.slice(0, 5);
  const resolvedActiveIndex = activeIndex >= 0 && activeIndex < navigationTabs.length
    ? activeIndex
    : -1;
  const [barWidth, setBarWidth] = useState(0);
  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorScale = useRef(new Animated.Value(1)).current;
  const tabWidth = barWidth > 0 && navigationTabs.length > 0
    ? (barWidth - TAB_INDICATOR_INSET * 2) / navigationTabs.length
    : 0;
  const bottomGap = Math.max(
    t.navigation.tabBarMinBottomGap,
    insets.bottom - t.navigation.tabBarBottomOffset
  );
  useEffect(() => {
    if (resolvedActiveIndex < 0 || tabWidth <= 0) return;
    indicatorX.stopAnimation();
    indicatorX.setValue(resolvedActiveIndex * tabWidth);
  }, [indicatorX, resolvedActiveIndex, tabWidth]);

  const select = (index) => {
    if (index === resolvedActiveIndex) {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
      Animated.sequence([
        Animated.timing(indicatorScale, { toValue: 0.9, duration: 75, useNativeDriver: true }),
        Animated.timing(indicatorScale, { toValue: 1.12, duration: 125, useNativeDriver: true }),
        Animated.spring(indicatorScale, { toValue: 1, damping: 6, stiffness: 230, mass: 0.65, useNativeDriver: true }),
      ]).start();
      return;
    }
    if (Platform.OS !== "web") {
      Haptics.selectionAsync().catch(() => {});
    }
    onSelect?.(tabs[index], index);
  };

  const surface = (
    <View style={styles.surfaceContent} onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}>
      {tabWidth > 0 && resolvedActiveIndex >= 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.indicator,
            {
              width: tabWidth,
              backgroundColor: colors.navigationSelected,
              borderColor: colors.navigationBorder,
              transform: [{ translateX: indicatorX }, { scale: indicatorScale }],
            },
          ]}
        >
        </Animated.View>
      ) : null}
      {navigationTabs.map((tab, index) => {
        const active = index === resolvedActiveIndex;
        return (
          <Pressable
            key={tab.route}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.accessibilityLabel || tab.label}
            onPress={() => select(index)}
            style={({ pressed, focused }) => [
              styles.tab,
              { opacity: pressed ? 0.65 : 1 },
              focused && { borderColor: colors.focusRing },
            ]}
          >
            <Animated.View style={[styles.iconWrap, active && { transform: [{ scale: indicatorScale }] }]}> 
              {Platform.OS === "ios" && tab.symbol ? (
                <SymbolView
                  name={active ? tab.symbol.active : tab.symbol.inactive}
                  size={t.iconSize.lg}
                  weight={active ? "semibold" : "regular"}
                  tintColor={active ? colors.accent : colors.textMuted}
                  resizeMode="scaleAspectFit"
                  style={styles.symbol}
                />
              ) : (
                <Ionicons
                  name={active ? tab.iconActive : tab.iconInactive}
                  size={t.iconSize.lg}
                  color={active ? colors.accent : colors.textMuted}
                />
              )}
              {tab.badge ? (
                <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.surface }]}>
                  <Text style={[styles.badgeText, { color: colors.textOnAccent }]}>{tab.badge}</Text>
                </View>
              ) : null}
            </Animated.View>
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                {
                  color: active ? colors.accent : colors.textMuted,
                  fontWeight: active ? "700" : "600",
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.container, { height: t.navigation.tabBarHeight + bottomGap, paddingBottom: bottomGap }]}> 
      {floatingContent ? (
        <View
          pointerEvents="box-none"
          style={[styles.accessoryLayer, { bottom: bottomGap + t.navigation.tabBarHeight + t.spacing.xs }]}
        >
          {floatingContent}
        </View>
      ) : null}
      <View
        style={[
          styles.shadowShell,
          {
            shadowColor: colors.text,
            backgroundColor: usesIOSMaterial ? "transparent" : colors.navigationSurface,
          },
        ]}
      >
        <View
          style={[
            styles.surface,
            {
              backgroundColor: usesIOSMaterial ? "transparent" : colors.navigationSurface,
              borderColor: colors.navigationBorder,
            },
          ]}
        >
          {usesIOSMaterial ? (
            <BlurView
              pointerEvents="none"
              tint={colorScheme === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
              intensity={80}
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          {surface}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: t.navigation.tabBarHorizontalGap,
    width: "100%",
    maxWidth: t.navigation.tabBarMaxWidth,
    alignSelf: "center",
  },
  accessoryLayer: {
    position: "absolute",
    right: t.spacing.xl,
    zIndex: 20,
    alignItems: "flex-end",
  },
  shadowShell: {
    flex: 1,
    borderRadius: t.componentRadius.pill,
    ...t.shadows.lg,
  },
  surface: {
    flex: 1,
    overflow: "hidden",
    borderRadius: t.componentRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  materialBackground: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: t.componentRadius.pill,
  },
  surfaceContent: {
    height: t.navigation.tabBarHeight,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: TAB_INDICATOR_INSET,
  },
  tab: {
    flex: 1,
    minHeight: t.controls.buttonHeight,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: t.spacing.xs,
    paddingBottom: t.spacing.xxs,
    borderWidth: t.focus.width,
    borderColor: "transparent",
    borderRadius: t.componentRadius.nestedControl,
  },
  indicator: {
    position: "absolute",
    left: TAB_INDICATOR_INSET,
    top: TAB_INDICATOR_INSET,
    height: t.navigation.tabBarHeight - TAB_INDICATOR_INSET * 2,
    overflow: "hidden",
    borderRadius: t.componentRadius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  iconWrap: {
    height: t.iconSize.xl,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  symbol: {
    width: t.iconSize.lg,
    height: t.iconSize.lg,
  },
  label: {
    ...t.typography.tabLabel,
    marginTop: t.spacing.xxxs,
    maxWidth: "100%",
  },
  badge: {
    position: "absolute",
    top: t.spacing.xs,
    left: "54%",
    minWidth: 18,
    height: 18,
    paddingHorizontal: t.spacing.xxs,
    borderRadius: t.componentRadius.pill,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { ...t.typography.caption, fontSize: t.typography.micro.fontSize, lineHeight: t.typography.micro.lineHeight, fontWeight: "900" },
});
