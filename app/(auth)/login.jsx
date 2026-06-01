// app/(auth)/login.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { signInWithCustomToken } from "firebase/auth";
import { useState } from "react";
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
import { inferServiceAccess, normaliseSessionRole } from "../../lib/access";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

const USER_CODE_LOGIN_URL =
  "https://bickers-v2.vercel.app/api/auth/user-code-login";

export default function LoginPage() {
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const { reloadSession } = useAuth();
  const { colors } = useTheme();

  const setSession = async (data) => {
    await AsyncStorage.multiSet([
      ["sessionRole", data.role || ""],
      ["sessionIsService", data.isService ? "1" : "0"],
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
      ["timesheetDefaultType", data.timesheetDefaultType || ""],
    ]);
  };

  const handleEmployeeLogin = async () => {
    if (loading) return;

    const codeStr = String(employeeCode).replace(/\D/g, "").padStart(4, "0");
    const emailStr = String(employeeEmail).trim().toLowerCase();

    if (!codeStr || codeStr.length !== 4) {
      Alert.alert("Invalid code", "Employee code must be 4 digits.");
      return;
    }
    if (!emailStr) {
      Alert.alert("Missing email", "Please enter your work email.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(USER_CODE_LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailStr, userCode: codeStr }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.customToken) {
        throw new Error(data.error || "Could not sign in with that email and code.");
      }

      await signInWithCustomToken(auth, data.customToken);

      const employee = {
        ...(data.employee || {}),
        id: data.employee?.id || data.session?.employeeId || "",
        name: data.employee?.name || emailStr,
        email: data.employee?.email || emailStr,
        userCode: data.employee?.userCode || codeStr,
        appAccess: data.session?.appAccess || data.employee?.appAccess,
        role: data.session?.role || data.employee?.role,
        isService: data.session?.isService ?? data.employee?.isService,
      };

      global.employee = employee;

      const sessionRole = data.session?.role || normaliseSessionRole(employee);
      const isServiceUser =
        data.session?.isService ?? inferServiceAccess(employee);
      const sessionData = {
        role: sessionRole,
        isService: isServiceUser,
        appAccess: data.session?.appAccess || employee.appAccess,
        displayName: employee.name || "Employee",
        email: employee.email || employeeEmail,
        employeeId: employee.id,
        userCode: employee.userCode || codeStr,
        timesheetYardStart:
          employee?.timesheetDefaults?.yardStart ||
          employee?.yardStartTime ||
          employee?.yardStart ||
          "",
        timesheetYardEnd:
          employee?.timesheetDefaults?.yardEnd ||
          employee?.yardEndTime ||
          employee?.yardEnd ||
          "",
        timesheetOfficeStart:
          employee?.timesheetDefaults?.officeStart ||
          employee?.officeStartTime ||
          employee?.officeStart ||
          "",
        timesheetOfficeEnd:
          employee?.timesheetDefaults?.officeEnd ||
          employee?.officeEndTime ||
          employee?.officeEnd ||
          "",
        timesheetDefaultType:
          String(
            employee?.timesheetDefaults?.defaultType ||
              employee?.timesheetDefaultType ||
              ""
          )
            .trim()
            .toLowerCase() === "office"
            ? "office"
            : "yard",
      };

      await setSession(sessionData);

      if (reloadSession) {
        await reloadSession();
      }

      Alert.alert("Welcome", `Hello ${employee.name || employeeEmail}`);
      router.replace(sessionData.isService ? "/service/home" : "/screens/homescreen");
    } catch (err) {
      Alert.alert("Login failed", err?.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
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
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Employee Login
            </Text>

            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.inputBorder,
                },
              ]}
              placeholder="Employee Code (4 digits)"
              placeholderTextColor={colors.textMuted}
              value={employeeCode}
              onChangeText={setEmployeeCode}
              keyboardType="number-pad"
              maxLength={4}
            />
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.inputBorder,
                },
              ]}
              placeholder="Work Email (must match record)"
              placeholderTextColor={colors.textMuted}
              value={employeeEmail}
              onChangeText={setEmployeeEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TouchableOpacity
              style={[styles.buttonAlt, { backgroundColor: colors.accent }]}
              onPress={handleEmployeeLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={[styles.buttonText, { color: colors.surface }]}>
                {loading ? "Please wait..." : "Employee Log In"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "flex-start",
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
    marginBottom: 14,
    textAlign: "center",
  },
  input: {
    width: "100%",
    height: 50,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  buttonAlt: {
    width: "100%",
    height: 50,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { fontWeight: "600", fontSize: 16 },
});
