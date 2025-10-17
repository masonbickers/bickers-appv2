"use client";

import { useLocalSearchParams, useRouter } from "expo-router";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
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
  View
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { db } from "../../../firebaseConfig";

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

  const DEFAULT_YARD_START = "08:00";
  const DEFAULT_YARD_END = "16:30";

  const [timesheet, setTimesheet] = useState({
    employeeCode: employee.userCode,
    weekStart: id,
    days: days.reduce((acc, d) => {
      const isWeekend = d === "Saturday" || d === "Sunday";
      acc[d] = isWeekend
        ? { mode: "off", dayNotes: "" } // weekends default OFF
        : { mode: "yard", leaveTime: DEFAULT_YARD_START, arriveBack: DEFAULT_YARD_END, dayNotes: "" };
      return acc;
    }, {}),
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
          return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][idx];
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
          const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
          dates.forEach((date) => {
            if (weekDates.includes(date)) {
              const dayName = getDayName(date);
              if (jobMap[dayName]) jobMap[dayName].push(job);
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

  function withDefaultYardTimes(ts) {
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const next = { ...ts, days: { ...ts.days } };

    weekdays.forEach((d) => {
      const e = { ...(next.days?.[d] || {}) };
      const mode = String(e.mode || "yard").toLowerCase();

      if (mode === "yard") {
        if (!e.leaveTime) e.leaveTime = DEFAULT_YARD_START;
        if (!e.arriveBack && !e.arriveTime) e.arriveBack = DEFAULT_YARD_END;
      }
      next.days[d] = e;
    });

    return next;
  }

  // Build a snapshot for quick queries and summaries
  function buildJobSnapshot(jobsByDayMap) {
    const byDay = Object.fromEntries(
      days.map((d) => [
        d,
        (jobsByDayMap[d] || []).map((j) => ({
          bookingId: j.id,
          jobNumber: j.jobNumber || "",
          client: j.client || "",
          location: j.location || "",
        })),
      ])
    );

    const flat = days.flatMap((d) => (byDay[d] || []).map((j) => ({ dayName: d, ...j })));

    const bookingIds = Array.from(new Set(flat.map((x) => x.bookingId)));
    const jobNumbers = Array.from(new Set(flat.map((x) => x.jobNumber).filter(Boolean)));
    const bookingIdsByDay = Object.fromEntries(days.map((d) => [d, (byDay[d] || []).map((x) => x.bookingId)]));
    const jobNumbersByDay = Object.fromEntries(
      days.map((d) => [d, (byDay[d] || []).map((x) => x.jobNumber).filter(Boolean)])
    );

    return { byDay, flat, bookingIds, jobNumbers, bookingIdsByDay, jobNumbersByDay };
  }

  // Imprint jobs into days and set a primary bookingId/jobNumber + dateISO
  function imprintJobsIntoDays(ts, jobsByDayMap, weekStartISO) {
    const copy = { ...ts, days: { ...ts.days } };

    const start = new Date(`${weekStartISO}T00:00:00`);
    const isoByDay = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);
      isoByDay[days[i]] = d.toISOString().slice(0, 10);
    }

    for (const day of days) {
      const dayEntry = { ...(copy.days[day] || {}) };
      const jobs = (jobsByDayMap[day] || []).map((j) => ({
        bookingId: j.id,
        jobNumber: j.jobNumber || "",
        client: j.client || "",
        location: j.location || "",
      }));

      dayEntry.jobs = jobs;
      dayEntry.hasJob = jobs.length > 0;
      dayEntry.bookingId = jobs[0]?.bookingId || null;
      dayEntry.jobNumber = jobs[0]?.jobNumber || null;
      dayEntry.dateISO = isoByDay[day];

      copy.days[day] = dayEntry;
    }
    return copy;
  }

  // Save (draft)
  const saveTimesheet = async () => {
    try {
      const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);
      let ts = withDefaultYardTimes(timesheet);

      // Imprint per-day primary bookingId/jobNumber + dateISO
      ts = imprintJobsIntoDays(ts, jobsByDay, id);

      // Build snapshot arrays (bookingIds, jobNumbers, etc.)
      const jobSnapshot = buildJobSnapshot(jobsByDay);

      // Optional: set top-level single job if week is single-job
      const singleJobId = jobSnapshot.bookingIds.length === 1 ? jobSnapshot.bookingIds[0] : null;
      const singleJobNumber = jobSnapshot.jobNumbers.length === 1 ? jobSnapshot.jobNumbers[0] : null;

      const payload = {
        ...ts,
        weekStart: id,
        employeeCode: employee.userCode,
        employeeName: employee.name || null,
        jobSnapshot,
        jobId: singleJobId,
        jobNumber: singleJobNumber,
        updatedAt: serverTimestamp(),
        submitted: false,
      };

      await setDoc(ref, payload, { merge: true });
      Alert.alert("✅ Saved", "Your timesheet has been saved as a draft.");
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
      let ts = withDefaultYardTimes(timesheet);
      ts = imprintJobsIntoDays(ts, jobsByDay, id);
      const jobSnapshot = buildJobSnapshot(jobsByDay);

      const singleJobId = jobSnapshot.bookingIds.length === 1 ? jobSnapshot.bookingIds[0] : null;
      const singleJobNumber = jobSnapshot.jobNumbers.length === 1 ? jobSnapshot.jobNumbers[0] : null;

      const payload = {
        ...ts,
        weekStart: id,
        employeeCode: employee.userCode,
        employeeName: employee.name || null,
        jobSnapshot,
        jobId: singleJobId,
        jobNumber: singleJobNumber,
        updatedAt: serverTimestamp(),
        submitted: true,
        submittedAt: serverTimestamp(),
      };

      await setDoc(ref, payload, { merge: true });
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
      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        {/* 🔙 Back */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Icon name="arrow-left" size={20} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>📝 Timesheet: Week of {id}</Text>

        {/* Status pill + hint (purely visual) */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <View
            style={[
              { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
              timesheet.submitted
                ? { backgroundColor: "#bbf7d0", borderColor: "#86efac" }
                : { backgroundColor: "#fed7aa", borderColor: "#fdba74" },
            ]}
          >
            <Text
              style={{
                color: timesheet.submitted ? "#052e16" : "#7c2d12",
                fontWeight: "800",
                fontSize: 12,
              }}
            >
              {timesheet.submitted ? "Submitted" : "Draft (not submitted)"}
            </Text>
          </View>
          {!timesheet.submitted && (
            <Text style={{ color: "#9ca3af", fontSize: 12 }}>
              Save keeps a draft. Submit sends it for approval.
            </Text>
          )}
        </View>

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
            <Text style={styles.actionButtonText}>💾 Save Draft</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, { backgroundColor: "#22c55e" }]}
            onPress={() =>
              Alert.alert(
                "Submit timesheet?",
                "After submission your manager will receive it. You can still re-open and update if needed.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Submit", style: "default", onPress: submitTimesheet },
                ]
              )
            }
          >
            <Text style={styles.actionButtonText}>📤 Submit for Approval</Text>
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
  title: { fontSize: 16, fontWeight: "bold", color: "#fff", marginBottom: 6 },
  dayBlock: {
    backgroundColor: "#1a1a1a",
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#262626",
  },
  dayTitle: { fontSize: 14, fontWeight: "bold", color: "#fff", marginBottom: 4 },
  holidayBlock: {
    padding: 10,
    backgroundColor: "#331111",
    borderRadius: 6,
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#4b1d1d",
  },
  modeRow: { flexDirection: "row", marginBottom: 6, gap: 6 },
  modeBtn: {
    flex: 1,
    backgroundColor: "#333",
    padding: 8,
    borderRadius: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  modeBtnActive: { backgroundColor: "#22c55e", borderColor: "#22c55e" },
  modeText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  onSetBlock: { marginTop: 4 },
  label: { color: "#ccc", fontSize: 12, marginBottom: 2 },
  dropdownBox: {
    backgroundColor: "#333",
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  dayInput: {
    backgroundColor: "#222",
    color: "#fff",
    padding: 8,
    borderRadius: 8,
    marginTop: 6,
    fontSize: 12,
    borderWidth: 1,
    borderColor: "#333",
  },
  input: {
    backgroundColor: "#1f1f1f",
    color: "#fff",
    padding: 10,
    borderRadius: 8,
    margin: 8,
    fontSize: 13,
    height: 55,
    borderWidth: 1,
    borderColor: "#2b2b2b",
  },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginVertical: 6,
  },
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
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#222",
  },
  actionButton: {
    flex: 1,
    alignItems: "center",
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 5,
  },
  actionButtonText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 15,
  },
});
