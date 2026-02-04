// app/screens/job-day.js
import { useFocusEffect, useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTS                                 */
/* -------------------------------------------------------------------------- */

const DAY_FORMAT_LONG = {
  weekday: "long",
  day: "2-digit",
  month: "short",
  year: "numeric",
};

const DAY_FORMAT_SHORT = {
  weekday: "long",
  day: "2-digit",
  month: "short",
};

const CALL_BADGE_BG = "#FFD60A"; // keeps that punchy yellow for call time
const RECCE_BG = "#FF453A"; // recce button accent

/* ───────────────────────────────
   BANK HOLIDAYS (UK via GOV.UK)
   - Source: https://www.gov.uk/bank-holidays.json
   - Region options: "england-and-wales" | "scotland" | "northern-ireland"
──────────────────────────────── */
const BANK_HOLIDAY_REGION = "england-and-wales";

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

const safeStr = (v) => String(v ?? "").trim().toLowerCase();

const toDateSafe = (val) => {
  if (!val) return null;
  if (val?.toDate && typeof val.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
};

const toISODate = (d) => {
  const date = d instanceof Date ? d : toDateSafe(d);
  if (!date) return null;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const isWeekend = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  const dow = d.getDay();
  return dow === 0 || dow === 6;
};

async function fetchUKBankHolidays(region = BANK_HOLIDAY_REGION) {
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const events = json?.[region]?.events || [];
    const map = {}; // dateISO -> title
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

/** Normalise call time across schemas */
const getCallTime = (job, dateISO) => {
  const byDate =
    job?.callTimes?.[dateISO] ||
    job?.callTimeByDate?.[dateISO] ||
    job?.call_times?.[dateISO];

  const single = job?.callTime || job?.calltime || job?.call_time;

  const fromNotes =
    job?.notesByDate?.[`${dateISO}-callTime`] ||
    job?.notesByDate?.[dateISO]?.callTime;

  return byDate || single || fromNotes || null;
};

/** Day-specific note (notesByDate) – handles "Other" pattern */
const getDayNote = (job, dateISO) => {
  const nb = job?.notesByDate || {};
  const raw = nb[dateISO];

  if (!raw) return null;

  if (raw === "Other") {
    return nb[`${dateISO}-other`] || null;
  }

  if (typeof raw === "string" && raw.trim()) return raw.trim();

  return null;
};

/** General job note */
const getJobNote = (job) => {
  if (typeof job?.notes === "string" && job.notes.trim()) {
    return job.notes.trim();
  }
  return null;
};

const isRecceDay = (job, dateISO) => {
  const note = getDayNote(job, dateISO);
  return /\b(recce\s*day)\b/i.test(note || "");
};

/** Resolve employees for a specific date using employeesByDate / legacy employees */
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
      return {
        code: safeStr(match?.userCode),
        name,
        displayName: name,
      };
    }

    const name =
      e.name ||
      e.displayName ||
      [e.firstName, e.lastName].filter(Boolean).join(" ");

    const code =
      e.userCode ||
      e.employeeCode ||
      allEmployees.find((x) => safeStr(x.name) === safeStr(name))?.userCode;

    return {
      code: safeStr(code),
      name: safeStr(name),
      displayName: name,
    };
  });
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

  return "paid"; // default to paid
}

/** Find matching APPROVED holiday for employee on date; returns the holiday doc or null */
function getApprovedHolidayForEmployeeOnDate(holidays, employee, targetISO) {
  if (!employee || !targetISO) return null;

  const meCode = safeStr(employee.userCode);
  const meName = safeStr(employee.name || employee.displayName);

  if (!meCode && !meName) return null;

  for (const h of holidays || []) {
    const statusStr = safeStr(h?.status);
    if (statusStr !== "approved") continue;

    const codeMatch =
      !!meCode && [h.employeeCode, h.userCode].map(safeStr).includes(meCode);

    const nameMatch =
      !!meName && [h.employee, h.name].map(safeStr).includes(meName);

    if (!codeMatch && !nameMatch) continue;

    const start = toDateSafe(h.startDate || h.from);
    const end = toDateSafe(h.endDate || h.to || start);
    if (!start) continue;

    const sISO = toISODate(start);
    const eISO = toISODate(end || start);
    if (!sISO || !eISO) continue;

    if (sISO <= targetISO && eISO >= targetISO) return h;
  }

  return null;
}

