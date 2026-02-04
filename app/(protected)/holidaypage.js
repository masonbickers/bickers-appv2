// app/holidaypage.js
import { useRouter } from "expo-router";
import { collection, deleteDoc, doc, getDocs, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
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

/* ─────────────────────────── Helpers ─────────────────────────── */
const norm = (v) => String(v ?? "").trim().toLowerCase();

/** Parse "YYYY-MM-DD" safely at local midnight (no TZ shift). */
const parseYMD = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const [, Y, M, D] = m.map(Number);
  return new Date(Y, M - 1, D, 0, 0, 0, 0);
};

/** Safer Firestore -> Date conversion (prefers strict YMD). */
const toDate = (v) => {
  if (!v) return null;
  if (typeof v === "string") {
    const strict = parseYMD(v);
    if (strict) return strict;
    const d = new Date(v);
    return Number.isNaN(+d) ? null : d;
  }
  if (typeof v?.toDate === "function") return v.toDate(); // Firestore Timestamp
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(+d) ? null : d;
  }
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
};

const eachDateInclusive = (start, end) => {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const out = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
};

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

const countBusinessDaysInclusive = (start, end, isBankHolidayFn = null) =>
  eachDateInclusive(start, end).filter((d) => {
    if (isWeekend(d)) return false;
    if (isBankHolidayFn && isBankHolidayFn(d)) return false; // ✅ exclude bank holidays too
    return true;
  }).length;

const fmt = (d) =>
  !d
    ? "—"
    : d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      });

/* Half-day detection & rendering */
const normaliseAMPM = (v) => {
  const s = String(v || "").trim().toUpperCase();
  if (["AM", "A.M.", "MORNING"].includes(s)) return "AM";
  if (["PM", "P.M.", "AFTERNOON"].includes(s)) return "PM";
  return null;
};

function boolish(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = norm(v);
  return s === "true" || s === "1" || s === "yes";
}

/**
 * ✅ Updated to match the schema you now save from the app + web:
 * - startHalfDay: boolean
 * - startAMPM: "AM" | "PM" | null
 * - endHalfDay: boolean
 * - endAMPM: "AM" | "PM" | null
 */
function getHalfMeta(h) {
  const startHalfFlag = boolish(h.startHalfDay ?? h.startHalf ?? h.startHalfday);
  const endHalfFlag = boolish(h.endHalfDay ?? h.endHalf ?? h.endHalfday);

  const startAMPM = normaliseAMPM(h.startAMPM ?? h.startPeriod ?? h.halfDayPeriod ?? h.halfDayType);
  const endAMPM = normaliseAMPM(h.endAMPM ?? h.endPeriod);

  // legacy single-half flag (kept for backward compatibility)
  const legacySingleHalf =
    boolish(h.halfDay) || boolish(h.isHalfDay) || boolish(h.isHalf) || boolish(h.half);

  return { startHalfFlag, endHalfFlag, startAMPM, endAMPM, legacySingleHalf };
}

// Compute business-day length with half-day adjustments (excludes weekends + bank holidays)
function computeDays(h, isBankHolidayFn = null) {
  const s = toDate(h.startDate);
  const e = toDate(h.endDate) || s;
  if (!s || !e) return 0;

  const { startHalfFlag, endHalfFlag, startAMPM, endAMPM, legacySingleHalf } = getHalfMeta(h);

  const businessDays = countBusinessDaysInclusive(s, e, isBankHolidayFn);

  // Single-day holiday
  const isSingle = s.toDateString() === e.toDateString();
  if (isSingle) {
    const isNonWorking =
      isWeekend(s) || (isBankHolidayFn ? isBankHolidayFn(s) : false);
    if (isNonWorking) return 0;

    const anyHalf =
      startHalfFlag ||
      endHalfFlag ||
      !!startAMPM ||
      !!endAMPM ||
      legacySingleHalf;

    return anyHalf ? 0.5 : 1;
  }

  // Multi-day holiday
  let reduction = 0;

  // Start day half = reduce 0.5 (only if start is a business day)
  if ((startHalfFlag || !!startAMPM) && businessDays > 0) {
    const startIsBusiness =
      !isWeekend(s) && !(isBankHolidayFn ? isBankHolidayFn(s) : false);
    if (startIsBusiness) reduction += 0.5;
  }

  // End day half = reduce 0.5 (only if end is a business day)
  if ((endHalfFlag || !!endAMPM) && businessDays > 0) {
    const endIsBusiness =
      !isWeekend(e) && !(isBankHolidayFn ? isBankHolidayFn(e) : false);
    if (endIsBusiness) reduction += 0.5;
  }

  // Legacy “halfDay” without start/end hint: apply a single 0.5 reduction
  if (reduction === 0 && legacySingleHalf && businessDays > 0) reduction += 0.5;

  return Math.max(0, Number((businessDays - reduction).toFixed(1)));
}

