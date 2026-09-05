import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import PageShell from "../../components/layout/PageShell";
import BrandArtwork from "../../components/renderers/BrandArtwork";
import { AppButton, AppText as Text, FormField } from "../../components/ui/AppPrimitives";
import { auth } from "../../firebaseConfig";
import { syncEmployeeAuth, warmAuthService } from "../../lib/authApi";
import { designTokens as t } from "../../lib/design/tokens";
import { useAuth } from "../../providers/AuthProvider";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_COMPANY_ID = "bickers-action";
const SESSION_KEYS = [
  "sessionRole",
  "sessionIsService",
  "sessionCompanyId",
  "sessionUserAccess",
  "sessionServiceAccess",
  "displayName",
  "employeeId",
  "employeeEmail",
  "employeeUserCode",
  "userCode",
  "timesheetYardStart",
  "timesheetYardEnd",
  "timesheetOfficeStart",
  "timesheetOfficeEnd",
  "timesheetWorkshopStart",
  "timesheetWorkshopEnd",
  "timesheetDefaultType",
];

export default function LoginPage() {
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);

  const router = useRouter();
  const { reloadSession } = useAuth();

  useEffect(() => {
    warmAuthService().catch(() => {});
  }, []);

  const setSession = async (data) => {
    await AsyncStorage.multiSet([
      ["sessionRole", data.role || ""],
      ["sessionIsService", data.isService ? "1" : "0"],
      ["sessionCompanyId", data.companyId || DEFAULT_COMPANY_ID],
      ["sessionUserAccess", data.appAccess?.user ? "1" : "0"],
      ["sessionServiceAccess", data.appAccess?.service ? "1" : "0"],
      ["displayName", data.displayName || ""],
      ["employeeId", data.employeeId || ""],
      ["employeeEmail", data.email || ""],
      ["employeeUserCode", data.userCode || ""],
      ["userCode", data.userCode || ""],
      ["timesheetYardStart", data.timesheetYardStart || ""],
      ["timesheetYardEnd", data.timesheetYardEnd || ""],
      ["timesheetOfficeStart", data.timesheetOfficeStart || ""],
      ["timesheetOfficeEnd", data.timesheetOfficeEnd || ""],
      ["timesheetWorkshopStart", data.timesheetWorkshopStart || ""],
      ["timesheetWorkshopEnd", data.timesheetWorkshopEnd || ""],
      ["timesheetDefaultType", data.timesheetDefaultType || ""],
    ]);
  };

  const completeLogin = async (sessionData, employee) => {
    global.employee = employee;
    await setSession(sessionData);
    await reloadSession?.();
    router.replace(sessionData.isService ? "/service/home" : "/screens/homescreen");
  };

  const clearRejectedLogin = async () => {
    global.employee = null;
    await Promise.all([
      signOut(auth).catch(() => {}),
      AsyncStorage.multiRemove(SESSION_KEYS).catch(() => {}),
    ]);
    await reloadSession?.().catch(() => {});
  };

  const handleLogin = async () => {
    if (loading) return;

    const email = String(employeeEmail || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      Alert.alert("Invalid email", "Enter your approved work email.");
      return;
    }
    if (!password) {
      Alert.alert("Missing password", "Enter your password.");
      return;
    }

    setLoading(true);
    try {
      await AsyncStorage.multiRemove(SESSION_KEYS);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken(true);
      const synced = await syncEmployeeAuth({ idToken });
      await completeLogin(synced.sessionData, synced.employee);
    } catch {
      await clearRejectedLogin();
      Alert.alert(
        "Sign in failed",
        "Check your email and password. If they are correct, ask an administrator to approve Mobile app access."
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (resetting) return;

    const email = String(employeeEmail || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      Alert.alert("Invalid email", "Enter your work email first.");
      return;
    }

    setResetting(true);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch {
      // Keep this response identical for unknown, disabled and unapproved accounts.
    } finally {
      setResetting(false);
      Alert.alert(
        "Check your email",
        "If an approved account exists for this email, Firebase will send password reset instructions."
      );
    }
  };

  return (
    <PageShell mode="form" width="full">
      <View style={styles.scrollContainer}>
        <BrandArtwork variant="login" />

        <Text variant="titleSmall" align="center" layoutStyle={styles.title}>
          Welcome to Bickers Action
        </Text>

        <View style={styles.section}>
          <Text variant="sectionTitle" align="center" layoutStyle={styles.sectionTitle}>
            Sign In
          </Text>

          <FormField
            label="Work email"
            placeholder="Work email"
            value={employeeEmail}
            onChangeText={setEmployeeEmail}
            inputStyle={styles.loginInput}
            inputProps={{
              autoCapitalize: "none",
              autoCorrect: false,
              spellCheck: false,
              autoComplete: "email",
              textContentType: "emailAddress",
              keyboardType: "email-address",
            }}
          />
          <FormField
            label="Password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            inputStyle={styles.loginInput}
            inputProps={{
              autoCapitalize: "none",
              autoCorrect: false,
              autoComplete: "password",
              textContentType: "password",
              secureTextEntry: true,
              onSubmitEditing: handleLogin,
            }}
          />

          <AppButton
            label={loading ? "Signing in..." : "Sign In"}
            onPress={handleLogin}
            loading={loading}
            disabled={resetting}
            fullWidth
          />
          <AppButton
            label={resetting ? "Please wait..." : "Forgot password?"}
            variant="ghost"
            onPress={handlePasswordReset}
            disabled={loading || resetting}
            fullWidth
          />

          <Text tone="secondary" align="center" layoutStyle={styles.helperText}>
            Access must be approved by a Bickers administrator before you can sign in.
          </Text>
        </View>
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: t.spacing["2xl"],
    paddingVertical: t.spacing["2xl"],
  },
  title: {
    marginBottom: t.spacing.xl,
  },
  section: {
    width: "100%",
    maxWidth: 420,
    gap: t.spacing.md,
  },
  sectionTitle: {
    marginBottom: t.spacing.sm,
  },
  loginInput: {
    textAlignVertical: "center",
    paddingTop: t.spacing.xs - t.spacing.xxxs,
    paddingBottom: t.spacing.xs + t.spacing.xxxs,
  },
  helperText: {
    marginTop: t.spacing.xs,
  },
});
