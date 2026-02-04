// app/(protected)/service/settings.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { signOut } from "firebase/auth";
import { auth } from "../../../firebaseConfig";

import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

/* --------- SERVICE STYLE COLOURS --------- */

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#FF3B30", // 🔴 red accent
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

export default function ServiceSettingsPage() {
  const router = useRouter();
  const { reloadSession } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const { theme, colorScheme, colors, setTheme } = useTheme();
  const isDarkScheme = colorScheme === "dark";

  const settings = [
    {
      group: "Workshop Account",
      items: [
        {
          label: "Edit Profile",
          icon: "user",
          onPress: () => router.push("/(protected)/edit-profile"),
        },
        {
          label: "Change Password",
          icon: "lock",
          onPress: () => router.push("/(protected)/change-password"),
        },
      ],
    },
    {
      group: "Service Notifications",
      items: [
        {
          label: "Job & Workshop Alerts",
          icon: "bell",
          type: "toggle",
        },
        {
          label: "MOT / Service Reminders",
          icon: "clock",
          onPress: () => router.push("/(protected)/service/notification-rules"),
        },
      ],
    },
    {
      group: "Appearance",
      items: [
        { label: "Theme", icon: "moon", type: "theme" }, // theme buttons
      ],
    },
    {
      group: "Support",
      items: [
        {
          label: "Help Centre",
          icon: "info",
          onPress: () => router.push("/(protected)/help"),
        },
        {
          label: "About",
          icon: "info",
          onPress: () => router.push("/(protected)/about"),
        },
      ],
    },
  ];

  const handleSetTheme = (mode) => {
    setTheme(mode); // "system" | "light" | "dark"
  };

  // 🔐 LOGOUT – mirror HomeScreen behaviour so root layout sends you to (auth)/login
  const handleLogout = async () => {
    try {
      // clear role + employee session
      await AsyncStorage.multiRemove([
        "sessionRole",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
      ]);

      // tell AuthProvider to re-check session
      await reloadSession();

      // sign out from Firebase (ignore minor errors)
      await signOut(auth).catch(() => {});

      // no router.replace needed – root layout should now mount the (auth) stack
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        {
          backgroundColor: colors.background || COLORS.background,
        },
      ]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          {
            borderBottomColor: colors.border || COLORS.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={router.back}
          style={styles.backButton}
          accessibilityRole="button"
        >
          <Icon
            name="arrow-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>

        <Text
          style={[
            styles.headerTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          Service Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {settings.map((section, idx) => (
          <View key={idx} style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textMuted || COLORS.textLow },
              ]}
            >
              {section.group}
            </Text>

            {section.items.map((item, index) => (
              <View
                key={index}
                style={[
                  styles.item,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                <View style={styles.itemLeft}>
                  <Icon
                    name={item.icon}
                    size={20}
                    color={colors.textMuted || COLORS.textMid}
                  />
                  <Text
                    style={[
                      styles.itemText,
                      { color: colors.text || COLORS.textHigh },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>

                {item.type === "toggle" ? (
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{
                      false: "#444",
                      true: colors.accent || COLORS.primaryAction,
                    }}
                    thumbColor={notificationsEnabled ? "#fff" : "#888"}
                  />
                ) : item.type === "theme" ? (
                  <View className="themeButtonsRow" style={styles.themeButtonsRow}>
                    {["system", "light", "dark"].map((mode, i) => {
                      const active = theme === mode;
                      return (
                        <TouchableOpacity
                          key={mode}
                          onPress={() => handleSetTheme(mode)}
                          style={[
                            styles.themeButton,
                            {
                              marginLeft: i === 0 ? 0 : 6,
                              borderColor: active
                                ? colors.accent || COLORS.primaryAction
                                : colors.border || COLORS.border,
                              backgroundColor: active
                                ? colors.accent || COLORS.primaryAction
                                : colors.surface || COLORS.card,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: active
                                ? COLORS.textHigh
                                : colors.text || COLORS.textHigh,
                              fontSize: 12,
                              fontWeight: active ? "700" : "500",
                              textTransform: "capitalize",
                            }}
                          >
                            {mode}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={item.onPress}
                    accessibilityRole="button"
                  >
                    <Icon
                      name="chevron-right"
                      size={20}
                      color={colors.textMuted || COLORS.textMid}
                    />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        ))}

        {/* 🚪 Logout section – styled like the main settings page */}
        <View style={styles.section}>
          <TouchableOpacity
            onPress={handleLogout}
            style={[
              styles.logoutButton,
              {
                borderColor: colors.accent || COLORS.primaryAction,
                backgroundColor: "transparent",
              },
            ]}
          >
            <Icon
              name="log-out"
              size={20}
              color={colors.accent || COLORS.primaryAction}
            />
            <Text
              style={[
                styles.logoutText,
                { color: colors.accent || COLORS.primaryAction },
              ]}
            >
              Log Out
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingRight: 10,
    paddingVertical: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 12,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  item: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
  },
  itemLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  itemText: {
    fontSize: 16,
    marginLeft: 10,
  },
  themeButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  themeButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  logoutButton: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  logoutText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: "700",
  },
});
