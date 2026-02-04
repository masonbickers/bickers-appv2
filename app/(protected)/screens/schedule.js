// app/(protected)/screens/schedule.js
import { useLocalSearchParams, useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";

import { db } from "../../../firebaseConfig";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

/* ───────────────────────────────
   BANK HOLIDAYS (UK via GOV.UK)
   - Source: https://www.gov.uk/bank-holidays.json
   - Region options: "england-and-wales" | "scotland" | "northern-ireland"
──────────────────────────────── */
const BANK_HOLIDAY_REGION = "england-and-wales";
const BANK_HOLIDAY_COLOR = "#7c3aed"; // purple
const BANK_HOLIDAY_BORDER = "#a855f7";

async function fetchUKBankHolidays(region = BANK_HOLIDAY_REGION) {
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const events = json?.[region]?.events || [];
    // map: date -> title
    const map = {};
    for (const ev of events) {
      if (!ev?.date) continue;
      map[String(ev.date)] = String(ev.title || "Bank holiday");
    }
    return map;
  } catch (e) {
    console.warn("[bank-holidays] failed to fetch:", e?.message || e);
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

function safeStr(v) {
  return String(v ?? "").trim().toLowerCase();
}

function toDateSafe(v) {
  if (!v) return null;
  if (v.toDate && typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function toISODate(d) {
  const date = d instanceof Date ? d : toDateSafe(d);
  if (!date) return null;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getEmployeesForDate(job, isoDate, allEmployees) {
  const byDate = job.employeesByDate || job.employeeAssignmentsByDate || null;

  const list = byDate?.[isoDate]
    ? byDate[isoDate]
    : Array.isArray(job.employees)
    ? job.employees
    : [];

  return list.map((e) => {
    if (typeof e === "string") {
      const name = e;
      const match = allEmployees.find((x) => safeStr(x.name) === safeStr(name));
      return { code: safeStr(match?.userCode), name, displayName: name };
    }

    const name =
      e.name ||
      e.displayName ||
      [e.firstName, e.lastName].filter(Boolean).join(" ");

    const code =
      e.userCode ||
      e.employeeCode ||
      allEmployees.find((x) => safeStr(x.name) === safeStr(name))?.userCode;

    return { code: safeStr(code), name: safeStr(name), displayName: name };
  });
}

function buildVehicleLookup(allVehicles) {
  const map = {};
  for (const v of allVehicles || []) {
    const id = String(v.id || "").trim();
    if (!id) continue;

    const nameRaw =
      v.name || v.vehicleName || v.title || v.displayName || v.nickname || v.model;
    const regRaw = v.registration || v.reg || v.plate;

    const name = String(nameRaw || "").trim();
    const reg = String(regRaw || "").trim();

    map[id] = name && reg ? `${name} (${reg})` : name || reg || id;
  }
  return map;
}

function resolveVehicleNamesFromJob(job, vehicleById) {
  const raw =
    job.vehicleIds ||
    job.vehicles ||
    job.selectedVehicles ||
    job.vehiclesSelected ||
    [];
  const arr = Array.isArray(raw) ? raw : [];

  const names = arr
    .map((item) => {
      if (typeof item === "string") {
        const key = String(item).trim();
        return vehicleById?.[key] || key;
      }
      const maybeId =
        item.id || item.vehicleId || item.value || item.docId || item.firebaseId;
      const idStr = String(maybeId || "").trim();
      const embeddedName =
        item.name || item.vehicleName || item.label || item.title || item.displayName;
      return (
        (idStr && vehicleById?.[idStr]) ||
        (embeddedName ? String(embeddedName).trim() : null) ||
        (idStr || null)
      );
    })
    .filter(Boolean);

  return Array.from(new Set(names));
}

/**
 * Determine if a holiday is unpaid based on common schema variants.
 * Supports:
 * - unpaid: true
 * - isUnpaid: true
 * - paid: false / isPaid: false
 * - payType: "unpaid" | "paid"
 * - leaveType / type: "unpaid" etc.
 */
function getHolidayPayType(h) {
  const payType = safeStr(h?.payType || h?.pay_type || "");
  const leaveType = safeStr(h?.leaveType || h?.leave_type || h?.type || "");
  const unpaidFlag = !!(h?.unpaid || h?.isUnpaid);
  const paidFlagExists = typeof h?.paid === "boolean" || typeof h?.isPaid === "boolean";
  const paidFlag =
    typeof h?.paid === "boolean" ? h.paid : typeof h?.isPaid === "boolean" ? h.isPaid : null;

  if (payType) {
    if (payType.includes("unpaid")) return "unpaid";
    if (payType.includes("paid")) return "paid";
  }
  if (leaveType) {
    if (leaveType.includes("unpaid")) return "unpaid";
    if (leaveType.includes("paid")) return "paid";
  }

  if (unpaidFlag) return "unpaid";
  if (paidFlagExists) return paidFlag ? "paid" : "unpaid";

  return "paid"; // default to paid if not specified (keeps current behaviour)
}

function isApprovedHoliday(h) {
  const s = safeStr(h?.status);
  // treat empty status as approved (backwards compatible), but if status exists it must be approved
  if (!s) return true;
  return s === "approved";
}

/* -------------------------------------------------------------------------- */
/*                                  SCREEN                                    */
/* -------------------------------------------------------------------------- */

export default function SchedulePage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();

  const [markedDates, setMarkedDates] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayInfo, setDayInfo] = useState(null);

  // ✅ control which month the Calendar opens on
  const [calendarCurrent, setCalendarCurrent] = useState(toISODate(new Date()));

  // ✅ Bank holidays: date -> title
  const [bankHolidayMap, setBankHolidayMap] = useState({});

  // ✅ If navigated here with ?date=YYYY-MM-DD, auto-select it and open that month
  useEffect(() => {
    const incoming = String(params?.date || "").trim();
    if (!incoming) return;

    const d = new Date(incoming);
    if (Number.isNaN(d.getTime())) return;

    const iso = toISODate(d);
    setSelectedDay(iso);
    setCalendarCurrent(iso);
  }, [params?.date]);

  // Load bank holidays once
  useEffect(() => {
    let alive = true;
    (async () => {
      const map = await fetchUKBankHolidays(BANK_HOLIDAY_REGION);
      if (alive) setBankHolidayMap(map || {});
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* -------------------------------------------------------------------------- */
  /*                                LOAD DATA                                  */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    const loadData = async () => {
      if (loading || !isAuthed) {
        setMarkedDates({});
        setSelectedDay(null);
        setDayInfo(null);
        return;
      }

      const meCode = safeStr(employee?.userCode);
      const meName = safeStr(employee?.name || employee?.displayName);

      if (!meCode && !meName) {
        setMarkedDates({});
        setSelectedDay(null);
        setDayInfo({ jobs: {}, holidayByDate: {}, bankHolidays: {} });
        return;
      }

      const [jobsSnap, holSnap, empSnap, vehSnap] = await Promise.all([
        getDocs(collection(db, "bookings")),
        getDocs(collection(db, "holidays")),
        getDocs(collection(db, "employees")),
        getDocs(collection(db, "vehicles")),
      ]);

      const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const holidays = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const allEmployees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const allVehicles = vehSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const vehicleById = buildVehicleLookup(allVehicles);

      const marks = {};
      const jobMap = {};
      const holidayByDate = {}; // ✅ date -> { payType: "paid"|"unpaid", title, status }

      /* --------------------------------- JOBS --------------------------------- */
      for (const job of jobs) {
        const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
        if (!dates.length) continue;

        for (const d of dates) {
          const dateStr = toISODate(d);
          if (!dateStr) continue;

          const todaysEmps = getEmployeesForDate(job, dateStr, allEmployees);

          const isMineToday =
            (!!meCode && todaysEmps.some((r) => r.code === meCode)) ||
            (!!meName && todaysEmps.some((r) => safeStr(r.name) === meName));

          if (!isMineToday) continue;

          marks[dateStr] = {
            ...(marks[dateStr] || {}),
            customStyles: {
              container: { backgroundColor: "#1C3C7A", borderRadius: 10 },
              text: { color: "#fff", fontWeight: "700" },
            },
          };

          if (!jobMap[dateStr]) jobMap[dateStr] = [];

          const vehicleNames = resolveVehicleNamesFromJob(job, vehicleById);

          jobMap[dateStr].push({
            ...job,
            employees: todaysEmps.map((r) => r.displayName).filter(Boolean),
            vehicleNames,
          });
        }
      }

      /* ------------------------------- HOLIDAYS ------------------------------- */
      for (const h of holidays) {
        const codeMatch =
          !!meCode && [h.employeeCode, h.userCode].map(safeStr).includes(meCode);

        const nameMatch =
          !!meName && [h.employee, h.name].map(safeStr).includes(meName);

        if (!codeMatch && !nameMatch) continue;

        // ✅ only show approved (matches "holiday the same" behaviour from Job Day screen)
        if (!isApprovedHoliday(h)) continue;

        const start = toDateSafe(h.startDate || h.from);
        const end = toDateSafe(h.endDate || h.to || start);
        if (!start) continue;

        const payType = getHolidayPayType(h); // "paid" | "unpaid"
        const isUnpaid = payType === "unpaid";

        const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          const dateStr = toISODate(d);
          if (!dateStr) continue;

          // Save meta so selected-day card can say Paid/Unpaid
          holidayByDate[dateStr] = {
            payType,
            status: "approved",
          };

          // Keep holiday green, but make unpaid obvious (yellow border)
          const baseContainer = { backgroundColor: "#126536", borderRadius: 10 };
          const unpaidBorder = isUnpaid
            ? { borderWidth: 2, borderColor: "#FFD60A" }
            : {};

          marks[dateStr] = {
            ...(marks[dateStr] || {}),
            customStyles: {
              container: { ...baseContainer, ...unpaidBorder },
              text: { color: "#fff", fontWeight: "700" },
            },
          };
        }
      }

      /* ------------------------------ BANK HOLIDAYS ---------------------------- */
      // Add bank holiday styling without overriding jobs/holidays.
      // If date already marked, add a purple border so it still “shows”.
      const bh = bankHolidayMap || {};
      Object.keys(bh).forEach((dateStr) => {
        if (!dateStr) return;

        const existing = marks[dateStr];

        if (existing?.customStyles?.container) {
          const prevContainer = existing.customStyles.container || {};
          marks[dateStr] = {
            ...existing,
            customStyles: {
              ...existing.customStyles,
              container: {
                ...prevContainer,
                borderWidth: Math.max(Number(prevContainer.borderWidth || 0), 2),
                borderColor: BANK_HOLIDAY_BORDER,
              },
              text: {
                ...(existing.customStyles.text || {}),
              },
            },
          };
        } else {
          marks[dateStr] = {
            ...(marks[dateStr] || {}),
            customStyles: {
              container: { backgroundColor: BANK_HOLIDAY_COLOR, borderRadius: 10 },
              text: { color: "#fff", fontWeight: "800" },
            },
          };
        }
      });

      /* ------------------------------- WEEKENDS ------------------------------- */
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const dateStr = toISODate(d);
        const dow = d.getDay();

        // only mark weekend grey if nothing else marked (jobs/holiday/bank hol)
        if ((dow === 0 || dow === 6) && !marks[dateStr]) {
          marks[dateStr] = {
            customStyles: {
              container: { backgroundColor: "#262626", borderRadius: 10 },
              text: { color: "#fff", fontWeight: "700" },
            },
          };
        }
      }

      setMarkedDates(marks);
      setDayInfo({ jobs: jobMap, holidayByDate, bankHolidays: bh });
    };

    loadData();
  }, [employee?.userCode, employee?.name, isAuthed, loading, bankHolidayMap]);

  const handleDayPress = (day) => {
    setSelectedDay(day.dateString);
    setCalendarCurrent(day.dateString);
  };

  const clearSelected = () => setSelectedDay(null);
  const jumpToToday = () => {
    const t = toISODate(new Date());
    setSelectedDay(t);
    setCalendarCurrent(t);
  };

  /* ---------------------------- SELECTED MARKING ---------------------------- */
  const computedMarked = useMemo(() => {
    if (!selectedDay) return markedDates;

    return {
      ...markedDates,
      [selectedDay]: {
        ...(markedDates[selectedDay] || {}),
        customStyles: {
          container: {
            // keep any existing border (eg bank holiday border or unpaid border), but show selected as red
            ...(markedDates[selectedDay]?.customStyles?.container || {}),
            backgroundColor: "#C8102E",
            borderRadius: 10,
          },
          text: { color: "#fff", fontWeight: "800" },
        },
      },
    };
  }, [markedDates, selectedDay]);

  if (loading || !isAuthed) return null;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* HEADER */}
          <View style={styles.headerBlock}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Schedule</Text>
          </View>

          {/* QUICK ACTIONS */}
          <View style={styles.quickRow}>
            <TouchableOpacity
              style={[
                styles.quickBtn,
                { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
              onPress={jumpToToday}
            >
              <Text style={[styles.quickText, { color: "#fff" }]}>Today</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.quickBtn,
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}
              onPress={clearSelected}
            >
              <Text style={[styles.quickText, { color: colors.text }]}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* CALENDAR */}
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Calendar
              firstDay={1}
              markingType="custom"
              markedDates={computedMarked}
              onDayPress={handleDayPress}
              current={calendarCurrent}
              theme={{
                backgroundColor: colors.background,
                calendarBackground: colors.surfaceAlt,
                dayTextColor: colors.text,
                todayTextColor: colors.accent,
                monthTextColor: colors.text,
                arrowColor: colors.accent,
                textDisabledColor: colors.textMuted,
                textSectionTitleColor: colors.textMuted,
              }}
            />
          </View>

          {/* SELECTED DAY */}
          <View
            style={[
              styles.dayHeader,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.dayText, { color: colors.text }]}>
              {selectedDay
                ? new Date(selectedDay).toLocaleDateString("en-GB", {
                    weekday: "long",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })
                : "No date selected"}
            </Text>
          </View>

          {/* DETAILS */}
          {renderDetails(selectedDay, dayInfo, colors)}

          {/* LEGEND */}
          <View style={styles.legendRow}>
            <LegendPill color="#1C3C7A" label="On Set" />
            <LegendPill color="#126536" label="Holiday (Paid)" />
            <LegendPill color="#126536" label="Holiday (Unpaid)" borderColor="#FFD60A" />
            <LegendPill color={BANK_HOLIDAY_COLOR} label="Bank Holiday" />
            <LegendPill color="#262626" label="Weekend" />
            <LegendPill color="#999" label="Yard" />
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/*                            SUBCOMPONENTS / UI                              */
/* -------------------------------------------------------------------------- */

function renderDetails(selectedDay, dayInfo, colors) {
  if (!selectedDay || !dayInfo) {
    return (
      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.infoTitle, { color: colors.text }]}>Pick a date</Text>
        <Text style={[styles.infoSubtitle, { color: colors.textMuted }]}>
          Tap any date in the calendar to view jobs or holiday info.
        </Text>
      </View>
    );
  }

  const { jobs, holidayByDate, bankHolidays } = dayInfo;

  /* ---------------------------------- JOBS ---------------------------------- */
  if (jobs[selectedDay]?.length) {
    return (
      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <View style={styles.infoHeader}>
          <Text style={[styles.infoTitle, { color: colors.text }]}>
            Jobs on {selectedDay}
          </Text>
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.badgeText, { color: "#fff" }]}>
              {jobs[selectedDay].length}
            </Text>
          </View>
        </View>

        {jobs[selectedDay].map((job) => {
          const dayNote =
            job?.notesByDate?.[selectedDay] === "Other"
              ? job?.notesByDate?.[`${selectedDay}-other`]
              : job?.notesByDate?.[selectedDay];

          return (
            <View
              key={job.id}
              style={[
                styles.jobCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.jobRow}>
                <Text style={[styles.jobTitle, { color: colors.text }]}>
                  Job #{job.jobNumber || "N/A"}
                </Text>

                {job.status && (
                  <Text
                    style={[
                      styles.jobStatus,
                      { backgroundColor: colors.surfaceAlt, color: colors.text },
                    ]}
                  >
                    {job.status}
                  </Text>
                )}
              </View>

              {job.client && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Client:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.client}
                  </Text>
                </Text>
              )}

              {job.location && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Location:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.location}
                  </Text>
                </Text>
              )}

              {Array.isArray(job.vehicleNames) && job.vehicleNames.length > 0 && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Vehicles:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.vehicleNames.join(", ")}
                  </Text>
                </Text>
              )}

              {Array.isArray(job.equipment) && job.equipment.length > 0 && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Equipment:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.equipment.join(", ")}
                  </Text>
                </Text>
              )}

              {Array.isArray(job.employees) && job.employees.length > 0 && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Crew:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.employees.join(", ")}
                  </Text>
                </Text>
              )}

              {dayNote && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Day Note:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {dayNote}
                  </Text>
                </Text>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  /* ------------------------------ BANK HOLIDAY ------------------------------ */
  if (bankHolidays?.[selectedDay]) {
    return (
      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.infoTitle, { color: colors.text }]}>Bank Holiday</Text>
        <Text style={[styles.infoSubtitle, { color: colors.textMuted }]}>
          {bankHolidays[selectedDay]}
        </Text>
      </View>
    );
  }

  /* -------------------------------- HOLIDAY (PAID/UNPAID) ------------------- */
  const hol = holidayByDate?.[selectedDay];
  if (hol) {
    const isUnpaid = hol.payType === "unpaid";
    return (
      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.infoTitle, { color: colors.text }]}>
          {isUnpaid ? "Unpaid Holiday" : "Holiday"}
        </Text>
        <Text style={[styles.infoSubtitle, { color: colors.textMuted }]}>
          {isUnpaid ? "This day is recorded as unpaid leave." : "Enjoy your time off."}
        </Text>
      </View>
    );
  }

  /* ------------------------------- WEEKENDS -------------------------------- */
  const dow = new Date(selectedDay).getDay();
  if (dow === 0 || dow === 6) {
    return (
      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.infoTitle, { color: colors.text }]}>Weekend</Text>
        <Text style={[styles.infoSubtitle, { color: colors.textMuted }]}>
          You are not booked today.
        </Text>
      </View>
    );
  }

  /* --------------------------- DEFAULT (YARD) --------------------------- */
  return (
    <View
      style={[
        styles.infoCard,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.infoTitle, { color: colors.text }]}>Yard Based</Text>
      <Text style={[styles.infoSubtitle, { color: colors.textMuted }]}>
        No offsite bookings today.
      </Text>
    </View>
  );
}

