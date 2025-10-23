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
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { db } from "../../../../firebaseConfig";

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

const DEFAULT_YARD_START = "08:00";
const DEFAULT_YARD_END = "16:30";

function ensureYardSegments(entry) {
  const e = { ...(entry || {}) };
  if (!Array.isArray(e.yardSegments) || e.yardSegments.length === 0) {
    e.yardSegments = [{ start: DEFAULT_YARD_START, end: DEFAULT_YARD_END }];
  }
  return e;
}

// Dropdown (JS-friendly)
function TimeDropdown({ label, value, onSelect, options }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: 6, flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.dropdownBox} onPress={() => setOpen(true)}>
        <Text style={{ color: value ? "#fff" : "#777" }}>{value || "Select"}</Text>
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
  const { id } = useLocalSearchParams(); // weekStart ISO
  const router = useRouter();
  const employee = global.employee || { userCode: "TEMP", name: "Unknown" };

  const [timesheet, setTimesheet] = useState({
    employeeCode: employee.userCode,
    weekStart: id,
    days: days.reduce((acc, d) => {
      const isWeekend = d === "Saturday" || d === "Sunday";
      acc[d] = isWeekend
        ? { mode: "off", dayNotes: "" }
        : {
            mode: "yard",
            // legacy fields kept for travel/on-set
            leaveTime: DEFAULT_YARD_START,
            arriveBack: DEFAULT_YARD_END,
            dayNotes: "",
            // multiple yard segments
            yardSegments: [{ start: DEFAULT_YARD_START, end: DEFAULT_YARD_END }],
          };
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
        if (snap.exists()) {
          const data = snap.data();
          // Patch older docs to ensure yardSegments exist where needed
          const patched = { ...data };
          for (const d of days) {
            const e = (patched.days && patched.days[d]) || {};
            if (String(e.mode || "yard").toLowerCase() === "yard") {
              patched.days[d] = ensureYardSegments(e);
            } else {
              patched.days[d] = e;
            }
          }
          setTimesheet(patched);
        }
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
        const empSnap = await getDocs(collection(db, "employees"));
        const allEmployees = empSnap.docs.map((doc) => doc.data());

        const jobsSnap = await getDocs(collection(db, "bookings"));
        const allJobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const holSnap = await getDocs(collection(db, "holidays"));
        const allHols = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        let jobMap = {};
        let holMap = {};
        for (let d of days) {
          jobMap[d] = [];
          holMap[d] = false;
        }

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

        // Jobs map
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

        // Holidays map
        allHols.forEach((hol) => {
          if (hol.employee === employee.name) {
            const start = new Date(hol.startDate);
            const end = new Date(hol.endDate);
            const d = new Date(start);
            while (d <= end) {
              const dateStr = d.toISOString().split("T")[0];
              if (weekDates.includes(dateStr)) {
                const dayName = getDayName(dateStr);
                if (holMap[dayName] !== undefined) holMap[dayName] = true;
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
        next.days[d] = ensureYardSegments(e);
      } else {
        next.days[d] = e;
      }
    });
    return next;
  }

  // Snapshot for summaries
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

  // Imprint jobs into days and set primary bookingId/jobNumber + dateISO
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

  // ---- Yard segment helpers ----
  const addYardSegment = (day) => {
    setTimesheet((prev) => {
      const existing = prev.days[day] || { mode: "yard" };
      const e = ensureYardSegments(existing);
      const last = e.yardSegments[e.yardSegments.length - 1] || {
        start: DEFAULT_YARD_START,
        end: DEFAULT_YARD_END,
      };
      const nextSeg = { start: last.end || DEFAULT_YARD_START, end: DEFAULT_YARD_END };
      return {
        ...prev,
        days: {
          ...prev.days,
          [day]: { ...e, yardSegments: [...e.yardSegments, nextSeg] },
        },
      };
    });
  };

  const removeYardSegment = (day, index) => {
    setTimesheet((prev) => {
      const existing = prev.days[day] || { mode: "yard" };
      const e = ensureYardSegments(existing);
      const segs = e.yardSegments.slice();
      if (segs.length <= 1) return prev; // keep at least one
      segs.splice(index, 1);
      return {
        ...prev,
        days: { ...prev.days, [day]: { ...e, yardSegments: segs } },
      };
    });
  };

  const updateYardSegment = (day, index, field, value) => {
    setTimesheet((prev) => {
      const existing = prev.days[day] || { mode: "yard" };
      const e = ensureYardSegments(existing);
      const segs = e.yardSegments.map((s, i) => (i === index ? { ...s, [field]: value } : s));
      return {
        ...prev,
        days: {
          ...prev.days,
          [day]: { ...e, yardSegments: segs },
        },
      };
    });
  };

  // Save (draft)
  const saveTimesheet = async () => {
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

  // Generic updater (for non-segment fields)
  const updateDay = (day, field, value) => {
    setTimesheet((prev) => {
      const existing = prev.days[day] || { mode: "yard", dayNotes: "" };
      let updated = { ...existing, [field]: value };

      if (field === "mode" && value === "yard") {
        updated = ensureYardSegments(updated);
        updated.leaveTime = updated.leaveTime || DEFAULT_YARD_START;
        updated.arriveBack = updated.arriveBack || DEFAULT_YARD_END;
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
          <Icon name="arrow-left" size={18} color="#fff" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>📝 Timesheet: Week of {id}</Text>

        {/* Status pill */}
        <View style={styles.statusRow}>
          <View style={[styles.pill, timesheet.submitted ? styles.pillOk : styles.pillDraft]}>
            <Text style={[styles.pillText, timesheet.submitted ? styles.pillTextOk : styles.pillTextDraft]}>
              {timesheet.submitted ? "Submitted" : "Draft (not submitted)"}
            </Text>
          </View>
          {!timesheet.submitted && <Text style={styles.statusHint}>Save keeps a draft. Submit sends it for approval.</Text>}
        </View>

        {days.map((day) => {
          const entry = timesheet.days[day] || { mode: "yard", dayNotes: "" };
          const jobs = jobsByDay[day] || [];
          const isHoliday = holidaysByDay[day];
          const yardEntry = entry.mode === "yard" ? ensureYardSegments(entry) : entry;

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
                      <Text style={styles.jobMain}>
                        📌 {job.jobNumber || job.id} – {job.client || "Client"}
                      </Text>
                      <Text style={styles.jobSub}>{job.location || ""}</Text>
                    </View>
                  ))}

                  {/* Mode selection incl. Yard */}
                  <View style={styles.modeRow}>
                    <TouchableOpacity
                      style={[styles.modeBtn, entry.mode === "travel" && styles.modeBtnActive]}
                      onPress={() => updateDay(day, "mode", "travel")}
                    >
                      <Text style={styles.modeText}>Travel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeBtn, entry.mode === "onset" && styles.modeBtnActive]}
                      onPress={() => updateDay(day, "mode", "onset")}
                    >
                      <Text style={styles.modeText}>On Set</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.modeBtn, entry.mode === "yard" && styles.modeBtnActive]}
                      onPress={() => updateDay(day, "mode", "yard")}
                    >
                      <Text style={styles.modeText}>Yard</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Travel */}
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

                  {/* On Set */}
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

                  {/* Yard: multiple segments */}
                  {yardEntry.mode === "yard" && (
                    <>
                      <Text style={styles.sectionCap}>Yard Day</Text>

                      {yardEntry.yardSegments.map((seg, idx) => (
                        <View key={idx} style={styles.segmentRow}>
                          <TimeDropdown
                            label={`Start ${idx + 1}`}
                            value={seg.start}
                            onSelect={(t) => updateYardSegment(day, idx, "start", t)}
                            options={timeOptions}
                          />
                          <View style={{ width: 8 }} />
                          <TimeDropdown
                            label={`Finish ${idx + 1}`}
                            value={seg.end}
                            onSelect={(t) => updateYardSegment(day, idx, "end", t)}
                            options={timeOptions}
                          />
                          <TouchableOpacity
                            onPress={() => removeYardSegment(day, idx)}
                            style={styles.segmentDelete}
                            disabled={yardEntry.yardSegments.length <= 1}
                          >
                            <Icon
                              name="trash-2"
                              size={16}
                              color={yardEntry.yardSegments.length <= 1 ? "#555" : "#ef4444"}
                            />
                          </TouchableOpacity>
                        </View>
                      ))}

                      {/* Smaller, cleaner add button */}
                      <TouchableOpacity style={styles.addBlockBtn} onPress={() => addYardSegment(day)}>
                        <Icon name="plus" size={14} color="#22c55e" />
                        <Text style={styles.addBlockText}>Add time block</Text>
                      </TouchableOpacity>

                      <TextInput
                        placeholder="Notes for this day"
                        placeholderTextColor="#777"
                        style={styles.dayInput}
                        multiline
                        value={yardEntry.dayNotes || ""}
                        onChangeText={(t) => updateDay(day, "dayNotes", t)}
                      />
                    </>
                  )}
                </>
              ) : day === "Saturday" || day === "Sunday" ? (
                <Text style={{ color: "#888" }}>Off (Weekend)</Text>
              ) : (
                <>
                  {/* Default Yard weekday (no jobs) */}
                  <Text style={styles.sectionCap}>Yard Day</Text>

                  {ensureYardSegments(entry).yardSegments.map((seg, idx) => (
                    <View key={idx} style={styles.segmentRow}>
                      <TimeDropdown
                        label={`Start ${idx + 1}`}
                        value={seg.start}
                        onSelect={(t) => updateYardSegment(day, idx, "start", t)}
                        options={timeOptions}
                      />
                      <View style={{ width: 8 }} />
                      <TimeDropdown
                        label={`Finish ${idx + 1}`}
                        value={seg.end}
                        onSelect={(t) => updateYardSegment(day, idx, "end", t)}
                        options={timeOptions}
                      />
                      <TouchableOpacity
                        onPress={() => removeYardSegment(day, idx)}
                        style={styles.segmentDelete}
                        disabled={ensureYardSegments(entry).yardSegments.length <= 1}
                      >
                        <Icon
                          name="trash-2"
                          size={16}
                          color={ensureYardSegments(entry).yardSegments.length <= 1 ? "#555" : "#ef4444"}
                        />
                      </TouchableOpacity>
                    </View>
                  ))}

                  {/* Smaller, cleaner add button */}
                  <TouchableOpacity style={styles.addBlockBtn} onPress={() => addYardSegment(day)}>
                    <Icon name="plus" size={14} color="#22c55e" />
                    <Text style={styles.addBlockText}>Add time block</Text>
                  </TouchableOpacity>

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
  backText: { color: "#fff", fontSize: 14, marginLeft: 6 },
  title: { fontSize: 16, fontWeight: "700", color: "#fff", marginBottom: 6 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  pill: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  pillOk: { backgroundColor: "#bbf7d0", borderColor: "#86efac" },
  pillDraft: { backgroundColor: "#fed7aa", borderColor: "#fdba74" },
  pillText: { fontWeight: "800", fontSize: 11 },
  pillTextOk: { color: "#052e16" },
  pillTextDraft: { color: "#7c2d12" },
  statusHint: { color: "#9ca3af", fontSize: 11 },

  dayBlock: {
    backgroundColor: "#111",
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1f1f1f",
  },
  dayTitle: { fontSize: 14, fontWeight: "700", color: "#fff", marginBottom: 6 },

  holidayBlock: {
    padding: 10,
    backgroundColor: "#241112",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#3b1c1c",
  },

  modeRow: { flexDirection: "row", marginBottom: 6, gap: 6 },
  modeBtn: {
    flex: 1,
    backgroundColor: "#1b1b1b",
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  modeBtnActive: { backgroundColor: "#1f3327", borderColor: "#205332" },
  modeText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  onSetBlock: { marginTop: 4 },

  label: { color: "#bbb", fontSize: 11, marginBottom: 2 },
  dropdownBox: {
    backgroundColor: "#1b1b1b",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    minHeight: 40,
    justifyContent: "center",
  },

  // Yard segments
  sectionCap: { color: "#cfcfcf", marginBottom: 6, fontWeight: "700", fontSize: 12, opacity: 0.9 },
  segmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  segmentDelete: {
    marginLeft: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#151515",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#242424",
    justifyContent: "center",
    alignItems: "center",
    height: 40,
  },

  // Smaller, cleaner add button
  addBlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 2,
    marginBottom: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#254c38",
    backgroundColor: "#0d1813",
  },
  addBlockText: { color: "#22c55e", fontWeight: "700", fontSize: 12 },

  jobLink: {
    padding: 8,
    backgroundColor: "#0f0f0f",
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#1d1d1d",
  },
  jobMain: { color: "#22c55e", fontWeight: "700", fontSize: 12.5 },
  jobSub: { color: "#bdbdbd", fontSize: 12, marginTop: 2 },

  dayInput: {
    backgroundColor: "#151515",
    color: "#fff",
    padding: 8,
    borderRadius: 8,
    marginTop: 6,
    fontSize: 12,
    borderWidth: 1,
    borderColor: "#242424",
  },
  input: {
    backgroundColor: "#121212",
    color: "#fff",
    padding: 10,
    borderRadius: 8,
    margin: 8,
    fontSize: 13,
    height: 55,
    borderWidth: 1,
    borderColor: "#232323",
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
    borderRadius: 10,
    padding: 10,
  },
  modalItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: "#eee" },
  closeBtn: {
    marginTop: 8,
    backgroundColor: "#333",
    padding: 10,
    borderRadius: 8,
    alignItems: "center",
  },

  actionButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 5,
  },
  actionButtonText: {
    color: "#000",
    fontWeight: "bold",
    fontSize: 15,
  },
});
