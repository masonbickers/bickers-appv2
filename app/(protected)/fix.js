import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { db } from "../../firebaseConfig";

// simple function to generate random 4-digit code
const generateCode = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export default function FixEmployeesPage() {
  useEffect(() => {
    const runFix = async () => {
      console.log("Adding 4-digit codes to employees...");

      const snap = await getDocs(collection(db, "employees"));
      for (const emp of snap.docs) {
        const empData = emp.data();

        // ✅ only add code if not already set
        if (!empData.userCode) {
          const code = generateCode();
          await updateDoc(doc(db, "employees", emp.id), {
            userCode: code,
          });
          console.log(`Updated ${emp.id} → ${code}`);
        }
      }

      console.log("Done ✅");
    };

    runFix();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <Text>Assigning 4-digit codes... check console</Text>
    </View>
  );
}
