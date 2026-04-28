//app/(auth)/login.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { signInAnonymously } from "firebase/auth";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
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

import { auth, db } from "../../firebaseConfig";
import { inferServiceAccess, normaliseSessionRole } from "../../lib/access";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

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
    setLoading(true);

    const codeStr = String(employeeCode).replace(/\D/g, "").padStart(4, "0");
    const emailStr = String(employeeEmail).trim().toLowerCase();

    if (!codeStr || codeStr.length !== 4) {
      Alert.alert("Invalid code", "Employee code must be 4 digits.");
      setLoading(false);
      return;
    }
    if (!emailStr) {
      Alert.alert("Missing email", "Please enter your work email.");
      setLoading(false);
      return;
    }

    try {
      if (!auth.currentUser) await signInAnonymously(auth);

      let snap = await getDocs(
        query(
          collection(db, "employees"),
          where("userCode", "==", codeStr),
          limit(1)
        )
      );
      if (snap.empty) {
        const codeNum = Number(codeStr);
        snap = await getDocs(
          query(
            collection(db, "employees"),
            where("userCode", "==", codeNum),
            limit(1)
          )
        );
      }

      if (snap.empty) {
        Alert.alert("Invalid code", "No employee found with that code.");
        setLoading(false);
        return;
      }

      const employee = { id: snap.docs[0].id, ...snap.docs[0].data() };

      if (employee?.status === "disabled") {
        Alert.alert("Access blocked", "Your account is disabled. Contact admin.");
        setLoading(false);
        return;
      }

      const empEmail = String(employee.email || "").trim().toLowerCase();
      const empEmails = Array.isArray(employee.emails)
        ? employee.emails.map((e) => String(e || "").trim().toLowerCase())
        : [];

      const emailMatches =
        (!!empEmail && empEmail === emailStr) ||
        (empEmails.length > 0 && empEmails.includes(emailStr));

      if (!emailMatches) {
        if (!empEmail && empEmails.length === 0) {
          Alert.alert(
            "Email not on file",
            "We don't have an email recorded for this employee. Please contact an admin."
          );
        } else {
          Alert.alert(
            "Email mismatch",
            "The email entered doesn't match the employee record. Please check and try again."
          );
        }
        setLoading(false);
        return;
      }

      global.employee = employee;

      const sessionRole = normaliseSessionRole(employee);
      const isServiceUser = inferServiceAccess(employee);
      const sessionData = {
        role: sessionRole,
        isService: isServiceUser,
        displayName: employee.name || "Employee",
        email: employee.email || employeeEmail,
        employeeId: employee.id,
        userCode: codeStr,
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

      setLoading(false);
    } catch (err) {
      Alert.alert("Error", err?.message || "Error");
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
              style={[
                styles.buttonAlt,
                { backgroundColor: colors.accent },
              ]}
              onPress={handleEmployeeLogin}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.buttonText,
                  { color: colors.surface },
                ]}
              >
                {loading ? "Please wait…" : "Employee Log In"}
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