// Date cell text with AM/PM suffix if applicable
function renderDateWithHalf(d, which, h) {
  if (!d) return "—";
  const dateText = fmt(d);

  const { startHalfFlag, endHalfFlag, startAMPM, endAMPM, legacySingleHalf } = getHalfMeta(h);

  const s = toDate(h.startDate);
  const e = toDate(h.endDate) || s;
  const isSingle = s && e && s.toDateString() === e.toDateString();

  if (which === "start") {
    if (startAMPM) return `${dateText} (${startAMPM})`;
    if (isSingle && (startHalfFlag || legacySingleHalf)) return `${dateText} (Half)`;
  }

  if (which === "end") {
    if (endAMPM) return `${dateText} (${endAMPM})`;
    if (isSingle && endHalfFlag) return `${dateText} (Half)`;
  }

  return dateText;
}

function displayTypeAndColor(h) {
  let displayType = "Other";
  let typeColor = "#22d3ee";
  const typeStr = (h.leaveType || h.paidStatus || "").toLowerCase();

  if (h.isAccrued || typeStr.includes("accrued") || typeStr.includes("toil")) {
    displayType = "Accrued";
    typeColor = "#38bdf8";
  } else if (h.isUnpaid || typeStr.includes("unpaid") || h.paid === false) {
    displayType = "Unpaid";
    typeColor = "#f87171";
  } else if (h.paid || typeStr.includes("paid")) {
    displayType = "Paid";
    typeColor = "#29bc5f";
  } else {
    // default: treat as paid if not explicitly unpaid/accrued
    displayType = "Paid";
    typeColor = "#29bc5f";
  }
  return { displayType, typeColor };
}