/* -------- date helpers for prep window (from Workshop To-Do) -------- */

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// normalise Firestore / string / Date into Date
function toJsDate(value) {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return new Date(y, m - 1, d, 12, 0, 0, 0);
    }
    return new Date(value);
  }

  return new Date(value);
}

// turn any booking into an array of per-day dates within a window
function getBookingDaysWithinWindow(booking, from, to) {
  const days = [];
  const fromDay = startOfDay(from);
  const toDay = startOfDay(to);

  if (Array.isArray(booking.bookingDates) && booking.bookingDates.length > 0) {
    booking.bookingDates.forEach((ds) => {
      const d = startOfDay(toJsDate(ds));
      if (!Number.isNaN(d.getTime()) && d >= fromDay && d <= toDay) {
        days.push(d);
      }
    });
    return days;
  }

  const startRaw = booking.startDate || booking.date;
  const endRaw = booking.endDate || booking.startDate || booking.date;

  if (!startRaw) return days;

  let start = startOfDay(toJsDate(startRaw));
  let end = endRaw ? startOfDay(toJsDate(endRaw)) : start;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return days;

  if (end < fromDay || start > toDay) return days;

  if (start < fromDay) start = fromDay;
  if (end > toDay) end = toDay;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  return days;
}

// normalise vehicles on booking to attach full DB record where possible
function normalizeVehicles(list, vehiclesData) {
  if (!Array.isArray(list)) return [];
  return list.map((vRaw) => {
    if (
      vRaw &&
      typeof vRaw === "object" &&
      (vRaw.name || vRaw.registration || vRaw.id)
    ) {
      return vRaw;
    }
    const needle = String(vRaw ?? "").trim();
    const match =
      vehiclesData.find((x) => x.id === needle) ||
      vehiclesData.find(
        (x) =>
          String(x.registration ?? "").trim().toUpperCase() ===
          needle.toUpperCase()
      ) ||
      vehiclesData.find(
        (x) => String(x.name ?? "").trim().toLowerCase() === needle.toLowerCase()
      );
    return match || { name: needle };
  });
}

