import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { sendPasswordResetEmail } from "firebase/auth";

import { auth } from "../../firebaseConfig";
import {
  cancelAllMaintenanceReminders,
  DEFAULT_MAINTENANCE_REMINDER_TIME,
  getMaintenanceReminderTime,
  getMaintenanceRemindersEnabled,
  setMaintenanceReminderTime,
  setMaintenanceRemindersEnabled,
} from "../../lib/maintenanceReminders";
import {
  NOTIFICATIONS_ENABLED,
  registerForPushNotificationsAsync,
  scheduleLocalNotification,
} from "../../lib/notifications";
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
  const [maintenanceReminderEnabled, setMaintenanceReminderEnabled] = useState(false);
  const [maintenanceReminderTime, setMaintenanceReminderTimeState] = useState(
    DEFAULT_MAINTENANCE_REMINDER_TIME
  );
  const [maintenanceReminderSaving, setMaintenanceReminderSaving] = useState(false);
  const [testNotificationSaving, setTestNotificationSaving] = useState(false);
  const { theme, colors, setTheme } = useTheme();
  const maintenanceReminderTimes = ["07:00", "09:00", "12:00", "17:00"];

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
          onPress: handleChangePassword,
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
          label: "Maintenance Job Reminders",
          icon: "clock",
          type: "maintenance-reminder-toggle",
          subLabel: "Day-before alerts for booked maintenance jobs",
        },
        {
          label: "Reminder Time",
          icon: "watch",
          type: "maintenance-reminder-time",
          subLabel: "When maintenance job alerts should arrive",
        },
        {
          label: "Test Notification",
          icon: "send",
          type: "test-notification",
          subLabel: "Sends a test alert after 10 seconds",
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

  useEffect(() => {
    let alive = true;
    Promise.all([
      getMaintenanceRemindersEnabled(),
      getMaintenanceReminderTime(),
    ])
      .then(([enabled, reminderTime]) => {
        if (!alive) return;
        setMaintenanceReminderEnabled(enabled);
        setMaintenanceReminderTimeState(reminderTime);
      })
      .catch((e) => {
        console.warn("[maintenance-reminders] failed to load setting:", e);
      });

    return () => {
      alive = false;
    };
  }, []);

  const handleMaintenanceReminderToggle = async (next) => {
    if (maintenanceReminderSaving) return;

    try {
      setMaintenanceReminderSaving(true);
      setMaintenanceReminderEnabled(next);
      await setMaintenanceRemindersEnabled(next);
      if (!next) {
        await cancelAllMaintenanceReminders();
      }
    } catch (e) {
      setMaintenanceReminderEnabled(!next);
      Alert.alert(
        "Could not update reminders",
        e?.message || "Please try again."
      );
    } finally {
      setMaintenanceReminderSaving(false);
    }
  };

  const handleMaintenanceReminderTimeChange = async (time) => {
    if (maintenanceReminderSaving || time === maintenanceReminderTime) return;

    const previous = maintenanceReminderTime;
    try {
      setMaintenanceReminderSaving(true);
      setMaintenanceReminderTimeState(time);
      await setMaintenanceReminderTime(time);
    } catch (e) {
      setMaintenanceReminderTimeState(previous);
      Alert.alert(
        "Could not update reminder time",
        e?.message || "Please try again."
      );
    } finally {
      setMaintenanceReminderSaving(false);
    }
  };

  const handleTestNotification = async () => {
    if (testNotificationSaving) return;

    try {
      setTestNotificationSaving(true);
      await registerForPushNotificationsAsync();
      const id = await scheduleLocalNotification({
        title: "Bickers test notification",
        body: "Notifications are working.",
        seconds: 10,
        data: {
          type: "test-notification",
        },
        writeToInbox: false,
      });

      if (!id) {
        Alert.alert(
          "Notification not scheduled",
          "Check notification permissions for this app in iOS Settings."
        );
        return;
      }

      Alert.alert("Test scheduled", "A test notification will arrive in 10 seconds.");
    } catch (e) {
      Alert.alert(
        "Could not send test",
        e?.message || "Please check notification permissions and try again."
      );
    } finally {
      setTestNotificationSaving(false);
    }
  };

  const handleChangePassword = () => {
    const email = String(auth.currentUser?.email || "").trim().toLowerCase();
    if (!email) {
      Alert.alert("No email found", "Please log out and sign in again.");
      return;
    }

    Alert.alert(
      "Change password?",
      `We will send a password reset link to ${email}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send email",
          onPress: async () => {
            try {
              await sendPasswordResetEmail(auth, email);
              Alert.alert(
                "Email sent",
                "Check your email and follow the link to choose a new password."
              );
            } catch (err) {
              Alert.alert("Could not send email", err?.message || "Please try again.");
            }
          },
        },
      ]
    );
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
                ) : item.type === "maintenance-reminder-toggle" ? (
                  <Switch
                    value={maintenanceReminderEnabled}
                    onValueChange={handleMaintenanceReminderToggle}
                    disabled={maintenanceReminderSaving}
                    trackColor={{
                      false: withAlpha(colors.textMuted, 0.45),
                      true: colors.accent,
                    }}
                    thumbColor={maintenanceReminderEnabled ? "#fff" : "#888"}
                  />
                ) : item.type === "maintenance-reminder-time" ? (
                  <View style={styles.timeButtonsRow}>
                    {maintenanceReminderTimes.map((time) => {
                      const active = maintenanceReminderTime === time;
                      return (
                        <TouchableOpacity
                          key={time}
                          onPress={() => handleMaintenanceReminderTimeChange(time)}
                          activeOpacity={0.85}
                          disabled={maintenanceReminderSaving}
                          style={[
                            styles.timeButton,
                            {
                              borderColor: active ? colors.accent : colors.border,
                              backgroundColor: active
                                ? withAlpha(colors.accent, 0.18)
                                : colors.surface,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.timeButtonText,
                              {
                                color: active ? colors.accent : colors.textMuted,
                              },
                            ]}
                          >
                            {time}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
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
                ) : item.type === "test-notification" ? (
                  <TouchableOpacity
                    onPress={handleTestNotification}
                    accessibilityRole="button"
                    activeOpacity={0.85}
                    disabled={testNotificationSaving || !NOTIFICATIONS_ENABLED}
                    style={[
                      styles.testButton,
                      {
                        borderColor: colors.accent,
                        backgroundColor: testNotificationSaving
                          ? withAlpha(colors.textMuted, 0.12)
                          : withAlpha(colors.accent, 0.14),
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.testButtonText,
                        {
                          color: testNotificationSaving
                            ? colors.textMuted
                            : colors.accent,
                        },
                      ]}
                    >
                      {testNotificationSaving ? "Sending" : "Send"}
                    </Text>
                  </TouchableOpacity>
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

  timeButtonsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    maxWidth: 180,
  },
  timeButton: {
    minWidth: 54,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  timeButtonText: {
    fontSize: 12,
    fontWeight: "800",
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
  testButton: {
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  testButtonText: {
    fontSize: 12,
    fontWeight: "900",
  },
});