/* ───────────────────── Year helpers ───────────────────── */
function yearKey(y) {
  return String(y);
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getAllowanceForYear(emp, y) {
  const Y = yearKey(y);

  const holidayAllowances = emp?.holidayAllowances || emp?.holidayAllowanceByYear || {};
  const carryoverByYear = emp?.carryoverByYear || emp?.carryOverByYear || emp?.carriedOverByYear || {};

  const allowance =
    numOrZero(holidayAllowances?.[Y]) ||
    numOrZero(emp?.holidayAllowance); // fallback

  const carryOver =
    numOrZero(carryoverByYear?.[Y]) ||
    numOrZero(emp?.carriedOverDays) || // fallback
    numOrZero(emp?.carryOverDays);

  return { allowance, carryOver };
}

// holiday intersects year?
function holidayTouchesYear(h, y) {
  const s = toDate(h.startDate);
  const e = toDate(h.endDate) || s;
  if (!s || !e) return false;

  const startOfYear = new Date(y, 0, 1);
  const endOfYear = new Date(y, 11, 31);

  return e >= startOfYear && s <= endOfYear;
}

/* ───────────────────────────── Component ───────────────────────────── */
export default function HolidayPage() {
  const router = useRouter();
  const { employee, user, isAuthed, loading } = useAuth();
  const { colors } = useTheme();

  const [employeeData, setEmployeeData] = useState(null);
  const [holidays, setHolidays] = useState([]);

  // ✅ Lock to current year only (no selector UI)
  const currentYear = new Date().getFullYear();
  const selectedYear = currentYear;

  // ✅ Bank holidays (UK Gov JSON) for current year
  const [bankHolidaySet, setBankHolidaySet] = useState(() => new Set());

  const isBankHoliday = useMemo(() => {
    return (d) => {
      if (!d) return false;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return bankHolidaySet.has(`${y}-${m}-${day}`);
    };
  }, [bankHolidaySet]);

  useEffect(() => {
    const controller = new AbortController();

    const loadBankHolidays = async () => {
      try {
        const REGION = "england-and-wales"; // "scotland" | "northern-ireland"
        const res = await fetch("https://www.gov.uk/bank-holidays.json", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Bank holidays fetch failed: ${res.status}`);
        const json = await res.json();
        const list = json?.[REGION]?.events || [];

        const set = new Set(
          list
            .map((ev) => {
              const d = parseYMD(ev?.date);
              if (!d) return null;
              if (d.getFullYear() !== Number(currentYear)) return null;
              const y = d.getFullYear();
              const m = String(d.getMonth() + 1).padStart(2, "0");
              const day = String(d.getDate()).padStart(2, "0");
              return `${y}-${m}-${day}`;
            })
            .filter(Boolean)
        );

        setBankHolidaySet(set);
      } catch (e) {
        if (e?.name === "AbortError") return;
        console.warn("Bank holidays unavailable:", e);
        setBankHolidaySet(new Set());
      }
    };

    loadBankHolidays();
    return () => controller.abort();
  }, [currentYear]);

  useEffect(() => {
    let unsubscribe = null;

    const fetchData = async () => {
      if (loading || !isAuthed) {
        setEmployeeData(null);
        setHolidays([]);
        return;
      }

      const empSnap = await getDocs(collection(db, "employees"));
      const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      let empRecord = null;
      const email = (employee?.email || user?.email || "").trim().toLowerCase();

      if (employee?.userCode) {
        empRecord =
          employees.find((e) => e.userCode === employee.userCode) ||
          employees.find((e) => (e.email || "").trim().toLowerCase() === email);
      } else if (email) {
        empRecord = employees.find((e) => (e.email || "").trim().toLowerCase() === email);
      }

      if (!empRecord) {
        setEmployeeData(null);
        setHolidays([]);
        return;
      }

      setEmployeeData(empRecord);

      const holRef = collection(db, "holidays");
      unsubscribe = onSnapshot(holRef, (snapshot) => {
        const allHolidays = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        const myHolidays = allHolidays.filter(
          (h) => h.employee === empRecord.name || h.employeeCode === empRecord.userCode
        );
        setHolidays(myHolidays);
      });
    };

    fetchData();
    return () => unsubscribe && unsubscribe();
  }, [loading, isAuthed, employee, user]);

  const cancelHoliday = async (id) => {
    try {
      await deleteDoc(doc(db, "holidays", id));
      alert("Holiday request cancelled");
    } catch (err) {
      console.error("Error cancelling holiday:", err.message, err);
      alert("Failed to cancel holiday: " + err.message);
    }
  };

  const holidaysForYear = useMemo(() => {
    return (holidays || []).filter((h) => holidayTouchesYear(h, selectedYear));
  }, [holidays, selectedYear]);

  /* ✅ Summary calc (CURRENT YEAR ONLY) */
  const calc = () => {
    let paid = 0,
      unpaid = 0,
      accruedTaken = 0,
      accruedEarned = 0;

    holidaysForYear.forEach((h) => {
      const status = norm(h.status);
      if (status !== "approved") return;

      const days = computeDays(h, isBankHoliday);
      const { displayType } = displayTypeAndColor(h);

      if (displayType === "Paid") paid += days;
      else if (displayType === "Unpaid") unpaid += days;
      else if (displayType === "Accrued") accruedTaken += days;
    });

    const { allowance, carryOver } = getAllowanceForYear(employeeData, selectedYear);
    const totalAllowance = allowance + carryOver;

    const accruedBalance = accruedEarned - accruedTaken;
    const allowanceBalance = totalAllowance - paid;

    return {
      paid,
      unpaid,
      accruedEarned,
      accruedTaken,
      accruedBalance,
      allowance,
      carryOver,
      totalAllowance,
      allowanceBalance,
    };
  };

  const {
    paid,
    unpaid,
    accruedEarned,
    accruedTaken,
    accruedBalance,
    allowance,
    carryOver,
    totalAllowance,
    allowanceBalance,
  } = calc();

  // ✅ Make status filtering case-insensitive
  const requestedHolidays = holidaysForYear.filter((h) => {
    const st = norm(h.status);
    return !st || st === "requested";
  });

  const confirmedHolidays = holidaysForYear.filter((h) => norm(h.status) === "approved");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingConfirmed = confirmedHolidays
    .filter((h) => {
      const end = toDate(h.endDate) || toDate(h.startDate);
      return end && end >= today;
    })
    .sort((a, b) => toDate(a.startDate) - toDate(b.startDate));

  const pastConfirmed = confirmedHolidays
    .filter((h) => {
      const end = toDate(h.endDate) || toDate(h.startDate);
      return end && end < today;
    })
    .sort((a, b) => toDate(a.startDate) - toDate(b.startDate));

  const pastPaidUsed = pastConfirmed.reduce((sum, h) => {
    const { displayType } = displayTypeAndColor(h);
    return displayType === "Paid" ? sum + computeDays(h, isBankHoliday) : sum;
  }, 0);

  const remainingAfterPast = totalAllowance - pastPaidUsed;

  // ✅ Notes field compatibility: app/web save "holidayReason", older UI might have "notes"
  const getNotes = (h) => {
    const v = h.holidayReason ?? h.notes ?? h.reason ?? "";
    return String(v || "").trim();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={[
            styles.topBarBtn,
            { backgroundColor: colors.background, borderColor: colors.background },
          ]}
          onPress={() => router.back()}
        >
          <Icon name="arrow-left" size={18} color={colors.text} />
          <Text style={[styles.topBarBtnText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.topBarBtn, styles.primaryBtn]}
          onPress={() => router.push("/holiday-request")}
        >
          <Icon name="plus" size={18} color="#000" />
          <Text style={[styles.topBarBtnText, { color: "#000", fontWeight: "800" }]}>
            Request
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
      >
        {employeeData && (
          <>
            {/* Header Card */}
            <View
              style={[
                styles.headerCard,
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.headerName, { color: colors.text }]}>
                {employeeData.name}
              </Text>

              <View style={styles.pillsWrap}>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.pillLabel, { color: colors.textMuted }]}>
                    Allowance ({selectedYear})
                  </Text>
                  <Text style={[styles.pillValue, { color: colors.text }]}>{allowance}</Text>
                </View>

                <View
                  style={[
                    styles.pill,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.pillLabel, { color: colors.textMuted }]}>
                    Carry Over ({selectedYear})
                  </Text>
                  <Text style={[styles.pillValue, { color: colors.text }]}>{carryOver}</Text>
                </View>

                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor: colors.surface,
                      borderColor: allowanceBalance < 0 ? "#ef4444" : "#16a34a",
                    },
                  ]}
                >
                  <Text style={[styles.pillLabel, { color: colors.textMuted }]}>
                    Left ({selectedYear})
                  </Text>
                  <Text
                    style={[
                      styles.pillValue,
                      { color: allowanceBalance < 0 ? "#ef4444" : "#16a34a" },
                    ]}
                  >
                    {Number(allowanceBalance.toFixed(1))}
                  </Text>
                </View>
              </View>
            </View>

            {/* Stats Grid */}
            <View style={styles.statsGrid}>
              <Stat
                label="Paid Used"
                value={`${Number(paid.toFixed(1))}/${totalAllowance}`}
                color="#60a5fa"
              />
              <Stat label="Unpaid" value={Number(unpaid.toFixed(1))} color="#f87171" />
            </View>

            {/* Requested Holidays */}
            <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Requested Holidays ({selectedYear})
              </Text>

              <View style={[styles.table, { borderColor: colors.border }]}>
                <View style={[styles.tableHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.th, { flex: 1.3, color: colors.text }]}>Date From</Text>
                  <Text style={[styles.th, { flex: 1.3, color: colors.text }]}>Date To</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Days</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Type</Text>
                  <Text style={[styles.th, { flex: 1.5, color: colors.text }]}>Notes</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Status</Text>
                </View>

                {requestedHolidays.length === 0 ? (
                  <Text style={[styles.tableEmpty, { color: colors.textMuted }]}>No requested holidays.</Text>
                ) : (
                  requestedHolidays
                    .slice()
                    .sort((a, b) => toDate(a.startDate) - toDate(b.startDate))
                    .map((h) => {
                      const s = toDate(h.startDate);
                      const e = toDate(h.endDate) || s;

                      // ✅ weekdays-only + excludes bank holidays + supports half days
                      const days = computeDays(h, isBankHoliday);

                      const { displayType, typeColor } = displayTypeAndColor(h);
                      const notesText = getNotes(h) || "-";

                      return (
                        <View key={h.id} style={[styles.tableBlock, { backgroundColor: colors.surface }]}>
                          <View style={styles.tableRow}>
                            <Text style={[styles.td, { flex: 1.3, color: colors.text }]}>
                              {renderDateWithHalf(s, "start", h)}
                            </Text>
                            <Text style={[styles.td, { flex: 1.3, color: colors.text }]}>
                              {renderDateWithHalf(e, "end", h)}
                            </Text>
                            <Text style={[styles.td, { color: colors.text }]}>{days}</Text>
                            <Text style={[styles.td, { color: typeColor, fontWeight: "700" }]}>{displayType}</Text>
                            <Text style={[styles.td, { flex: 1.5, color: colors.text }]}>{notesText}</Text>
                            <Text style={[styles.td, { color: "#fde047", fontWeight: "800" }]}>Requested</Text>
                          </View>

                          <View style={styles.tableActions}>
                            <TouchableOpacity style={styles.cancelButton} onPress={() => cancelHoliday(h.id)}>
                              <Icon name="x-circle" size={14} color="#fff" />
                              <Text style={styles.cancelButtonText}>Cancel Request</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                )}
              </View>
            </View>

            {/* Upcoming Confirmed Holidays */}
            <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Upcoming Confirmed Holidays ({selectedYear})
              </Text>

              <View style={[styles.table, { borderColor: colors.border }]}>
                <View style={[styles.tableHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.th, { flex: 1.3, color: colors.text }]}>Date From</Text>
                  <Text style={[styles.th, { flex: 1.3, color: colors.text }]}>Date To</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Days</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Type</Text>
                  <Text style={[styles.th, { flex: 1.5, color: colors.text }]}>Notes</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Left</Text>
                </View>

                {upcomingConfirmed.length === 0 ? (
                  <Text style={[styles.tableEmpty, { color: colors.textMuted }]}>No upcoming confirmed holidays.</Text>
                ) : (
                  (() => {
                    let projected = remainingAfterPast;
                    return upcomingConfirmed.map((h) => {
                      const s = toDate(h.startDate);
                      const e = toDate(h.endDate) || s;
                      const days = computeDays(h, isBankHoliday);
                      const { displayType, typeColor } = displayTypeAndColor(h);
                      const notesText = getNotes(h) || "-";

                      if (displayType === "Paid") projected -= days;

                      return (
                        <View key={h.id} style={[styles.tableRow, { backgroundColor: colors.surface }]}>
                          <Text style={[styles.td, { flex: 1.3, color: colors.text }]}>
                            {renderDateWithHalf(s, "start", h)}
                          </Text>
                          <Text style={[styles.td, { flex: 1.3, color: colors.text }]}>
                            {renderDateWithHalf(e, "end", h)}
                          </Text>
                          <Text style={[styles.td, { color: colors.text }]}>{days}</Text>
                          <Text style={[styles.td, { color: typeColor, fontWeight: "700" }]}>{displayType}</Text>
                          <Text style={[styles.td, { flex: 1.5, color: colors.text }]}>{notesText}</Text>
                          <Text style={[styles.td, { color: colors.text }]}>{Number(projected.toFixed(1))}</Text>
                        </View>
                      );
                    });
                  })()
                )}
              </View>
            </View>

            {/* Confirmed Holidays (Past) */}
            <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Confirmed Holidays (Past) ({selectedYear})
              </Text>

              <View style={[styles.table, { borderColor: colors.border }]}>
                <View style={[styles.tableHeader, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[styles.th, { flex: 1.3, color: colors.text }]}>Date From</Text>
                  <Text style={[styles.th, { flex: 1.3, color: colors.text }]}>Date To</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Days</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Type</Text>
                  <Text style={[styles.th, { flex: 1.5, color: colors.text }]}>Notes</Text>
                  <Text style={[styles.th, { color: colors.text }]}>Balance</Text>
                </View>

                {pastConfirmed.length === 0 ? (
                  <Text style={[styles.tableEmpty, { color: colors.textMuted }]}>No past confirmed holidays.</Text>
                ) : (
                  (() => {
                    let runningBalance = totalAllowance;
                    return pastConfirmed.map((h) => {
                      const s = toDate(h.startDate);
                      const e = toDate(h.endDate) || s;
                      const days = computeDays(h, isBankHoliday);
                      const { displayType, typeColor } = displayTypeAndColor(h);
                      const notesText = getNotes(h) || "-";

                      if (displayType === "Paid") runningBalance -= days;

                      return (
                        <View key={h.id} style={[styles.tableRow, { backgroundColor: colors.surface }]}>
                          <Text style={[styles.td, { flex: 1.3, color: colors.text }]}>
                            {renderDateWithHalf(s, "start", h)}
                          </Text>
                          <Text style={[styles.td, { flex: 1.3, color: colors.text }]}>
                            {renderDateWithHalf(e, "end", h)}
                          </Text>
                          <Text style={[styles.td, { color: colors.text }]}>{days}</Text>
                          <Text style={[styles.td, { color: typeColor, fontWeight: "700" }]}>{displayType}</Text>
                          <Text style={[styles.td, { flex: 1.5, color: colors.text }]}>{notesText}</Text>
                          <Text style={[styles.td, { color: colors.text }]}>{Number(runningBalance.toFixed(1))}</Text>
                        </View>
                      );
                    });
                  })()
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ─────────────────────────── UI subcomponent ─────────────────────────── */
function Stat({ label, value, color }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statBox, { borderColor: color }]}>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

/* ────────────────────────────── Styles ────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0b" },

  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topBarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#151515",
  },
  topBarBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  primaryBtn: { backgroundColor: "#fde047", borderColor: "#fde047" },

  headerCard: {
    backgroundColor: "#111111",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  headerName: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "center",
  },
  pillsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  pill: {
    flexGrow: 1,
    minWidth: "45%",
    borderWidth: 1,
    borderColor: "#2b2b2b",
    backgroundColor: "#161616",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  pillLabel: { color: "#cfcfcf", fontSize: 12 },
  pillValue: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 2 },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  statBox: {
    backgroundColor: "#131313",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexBasis: "48%",
  },
  statLabel: { color: "#cfcfcf", fontSize: 12 },
  statValue: { fontSize: 18, fontWeight: "800", marginTop: 2 },

  card: {
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "left",
  },

  table: {
    borderTopWidth: 1,
    borderColor: "#222",
    borderRadius: 10,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#171717",
    borderBottomWidth: 1,
    borderColor: "#222",
  },
  th: {
    flex: 1,
    color: "#eee",
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: 10,
    fontSize: 12,
  },
  tableEmpty: { color: "#aaa", paddingVertical: 12, textAlign: "center" },

  tableBlock: {
    borderBottomWidth: 1,
    borderColor: "#222",
    backgroundColor: "#0f0f0f",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 6,
  },
  td: {
    flex: 1,
    color: "#d1d1d1",
    textAlign: "center",
    fontSize: 12,
  },

  tableActions: {
    paddingHorizontal: 6,
    paddingBottom: 8,
    alignItems: "flex-end",
  },
  cancelButton: {
    backgroundColor: "#ef4444",
    borderWidth: 1,
    borderColor: "#ef4444",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cancelButtonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});
