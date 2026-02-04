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

// 👇 Make sure this path is correct for your project.
// If this file is app/(protected)/settings.js, you probably need "../../providers/ThemeProvider".
import { useTheme } from "../providers/ThemeProvider";

export default function SettingsPage() {
  const router = useRouter();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // grab theme values
  const { theme, colorScheme, colors, setTheme } = useTheme();
  const isDarkScheme = colorScheme === "dark";

  const settings = [
    {
      group: "Account",
      items: [
        { label: "Edit Profile", icon: "user", onPress: () => router.push("/edit-profile") },
        { label: "Change Password", icon: "lock", onPress: () => router.push("/change-password") },
      ],
    },
    {
      group: "App",
      items: [
        { label: "Notifications", icon: "bell", type: "toggle" },
        { label: "Appearance", icon: "moon", type: "theme" }, // theme buttons
      ],
    },
    {
      group: "Support",
      items: [
        { label: "Help Centre", icon: "info", onPress: () => router.push("/help") },
        { label: "About", icon: "info", onPress: () => router.push("/about") },
      ],
    },
  ];

  const handleSetTheme = (mode) => {
    // mode will be "system" | "light" | "dark"
    setTheme(mode);
  };

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: colors.background },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>Settings</Text>

        {settings.map((section, idx) => (
          <View key={idx} style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textMuted },
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
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.itemLeft}>
                  <Icon
                    name={item.icon}
                    size={20}
                    color={colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.itemText,
                      { color: colors.text },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>

                {item.type === "toggle" ? (
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{ false: "#444", true: colors.accent }}
                    thumbColor={notificationsEnabled ? "#fff" : "#888"}
                  />
                ) : item.type === "theme" ? (
                  // 🔽 three buttons: System / Light / Dark
                  <View style={styles.themeButtonsRow}>
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
                              borderColor: active ? colors.accent : colors.border,
                              backgroundColor: active ? colors.accent : colors.surface,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: active ? colors.surface : colors.text,
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
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        ))}

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 24, paddingTop: 12 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 16,
    textAlign: "center",
  },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 14, fontWeight: "bold", marginBottom: 10 },
  item: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
  },
  itemLeft: { flexDirection: "row", alignItems: "center" },
  itemText: { fontSize: 16, marginLeft: 10 },

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
});
