// app/holidaypage.js
import { useRouter } from "expo-router";
import { collection, deleteDoc, doc, getDocs, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { auth, db } from "../../firebaseConfig";

/* ─────────────────────────── Helpers ─────────────────────────── */
const eachDateInclusive = (start, end) => {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const out = [];
  for (let d = s; d <= e; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
};
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const countWeekdaysInclusive = (start, end) =>
  eachDateInclusive(start, end).filter((d) => !isWeekend(d)).length;

const toDate = (v) => {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
};

const fmt = (d) =>
  !d
    ? "—"
    : d.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      });

/* Half-day detection & rendering
   Supports:
   - h.halfDay / h.isHalfDay / h.half === true
   - h.halfDayType / h.half / h.period → "AM"|"PM"
   - start/end variants: startHalf, startHalfDay, startAMPM, startPeriod
                         endHalf,   endHalfDay,   endAMPM,   endPeriod
   - h.halfDayAt: "start" | "end"
*/
const normaliseAMPM = (v) => {
  const s = String(v || "").trim().toUpperCase();
  if (["AM", "A.M.", "MORNING", "AM/PM AM"].includes(s)) return "AM";
  if (["PM", "P.M.", "AFTERNOON", "AM/PM PM"].includes(s)) return "PM";
  return null;
};

function getHalfMeta(h) {
  const singleHalfFlag = !!(h.halfDay || h.isHalfDay || h.half === true);

  const startHint =
    h.startHalf ??
    h.startHalfDay ??
    h.startAMPM ??
    h.startPeriod ??
    (h.halfDayAt === "start" ? h.halfDayType || h.half : null);

  const endHint =
    h.endHalf ??
    h.endHalfDay ??
    h.endAMPM ??
    h.endPeriod ??
    (h.halfDayAt === "end" ? h.halfDayType || h.half : null);

  let startAMPM = normaliseAMPM(startHint);
  let endAMPM = normaliseAMPM(endHint);

  // If only one generic "half" type exists, map it onto start/end based on halfDayAt or default to start.
  const genericAMPM = normaliseAMPM(h.halfDayType || h.half || h.period);
  if (!startAMPM && !endAMPM && genericAMPM) {
    if (h.halfDayAt === "end") endAMPM = genericAMPM;
    else startAMPM = genericAMPM; // default to start
  }

  return {
    singleHalfFlag,
    startAMPM, // "AM" | "PM" | null
    endAMPM,   // "AM" | "PM" | null
  };
}

// Compute business-day length with half-day adjustments
function computeDays(h) {
  const s = toDate(h.startDate);
  const e = toDate(h.endDate) || s;
  if (!s || !e) return 0;

  const { singleHalfFlag, startAMPM, endAMPM } = getHalfMeta(h);

  // Base business days
  let days = countWeekdaysInclusive(s, e);

  // Single-day case
  if (s.toDateString() === e.toDateString()) {
    if (h.halfDay || h.isHalfDay || startAMPM || endAMPM) return 0.5;
    return days; // 0 or 1 (weekday) depending on date; our base handles weekend=0 already
  }

  // Multi-day: subtract halves at start/end if present
  let reduction = 0;
  if (startAMPM) reduction += 0.5;
  if (endAMPM) reduction += 0.5;

  // If only a generic "halfDay" flag exists (and no start/end AM/PM specified), subtract 0.5 once
  if (reduction === 0 && (h.halfDay || h.isHalfDay)) reduction += 0.5;

  return Math.max(0, Number((days - reduction).toFixed(1)));
}

// Date cell text with AM/PM suffix if applicable
function renderDateWithHalf(d, which, h) {
  const { singleHalfFlag, startAMPM, endAMPM } = getHalfMeta(h);
  const dateText = fmt(d);

  if (!d) return "—";

  if (which === "start" && startAMPM) return `${dateText} (${startAMPM})`;
  if (which === "end" && endAMPM) return `${dateText} (${endAMPM})`;

  // Single-day, generic half with no explicit side — show "(Half)"
  const s = toDate(h.startDate);
  const e = toDate(h.endDate) || s;
  const isSingle = s && e && s.toDateString() === e.toDateString();

  if (singleHalfFlag && isSingle && (which === "start" || which === "end")) {
    // Only annotate once for readability
    if (which === "start") return `${dateText} (Half)`;
  }

  return dateText;
}

