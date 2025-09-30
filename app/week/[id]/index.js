"use client";

import { useLocalSearchParams, useRouter } from "expo-router";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { db } from "../../firebaseConfig";

const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Generate 15-min increments
const timeOptions = [];
for (let h = 0; h < 24; h++) {
  for (let m of [0, 15, 30, 45]) {
    const hh = h.toString().padStart(2, "0");
    const mm = m.toString().padStart(2, "0");
    timeOptions.push(`${hh}:${mm}`);
  }
}

// Dropdown component
function TimeDropdown({ label, value, onSelect, options }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={{ marginBottom: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.dropdownBox} onPress={() => setOpen(true)}>
        <Text style={{ color: value ? "#fff" : "#777" }}>{value || "Select Time"}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalItem}
                  onPress={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  <Text>{item}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.closeBtn} onPress={() => setOpen(false)}>
              <Text style={{ color: "#fff" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function WeekTimesheet() {
  const { id } = useLocalSearchParams(); // weekStart ISO string
  const router = useRouter();
  const employee = global.employee || { userCode: "TEMP", name: "Unknown" };

  const [timesheet, setTimesheet] = useState({
    employeeCode: employee.userCode,
    weekStart: id,
    days: days.reduce((acc, d) => ({ ...acc, [d]: { mode: "yard", dayNotes: "" } }), {}),
    notes: "",
    submitted: false,
  });

  const [jobsByDay, setJobsByDay] = useState({});
  const [holidaysByDay, setHolidaysByDay] = useState({});

  // Load existing timesheet
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);
        const snap = await getDoc(ref);
        if (snap.exists()) setTimesheet(snap.data());
      } catch (err) {
        console.error("Firestore load error:", err);
      }
    })();
  }, [id]);

  // Load jobs & holidays
  useEffect(() => {
    if (!id || !employee?.userCode) return;

    (async () => {
      try {
        // Employees
        const empSnap = await getDocs(collection(db, "employees"));
        const allEmployees = empSnap.docs.map((doc) => doc.data());

        // Jobs
        const jobsSnap = await getDocs(collection(db, "bookings"));
        const allJobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Holidays
        const holSnap = await getDocs(collection(db, "holidays"));
        const allHols = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Build maps
        let jobMap = {};
        let holMap = {};
        for (let d of days) {
          jobMap[d] = [];
          holMap[d] = false;
        }

        // Week start
        const weekStartDate = new Date(id);
        const weekDates = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(weekStartDate);
          d.setDate(weekStartDate.getDate() + i);
          weekDates.push(d.toISOString().split("T")[0]);
        }

        function getDayName(dateStr) {
          const d = new Date(dateStr);
          const idx = d.getDay();
          return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][idx];
        }

        // Map jobs
        allJobs.forEach((job) => {
          const codes = (job.employees || [])
            .map((emp) => {
              if (emp.userCode) return emp.userCode;
              const found = allEmployees.find((e) => e.name === emp.name);
              return found ? found.userCode : null;
            })
            .filter(Boolean);

          if (codes.includes(employee.userCode)) {
            (job.bookingDates || []).forEach((date) => {
              if (weekDates.includes(date)) {
                const dayName = getDayName(date);
                if (jobMap[dayName]) {
                  jobMap[dayName].push(job);
                }
              }
            });
          }
        });

        // Map holidays
        allHols.forEach((hol) => {
          if (hol.employee === employee.name) {
            const start = new Date(hol.startDate);
            const end = new Date(hol.endDate);
            const d = new Date(start);
            while (d <= end) {
              const dateStr = d.toISOString().split("T")[0];
              if (weekDates.includes(dateStr)) {
                const dayName = getDayName(dateStr);
                if (holMap[dayName] !== undefined) {
                  holMap[dayName] = true;
                }
              }
              d.setDate(d.getDate() + 1);
            }
          }
        });

        setJobsByDay(jobMap);
        setHolidaysByDay(holMap);
      } catch (err) {
        console.error("Error fetching jobs/holidays:", err);
      }
    })();
  }, [id, employee]);

  // Save
  const saveTimesheet = async () => {
    try {
      const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);
      await setDoc(ref, timesheet);
      Alert.alert("✅ Saved", "Your timesheet has been saved.");
      router.back();
    } catch (err) {
      console.error(err);
      Alert.alert("❌ Error", "Could not save timesheet");
    }
  };

  // Submit (final)
