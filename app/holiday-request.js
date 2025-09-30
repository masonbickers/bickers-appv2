import { useRouter } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars"; // ✅ calendar date picker
import Icon from "react-native-vector-icons/Feather";
import Footer from "./components/footer";
import { db } from "./firebaseConfig";

export default function HolidayRequestPage() {
  const router = useRouter();
  const employee = global.employee || {};

  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const [type, setType] = useState("Paid");
  const [notes, setNotes] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);


  // calendar marking
  const markedDates = {};
  if (startDate) {
    markedDates[startDate] = { startingDay: true, color: "#22c55e", textColor: "#fff" };
  }
  if (endDate) {
    markedDates[endDate] = { endingDay: true, color: "#22c55e", textColor: "#fff" };
  }
  if (startDate && endDate) {
    let current = new Date(startDate);
    const last = new Date(endDate);
    while (current <= last) {
      const dateStr = current.toISOString().split("T")[0];
      if (dateStr !== startDate && dateStr !== endDate) {
        markedDates[dateStr] = { color: "#86efac", textColor: "#ffffffff" };
      }
      current.setDate(current.getDate() + 1);
    }
  }

  const handleDayPress = (day) => {
    if (!startDate || (startDate && endDate)) {
      setStartDate(day.dateString);
      setEndDate(null);
    } else if (startDate && !endDate) {
      if (new Date(day.dateString) < new Date(startDate)) {
        setEndDate(startDate);
        setStartDate(day.dateString);
      } else {
        setEndDate(day.dateString);
      }
    }
  };

const submitRequest = async () => {
if (!startDate || (!endDate && !isHalfDay)) {
  return alert("Please select a date range or a half day");
}

  try {
    await addDoc(collection(db, "holidays"), {
      employee: employee.name,
      employeeCode: employee.userCode,
startDate,
endDate: isHalfDay ? startDate : endDate,   // 👈 force same-day if half-day
leaveType: type,              // "Paid" | "Unpaid" | "Accrued"
paidStatus: type,
paid: type === "Paid",
isUnpaid: type === "Unpaid",
isAccrued: type === "Accrued",
halfDay: isHalfDay,           // 👈 flag saved
notes,
status: "requested",
createdAt: serverTimestamp(),

    });
    alert("✅ Holiday request submitted!");
    router.back();
  } catch (err) {
    console.error(err);
    alert("❌ Error submitting request");
  }
};

  return (
    <SafeAreaView style={styles.container}>
      {/* Back */}
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Icon name="arrow-left" size={22} color="#fff" />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <ScrollView style={{ flex: 1 }}>
        <Text style={styles.title}>📅 Request Holiday</Text>

        {/* Calendar Date Picker */}
        <Calendar
          onDayPress={handleDayPress}
          markedDates={markedDates}
          markingType="period"
          theme={{
            calendarBackground: "#000",
            dayTextColor: "#fff",
            monthTextColor: "#fff",
            arrowColor: "#22c55e",
            selectedDayBackgroundColor: "#22c55e",
            selectedDayTextColor: "#fff",
            todayTextColor: "#22c55e",
          }}
        />

        {/* Show chosen dates */}
        <View style={{ margin: 12 }}>
          <Text style={{ color: "#fff" }}>
            Start: {startDate || "Not selected"}
          </Text>
          <Text style={{ color: "#fff" }}>
            End: {endDate || "Not selected"}
          </Text>
        </View>

        {/* Type Dropdown */}
<View style={styles.typeBox}>
  {["Paid", "Unpaid", "Accrued"].map((option) => (
    <TouchableOpacity
      key={option}
      style={styles.typeRow}
      onPress={() => setType(option)}
    >
      <Icon
        name={type === option ? "check-square" : "square"}
        size={20}
        color={type === option ? "#22c55e" : "#777"}
        style={{ marginRight: 8 }}
      />
      <Text style={{ color: "#fff", fontSize: 16 }}>{option}</Text>
    </TouchableOpacity>
  ))}
</View>

<View style={styles.typeBox}>
  <TouchableOpacity
    style={styles.typeRow}
    onPress={() => setIsHalfDay(!isHalfDay)}
  >
    <Icon
      name={isHalfDay ? "check-square" : "square"}
      size={20}
      color={isHalfDay ? "#22c55e" : "#777"}
      style={{ marginRight: 8 }}
    />
    <Text style={{ color: "#fff", fontSize: 16 }}>
      Request Half Day
    </Text>
  </TouchableOpacity>
</View>



        {/* Notes */}
        <View style={styles.notesBox}>
          <Text style={{ color: "#ccc", marginBottom: 6 }}>Notes</Text>
          <TextInput
            placeholder="Add notes..."
            placeholderTextColor="#777"
            value={notes}
            onChangeText={setNotes}
            multiline
            style={styles.notesInput}
          />
        </View>

        {/* Submit */}
        <TouchableOpacity style={styles.submitButton} onPress={submitRequest}>
          <Text style={styles.submitText}>Submit Request</Text>
        </TouchableOpacity>
      </ScrollView>

      <Footer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  backButton: { flexDirection: "row", alignItems: "center", padding: 12 },
  backText: { color: "#fff", fontSize: 16, marginLeft: 6 },
  title: { color: "#fff", fontSize: 20, fontWeight: "bold", marginBottom: 20, paddingLeft: 12 },

  dropdown: {
    backgroundColor: "#1a1a1a",
    borderRadius: 6,
    marginBottom: 12,
    marginHorizontal: 12,
  },

  notesBox: { marginVertical: 12, marginHorizontal: 12 },
  notesInput: {
    backgroundColor: "#1a1a1a",
    color: "#fff",
    padding: 12,
    borderRadius: 6,
    minHeight: 80,
    textAlignVertical: "top",
  },

  submitButton: {
    backgroundColor: "#22c55e",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    margin: 12,
  },
  submitText: { color: "#000", fontWeight: "bold", fontSize: 16 },

  typeBox: {
  marginVertical: 12,
  marginHorizontal: 12,
  backgroundColor: "#1a1a1a",
  borderRadius: 6,
  padding: 10,
},
typeRow: {
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: 6,
},

});