/** ✅ Display vehicles by NAME/REG but keep bookings stored by ID */
function getVehicleDisplayList(job, vehiclesData) {
  const list =
    job?.vehicles ||
    job?.vehicleIds ||
    job?.selectedVehicles ||
    job?.vehicleIDs ||
    [];

  const norm = normalizeVehicles(list, vehiclesData);

  return norm
    .map((v) => {
      const name =
        v?.name ||
        [v?.manufacturer, v?.model].filter(Boolean).join(" ") ||
        (typeof v === "string" ? v : "") ||
        "";

      const reg = v?.registration || v?.reg || v?.plate || v?.license || "";

      const cleanName = String(name || "").trim();
      const cleanReg = String(reg || "").trim();

      if (!cleanName && !cleanReg) return null;
      if (cleanName && cleanReg) return `${cleanName} · ${cleanReg}`;
      return cleanName || cleanReg;
    })
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/*                               JOB CARD (UI)                                */
/* -------------------------------------------------------------------------- */

const JobCard = ({ job, dateISO, router, colors, vehiclesData }) => {
  const callTime = useMemo(() => getCallTime(job, dateISO), [job, dateISO]);
  const dayNote = useMemo(() => getDayNote(job, dateISO), [job, dateISO]);
  const jobNote = useMemo(() => getJobNote(job), [job]);
  const recce = useMemo(() => isRecceDay(job, dateISO), [job, dateISO]);

  const vehiclesDisplay = useMemo(() => {
    return getVehicleDisplayList(job, vehiclesData);
  }, [job, vehiclesData]);

  const vehicleChecked = !!job.vehicleChecked;

  const handleActionPress = (pathname) => {
    router.push({ pathname, params: { jobId: job.id, dateISO } });
  };

  return (
    <View
      key={job.id}
      style={[
        styles.jobCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {/* Top row: job + call time */}
      <View style={[styles.titleRow, { borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[styles.jobDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.jobTitle, { color: colors.text }]}>
            Job #{job.jobNumber || "N/A"}
          </Text>
        </View>

        {callTime ? (
          <View style={[styles.callBadge, { backgroundColor: CALL_BADGE_BG }]}>
            <Icon name="clock" size={12} color="#111" style={{ marginRight: 4 }} />
            <Text style={styles.callBadgeText}>{callTime}</Text>
          </View>
        ) : null}
      </View>

      {/* Details */}
      <View style={styles.detailsContainer}>
        {job.client && (
          <Text style={[styles.jobLine, { color: colors.textMuted }]}>
            <Text style={[styles.jobLabel, { color: colors.textMuted }]}>
              Production
            </Text>{" "}
            <Text style={[styles.jobValue, { color: colors.text }]}>{job.client}</Text>
          </Text>
        )}
        {job.location && (
          <Text style={[styles.jobLine, { color: colors.textMuted }]}>
            <Text style={[styles.jobLabel, { color: colors.textMuted }]}>
              Location
            </Text>{" "}
            <Text style={[styles.jobValue, { color: colors.text }]}>{job.location}</Text>
          </Text>
        )}

        {vehiclesDisplay.length > 0 && (
          <Text style={[styles.jobLine, { color: colors.textMuted }]}>
            <Text style={[styles.jobLabel, { color: colors.textMuted }]}>Vehicles</Text>{" "}
            <Text style={[styles.jobValue, { color: colors.text }]}>
              {vehiclesDisplay.join(", ")}
            </Text>
          </Text>
        )}

        {Array.isArray(job.employees) && job.employees.length > 0 && (
          <Text style={[styles.jobLine, { color: colors.textMuted }]}>
            <Text style={[styles.jobLabel, { color: colors.textMuted }]}>Crew</Text>{" "}
            <Text style={[styles.jobValue, { color: colors.text }]}>
              {job.employees.map((e) => e?.displayName || e?.name || e).join(", ")}
            </Text>
          </Text>
        )}
      </View>

      {/* Notes */}
      {(dayNote || jobNote) && (
        <View
          style={[
            styles.noteBox,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Icon
            name="message-circle"
            size={14}
            color={colors.text}
            style={{ marginRight: 8, marginTop: 1 }}
          />
          <View style={{ flex: 1 }}>
            {dayNote && (
              <Text style={[styles.noteText, { color: colors.textMuted }]}>
                <Text style={[styles.noteLabel, { color: colors.text }]}>Day Note</Text>{" "}
                <Text style={[styles.noteBody, { color: colors.textMuted }]}>{dayNote}</Text>
              </Text>
            )}
            {jobNote && (
              <Text
                style={[
                  styles.noteText,
                  { color: colors.textMuted, marginTop: dayNote ? 4 : 0 },
                ]}
              >
                <Text style={[styles.noteLabel, { color: colors.text }]}>Job Note</Text>{" "}
                <Text style={[styles.noteBody, { color: colors.textMuted }]}>{jobNote}</Text>
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[
            styles.actionBtn,
            vehicleChecked
              ? {
                  backgroundColor: colors.success,
                  borderWidth: 1,
                  borderColor: colors.success,
                }
              : { backgroundColor: colors.accent },
          ]}
          activeOpacity={0.85}
          onPress={() => handleActionPress("/vehicle-check")}
        >
          <Icon
            name={vehicleChecked ? "check-circle" : "truck"}
            size={16}
            color={colors.surface}
          />
          <Text style={[styles.actionText, { color: colors.surface }]}>
            {vehicleChecked ? "Vehicle Check Complete" : "Vehicle Check"}
          </Text>
        </TouchableOpacity>

        {recce && (
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: RECCE_BG }]}
            activeOpacity={0.85}
            onPress={() => handleActionPress("/recce")}
          >
            <Icon name="map-pin" size={16} color={colors.surface} />
            <Text style={[styles.actionText, { color: colors.surface }]}>Recce Form</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

/* -------------------------------------------------------------------------- */
/*                             VEHICLE PREP ROW (UI)                          */
/* -------------------------------------------------------------------------- */

function VehiclePrepRow({ item, colors, prepDone }) {
  const router = useRouter();

  const dateText = new Date(item.date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const showComplianceWarning = item.isSornOrUntaxed || item.isUninsured;

  const onPress = () => {
    const base = `/vehicle-prep/${encodeURIComponent(item.vehicleId || "vehicle")}`;
    const params = new URLSearchParams({
      date: item.date,
      vehicleName: item.vehicleName || "",
      registration: item.registration || "",
      vehicleId: item.vehicleId || "",
    });
    router.push(`${base}?${params.toString()}`);
  };

  return (
    <TouchableOpacity style={styles.prepRow} activeOpacity={0.9} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.prepVehicleMain, { color: colors.text }]}>
          {item.vehicleName}
          {item.registration ? ` · ${item.registration}` : ""}
        </Text>
        <Text style={[styles.prepGoingOutText, { color: colors.textMuted }]}>
          Going out: {dateText}
        </Text>

        <View style={styles.prepBadgeRow}>
          {prepDone ? (
            <View style={styles.prepDoneBadge}>
              <Icon name="check-circle" size={12} color="#0b0b0b" />
              <Text style={styles.prepDoneText}>Prepped</Text>
            </View>
          ) : showComplianceWarning ? (
            <View style={styles.prepComplianceBad}>
              <Icon name="alert-triangle" size={12} color="#fff" />
              <Text style={styles.prepComplianceText}>CHECK TAX / INS</Text>
            </View>
          ) : (
            <View style={styles.prepComplianceOk}>
              <Icon name="check" size={12} color="#0b0b0b" />
              <Text style={styles.prepComplianceOkText}>Compliance OK</Text>
            </View>
          )}
        </View>
      </View>
      <Icon name="chevron-right" size={18} color={colors.textMuted} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  SCREEN                                    */
/* -------------------------------------------------------------------------- */

export default function JobDayScreen() {
  const router = useRouter();
  const { employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);

  // ✅ Holiday info (paid/unpaid)
  const [holidayInfo, setHolidayInfo] = useState({ onHoliday: false, payType: "paid" });

  // ✅ Bank holidays: date -> title
  const [bankHolidayMap, setBankHolidayMap] = useState({});

  // 👇 data for vehicle prep list (next 3 days)
  const [bookings, setBookings] = useState([]);
  const [vehiclesData, setVehiclesData] = useState([]);
  const [prepLoading, setPrepLoading] = useState(true);

  // vehicle prep completion status map: `${date}__${vehicleId}` -> true
  const [prepChecksMap, setPrepChecksMap] = useState({});

  const dateISO = useMemo(() => toISODate(selectedDate), [selectedDate]);

  // Fetch bank holidays once
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

  const bankHolidayTitle = useMemo(() => {
    if (!dateISO) return null;
    return bankHolidayMap?.[dateISO] || null;
  }, [bankHolidayMap, dateISO]);

  const loadAllEmployees = useCallback(async () => {
    const empSnap = await getDocs(collection(db, "employees"));
    return empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }, []);

  // Load vehicle check status for a list of job IDs (once per job)
  const loadVehicleChecksForJobs = useCallback(async (jobIds) => {
    const map = {};
    if (!jobIds || jobIds.length === 0) return map;

    const chunks = [];
    for (let i = 0; i < jobIds.length; i += 10) {
      chunks.push(jobIds.slice(i, i + 10));
    }

    for (const ids of chunks) {
      const vcSnap = await getDocs(
        query(collection(db, "vehicleChecks"), where("bookingId", "in", ids))
      );

      vcSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const bid = data.bookingId || data.jobId;
        if (bid) map[bid] = true;
      });
    }

    return map;
  }, []);

  const loadJobs = useCallback(async () => {
    if (loading || !isAuthed) return;

    const meCode = safeStr(employee?.userCode);
    const meName = safeStr(employee?.name || employee?.displayName);
    if (!meCode && !meName) {
      setJobs([]);
      setHolidayInfo({ onHoliday: false, payType: "paid" });
      return;
    }
    if (!dateISO) return;

    setBusy(true);
    try {
      const [allEmployees, jobsSnap, holSnap] = await Promise.all([
        loadAllEmployees(),
        getDocs(
          query(
            collection(db, "bookings"),
            where("bookingDates", "array-contains", dateISO)
          )
        ),
        getDocs(collection(db, "holidays")),
      ]);

      const bookings = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const holidays = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const todaysJobs = [];

      for (const job of bookings) {
        const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
        if (!dates.length) continue;

        const hasThisDate = dates.some((d) => toISODate(d) === dateISO);
        if (!hasThisDate) continue;

        const todaysEmps = getEmployeesForDate(job, dateISO, allEmployees);

        const isMineToday =
          (!!meCode && todaysEmps.some((r) => r.code === meCode)) ||
          (!!meName && todaysEmps.some((r) => safeStr(r.name) === meName));

        if (!isMineToday) continue;

        todaysJobs.push({
          ...job,
          employees: todaysEmps.map((r) => r.displayName).filter(Boolean),
        });
      }

      // vehicle check map
      const jobIds = todaysJobs.map((j) => j.id);
      const vehicleChecksMap = await loadVehicleChecksForJobs(jobIds);

      const jobsWithCheckFlag = todaysJobs.map((job) => ({
        ...job,
        vehicleChecked: !!vehicleChecksMap[job.id],
      }));

      setJobs(jobsWithCheckFlag);

      // ✅ Holiday (paid/unpaid) only applies when no jobs that day
      const hol = getApprovedHolidayForEmployeeOnDate(holidays, employee, dateISO);
      const isHolidayNoJobs = !!hol && jobsWithCheckFlag.length === 0;

      setHolidayInfo({
        onHoliday: isHolidayNoJobs,
        payType: hol ? getHolidayPayType(hol) : "paid",
      });
    } catch (err) {
      console.error("Error loading jobs:", err);
      setJobs([]);
      setHolidayInfo({ onHoliday: false, payType: "paid" });
    } finally {
      setBusy(false);
    }
  }, [
    employee?.userCode,
    employee?.name,
    isAuthed,
    loading,
    dateISO,
    loadAllEmployees,
    loadVehicleChecksForJobs,
    employee,
  ]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // 🔄 Load bookings + vehicles for Vehicle prep (next 3 days)
  useEffect(() => {
    const fetchData = async () => {
      try {
        setPrepLoading(true);
        const [bookingsSnap, vehiclesSnap] = await Promise.all([
          getDocs(collection(db, "bookings")),
          getDocs(collection(db, "vehicles")),
        ]);
        const bookingsData = bookingsSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        const vehiclesData = vehiclesSnap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setBookings(bookingsData);
        setVehiclesData(vehiclesData);
      } catch (err) {
        console.error("Failed to load data for vehicle prep:", err);
        setBookings([]);
        setVehiclesData([]);
      } finally {
        setPrepLoading(false);
      }
    };

    fetchData();
  }, []);

  // 🔄 Load prep completion status (runs on focus)
  const refreshPrepChecks = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "vehiclePrepChecks"));
      const map = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (data.date && data.vehicleId && data.completed) {
          const key = `${data.date}__${data.vehicleId}`;
          map[key] = true;
        }
      });
      setPrepChecksMap(map);
    } catch (err) {
      console.error("Failed to load vehicle prep checks:", err);
      setPrepChecksMap({});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPrepChecks();
    }, [refreshPrepChecks])
  );

  const prepItems = useMemo(() => {
    if (!bookings.length) return [];

    const today = startOfDay(new Date());
    const windowStart = startOfDay(addDays(today, 1)); // tomorrow
    const windowEnd = startOfDay(addDays(today, 3)); // next 3 days

    const validStatuses = new Set(["Confirmed"]); // confirmed jobs only
    const items = [];

    bookings.forEach((b) => {
      const status = b.status || "Confirmed";
      if (!validStatuses.has(status)) return;

      const days = getBookingDaysWithinWindow(b, windowStart, windowEnd);
      if (!days.length) return;

      const normVehicles = normalizeVehicles(b.vehicles || [], vehiclesData);
      if (!normVehicles.length) return;

      days.forEach((day) => {
        const dateKey = day.toISOString().split("T")[0];

        normVehicles.forEach((v) => {
          const name =
            v.name || [v.manufacturer, v.model].filter(Boolean).join(" ") || "Vehicle";
          const reg = v.registration || v.reg || v.plate || v.license || "";

          const taxStatus = v.taxStatus || "";
          const insuranceStatus = v.insuranceStatus || "";

          const tax = String(taxStatus).toLowerCase();
          const ins = String(insuranceStatus).toLowerCase();

          const isSornOrUntaxed = ["sorn", "untaxed", "no tax"].includes(tax);
          const isUninsured = ["not insured", "uninsured", "no insurance"].includes(ins);

          items.push({
            key: `${b.id}-${v.id || name}-${dateKey}`,
            bookingId: b.id,
            date: dateKey,
            dateObj: day,
            vehicleId: v.id || reg || name,
            vehicleName: name,
            registration: reg,
            taxStatus,
            insuranceStatus,
            isSornOrUntaxed,
            isUninsured,
          });
        });
      });
    });

    items.sort((a, b) => {
      if (a.dateObj.getTime() !== b.dateObj.getTime()) return a.dateObj - b.dateObj;
      return (a.vehicleName || "").localeCompare(b.vehicleName || "");
    });

    return items;
  }, [bookings, vehiclesData]);

  const prepByDate = useMemo(() => {
    if (!prepItems.length) return [];
    const map = new Map();
    prepItems.forEach((item) => {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date).push(item);
    });

    return Array.from(map.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([date, items]) => ({ date, items }));
  }, [prepItems]);

  const goPrevDay = () => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() - 1);
      return nd;
    });
  };

  const goNextDay = () => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + 1);
      return nd;
    });
  };

  const onRefresh = useCallback(() => {
    loadJobs();
    refreshPrepChecks();
  }, [loadJobs, refreshPrepChecks]);

  if (loading || !isAuthed) return null;

  const weekend = isWeekend(selectedDate);
  const isUnpaidHoliday = holidayInfo.onHoliday && holidayInfo.payType === "unpaid";

  // ✅ include Bank Holiday in status logic (only when no jobs and not on holiday)
  const dayStatus =
    jobs.length > 0
      ? "On Set"
      : holidayInfo.onHoliday
      ? isUnpaidHoliday
        ? "Unpaid Holiday"
        : "Holiday"
      : bankHolidayTitle
      ? "Bank Holiday"
      : weekend
      ? "Off"
      : "Yard";

  const statusColour =
    dayStatus === "On Set"
      ? colors.accent
      : dayStatus === "Holiday" || dayStatus === "Unpaid Holiday"
      ? colors.success
      : dayStatus === "Bank Holiday"
      ? "#a855f7" // purple
      : colors.textMuted;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {/* Top header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Today</Text>
        <Text style={[styles.headerDate, { color: colors.textMuted }]}>
          {selectedDate.toLocaleDateString("en-GB", DAY_FORMAT_LONG)}
        </Text>
      </View>

      {/* Date status pill */}
      <View style={styles.pillRow}>
        <View
          style={[
            styles.datePill,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.pillDateText, { color: colors.textMuted }]}>
            {selectedDate.toLocaleDateString("en-GB", {
              weekday: "short",
              day: "2-digit",
              month: "short",
            })}
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            {
              borderColor: isUnpaidHoliday ? "#FFD60A" : statusColour,
              backgroundColor: colors.surfaceAlt,
            },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isUnpaidHoliday ? "#FFD60A" : statusColour },
            ]}
          />
          <Text style={[styles.statusText, { color: colors.text }]}>{dayStatus}</Text>
        </View>

        {/* ✅ optional: show the bank holiday name as a tiny pill */}
        {bankHolidayTitle && jobs.length === 0 && !holidayInfo.onHoliday && (
          <View style={[styles.bankHolidayPill, { borderColor: "#a855f7" }]}>
            <Icon name="flag" size={12} color="#a855f7" />
            <Text style={styles.bankHolidayPillText} numberOfLines={1}>
              {bankHolidayTitle}
            </Text>
          </View>
        )}
      </View>

      {/* Day navigation */}
      <View style={[styles.dayHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={goPrevDay} disabled={busy} style={styles.dayNavButton}>
          <Icon name="chevron-left" size={22} color={busy ? colors.textMuted : colors.text} />
        </TouchableOpacity>
        <Text style={[styles.dayTitle, { color: colors.text }]}>
          {selectedDate.toLocaleDateString("en-GB", DAY_FORMAT_SHORT)}
        </Text>
        <TouchableOpacity onPress={goNextDay} disabled={busy} style={styles.dayNavButton}>
          <Icon name="chevron-right" size={22} color={busy ? colors.textMuted : colors.text} />
        </TouchableOpacity>
      </View>

      {/* Body */}
      <ScrollView
        contentContainerStyle={styles.scrollViewContent}
        refreshControl={
          <RefreshControl refreshing={busy} onRefresh={onRefresh} tintColor={colors.text} />
        }
      >
        {busy && jobs.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>
              Updating your day…
            </Text>
          </View>
        ) : jobs.length > 0 ? (
          jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              dateISO={dateISO}
              router={router}
              colors={colors}
              vehiclesData={vehiclesData}
            />
          ))
        ) : holidayInfo.onHoliday ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.bigIconWrap, { backgroundColor: "#102917" }]}>
              <Icon name="umbrella" size={26} color={colors.success} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {isUnpaidHoliday ? "Unpaid Holiday" : "Holiday"}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              {isUnpaidHoliday
                ? "You’re on approved unpaid leave for this date."
                : "You’re on approved leave for this date."}
            </Text>
          </View>
        ) : bankHolidayTitle ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.bigIconWrap, { backgroundColor: "#221032" }]}>
              <Icon name="flag" size={26} color="#a855f7" />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Bank Holiday</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              {bankHolidayTitle}
            </Text>
          </View>
        ) : weekend ? (
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={[styles.bigIconWrap, { backgroundColor: colors.surfaceAlt }]}>
              <Icon name="sun" size={26} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>Weekend</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
              No bookings assigned. Enjoy the day.
            </Text>
          </View>
        ) : (
          <>
            {/* Yard status card */}
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.bigIconWrap, { backgroundColor: colors.surfaceAlt }]}>
                <Icon name="home" size={26} color={colors.textMuted} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Yard Based</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                You’re not scheduled on a job for this day.
              </Text>
            </View>

            {/* 🚚 Vehicle prep – next 3 days (only when Yard) */}
            <View style={styles.prepSectionHeaderRow}>
              <Text style={[styles.prepSectionTitle, { color: colors.text }]}>
                Vehicle prep — next 3 days
              </Text>
              <Text style={[styles.prepSectionSubtitle, { color: colors.textMuted }]}>
                Confirmed jobs only · starts from tomorrow.
              </Text>
            </View>

            <View
              style={[
                styles.prepCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {prepLoading ? (
                <View style={styles.serviceLoadingRow}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={[styles.serviceLoadingText, { color: colors.textMuted }]}>
                    Pulling vehicles for the next 3 days…
                  </Text>
                </View>
              ) : prepByDate.length === 0 ? (
                <View style={styles.emptyServiceState}>
                  <Icon name="truck" size={18} color={colors.textMuted} />
                  <Text style={[styles.emptyServiceText, { color: colors.textMuted }]}>
                    No confirmed vehicles going out in the next 3 days.
                  </Text>
                </View>
              ) : (
                prepByDate.map((group) => {
                  const label = new Date(group.date).toLocaleDateString("en-GB", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                  });

                  return (
                    <View key={group.date} style={{ marginBottom: 10 }}>
                      <Text style={styles.prepDateLabel}>{label}</Text>
                      {group.items.map((item) => {
                        const prepKey = `${item.date}__${item.vehicleId}`;
                        return (
                          <VehiclePrepRow
                            key={item.key}
                            item={item}
                            colors={colors}
                            prepDone={!!prepChecksMap[prepKey]}
                          />
                        );
                      })}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  /* Header */
  header: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === "android" ? 26 : 14,
    paddingBottom: 8,
  },
  headerTitle: { fontSize: 26, fontWeight: "900", letterSpacing: 0.4 },
  headerDate: { fontSize: 13, marginTop: 4 },

  /* Status pills */
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    marginTop: 6,
    marginBottom: 4,
    gap: 8,
    flexWrap: "wrap",
  },
  datePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillDateText: { fontSize: 13, fontWeight: "600" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: "700" },

  bankHolidayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: "#16091f",
    maxWidth: "55%",
  },
  bankHolidayPillText: { color: "#e9d5ff", fontSize: 12, fontWeight: "800" },

  /* Day navigation */
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayNavButton: { padding: 4, borderRadius: 999 },
  dayTitle: { fontSize: 17, fontWeight: "700" },

  /* Scroll content */
  scrollViewContent: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 30 },

  /* Job Card */
  jobCard: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  jobDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  jobTitle: { fontSize: 17, fontWeight: "800", letterSpacing: 0.4 },
  callBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  callBadgeText: { color: "#111111", fontWeight: "800", fontSize: 13 },

  detailsContainer: { paddingTop: 10, marginBottom: 8 },
  jobLine: { fontSize: 14, marginBottom: 4 },
  jobLabel: { fontWeight: "600" },
  jobValue: { fontWeight: "600" },

  noteBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 10,
    borderRadius: 12,
    marginTop: 6,
    marginBottom: 12,
    borderWidth: 1,
  },
  noteText: { fontSize: 14, flexShrink: 1 },
  noteLabel: { fontWeight: "700" },
  noteBody: {},

  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
    alignItems: "center",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    flex: 1,
    minWidth: 150,
  },
  actionText: { fontWeight: "700", fontSize: 14 },

  /* Empty / Holiday / Weekend cards */
  emptyCard: {
    marginTop: 18,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    borderWidth: 1,
  },
  bigIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  emptySubtitle: { fontSize: 14, textAlign: "center" },

  /* Loading */
  loadingWrap: { paddingTop: 40, alignItems: "center" },
  loadingText: { fontSize: 13, marginTop: 10 },

  /* VEHICLE PREP section on Yard days */
  prepSectionHeaderRow: {
    marginTop: 22,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  prepSectionTitle: { fontSize: 15, fontWeight: "700" },
  prepSectionSubtitle: { fontSize: 12 },
  prepCard: { borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1 },
  prepDateLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#E0E0E0",
    marginBottom: 4,
  },
  prepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#333333",
  },
  prepVehicleMain: { fontSize: 14, fontWeight: "700" },
  prepGoingOutText: { fontSize: 12, marginTop: 2 },
  prepBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },

  prepComplianceBad: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#e53935",
    borderWidth: 1,
    borderColor: "#0b0b0b",
    gap: 4,
  },
  prepComplianceText: { fontSize: 10, fontWeight: "800", color: "#fff" },

  prepComplianceOk: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#7AFE6E",
    borderWidth: 1,
    borderColor: "#0b0b0b",
    gap: 4,
  },
  prepComplianceOkText: { fontSize: 10, fontWeight: "800", color: "#0b0b0b" },

  serviceLoadingRow: { flexDirection: "row", alignItems: "center" },
  serviceLoadingText: { marginLeft: 8, fontSize: 13 },
  emptyServiceState: { flexDirection: "row", alignItems: "center" },
  emptyServiceText: { marginLeft: 6, fontSize: 13 },

  prepDoneBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#7AFE6E",
    borderWidth: 1,
    borderColor: "#0b0b0b",
    gap: 4,
  },
  prepDoneText: { fontSize: 10, fontWeight: "800", color: "#0b0b0b" },
});