const submitTimesheet = async () => {
  try {
    const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);
    await setDoc(ref, { ...timesheet, submitted: true });
    Alert.alert("📤 Submitted", "Your timesheet has been submitted.");
    router.back();
  } catch (err) {
    console.error(err);
    Alert.alert("❌ Error", "Could not submit timesheet");
  }
};


  // Update helper
  const updateDay = (day, field, value) => {
    setTimesheet((prev) => {
      const existing = prev.days[day] || { mode: "yard", dayNotes: "" };
      let updated = { ...existing, [field]: value };

      // Autofill Yard with standard hours
      if (field === "mode" && value === "yard") {
        updated.leaveTime = updated.leaveTime || "08:00";
        updated.arriveBack = updated.arriveBack || "16:30";
      }

      return {
        ...prev,
        days: {
          ...prev.days,
          [day]: updated,
        },
      };
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 70 }}>
        {/* 🔙 Back */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Icon name="arrow-left" size={20} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>📝 Timesheet: Week of {id}</Text>

        {days.map((day) => {
          const entry = timesheet.days[day] || { mode: "yard", dayNotes: "" };
          const jobs = jobsByDay[day] || [];
          const isHoliday = holidaysByDay[day];

          return (
            <View key={day} style={styles.dayBlock}>
              <Text style={styles.dayTitle}>{day}</Text>

              {isHoliday ? (
                <View style={styles.holidayBlock}>
                  <Text style={{ color: "#f87171", fontWeight: "bold" }}>Holiday</Text>
                </View>
              ) : jobs.length > 0 ? (
                <>
                  {jobs.map((job) => (
                    <View key={job.id} style={styles.jobLink}>
                      <Text style={{ color: "#22c55e", fontWeight: "bold" }}>
                        📌 {job.jobNumber || job.id} – {job.client || "Client"}
                      </Text>
                      <Text style={{ color: "#ccc" }}>{job.location || ""}</Text>
                    </View>
                  ))}

                  {/* Travel / On Set selection */}
                  <View style={styles.modeRow}>
                    <TouchableOpacity
                      style={[styles.modeBtn, entry.mode === "travel" && styles.modeBtnActive]}
                      onPress={() => updateDay(day, "mode", "travel")}
                    >
                      <Text style={styles.modeText}>Travel Day</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeBtn, entry.mode === "onset" && styles.modeBtnActive]}
                      onPress={() => updateDay(day, "mode", "onset")}
                    >
                      <Text style={styles.modeText}>On Set</Text>
                    </TouchableOpacity>
                  </View>

                  {entry.mode === "travel" && (
                    <View style={styles.onSetBlock}>
                      <TimeDropdown
                        label="Leave Time"
                        value={entry.leaveTime}
                        onSelect={(t) => updateDay(day, "leaveTime", t)}
                        options={timeOptions}
                      />
                      <TimeDropdown
                        label="Arrive Time"
                        value={entry.arriveTime}
                        onSelect={(t) => updateDay(day, "arriveTime", t)}
                        options={timeOptions}
                      />
                      {/* Notes for the day */}
<TextInput
  placeholder="Notes for this day"
  placeholderTextColor="#777"
  style={styles.dayInput}
  multiline
  value={entry.dayNotes || ""}
  onChangeText={(t) => updateDay(day, "dayNotes", t)}
/>

                    </View>
                    
                  )}

                  {entry.mode === "onset" && (
                    <View style={styles.onSetBlock}>
                      <TimeDropdown
                        label="Leave Time"
                        value={entry.leaveTime}
                        onSelect={(t) => updateDay(day, "leaveTime", t)}
                        options={timeOptions}
                      />
                      <TimeDropdown
                        label="Arrive Time"
                        value={entry.arriveTime}
                        onSelect={(t) => updateDay(day, "arriveTime", t)}
                        options={timeOptions}
                      />
                      <TimeDropdown
                        label="Call Time"
                        value={entry.callTime}
                        onSelect={(t) => updateDay(day, "callTime", t)}
                        options={timeOptions}
                      />
                      <TimeDropdown
                        label="Wrap Time"
                        value={entry.wrapTime}
                        onSelect={(t) => updateDay(day, "wrapTime", t)}
                        options={timeOptions}
                      />
                      <TimeDropdown
                        label="Arrive Back"
                        value={entry.arriveBack}
                        onSelect={(t) => updateDay(day, "arriveBack", t)}
                        options={timeOptions}
                      />

                      <View style={styles.toggleRow}>
                        <Text style={styles.label}>Overnight?</Text>
                        <Switch
                          value={entry.overnight || false}
                          onValueChange={(v) => updateDay(day, "overnight", v)}
                        />
                      </View>
                      <View style={styles.toggleRow}>
                        <Text style={styles.label}>Lunch Sup?</Text>
                        <Switch
                          value={entry.lunchSup || false}
                          onValueChange={(v) => updateDay(day, "lunchSup", v)}
                        />
                      </View>
                      {/* Notes for the day */}
<TextInput
  placeholder="Notes for this day"
  placeholderTextColor="#777"
  style={styles.dayInput}
  multiline
  value={entry.dayNotes || ""}
  onChangeText={(t) => updateDay(day, "dayNotes", t)}
/>



                    </View>
                  )}
                </>
              ) : day === "Saturday" || day === "Sunday" ? (
                <Text style={{ color: "#888" }}>Off (Weekend)</Text>
              ) : (
                <>
                  {/* Yard default */}
                <Text style={{ color: "#ccc", marginBottom: 6, fontWeight: "bold" }}>Yard Day</Text>
                <View style={styles.onSetBlock}>
                  <TimeDropdown
                    label="Start Time"
                    value={entry.leaveTime || "08:00"}
                    onSelect={(t) => updateDay(day, "leaveTime", t)}
                    options={timeOptions}
                  />
                  <TimeDropdown
                    label="Finish Time"
                    value={entry.arriveBack || "16:30"}
                    onSelect={(t) => updateDay(day, "arriveBack", t)}
                    options={timeOptions}
                  />
                </View>

                  <TextInput
                    placeholder="Notes for this day"
                    placeholderTextColor="#777"
                    style={styles.dayInput}
                    multiline
                    value={entry.dayNotes || ""}
                    onChangeText={(t) => updateDay(day, "dayNotes", t)}
                  />
                </>
              )}
            </View>
          );
        })}

        <TextInput
          placeholder="General notes for the week"
          placeholderTextColor="#777"
          style={styles.input}
          multiline
          value={timesheet.notes}
          onChangeText={(t) => setTimesheet((prev) => ({ ...prev, notes: t }))}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between", margin: 10 }}>
  <TouchableOpacity
    style={[styles.actionButton, { backgroundColor: "#666" }]}
    onPress={saveTimesheet}
  >
    <Text style={styles.actionButtonText}>💾 Save</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[styles.actionButton, { backgroundColor: "#22c55e" }]}
    onPress={submitTimesheet}
  >
    <Text style={styles.actionButtonText}>📤 Submit</Text>
  </TouchableOpacity>
