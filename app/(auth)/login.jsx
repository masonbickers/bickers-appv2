// app/(auth)/login.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { signInAnonymously } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
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
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

export default function LoginPage() {
  // Manager fields (future)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Employee fields
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");

  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const { reloadSession } = useAuth();
  const { colors } = useTheme();

  // ───────────────────────────────── helpers ─────────────────────────────────
  const setSession = async (data) => {
    await AsyncStorage.multiSet([
      ["sessionRole", data.role || ""],
      ["displayName", data.displayName || ""],
      ["employeeId", data.employeeId || ""],
      ["employeeEmail", data.email || ""],
      ["employeeUserCode", data.userCode || ""], // used by AuthProvider
      ["userCode", data.userCode || ""],         // used by Footer / routing rules
    ]);
  };

  const ensureUserInFirestore = async (user) => {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || "",
        createdAt: new Date().toISOString(),
      });
    }
  };

  // ───────────────────────────── Employee Login ─────────────────────────────
  const handleEmployeeLogin = async () => {
    if (loading) return;
    setLoading(true);

    // 🔑 canonical 4-digit code from the input
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
      // Anonymous auth so Firestore rules allow the query
      if (!auth.currentUser) await signInAnonymously(auth);

      // Find employee by userCode (string, then number)
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

      // Email must match employee record (case insensitive)
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

      // Legacy global
      global.employee = employee;

      // 🔐 SESSION DATA — store exactly what they typed (normalised)
      const sessionData = {
        role: "employee",
        displayName: employee.name || "Employee",
        email: employee.email || employeeEmail,
        employeeId: employee.id,
        userCode: codeStr,
      };

      await setSession(sessionData);

      if (reloadSession) {
        await reloadSession();
      }

      Alert.alert("Welcome", `Hello ${employee.name || employeeEmail}`);

      console.log("LOGIN codeStr =", codeStr);

      // 🔥 ROUTING:
      // app/(protected)/service.js      -> "/service"
      // app/(protected)/screens/homescreen.js -> "/screens/homescreen"
      if (codeStr === "1234") {
        router.replace("service/home");
      } else {
        router.replace("/screens/homescreen");
      }

      setLoading(false);
    } catch (err) {
      Alert.alert("Error", err?.message || "Error");
      setLoading(false);
    }
  };

  // ─────────────────────────────── UI ───────────────────────────────
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
          {/* Logo */}
          <Image
            source={require("../../assets/images/bickers-action-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={[styles.title, { color: colors.text }]}>
            Welcome to Bickers Action
          </Text>

          {/* Employee Login */}
          <View style={styles.section}>
            <Text
              style={[styles.sectionTitle, { color: colors.text }]}
            >
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
    justifyContent: "flex-start",
    alignItems: "center",
    paddingHorizontal: 30,
    paddingVertical: 40,
  },
  logo: { width: 220, height: 80, marginBottom: 20 },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 30,
    textAlign: "center",
  },
  section: {
    width: "100%",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
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