const isPaidType = (h) => {
  const typeStr = (h.leaveType || h.paidStatus || "").toLowerCase();
  const isAccrued =
    h.isAccrued === true ||
    typeStr.includes("accrued") ||
    typeStr.includes("toil");
  const isUnpaid =
    h.isUnpaid === true ||
    h.unpaid === true ||
    h.paid === false ||
    typeStr.includes("unpaid");
  return !isAccrued && !isUnpaid; // treat as paid by default
};

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
  } else if (h.paid || typeStr.includes("paid") || isPaidType(h)) {
    displayType = "Paid";
    typeColor = "#86efac";
  }
  return { displayType, typeColor };
}

/* ───────────────────────────── Component ───────────────────────────── */
export default function HolidayPage() {
  const router = useRouter();
  const user = auth.currentUser;
  const employee = global.employee;

  const [employeeData, setEmployeeData] = useState(null);
  const [holidays, setHolidays] = useState([]);

  useEffect(() => {
    let unsubscribe = null;

    const fetchData = async () => {
      const empSnap = await getDocs(collection(db, "employees"));
      const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      let empRecord = null;
      if (employee) {
        empRecord = employees.find((e) => e.userCode === employee.userCode);
      } else if (user) {
        empRecord = employees.find((e) => e.email === user.email);
      }
      if (!empRecord) return;
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
  }, []);

  const cancelHoliday = async (id) => {
    try {
      await deleteDoc(doc(db, "holidays", id));
      alert("Holiday request cancelled");
    } catch (err) {
      console.error("Error cancelling holiday:", err.message, err);
      alert("Failed to cancel holiday: " + err.message);
    }
  };

  /* Summary calc (unchanged except relying on computeDays for paid/unpaid totals) */
  const calc = () => {
    let paid = 0,
      unpaid = 0,
      accruedTaken = 0,
      accruedEarned = 0;

    holidays.forEach((h) => {
      const status = (h.status || "").toLowerCase();
      if (status !== "approved") return;

      const days = computeDays(h);
      const typeStr = (h.leaveType || h.paidStatus || "").toLowerCase();
      const isAccrued =
        h.isAccrued === true || typeStr.includes("accrued") || typeStr.includes("toil");
      const isUnpaid =
        !isAccrued &&
        (h.isUnpaid === true ||
          h.unpaid === true ||
          h.paid === false ||
          typeStr.includes("unpaid"));

      const isPaid = !isUnpaid && !isAccrued;

      if (isPaid) paid += days;
      else if (isUnpaid) unpaid += days;
      else if (isAccrued) accruedTaken += days;
    });

    const allowance = Number(employeeData?.holidayAllowance || 0);
    const carryOver = Number(employeeData?.carriedOverDays || 0);
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

  const requestedHolidays = holidays.filter((h) => !h.status || h.status === "requested");
  const confirmedHolidays = holidays.filter((h) => h.status === "approved");

  /* Split confirmed into UPCOMING vs PAST */
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingConfirmed = confirmedHolidays
    .filter((h) => {
      const end = toDate(h.endDate) || toDate(h.startDate);
      return end && end >= today;
    })
    .sort((a, b) => (toDate(a.startDate) - toDate(b.startDate)));

  const pastConfirmed = confirmedHolidays
    .filter((h) => {
      const end = toDate(h.endDate) || toDate(h.startDate);
      return end && end < today;
    })
    .sort((a, b) => (toDate(a.startDate) - toDate(b.startDate)));

  // For projected balances:
  const pastPaidUsed = pastConfirmed.reduce((sum, h) => {
    const { displayType } = displayTypeAndColor(h);
    return displayType === "Paid" ? sum + computeDays(h) : sum;
  }, 0);
  const remainingAfterPast = totalAllowance - pastPaidUsed;

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.topBarBtn} onPress={() => router.back()}>
          <Icon name="arrow-left" size={18} color="#fff" />
          <Text style={styles.topBarBtnText}>Back</Text>
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
            <View style={styles.headerCard}>
              <Text style={styles.headerName}>{employeeData.name}</Text>

              <View style={styles.pillsWrap}>
                <View style={styles.pill}>
                  <Text style={styles.pillLabel}>Allowance</Text>
                  <Text style={styles.pillValue}>{allowance}</Text>
                </View>
                <View style={styles.pill}>
                  <Text style={styles.pillLabel}>Carry Over</Text>
                  <Text style={styles.pillValue}>{carryOver}</Text>
                </View>

                <View
                  style={[
                    styles.pill,
                    { borderColor: allowanceBalance < 0 ? "#ef4444" : "#16a34a" },
                  ]}
                >
                  <Text style={styles.pillLabel}>Left</Text>
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
              <Stat label="Paid Used" value={`${Number(paid.toFixed(1))}/${totalAllowance}`} color="#60a5fa" />
              <Stat label="Unpaid" value={Number(unpaid.toFixed(1))} color="#f87171" />
            </View>

            {/* Requested Holidays */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Requested Holidays</Text>

              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.th, { flex: 1.3 }]}>Date From</Text>
                  <Text style={[styles.th, { flex: 1.3 }]}>Date To</Text>
                  <Text style={styles.th}>Days</Text>
                  <Text style={styles.th}>Type</Text>
                  <Text style={[styles.th, { flex: 1.5 }]}>Notes</Text>
                  <Text style={styles.th}>Status</Text>
                </View>

                {requestedHolidays.length === 0 ? (
                  <Text style={styles.tableEmpty}>No requested holidays.</Text>
                ) : (
                  requestedHolidays
                    .slice()
                    .sort((a, b) => toDate(a.startDate) - toDate(b.startDate))
                    .map((h) => {
                      const s = toDate(h.startDate);
                      const e = toDate(h.endDate) || s;
                      const days = computeDays(h);
                      const { displayType, typeColor } = displayTypeAndColor(h);

                      return (
                        <View key={h.id} style={styles.tableBlock}>
                          <View style={styles.tableRow}>
                            <Text style={[styles.td, { flex: 1.3 }]}>
                              {renderDateWithHalf(s, "start", h)}
                            </Text>
                            <Text style={[styles.td, { flex: 1.3 }]}>
                              {renderDateWithHalf(e, "end", h)}
                            </Text>
                            <Text style={styles.td}>{days}</Text>
                            <Text style={[styles.td, { color: typeColor, fontWeight: "700" }]}>
                              {displayType}
                            </Text>
                            <Text style={[styles.td, { flex: 1.5 }]}>{h.notes?.trim() || "-"}</Text>
                            <Text style={[styles.td, { color: "#fde047", fontWeight: "800" }]}>
                              Requested
                            </Text>
                          </View>

                          <View style={styles.tableActions}>
                            <TouchableOpacity
                              style={styles.cancelButton}
                              onPress={() => cancelHoliday(h.id)}
                            >
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
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Upcoming Confirmed Holidays</Text>

              <View style={styles.table}>
                <View style={styles.tableHeader}>
                    <Text style={[styles.th, { flex: 1.3 }]}>Date From</Text>
                    <Text style={[styles.th, { flex: 1.3 }]}>Date To</Text>
                    <Text style={styles.th}>Days</Text>
                    <Text style={styles.th}>Type</Text>
                    <Text style={[styles.th, { flex: 1.5 }]}>Notes</Text>
                    <Text style={styles.th}>Projected</Text>
                </View>

                {upcomingConfirmed.length === 0 ? (
                  <Text style={styles.tableEmpty}>No upcoming confirmed holidays.</Text>
                ) : (
                  (() => {
                    let projected = remainingAfterPast;
                    return upcomingConfirmed.map((h) => {
                      const s = toDate(h.startDate);
                      const e = toDate(h.endDate) || s;
                      const days = computeDays(h);
                      const { displayType, typeColor } = displayTypeAndColor(h);

                      if (displayType === "Paid") projected -= days;

                      return (
                        <View key={h.id} style={styles.tableRow}>
                          <Text style={[styles.td, { flex: 1.3 }]}>{renderDateWithHalf(s, "start", h)}</Text>
                          <Text style={[styles.td, { flex: 1.3 }]}>{renderDateWithHalf(e, "end", h)}</Text>
                          <Text style={styles.td}>{days}</Text>
                          <Text style={[styles.td, { color: typeColor, fontWeight: "700" }]}>{displayType}</Text>
                          <Text style={[styles.td, { flex: 1.5 }]}>{h.notes?.trim() || "-"}</Text>
                          <Text style={styles.td}>{Number(projected.toFixed(1))}</Text>
                        </View>
                      );
                    });
                  })()
                )}
              </View>
            </View>

            {/* Confirmed Holidays (Past) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Confirmed Holidays (Past)</Text>

              <View style={styles.table}>
                <View style={styles.tableHeader}>
                    <Text style={[styles.th, { flex: 1.3 }]}>Date From</Text>
                    <Text style={[styles.th, { flex: 1.3 }]}>Date To</Text>
                    <Text style={styles.th}>Days</Text>
                    <Text style={styles.th}>Type</Text>
                    <Text style={[styles.th, { flex: 1.5 }]}>Notes</Text>
                    <Text style={styles.th}>Balance</Text>
                </View>

                {pastConfirmed.length === 0 ? (
                  <Text style={styles.tableEmpty}>No past confirmed holidays.</Text>
                ) : (
                  (() => {
                    let runningBalance = totalAllowance;
                    return pastConfirmed.map((h) => {
                      const s = toDate(h.startDate);
                      const e = toDate(h.endDate) || s;
                      const days = computeDays(h);
                      const { displayType, typeColor } = displayTypeAndColor(h);

                      if (displayType === "Paid") runningBalance -= days;

                      return (
                        <View key={h.id} style={styles.tableRow}>
                          <Text style={[styles.td, { flex: 1.3 }]}>{renderDateWithHalf(s, "start", h)}</Text>
                          <Text style={[styles.td, { flex: 1.3 }]}>{renderDateWithHalf(e, "end", h)}</Text>
                          <Text style={styles.td}>{days}</Text>
                          <Text style={[styles.td, { color: typeColor, fontWeight: "700" }]}>{displayType}</Text>
                          <Text style={[styles.td, { flex: 1.5 }]}>{h.notes?.trim() || "-"}</Text>
                          <Text style={styles.td}>{Number(runningBalance.toFixed(1))}</Text>
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
  return (
    <View style={[styles.statBox, { borderColor: color }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

/* ────────────────────────────── Styles ────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0b" },
  topBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10,
  },
  topBarBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: "#2a2a2a",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: "#151515",
  },
  topBarBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  primaryBtn: { backgroundColor: "#fde047", borderColor: "#fde047" },

  headerCard: {
    backgroundColor: "#111111", borderWidth: 1, borderColor: "#222", borderRadius: 14,
    padding: 14, marginBottom: 12,
  },
  headerName: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 10, textAlign: "center" },
  pillsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
  pill: {
    flexGrow: 1, minWidth: "45%", borderWidth: 1, borderColor: "#2b2b2b",
    backgroundColor: "#161616", borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
  },
  pillLabel: { color: "#cfcfcf", fontSize: 12 },
  pillValue: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 2 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12, paddingHorizontal: 2 },
  statBox: { backgroundColor: "#131313", borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, flexBasis: "48%" },
  statLabel: { color: "#cfcfcf", fontSize: 12 },
  statValue: { fontSize: 18, fontWeight: "800", marginTop: 2 },

  card: { backgroundColor: "#111", borderWidth: 1, borderColor: "#222", borderRadius: 14, padding: 12, marginBottom: 14 },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "800", marginBottom: 10, textAlign: "left" },

  table: { borderTopWidth: 1, borderColor: "#222", borderRadius: 10, overflow: "hidden" },
  tableHeader: { flexDirection: "row", backgroundColor: "#171717", borderBottomWidth: 1, borderColor: "#222" },
  th: { flex: 1, color: "#eee", fontWeight: "800", textAlign: "center", paddingVertical: 10, fontSize: 12 },
  tableEmpty: { color: "#aaa", paddingVertical: 12, textAlign: "center" },

  tableBlock: { borderBottomWidth: 1, borderColor: "#222", backgroundColor: "#0f0f0f" },
  tableRow: { flexDirection: "row", paddingVertical: 10, paddingHorizontal: 6, gap: 6 },
  td: { flex: 1, color: "#d1d1d1", textAlign: "center", fontSize: 12 },

  tableActions: { paddingHorizontal: 6, paddingBottom: 8, alignItems: "flex-end" },
  cancelButton: {
    backgroundColor: "#ef4444", borderWidth: 1, borderColor: "#ef4444",
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 6,
  },
  cancelButtonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});
