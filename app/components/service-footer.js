// app/components/service-footer.jsx
import { usePathname, useRouter } from "expo-router";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { useTheme } from "../providers/ThemeProvider";

export default function ServiceFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const { colorScheme, colors } = useTheme();
  const isDark = colorScheme === "dark";

  // 🔧 Tabs dedicated to Service / Workshop area
  // URLs are /service/... (group (protected) is hidden from URL)
  const tabs = [
    {
      route: "/service/home",          // app/(protected)/service/home.jsx
      label: "Home",
      iconActive: "home",
      iconInactive: "home-outline",
    },
    {
      // e.g. app/(protected)/service/work.jsx or index for overview
      route: "/service/work",
      label: "Overview",
      iconActive: "construct",
      iconInactive: "construct-outline",
    },
    {
      // app/(protected)/service/book-work.jsx
      route: "/service/book-work",
      label: "Book Work",
      iconActive: "clipboard",
      iconInactive: "clipboard-outline",
    },
    {
      // app/(protected)/service/service-list.jsx
      route: "/service/service-list",
      label: "Schedule",
      iconActive: "list",
      iconInactive: "list-outline",
    },
    {
      // app/(protected)/service/defects.jsx
      route: "/service/defects",
      label: "Defects",
      iconActive: "alert-circle",
      iconInactive: "alert-circle-outline",
    },
  ];

  const activeColor = colors.text;
  const inactiveColor = colors.textMuted;
  const bg = colors.surface || colors.background;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.footer,
          {
            backgroundColor: bg,
            shadowColor: "#000",
          },
        ]}
      >
        {tabs.map((t) => {
          // ✅ pathname comes back like "/service/home"
          const isActive =
            pathname === t.route ||
            (t.route !== "/" && pathname?.startsWith(t.route + "/"));

          const handlePress = () => {
            if (isActive) return;
            router.push(t.route);
          };

          return (
            <TouchableOpacity
              key={t.route}
              style={styles.tab}
              activeOpacity={isActive ? 1 : 0.6}
              onPress={handlePress}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={t.label}
            >
              <Ionicons
                name={isActive ? t.iconActive : t.iconInactive}
                size={26}
                color={isActive ? activeColor : inactiveColor}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 0 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 0,
    marginHorizontal: 0,
    borderRadius: 0,
    paddingVertical: 10,
    paddingHorizontal: 4,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: -2 },
      },
      android: { elevation: 12 },
    }),
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
});
