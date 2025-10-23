import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  createUserWithEmailAndPassword,
  signInAnonymously,
  signInWithEmailAndPassword,
} from "firebase/auth";
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

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // NEW: employee email field for code-based login
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");

  const router = useRouter();

  const setSession = async (data) => {
    await AsyncStorage.multiSet([
      ["sessionRole", data.role || ""],
      ["displayName", data.displayName || ""],
      ["employeeId", data.employeeId || ""],
      ["employeeEmail", data.email || ""],
    ]);
  };

  /** 🔑 Manager Login (login OR signup if not found) */
  const handleManagerLogin = async () => {
    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const user = userCredential.user;
      await ensureUserInFirestore(user);

      await setSession({
        role: "manager",
        displayName: user.displayName || user.email || "Manager",
        email: user.email || "",
        employeeId: "",
      });

      Alert.alert("Welcome back!", `Logged in as ${user.email}`);
      router.replace("/"); // app/(protected)/index.js
    } catch (err) {
      if (err?.code === "auth/user-not-found") {
        try {
          const userCredential = await createUserWithEmailAndPassword(
            auth,
            email.trim(),
            password
          );
          const user = userCredential.user;
          await ensureUserInFirestore(user);

          await setSession({
            role: "manager",
            displayName: user.displayName || user.email || "Manager",
            email: user.email || "",
            employeeId: "",
          });

          Alert.alert("Account created!", `Welcome, ${user.email}`);
          router.replace("/screens/homescreen");
        } catch (signupErr) {
          Alert.alert("Signup failed", signupErr?.message || "Error");
        }
      } else {
        Alert.alert("Login failed", err?.message || "Error");
      }
    }
  };

  /** 🔑 Employee Login (code + email must match employee doc) */
  const handleEmployeeLogin = async () => {
    // Basic inputs
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

    try {
      // Must be authenticated for security rules; anonymous is ok for this step
      if (!auth.currentUser) await signInAnonymously(auth);

      // Find employee by code (string first, then number)
      let snap = await getDocs(
        query(collection(db, "employees"), where("userCode", "==", codeStr), limit(1))
      );
      if (snap.empty) {
        const codeNum = Number(codeStr);
        snap = await getDocs(
          query(collection(db, "employees"), where("userCode", "==", codeNum), limit(1))
        );
      }
      if (snap.empty) {
        Alert.alert("Invalid code", "No employee found with that code.");
        return;
      }

      const employee = { id: snap.docs[0].id, ...snap.docs[0].data() };

      if (employee?.status === "disabled") {
        Alert.alert("Access blocked", "Your account is disabled. Contact admin.");
        return;
      }

      // ---- NEW: email must match employee.email (case-insensitive)
      const empEmail = String(employee.email || "").trim().toLowerCase();

      // Optional: support array of emails on employee docs
      const empEmails = Array.isArray(employee.emails)
        ? employee.emails.map((e) => String(e || "").trim().toLowerCase())
        : [];

      const emailMatches =
        (!!empEmail && empEmail === emailStr) ||
        (empEmails.length > 0 && empEmails.includes(emailStr));

      if (!emailMatches) {
        // If no email on file, block by default (safer). You can relax this if you want.
        if (!empEmail && empEmails.length === 0) {
          Alert.alert(
            "Email not on file",
            "We don't have an email recorded for this employee. Please contact an admin."
          );
          return;
        }
        Alert.alert(
          "Email mismatch",
          "The email entered doesn't match the employee record. Please check and try again."
        );
        return;
      }

      global.employee = employee;

      // Save an employee session + their name so the homescreen can greet properly
      await setSession({
        role: "employee",
        displayName: employee.name || "Employee",
        email: employee.email || employeeEmail, // prefer Firestore email if present
        employeeId: employee.id,
      });

      Alert.alert("Welcome", `Hello ${employee.name || employeeEmail}`);
      router.replace("/screens/homescreen");
    } catch (err) {
      Alert.alert("Error", err?.message || "Error");
    }
  };

  const ensureUserInFirestore = async (user) => {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        name: user.displayName || "",
        createdAt: new Date().toISOString(),
      });
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
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

          <Text style={styles.title}>Welcome to Bickers Action</Text>

          {/* Manager Login */}
          <TextInput
            style={styles.input}
            placeholder="Manager Email"
            placeholderTextColor="#888"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#888"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <TouchableOpacity style={styles.button} onPress={handleManagerLogin}>
            <Text style={styles.buttonText}>Manager Log In / Sign Up</Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.divider}>
            <View className="line" style={styles.line} />
            <Text style={styles.orText}>OR</Text>
            <View className="line" style={styles.line} />
          </View>

          {/* Employee Login (code + email must match) */}
          <TextInput
            style={styles.input}
            placeholder="Employee Code (4 digits)"
            placeholderTextColor="#888"
            value={employeeCode}
            onChangeText={setEmployeeCode}
            keyboardType="number-pad"
            maxLength={4}
          />
          <TextInput
            style={styles.input}
            placeholder="Work Email (must match record)"
            placeholderTextColor="#888"
            value={employeeEmail}
            onChangeText={setEmployeeEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TouchableOpacity style={styles.buttonAlt} onPress={handleEmployeeLogin}>
            <Text style={styles.buttonText}>Employee Log In</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#000" },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 30,
    paddingVertical: 40,
  },
  logo: { width: 220, height: 80, marginBottom: 20 },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 30,
    textAlign: "center",
  },
  input: {
    width: "100%",
    height: 50,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    paddingHorizontal: 16,
    color: "#fff",
    marginBottom: 16,
  },
  button: {
    width: "100%",
    height: 50,
    backgroundColor: "#C8102E",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  buttonAlt: {
    width: "100%",
    height: 50,
    backgroundColor: "#444",
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 20,
    width: "100%",
  },
  line: { flex: 1, height: 1, backgroundColor: "#333" },
  orText: { color: "#888", marginHorizontal: 10, fontSize: 12 },
});
