import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { useEffect, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { auth } from "../../firebaseConfig";
import { syncEmployeeAuth, warmAuthService } from "../../lib/authApi";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

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
  const { colors } = useTheme();

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

      global.employee = synced.employee;
      await setSession(synced.sessionData);
      await reloadSession?.();
      router.replace(
        synced.sessionData.isService ? "/service/home" : "/screens/homescreen"
      );
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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Image
            source={require("../../assets/images/bickers-action-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={[styles.title, { color: colors.text }]}>
            Welcome to Bickers Action
          </Text>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Sign In</Text>

            <Text style={[styles.label, { color: colors.text }]}>Work email</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.inputBorder,
                },
              ]}
              placeholder="Work email"
              placeholderTextColor={colors.textMuted}
              value={employeeEmail}
              onChangeText={setEmployeeEmail}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="email"
              textContentType="emailAddress"
              keyboardType="email-address"
              returnKeyType="next"
            />

            <Text style={[styles.label, { color: colors.text }]}>Password</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.inputBorder,
                },
              ]}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={handleLogin}
            />

            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.accent }]}
              onPress={handleLogin}
              disabled={loading || resetting}
              activeOpacity={0.85}
            >
              <Text style={[styles.buttonText, { color: colors.surface }]}>
                {loading ? "Signing in..." : "Sign In"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={handlePasswordReset}
              disabled={loading || resetting}
              activeOpacity={0.85}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>
                {resetting ? "Please wait..." : "Forgot password?"}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.helperText, { color: colors.textMuted }]}>
              Access must be approved by a Bickers administrator before you can sign in.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1 },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 30,
    paddingVertical: 32,
  },
  logo: { width: 220, height: 80, marginBottom: 24 },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 28,
    textAlign: "center",
  },
  section: {
    width: "100%",
    maxWidth: 420,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 18,
    textAlign: "center",
  },
  label: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 7,
  },
  input: {
    width: "100%",
    height: 50,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 0,
    textAlignVertical: "center",
    marginBottom: 16,
    borderWidth: 1,
  },
  button: {
    width: "100%",
    height: 50,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { fontWeight: "600", fontSize: 16 },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: 12,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    textAlign: "center",
  },
});
