import { useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { db } from "../firebaseConfig";

export default function EmployeeLogin() {
  const [code, setCode] = useState("");
  const router = useRouter();

  const handleLogin = async () => {
    if (!code) {
      Alert.alert("Missing code", "Please enter your 4-digit code");
      return;
    }

    try {
      const q = query(collection(db, "employees"), where("userCode", "==", code));
      const snap = await getDocs(q);

      if (snap.empty) {
        Alert.alert("Invalid code", "No employee found with that code");
        return;
      }

      // ✅ Found employee
      const employee = { id: snap.docs[0].id, ...snap.docs[0].data() };

      // Save to local state (or AsyncStorage if you want persistence)
      global.employee = employee; 

      Alert.alert("Welcome", `Hello ${employee.name}`);
      router.replace("/employeeJobs"); // go to jobs page
    } catch (err) {
      console.error(err);
      Alert.alert("Login error", err.message);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Employee Login</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter your 4-digit code"
        placeholderTextColor="#888"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={4}
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin}>
        <Text style={styles.buttonText}>Log In</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20, backgroundColor: "#000" },
  title: { color: "#fff", fontSize: 24, fontWeight: "bold", marginBottom: 30 },
  input: { width: "100%", height: 50, backgroundColor: "#1a1a1a", borderRadius: 8, paddingHorizontal: 16, color: "#fff", marginBottom: 16 },
  button: { width: "100%", height: 50, backgroundColor: "#C8102E", borderRadius: 8, justifyContent: "center", alignItems: "center" },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
