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
  const [employeeCode, setEmployeeCode] = useState("");
  const router = useRouter();

  const setSession = async (data) => {
    // Persist role + name for the rest of the app (homescreen/header/guards)
    await AsyncStorage.multiSet([
      ["sessionRole", data.role || ""],
      ["displayName", data.displayName || ""],
      ["employeeId", data.employeeId || ""],
      ["employeeEmail", data.email || ""],
    ]);
  };

  /** 🔑 Manager Login */
  const handleManagerLogin = async () => {
    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const user = userCredential.user;
      await ensureUserInFirestore(user);

      // Save a manager session + a friendly display name
      await setSession({
        role: "manager",
        displayName: user.displayName || user.email || "Manager",
        email: user.email || "",
        employeeId: "",
      });

      Alert.alert("Welcome back!", `Logged in as ${user.email}`);
      router.replace("/screens/homescreen");
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

  /** 🔑 Employee Login */
  const handleEmployeeLogin = async () => {
    if (!employeeCode) {
      Alert.alert("Missing code", "Please enter your 4-digit employee code");
      return;
    }

    const codeStr = String(employeeCode).replace(/\D/g, "").padStart(4, "0");
    if (codeStr.length !== 4) {
      Alert.alert("Invalid code", "Employee code must be 4 digits");
      return;
    }
    const codeNum = Number(codeStr);

    try {
      // Be authenticated for rules; anonymous is fine.
      if (!auth.currentUser) await signInAnonymously(auth);

      // Find employee by code (string first, then number)
      let snap = await getDocs(
        query(collection(db, "employees"), where("userCode", "==", codeStr), limit(1))
      );
      if (snap.empty) {
        snap = await getDocs(
          query(collection(db, "employees"), where("userCode", "==", codeNum), limit(1))
        );
      }
      if (snap.empty) {
        Alert.alert("Invalid code", "No employee found with that code");
        return;
      }

      const employee = { id: snap.docs[0].id, ...snap.docs[0].data() };

      if (employee?.status === "disabled") {
        Alert.alert("Access blocked", "Your account is disabled. Contact admin.");
        return;
      }

      global.employee = employee;

      // Save an employee session + their name so the homescreen can greet properly
      await setSession({
        role: "employee",
        displayName: employee.name || "Employee",
        email: employee.email || "",
        employeeId: employee.id,
      });

      Alert.alert("Welcome", `Hello ${employee.name}`);
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

          <Text style={styles.title}>Welcome to ickers Action</Text>

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
            <View style={styles.line} />
            <Text style={styles.orText}>OR</Text>
            <View style={styles.line} />
          </View>

          {/* Employee Login */}
          <TextInput
            style={styles.input}
            placeholder="Enter Employee Code"
            placeholderTextColor="#888"
            value={employeeCode}
            onChangeText={setEmployeeCode}
            keyboardType="number-pad"
            maxLength={4}
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
