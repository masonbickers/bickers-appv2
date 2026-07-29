// app/(protected)/service/settings.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signOut,
  updatePassword,
} from "firebase/auth";
import ChangePasswordModal from "../../../components/ChangePasswordModal";
import { auth } from "../../../firebaseConfig";
import { useAuth } from "../../../providers/AuthProvider";
import { useNotificationPreferences } from "../../../providers/NotificationPreferencesProvider";
import { useTheme } from "../../../providers/ThemeProvider";

/* --------- SERVICE STYLE COLOURS --------- */

const COLORS = {
  background: "#000000",
  card: "#151517",
  border: "#2B2B31",
  textHigh: "#F5F5F5",
  textMid: "#D4D4D8",
  textLow: "#A1A1AA",
  primaryAction: "#D94B52",
  inputBg: "#111114",
  lightGray: "#3F3F46",
};

export default function ServiceSettingsPage() {
  const router = useRouter();
  const { reloadSession, user, employee } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const {
    maintenanceRemindersEnabled: maintenanceReminderEnabled,
    maintenanceReminderTime,
    isLoading: maintenanceReminderLoading,
    isSaving: maintenanceReminderSaving,
    error: maintenanceReminderError,
    refresh: refreshMaintenancePreferences,
    setMaintenanceRemindersEnabled,
    setMaintenanceReminderTime,
  } = useNotificationPreferences();
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const { theme, colors, setTheme } = useTheme();
  const maintenanceReminderTimes = ["07:00", "09:00", "12:00", "17:00"];

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
          onPress: () => handleChangePassword(),
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
          label: "Maintenance Job Reminders",
          icon: "clock",
          type: "maintenance-reminder-toggle",
          subLabel: "Day-before alerts for booked maintenance jobs",
        },
        {
          label: "Reminder Time",
          icon: "watch",
          type: "maintenance-reminder-time",
          subLabel: "When the day-before alert should arrive",
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

  const passwordEmail = () =>
    String(user?.email || auth.currentUser?.email || employee?.email || "")
      .trim()
      .toLowerCase();

  const resetPasswordForm = () => {
    setPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
  };

  const handlePasswordFieldChange = (field, value) => {
    setPasswordForm((current) => ({ ...current, [field]: value }));
  };

  const handleMaintenanceReminderToggle = async (next) => {
    if (maintenanceReminderSaving) return;

    try {
      await setMaintenanceRemindersEnabled(next);
    } catch (e) {
      Alert.alert(
        "Could not update reminders",
        e?.message || "Please try again."
      );
    }
  };

  const handleMaintenanceReminderTimeChange = async (time) => {
    if (maintenanceReminderSaving || time === maintenanceReminderTime) return;

    try {
      await setMaintenanceReminderTime(time);
    } catch (e) {
      Alert.alert(
        "Could not update reminder time",
        e?.message || "Please try again."
      );
    }
  };

  const handleChangePassword = () => {
    const email = passwordEmail();
    if (!email) {
      Alert.alert("No email found", "Please log out and sign in again.");
      return;
    }

    resetPasswordForm();
    setPasswordModalVisible(true);
  };

  const handleClosePasswordModal = () => {
    if (passwordSaving) return;
    setPasswordModalVisible(false);
    resetPasswordForm();
  };

  const handleForgotCurrentPassword = async () => {
    const email = passwordEmail();
    if (!email) {
      Alert.alert("No email found", "Please log out and sign in again.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert(
        "Reset email sent",
        `Check ${email} and follow the link to choose a new password.`
      );
    } catch (err) {
      Alert.alert("Could not send email", err?.message || "Please try again.");
    }
  };

  const handleSubmitPasswordChange = async () => {
    const firebaseUser = user || auth.currentUser;
    const email = passwordEmail();
    const currentPassword = String(passwordForm.currentPassword || "");
    const newPassword = String(passwordForm.newPassword || "");
    const confirmPassword = String(passwordForm.confirmPassword || "");

    if (!firebaseUser || !email) {
      Alert.alert("No signed-in user", "Please log out and sign in again.");
      return;
    }
    if (!currentPassword) {
      Alert.alert("Current password required", "Enter your current password.");
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters for the new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Password mismatch", "The new passwords do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      Alert.alert("Choose a new password", "The new password must be different.");
      return;
    }

    try {
      setPasswordSaving(true);
      const credential = EmailAuthProvider.credential(email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);
      setPasswordModalVisible(false);
      resetPasswordForm();
      Alert.alert("Password changed", "Your password has been updated.");
    } catch (err) {
      if (
        err?.code === "auth/wrong-password" ||
        err?.code === "auth/invalid-credential"
      ) {
        Alert.alert("Wrong current password", "Check your current password and try again.");
      } else if (err?.code === "auth/weak-password") {
        Alert.alert("Weak password", "Use a stronger new password.");
      } else if (err?.code === "auth/requires-recent-login") {
        Alert.alert("Sign in again", "Please log out, sign back in, then try again.");
      } else {
        Alert.alert("Could not change password", err?.message || "Please try again.");
      }
    } finally {
      setPasswordSaving(false);
    }
  };

  // 🔐 LOGOUT – mirror HomeScreen behaviour so root layout sends you to (auth)/login
  const handleLogout = async () => {
    try {
      // clear role + employee session
      await AsyncStorage.multiRemove([
        "sessionRole",
        "sessionIsService",
        "sessionUserAccess",
        "sessionServiceAccess",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
        "timesheetYardStart",
        "timesheetYardEnd",
        "timesheetOfficeStart",
        "timesheetOfficeEnd",
        "timesheetDefaultType",
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
      edges={["left", "right"]}
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

        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.headerTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service Settings
          </Text>
          <Text
            style={[
              styles.headerSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Workshop preferences and account controls.
          </Text>
        </View>
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
                  <View style={styles.itemTextWrap}>
                    <Text
                      style={[
                        styles.itemText,
                        { color: colors.text || COLORS.textHigh },
                      ]}
                    >
                      {item.label}
                    </Text>
                    {!!item.subLabel && (
                      <Text
                        style={[
                          styles.itemSubText,
                          { color: colors.textMuted || COLORS.textLow },
                        ]}
                      >
                        {item.subLabel}
                      </Text>
                    )}
                  </View>
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
                ) : item.type === "maintenance-reminder-toggle" ? (
                  maintenanceReminderError ? (
                    <TouchableOpacity
                      onPress={() => refreshMaintenancePreferences().catch(() => {})}
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading maintenance reminder settings"
                      style={{ paddingHorizontal: 12, paddingVertical: 9 }}
                    >
                      <Text
                        style={{
                          color: colors.accent || COLORS.primaryAction,
                          fontWeight: "700",
                        }}
                      >
                        Retry
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <Switch
                      value={maintenanceReminderEnabled}
                      onValueChange={handleMaintenanceReminderToggle}
                      disabled={maintenanceReminderSaving || maintenanceReminderLoading}
                      trackColor={{
                        false: "#444",
                        true: colors.accent || COLORS.primaryAction,
                      }}
                      thumbColor={maintenanceReminderEnabled ? "#fff" : "#888"}
                    />
                  )
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
                            style={[
                              styles.timeButtonText,
                              {
                                color: active
                                  ? COLORS.textHigh
                                  : colors.text || COLORS.textHigh,
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
      <ChangePasswordModal
        visible={passwordModalVisible}
        colors={colors}
        values={passwordForm}
        saving={passwordSaving}
        onChange={handlePasswordFieldChange}
        onClose={handleClosePasswordModal}
        onSubmit={handleSubmitPasswordChange}
        onForgotPassword={handleForgotCurrentPassword}
      />
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
    fontSize: 22,
    fontWeight: "800",
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
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
    flex: 1,
    paddingRight: 12,
  },
  itemTextWrap: {
    flex: 1,
    marginLeft: 10,
  },
  itemText: {
    fontSize: 16,
  },
  itemSubText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
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
    fontWeight: "700",
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