function LegendPill({ color, label, borderColor }) {
  return (
    <View style={styles.pill}>
      <View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            borderColor: borderColor || "transparent",
            borderWidth: borderColor ? 2 : 0,
          },
        ]}
      />
      <Text style={[styles.pillText, { color: "#EEE" }]}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  STYLES                                    */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#000" },
  container: { flex: 1, backgroundColor: "#000" },
  scrollContainer: { paddingHorizontal: 20, paddingTop: 6 },

  headerBlock: { paddingVertical: 12, alignItems: "flex-start" },
  headerTitle: { fontSize: 26, fontWeight: "800", letterSpacing: 0.4 },

  quickRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    marginTop: 8,
    marginBottom: 10,
  },
  quickBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickText: { fontWeight: "700" },

  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },

  dayHeader: {
    marginTop: 14,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  dayText: { fontSize: 15, fontWeight: "700" },

  infoCard: { marginTop: 14, padding: 16, borderRadius: 16, borderWidth: 1 },
  infoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoTitle: { fontSize: 17, fontWeight: "800" },
  infoSubtitle: { marginTop: 4, fontSize: 14 },

  badge: { paddingVertical: 2, paddingHorizontal: 10, borderRadius: 12 },
  badgeText: { fontWeight: "800", fontSize: 12 },

  jobCard: { marginTop: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  jobRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  jobTitle: { fontWeight: "800", fontSize: 15 },
  jobStatus: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: "600",
  },
  jobItem: { marginTop: 4, fontSize: 14 },
  jobValue: { fontWeight: "700" },

  legendRow: { marginTop: 20, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#111",
    borderColor: "#222",
    borderWidth: 1,
    borderRadius: 20,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  pillText: { fontSize: 13, fontWeight: "700", color: "#EEE" },
});