</View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 6 },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  backText: { color: "#fff", fontSize: 15, marginLeft: 6 },
  title: { fontSize: 16, fontWeight: "bold", color: "#fff", marginBottom: 8 },
  dayBlock: {
    backgroundColor: "#1a1a1a",
    padding: 6,
    borderRadius: 6,
    marginBottom: 8,
  },
  dayTitle: { fontSize: 14, fontWeight: "bold", color: "#fff", marginBottom: 4 },
  holidayBlock: {
    padding: 10,
    backgroundColor: "#331111",
    borderRadius: 6,
    marginTop: 4,
  },
  modeRow: { flexDirection: "row", marginBottom: 6 },
  modeBtn: {
    flex: 1,
    backgroundColor: "#333",
    padding: 6,
    borderRadius: 4,
    marginRight: 4,
    alignItems: "center",
  },
  modeBtnActive: { backgroundColor: "#22c55e" },
  modeText: { color: "#fff", fontSize: 13 },
  onSetBlock: { marginTop: 4 },
  label: { color: "#ccc", fontSize: 12, marginBottom: 2 },
  dropdownBox: {
    backgroundColor: "#333",
    padding: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
  dayInput: {
    backgroundColor: "#222",
    color: "#fff",
    padding: 6,
    borderRadius: 6,
    marginTop: 4,
    fontSize: 12,
  },
  input: {
    backgroundColor: "#333",
    color: "#fff",
    padding: 8,
    borderRadius: 6,
    margin: 8,
    fontSize: 13,
    height: 55,
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 4,
  },
  saveButton: {
    backgroundColor: "#22c55e",
    alignItems: "center",
    padding: 12,
    borderRadius: 6,
    margin: 10,
  },
  saveButtonText: { color: "#000", fontWeight: "bold", fontSize: 15 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalBox: {
    width: "70%",
    maxHeight: "60%",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 10,
  },
  modalItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: "#eee" },
  closeBtn: {
    marginTop: 8,
    backgroundColor: "#333",
    padding: 10,
    borderRadius: 6,
    alignItems: "center",
  },
  jobLink: {
    padding: 8,
    backgroundColor: "#111",
    borderRadius: 6,
    marginBottom: 4,
  },
  actionButton: {
  flex: 1,
  alignItems: "center",
  padding: 12,
  borderRadius: 6,
  marginHorizontal: 5,
},
actionButtonText: {
  color: "#000",
  fontWeight: "bold",
  fontSize: 15,
},

});
