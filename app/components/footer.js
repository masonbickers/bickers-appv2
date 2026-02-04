// app/components/footer.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

// ✅ Use ThemeProvider hook instead of custom useColorScheme
import { useTheme } from "../providers/ThemeProvider";

export default function Footer() {
  const router = useRouter();
  const pathname = usePathname();
  const { colorScheme, colors } = useTheme();
  const isDark = colorScheme === "dark";

  const [userCode, setUserCode] = useState(null);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        // read the key we now definitely save
        const storedCode = await AsyncStorage.getItem("userCode");
        console.log("FOOTER userCode:", storedCode);
        if (isMounted) {
          setUserCode(storedCode);
        }
      } catch (e) {
        console.warn("Failed to load userCode", e);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

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

  const activeColor = colors.text;
  const inactiveColor = colors.textMuted;
  const bg = colors.background;

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
          const isJobsTab = t.route === "/job";

          // 👉 If Jobs tab + code 1234, treat /protected/service as its page
          let isActive;
          if (isJobsTab && userCode === "1234") {
            isActive = pathname?.startsWith("/service-home");
          } else {
            isActive =
              pathname === t.route ||
              (t.route !== "/" && pathname?.startsWith(t.route));
          }

          const handlePress = () => {
            if (isActive) return;

            if (isJobsTab && userCode === "1234") {
              console.log("Routing Jobs tab to /protected/service for 1234");
              router.push("service/service-home"); // 👈 service screen
              return;
            }

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
