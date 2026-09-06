import { AppText as Text, AppPressable as TouchableOpacity } from "../../components/ui/AppPrimitives";
import {
  useRouter } from "expo-router";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { useCallback,
  useEffect,
  useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Platform,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  updatePassword,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import ChangePasswordModal from "../../components/ChangePasswordModal";
import { auth, db } from "../../firebaseConfig";
import { registerDeviceToken } from "../../lib/authApi";
import {
  getNotificationPermissionStatus,
  NOTIFICATIONS_ENABLED,
  registerForPushNotificationsAsync,
  requestNotificationPermission,
  scheduleLocalNotification,
} from "../../lib/notifications";
import { useAuth } from "../../providers/AuthProvider";
import { useNotificationPreferences } from "../../providers/NotificationPreferencesProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

function getCurrentAppVersion() {
  return (
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    Constants.manifest2?.extra?.expoClient?.version ||
    Constants.manifest?.version ||
    "0.0.0"
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, employee } = useAuth();
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
  const [testNotificationSaving, setTestNotificationSaving] = useState(false);
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [securityStatus, setSecurityStatus] = useState({
    loading: true,
    passwordEnabled: true,
    notificationsGranted: false,
    notificationStatus: "unknown",
  });
  const { theme, colors, setTheme } = useTheme();
  const maintenanceReminderTimes = ["07:00", "09:00", "12:00", "17:00"];

  const handleSetTheme = (mode) => {
    setTheme(mode);
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

  const refreshAccountSetupStatus = useCallback(
    async () => {
      const firebaseUser = user || auth.currentUser;
      const employeeId = employee?.employeeId;
      const hasPasswordProvider =
        firebaseUser?.providerData?.some((provider) => provider?.providerId === "password") ||
        false;

      try {
        const [userSnap, employeeSnap, notificationPermission] = await Promise.all([
          firebaseUser?.uid
            ? getDoc(doc(db, "users", String(firebaseUser.uid))).catch(() => null)
            : Promise.resolve(null),
          employeeId
            ? getDoc(doc(db, "employees", String(employeeId))).catch(() => null)
            : Promise.resolve(null),
          getNotificationPermissionStatus(),
        ]);

        const userData = userSnap?.exists?.() ? userSnap.data() : {};
        const employeeData = employeeSnap?.exists?.() ? employeeSnap.data() : {};
        const authData = employeeData?.auth || {};
        const passwordEnabled =
          hasPasswordProvider ||
          authData?.passwordEnabled === true ||
          userData?.auth?.passwordEnabled === true;

        setSecurityStatus({
          loading: false,
          passwordEnabled,
          notificationsGranted: notificationPermission.granted,
          notificationStatus: notificationPermission.status || "unknown",
        });
      } catch {
        setSecurityStatus((current) => ({
          ...current,
          loading: false,
        }));
      }
    },
    [employee?.employeeId, user]
  );

  useEffect(() => {
    refreshAccountSetupStatus();
  }, [refreshAccountSetupStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") refreshAccountSetupStatus();
    });
    return () => subscription.remove();
  }, [refreshAccountSetupStatus]);

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

  const handleSendPasswordSetupEmail = async () => {
    const email = String(user?.email || auth.currentUser?.email || employee?.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      Alert.alert("No email found", "Please contact an admin to finish setup.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      Alert.alert(
        "Password email sent",
        `Check ${email} and follow the link to set your password.`
      );
    } catch (err) {
      Alert.alert("Could not send email", err?.message || "Please try again.");
    }
  };

  const handleEnableNotifications = async () => {
    if (!NOTIFICATIONS_ENABLED) {
      Alert.alert("Notifications disabled", "Notifications are disabled in this build.");
      return;
    }

    try {
      const result = await requestNotificationPermission();
      await refreshAccountSetupStatus();

      if (result.granted) {
        const firebaseUser = user || auth.currentUser;
        const token = await registerForPushNotificationsAsync();
        if (!firebaseUser || !token) {
          throw new Error("This device could not be registered for push notifications.");
        }

        await registerDeviceToken({
          idToken: await firebaseUser.getIdToken(),
          token,
          platform: Platform.OS,
          appVersion: getCurrentAppVersion(),
          employeeId: employee?.employeeId,
          employeeCode: employee?.userCode,
          email: employee?.email || firebaseUser.email,
        });
        Alert.alert("Notifications enabled", "This device is registered for reminders.");
        return;
      }

      Alert.alert(
        "Notifications blocked",
        "Enable notifications for this app in iOS Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
    } catch (error) {
      Alert.alert(
        "Could not enable notifications",
        error?.message || "Please try again."
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
      await refreshAccountSetupStatus();
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

  const accountSetupItems = [
    {
      key: "password",
      label: "Password",
      icon: "lock",
      complete: securityStatus.passwordEnabled,
      subLabel: securityStatus.passwordEnabled
        ? "Email password login is set up"
        : "Password setup is needed",
      actionLabel: "Send",
      onPress: () => handleSendPasswordSetupEmail(),
    },
  ];

  const incompleteSetupItems = accountSetupItems.filter((item) => !item.complete);

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
      group: "Notifications",
      items: [
        {
          label: "Device Notifications",
          icon: "bell",
          type: "notification-permission",
          complete: securityStatus.notificationsGranted,
          subLabel: securityStatus.notificationsGranted
            ? "Alerts are allowed on this device"
            : securityStatus.notificationStatus === "denied"
              ? "Blocked in device settings"
              : "Allow job and reminder alerts",
          actionLabel: securityStatus.notificationStatus === "denied" ? "Open" : "Enable",
          onPress: securityStatus.notificationStatus === "denied"
            ? () => Linking.openSettings()
            : handleEnableNotifications,
        },
        {
          label: "Maintenance Reminders",
          icon: "clock",
          type: "maintenance-reminder-toggle",
          subLabel: securityStatus.notificationsGranted
            ? "Alert me the day before booked maintenance"
            : "Enable device notifications first",
        },
        ...(maintenanceReminderEnabled && securityStatus.notificationsGranted
          ? [{
              label: "Reminder Time",
              icon: "watch",
              type: "maintenance-reminder-time",
              subLabel: "When the day-before alert arrives",
            }]
          : []),
        ...(securityStatus.notificationsGranted
          ? [{
              label: "Test Alert",
              icon: "send",
              type: "test-notification",
              subLabel: "Send a test in 10 seconds",
            }]
          : []),
      ],
    },
    {
      group: "Appearance",
      items: [
        {
          label: "Theme",
          icon: "moon",
          type: "theme",
          subLabel: "Use system, light, or dark mode",
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
        {
          label: "Working Terms",
          icon: "file-text",
          subLabel: "View the terms you have signed",
          onPress: () => router.push("/working-terms"),
        },
      ],
    },
  ];

  return (
    <PageShell
      mode="form"
      width="form"
      header={{
        variant: "compact",
        eyebrow: "Profile & App",
        title: "Settings",
        onBack: router.back,
      }}
    >
      <>
        {!securityStatus.loading && incompleteSetupItems.length > 0 ? (
          <View style={[styles.sectionCard, { borderColor: colors.border }]}> 
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}> 
                Finish Setup
              </Text>
            </View>

            {incompleteSetupItems.map((item) => (
              <View
                key={item.key}
                style={[
                  styles.itemRow,
                  {
                    backgroundColor: withAlpha(colors.warning, 0.08),
                    borderColor: withAlpha(colors.warning, 0.38),
                  },
                ]}
              >
                <View style={styles.itemLeftWrap}>
                  <View
                    style={[
                      styles.itemIconWrap,
                      {
                        backgroundColor: withAlpha(colors.warning, 0.14),
                        borderColor: withAlpha(colors.warning, 0.38),
                      },
                    ]}
                  >
                    <Icon name={item.icon} size={16} color={colors.warning} />
                  </View>

                  <View style={styles.itemTextWrap}>
                    <Text style={[styles.itemText, { color: colors.text }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.itemSubText, { color: colors.textMuted }]}>
                      {item.subLabel}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  onPress={item.onPress}
                  accessibilityRole="button"
                  activeOpacity={0.85}
                  style={[
                    styles.securityActionButton,
                    {
                      borderColor: colors.warning,
                      backgroundColor: withAlpha(colors.warning, 0.14),
                    },
                  ]}
                >
                  <Text style={[styles.securityActionText, { color: colors.warning }]}> 
                    {item.actionLabel}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {settings.map((section) => (
          <View
            key={section.group}
            style={[
              styles.sectionCard,
              { borderColor: colors.border },
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.group}</Text>
            </View>

            {section.items.map((item) => (
              <View
                key={item.label}
                style={[
                  styles.itemRow,
                  (item.type === "maintenance-reminder-time" || item.type === "theme") &&
                    styles.controlItemRow,
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

                {item.type === "notification-permission" ? (
                  item.complete ? (
                    <View
                      style={[
                        styles.statusBadge,
                        {
                          borderColor: withAlpha(colors.success, 0.42),
                          backgroundColor: withAlpha(colors.success, 0.14),
                        },
                      ]}
                    >
                      <Icon name="check" size={13} color={colors.success} />
                      <Text style={[styles.statusBadgeText, { color: colors.success }]}>Allowed</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={item.onPress}
                      accessibilityRole="button"
                      activeOpacity={0.85}
                      style={[
                        styles.securityActionButton,
                        {
                          borderColor: colors.warning,
                          backgroundColor: withAlpha(colors.warning, 0.14),
                        },
                      ]}
                    >
                      <Text style={[styles.securityActionText, { color: colors.warning }]}> 
                        {item.actionLabel}
                      </Text>
                    </TouchableOpacity>
                  )
                ) : item.type === "maintenance-reminder-toggle" ? (
                  maintenanceReminderError ? (
                    <TouchableOpacity
                      onPress={() => refreshMaintenancePreferences().catch(() => {})}
                      accessibilityRole="button"
                      accessibilityLabel="Retry loading maintenance reminder settings"
                      style={{ paddingHorizontal: t.spacing.sm, paddingVertical: t.spacing.xs }}
                    >
                      <Text style={{ color: colors.warning, fontWeight: "700" }}>Retry</Text>
                    </TouchableOpacity>
                  ) : (
                    <Switch
                      value={maintenanceReminderEnabled}
                      onValueChange={handleMaintenanceReminderToggle}
                      disabled={
                        maintenanceReminderSaving ||
                        maintenanceReminderLoading ||
                        !securityStatus.notificationsGranted
                      }
                      trackColor={{
                        false: withAlpha(colors.textMuted, 0.45),
                        true: colors.accent,
                      }}
                      thumbColor={maintenanceReminderEnabled ? staticColors.hex_fff_yhjmu8 : staticColors.hex_888_yhlrem}
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
      </>
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
    </PageShell>
  );
}

const styles = StyleSheet.create({
  sectionCard: {
    marginBottom: t.spacing.sm,
    borderWidth: 0,
    borderRadius: t.radius.lg,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.none,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xs,
    paddingHorizontal: t.spacing.none,
  },
  sectionTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  itemRow: {
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    gap: t.spacing.xs,
  },
  controlItemRow: {
    flexDirection: "column",
    alignItems: "stretch",
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
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  itemTextWrap: {
    marginLeft: t.spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  itemAction: {
    width: 28,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  itemText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
    lineHeight: t.typography.body.lineHeight,
  },
  itemSubText: {
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    marginTop: t.spacing.none,
  },

  timeButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: t.spacing.xxs,
    width: "100%",
  },
  timeButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  timeButtonText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },

  themeButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xxs,
    width: "100%",
  },
  themeButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  themeButtonText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
    textTransform: "capitalize",
    letterSpacing: 0.1,
  },
  testButton: {
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  testButtonText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
  },
  securityActionButton: {
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  securityActionText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
  },
  statusBadge: {
    minWidth: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
  },
});
