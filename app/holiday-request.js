// app/holiday-request.js
import { useRouter } from "expo-router";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import Icon from "react-native-vector-icons/Feather";
import { db } from "../firebaseConfig";

export default function HolidayRequestPage() {
  const router = useRouter();
  const employee = global.employee || {};

  const [startDate, setStartDate] = useState(null); // "YYYY-MM-DD"
  const [endDate, setEndDate] = useState(null);     // "YYYY-MM-DD"
  const [type, setType] = useState("Paid");         // "Paid" | "Unpaid"
  const [notes, setNotes] = useState("");

  // Single half-day option
  const [halfDay, setHalfDay] = useState(false);
  const [halfDayPeriod, setHalfDayPeriod] = useState("AM"); // "AM" | "PM"

  const isSingleDay = !!startDate && (endDate ?? startDate) === startDate;

  // If the selection becomes multi-day, auto-disable half-day
  useEffect(() => {
    if (!isSingleDay && halfDay) {
      setHalfDay(false);
    }
  }, [isSingleDay, halfDay]);

  // Calendar highlights
  const markedDates = useMemo(() => {
    const m = {};
    if (startDate) m[startDate] = { startingDay: true, color: "#22c55e", textColor: "#fff" };
    const last = endDate || startDate;
    if (last) m[last] = { ...(m[last] || {}), endingDay: true, color: "#22c55e", textColor: "#fff" };

    if (startDate && last) {
      let cur = new Date(startDate);
      const endD = new Date(last);
      while (cur <= endD) {
        const s = cur.toISOString().split("T")[0];
        if (!m[s]) m[s] = { color: "#86efac", textColor: "#fff" };
        cur.setDate(cur.getDate() + 1);
      }

      // Subtle highlight for single-day half-day
      if (isSingleDay && halfDay && startDate) {
        m[startDate] = { ...(m[startDate] || {}), color: "#34d399", textColor: "#000" };
      }
    }
    return m;
  }, [startDate, endDate, isSingleDay, halfDay]);

  // Date picking
  const handleDayPress = (day) => {
    const d = day.dateString;
    if (!startDate || (startDate && endDate)) {
      setStartDate(d);
      setEndDate(null);
      // reset half-day defaults on new selection
      setHalfDay(false);
      setHalfDayPeriod("AM");
    } else if (startDate && !endDate) {
      if (new Date(d) < new Date(startDate)) {
        setEndDate(startDate);
        setStartDate(d);
      } else {
        setEndDate(d);
      }
    }
  };

  // Submit
  const submitRequest = async () => {
    if (!startDate) return alert("Please pick at least a start date.");
    const effectiveEnd = endDate || startDate;

    // Enforce: half-day only allowed on single-day
    if (!isSingleDay && halfDay) {
      return alert("Half-day can only be booked on a single-day request.");
    }

    try {
      await addDoc(collection(db, "holidays"), {
        employee: employee.name,
        employeeCode: employee.userCode,

        startDate,
        endDate: effectiveEnd,

        leaveType: type,
        paidStatus: type,
        paid: type === "Paid",
        isUnpaid: type === "Unpaid",

        // Preferred simple fields
        halfDay: !!halfDay,
        halfDayPeriod: halfDay ? halfDayPeriod : null, // "AM" | "PM" | null

        // Legacy-ish fields kept harmlessly for compatibility
        halfDayAt: halfDay ? "start" : "none",
        halfDayType: halfDay ? halfDayPeriod : null,

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
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Icon name="arrow-left" size={18} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        <Text style={styles.title}>📅 Request Holiday</Text>

        {/* Calendar */}
        <View style={styles.card}>
          <Calendar
            onDayPress={handleDayPress}
            markedDates={markedDates}
            markingType="period"
            theme={{
              calendarBackground: "#0b0b0b",
              dayTextColor: "#fff",
              monthTextColor: "#fff",
              arrowColor: "#22c55e",
              selectedDayBackgroundColor: "#22c55e",
              selectedDayTextColor: "#fff",
              todayTextColor: "#22c55e",
            }}
          />
        </View>

        {/* Chosen dates */}
        <View style={[styles.card, { gap: 4 }]}>
          <Text style={{ color: "#cfcfcf" }}>
            Start: <Text style={{ color: "#fff" }}>{startDate || "Not selected"}</Text>
            {isSingleDay && halfDay ? (
              <Text style={{ color: "#86efac" }}> ({halfDayPeriod} half)</Text>
            ) : null}
          </Text>
          <Text style={{ color: "#cfcfcf" }}>
            End: <Text style={{ color: "#fff" }}>{endDate || startDate || "Not selected"}</Text>
          </Text>
        </View>

        {/* Type (no Accrued here) */}
        <View style={styles.card}>
          {["Paid", "Unpaid"].map((option) => (
            <TouchableOpacity
              key={option}
              style={styles.row}
              onPress={() => setType(option)}
              activeOpacity={0.85}
            >
              <Icon
                name={type === option ? "check-square" : "square"}
                size={20}
                color={type === option ? "#22c55e" : "#777"}
                style={{ marginRight: 10 }}
              />
              <Text style={{ color: "#fff", fontSize: 16 }}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Half-day (single toggle + AM/PM) */}
        <View style={styles.card}>
          <Text style={{ color: "#cfcfcf", marginBottom: 8, fontWeight: "700" }}>
            Half day
          </Text>

          <TouchableOpacity
            style={[styles.row, !isSingleDay && styles.rowDisabled]}
            onPress={() => isSingleDay && setHalfDay((v) => !v)}
            activeOpacity={0.85}
          >
            <Icon
              name={halfDay ? "check-square" : "square"}
              size={20}
              color={halfDay ? "#22c55e" : "#777"}
              style={{ marginRight: 10 }}
            />
            <Text style={styles.rowText}>
              {isSingleDay ? "Book as half day" : "Half-day only available for a single day"}
            </Text>
          </TouchableOpacity>

          {isSingleDay && halfDay && (
            <View style={styles.choiceRow}>
              <HalfChip
                label="AM"
                active={halfDayPeriod === "AM"}
                onPress={() => setHalfDayPeriod("AM")}
              />
              <HalfChip
                label="PM"
                active={halfDayPeriod === "PM"}
                onPress={() => setHalfDayPeriod("PM")}
              />
            </View>
          )}

          <Text style={{ color: "#8b8b8b", marginTop: 8, fontSize: 12 }}>
            Half-days are only available for a single-day request. If you need multiple days with a
            half-day at the start or end, submit a separate request (e.g. one single-day half-day +
            one full-day range).
          </Text>
        </View>

        {/* Notes */}
        <View style={styles.card}>
          <Text style={{ color: "#cfcfcf", marginBottom: 6 }}>Notes</Text>
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
        <TouchableOpacity style={styles.submitButton} onPress={submitRequest} activeOpacity={0.9}>
          <Text style={styles.submitText}>Submit Request</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

/* Small chip button for AM/PM */
function HalfChip({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        {
          paddingVertical: 6,
          paddingHorizontal: 12,
          borderRadius: 999,
          borderWidth: 1,
          marginRight: 8,
        },
        active
          ? { backgroundColor: "#22c55e", borderColor: "#22c55e" }
          : { backgroundColor: "#141414", borderColor: "#232323" },
      ]}
    >
      <Text style={{ color: active ? "#000" : "#fff", fontWeight: "800", fontSize: 12 }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0f0f0f",
  },
  backText: { color: "#fff", fontSize: 14, marginLeft: 6, fontWeight: "700" },

  title: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    marginVertical: 12,
    paddingHorizontal: 12,
  },

  card: {
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "#1f1f1f",
    borderRadius: 12,
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
  },

  row: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  rowText: { color: "#fff", fontSize: 16 },
  rowDisabled: { opacity: 0.45 },

  choiceRow: { flexDirection: "row", alignItems: "center", marginLeft: 34, marginTop: 4 },

  notesInput: {
    backgroundColor: "#111",
    color: "#fff",
    padding: 12,
    borderRadius: 8,
    minHeight: 90,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#222",
  },

  submitButton: {
    backgroundColor: "#22c55e",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginHorizontal: 12,
    marginTop: 4,
    marginBottom: 20,
  },
  submitText: { color: "#000", fontWeight: "800", fontSize: 16 },
});
