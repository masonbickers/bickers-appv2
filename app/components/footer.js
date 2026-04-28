// app/components/footer.jsx
import { usePathname, useRouter } from "expo-router";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { resolveWorkspaceAccess } from "../../lib/access";
import { useAuth } from "../providers/AuthProvider";
// ✅ Use ThemeProvider hook instead of custom useColorScheme
import { useTheme } from "../providers/ThemeProvider";

export default function Footer() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();
  const { employee } = useAuth() ?? {};
  const workspaceAccess = resolveWorkspaceAccess(employee);
  const isServiceOnlyUser = workspaceAccess.service && !workspaceAccess.user;

  const tabs = [
    {
      route: "/screens/homescreen",
      label: "Home",
      iconActive: "home",
      iconInactive: "home-outline",
    },
    {
      route: "/screens/schedule",
      label: "Schedule",
      iconActive: "calendar",
      iconInactive: "calendar-outline",
    },
    {
      route: "/job", // logical route name for Jobs tab
      label: "Jobs",
      iconActive: "document-text",
      iconInactive: "document-text-outline",
    },
    {
      route: "/contacts",
      label: "Contacts",
      iconActive: "people",
      iconInactive: "people-outline",
    },
    {
      route: "/me",
      label: "Me",
      iconActive: "person-circle",
      iconInactive: "person-circle-outline",
    },
  ];

  const activeColor = colors.accent;
  const inactiveColor = colors.textMuted;
  const bg = colors.surface;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.footer,
          {
            backgroundColor: bg,
            borderTopColor: colors.border,
            shadowColor: "#000",
          },
        ]}
      >
        {tabs.map((t) => {
          const isJobsTab = t.route === "/job";

          // Service users use service workspace routes.
          let isActive;
          if (isJobsTab && isServiceOnlyUser) {
            isActive = pathname?.startsWith("/service");
          } else {
            isActive =
              pathname === t.route ||
              (t.route !== "/" && pathname?.startsWith(t.route));
          }

          const handlePress = () => {
            if (isActive) return;

            if (isJobsTab && isServiceOnlyUser) {
              router.navigate("/service/home");
              return;
            }

            router.navigate(t.route);
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
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
    borderRadius: 0,
    paddingVertical: 7,
    paddingHorizontal: 4,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: -2 },
      },
      android: { elevation: 8 },
    }),
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 0,
  },
});
