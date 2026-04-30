import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { NOTIFICATIONS_ENABLED } from "../../lib/notifications";
import { useTheme } from "../../providers/ThemeProvider";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export default function SettingsPage() {
  const router = useRouter();
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    !!NOTIFICATIONS_ENABLED
  );
  const { theme, colors, setTheme } = useTheme();

  const settings = [
    {
      group: "Account",
      items: [
        {
          label: "Edit Profile",
          icon: "user",
          subLabel: "Update your personal details",
          onPress: () => router.push("/edit-profile"),
        },
        {
          label: "Change Password",
          icon: "lock",
          subLabel: "Update your login credentials",
          onPress: () =>
            Alert.alert(
              "Coming soon",
              "Password changes are not available in-app yet."
            ),
        },
      ],
    },
    {
      group: "App",
      items: [
        {
          label: "Notifications",
          icon: "bell",
          type: "toggle",
          subLabel: NOTIFICATIONS_ENABLED
            ? "Control in-app notification alerts"
            : "Temporarily disabled across the app",
        },
        {
          label: "Appearance",
          icon: "moon",
          type: "theme",
          subLabel: "Choose system, light, or dark mode",
        },
      ],
    },
    {
      group: "Support",
      items: [
        {
          label: "Help Centre",
          icon: "help-circle",
          subLabel: "Browse FAQs and app guidance",
          onPress: () => router.push("/help"),
        },
        {
          label: "About",
          icon: "info",
          subLabel: "Version and company information",
          onPress: () => router.push("/about"),
        },
      ],
    },
  ];

  const handleSetTheme = (mode) => {
    setTheme(mode);
  };

  const handleNotificationsToggle = (next) => {
    if (!NOTIFICATIONS_ENABLED) return;
    setNotificationsEnabled(next);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroContent}>
            <View style={styles.heroTopRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                activeOpacity={0.85}
                style={[
                  styles.backBtn,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                    borderColor: withAlpha(colors.border, 0.75),
                  },
                ]}
              >
                <Icon name="arrow-left" size={15} color={colors.text} />
              </TouchableOpacity>

              <View style={styles.heroTitleWrap}>
                <Text style={[styles.heroEyebrow, { color: colors.textMuted }]}>
                  Profile & App
                </Text>
                <Text style={[styles.heroTitle, { color: colors.text }]}>Settings</Text>
              </View>

              <View style={styles.heroSpacer} />
            </View>

          </View>
        </View>

        {settings.map((section, idx) => (
          <View
            key={idx}
            style={[
              styles.sectionCard,
              { borderColor: colors.border },
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.group}</Text>
              <View
                style={[
                  styles.sectionCountPill,
                  {
                    backgroundColor: withAlpha(colors.accent, 0.16),
                    borderColor: withAlpha(colors.accent, 0.42),
                  },
                ]}
              >
                <Text style={[styles.sectionCountText, { color: colors.accent }]}>
                  {section.items.length}
                </Text>
              </View>
            </View>

            {section.items.map((item, index) => (
              <View
                key={index}
                style={[
                  styles.itemRow,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.itemLeftWrap}>
                  <View
                    style={[
                      styles.itemIconWrap,
                      {
                        backgroundColor: withAlpha(colors.accent, 0.12),
                        borderColor: withAlpha(colors.accent, 0.35),
                      },
                    ]}
                  >
                    <Icon name={item.icon} size={16} color={colors.accent} />
                  </View>

                  <View style={styles.itemTextWrap}>
                    <Text style={[styles.itemText, { color: colors.text }]}>{item.label}</Text>
                    {!!item.subLabel && (
                      <Text style={[styles.itemSubText, { color: colors.textMuted }]}>
                        {item.subLabel}
                      </Text>
                    )}
                  </View>
                </View>

                {item.type === "toggle" ? (
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={handleNotificationsToggle}
                    disabled={!NOTIFICATIONS_ENABLED}
                    trackColor={{
                      false: withAlpha(colors.textMuted, 0.45),
                      true: colors.accent,
                    }}
                    thumbColor={notificationsEnabled ? "#fff" : "#888"}
                  />
                ) : item.type === "theme" ? (
                  <View style={styles.themeButtonsRow}>
                    {["system", "light", "dark"].map((mode) => {
                      const active = theme === mode;
                      return (
                        <TouchableOpacity
                          key={mode}
                          onPress={() => handleSetTheme(mode)}
                          activeOpacity={0.85}
                          style={[
                            styles.themeButton,
                            {
                              borderColor: active ? colors.accent : colors.border,
                              backgroundColor: active
                                ? withAlpha(colors.accent, 0.15)
                                : colors.surface,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.themeButtonText,
                              {
                                color: active ? colors.accent : colors.textMuted,
                              },
                            ]}
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
                    activeOpacity={0.8}
                    style={styles.itemAction}
                  >
                    <Icon name="chevron-right" size={20} color={colors.textMuted} />
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
  scrollContent: { paddingHorizontal: 14, paddingBottom: 24, paddingTop: 8 },

  heroCard: {
    position: "relative",
    marginBottom: 8,
  },
  heroContent: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitleWrap: {
    flex: 1,
    paddingTop: 1,
    alignItems: "center",
  },
  heroSpacer: {
    width: 34,
    height: 34,
  },
  heroEyebrow: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "800",
    textAlign: "center",
  },
  heroTitle: {
    marginTop: 2,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  heroSubTitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  heroMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroMetaText: {
    fontSize: 11,
    fontWeight: "700",
  },

  sectionCard: {
    marginBottom: 12,
    borderWidth: 0,
    borderRadius: 14,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  sectionCountPill: {
    minWidth: 30,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  sectionCountText: {
    fontSize: 12,
    fontWeight: "900",
  },

  itemRow: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    gap: 10,
  },
  itemLeftWrap: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  itemIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  itemTextWrap: {
    marginLeft: 10,
    flex: 1,
    minWidth: 0,
  },
  itemAction: {
    width: 28,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  itemText: {
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
  },
  itemSubText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  themeButtonsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  themeButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  themeButtonText: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "capitalize",
    letterSpacing: 0.1,
  },
});
