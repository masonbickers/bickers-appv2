import { AppText as Text, AppPressable as TouchableOpacity } from "../../components/ui/AppPrimitives";
// app/holidaypage.js
import {
  useRouter } from "expo-router";
import { collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot } from "firebase/firestore";
import { useEffect,
  useMemo,
  useState } from "react";
import { StyleSheet, View } from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { db } from "../../firebaseConfig";
import { holidayBelongsToYear } from "../../lib/holidayYear";
import { employeeMatchesHoliday } from "../../lib/holidayOwnership";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

/* ─────────────────────────── Helpers ─────────────────────────── */
const norm = (v) => String(v ?? "").trim().toLowerCase();
const canonicalCode = (v) => {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits ? digits.padStart(4, "0") : norm(raw);
};

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

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function getHolidayStart(h) {
  return toDate(
    firstValue(
      h?.startDate,
      h?.dateFrom,
      h?.fromDate,
      h?.from,
      h?.start,
      h?.date,
      h?.holidayStart,
      h?.start_date
    )
  );
}

function getHolidayEnd(h) {
  return (
    toDate(
      firstValue(
        h?.endDate,
        h?.dateTo,
        h?.toDate,
        h?.to,
        h?.end,
        h?.holidayEnd,
        h?.end_date
      )
    ) || getHolidayStart(h)
  );
}

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
  const s = getHolidayStart(h);
  const e = getHolidayEnd(h) || s;
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

  const s = getHolidayStart(h);
  const e = getHolidayEnd(h) || s;
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
  let typeColor = staticColors.hex_22d3ee_74my7l;
  const typeStr = (h.leaveType || h.paidStatus || h.type || h.holidayType || "").toLowerCase();

  if (h.isAccrued || typeStr.includes("accrued") || typeStr.includes("toil")) {
    displayType = "Accrued";
    typeColor = staticColors.hex_38bdf8_92tkol;
  } else if (h.isUnpaid || typeStr.includes("unpaid") || h.paid === false) {
    displayType = "Unpaid";
    typeColor = staticColors.hex_f87171_ohxdjs;
  } else if (h.paid || typeStr.includes("paid")) {
    displayType = "Paid";
    typeColor = staticColors.hex_29bc5f_75jpdr;
  } else {
    // default: treat as paid if not explicitly unpaid/accrued
    displayType = "Paid";
    typeColor = staticColors.hex_29bc5f_75jpdr;
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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function getAllowanceForYear(emp, y) {
  const Y = yearKey(y);

  const holidayAllowances = emp?.holidayAllowances || emp?.holidayAllowanceByYear || {};
  const carryoverByYear = emp?.carryoverByYear || emp?.carryOverByYear || emp?.carriedOverByYear || {};

  // A configured value of 0 is meaningful. Only use the legacy fields when
  // this year has no entry at all; otherwise last year's value can leak into
  // the current-year totals.
  const allowance = hasOwn(holidayAllowances, Y)
    ? numOrZero(holidayAllowances[Y])
    : numOrZero(emp?.holidayAllowance);

  const carryOver = hasOwn(carryoverByYear, Y)
    ? numOrZero(carryoverByYear[Y])
    : emp?.carriedOverDays !== undefined && emp?.carriedOverDays !== null
      ? numOrZero(emp.carriedOverDays)
      : numOrZero(emp?.carryOverDays);

  return { allowance, carryOver };
}

function isRequestedStatus(status) {
  const st = norm(status);
  return (
    !st ||
    st === "requested" ||
    st === "request" ||
    st === "pending" ||
    st === "submitted" ||
    st.includes("awaiting")
  );
}

function isApprovedStatus(status) {
  const st = norm(status);
  return (
    st === "approved" ||
    st === "accept" ||
    st === "accepted" ||
    st === "confirmed" ||
    st === "authorised" ||
    st === "authorized" ||
    st.startsWith("approved")
  );
}

// Holidays belong to the leave year in which they start. Using an overlap
// check here caused leave beginning in the previous year to reappear in the
// current year's lists and totals.
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
        const targetCode = canonicalCode(employee.userCode);
        empRecord =
          employees.find((e) => canonicalCode(e.userCode) === targetCode) ||
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
        const myHolidays = allHolidays.filter((h) =>
          employeeMatchesHoliday(h, empRecord, employee, user)
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
    return (holidays || []).filter((h) =>
      holidayBelongsToYear(h, selectedYear, getHolidayStart(h))
    );
  }, [holidays, selectedYear]);

  /* ✅ Summary calc (CURRENT YEAR ONLY) */
  const calc = () => {
    let paidBooked = 0,
      unpaid = 0,
      accruedTaken = 0,
      accruedEarned = 0;

    holidaysForYear.forEach((h) => {
      if (!isApprovedStatus(h.status)) return;

      const days = computeDays(h, isBankHoliday);
      const { displayType } = displayTypeAndColor(h);

      if (displayType === "Paid") paidBooked += days;
      else if (displayType === "Unpaid") unpaid += days;
      else if (displayType === "Accrued") accruedTaken += days;
    });

    const { allowance, carryOver } = getAllowanceForYear(employeeData, selectedYear);
    const totalAllowance = allowance + carryOver;

    const accruedBalance = accruedEarned - accruedTaken;
    const allowanceBalance = totalAllowance - paidBooked;

    return {
      paidBooked,
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
    paidBooked,
    unpaid,
    totalAllowance,
    allowanceBalance,
  } = calc();

  // ✅ Make status filtering case-insensitive
  const requestedHolidays = holidaysForYear.filter((h) => {
    return isRequestedStatus(h.status);
  });

  const confirmedHolidays = holidaysForYear.filter((h) => isApprovedStatus(h.status));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingConfirmed = confirmedHolidays
    .filter((h) => {
      const end = getHolidayEnd(h) || getHolidayStart(h);
      return end && end >= today;
    })
    .sort((a, b) => getHolidayStart(a) - getHolidayStart(b));

  const pastConfirmed = confirmedHolidays
    .filter((h) => {
      const end = getHolidayEnd(h) || getHolidayStart(h);
      return end && end < today;
    })
    .sort((a, b) => getHolidayStart(a) - getHolidayStart(b));

  const pastPaidUsed = pastConfirmed.reduce((sum, h) => {
    const { displayType } = displayTypeAndColor(h);
    return displayType === "Paid" ? sum + computeDays(h, isBankHoliday) : sum;
  }, 0);

  const remainingAfterPast = totalAllowance - pastPaidUsed;
  const upcomingPaidBooked = Math.max(0, paidBooked - pastPaidUsed);

  // ✅ Notes field compatibility: app/web save "holidayReason", older UI might have "notes"
  const getNotes = (h) => {
    const v = h.holidayReason ?? h.notes ?? h.reason ?? "";
    return String(v || "").trim();
  };

  const toListItem = (h, trailingLabel, trailingValue) => {
    const s = getHolidayStart(h);
    const e = getHolidayEnd(h) || s;
    const { displayType, typeColor } = displayTypeAndColor(h);
    return {
      id: h.id,
      holiday: h,
      start: renderDateWithHalf(s, "start", h),
      end: renderDateWithHalf(e, "end", h),
      days: computeDays(h, isBankHoliday),
      type: displayType,
      typeColor,
      notes: getNotes(h),
      trailingLabel,
      trailingValue,
    };
  };

  const requestedItems = requestedHolidays
    .slice()
    .sort((a, b) => getHolidayStart(a) - getHolidayStart(b))
    .map((h) => toListItem(h, "Status", "Requested"));

  let projectedBalance = remainingAfterPast;
  const upcomingItems = upcomingConfirmed.map((h) => {
    const { displayType } = displayTypeAndColor(h);
    if (displayType === "Paid") projectedBalance -= computeDays(h, isBankHoliday);
    return toListItem(
      h,
      "Balance after",
      `${Number(projectedBalance.toFixed(1))} days`
    );
  });

  let pastBalance = totalAllowance;
  const pastItems = pastConfirmed.map((h) => {
    const { displayType } = displayTypeAndColor(h);
    if (displayType === "Paid") pastBalance -= computeDays(h, isBankHoliday);
    return toListItem(h, "Balance after", `${Number(pastBalance.toFixed(1))} days`);
  });

  const isOverbooked = allowanceBalance < 0;
  const balanceValue = Math.abs(Number(allowanceBalance.toFixed(1)));

  return (
    <PageShell
      header={{
        variant: "compact",
        eyebrow: "Leave",
        title: "Holiday",
        subtitle: employeeData?.name ? `${employeeData.name} · ${selectedYear}` : `Track leave and balances for ${selectedYear}.`,
        onBack: router.back,
        action: { label: "Request Holiday", icon: "plus", onPress: () => router.push("/holiday-request") },
        metadata: <View style={styles.heroMetaRow}>
              <View
                style={[
                  styles.heroMetaChip,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.82),
                    borderColor: withAlpha(colors.border, 0.82),
                  },
                ]}
              >
                <Icon name="pie-chart" size={12} color={colors.textMuted} />
                <Text style={[styles.heroMetaText, { color: colors.text }]}>
                  Allowance: {Number(totalAllowance.toFixed(1))}
                </Text>
              </View>

              <View
                style={[
                  styles.heroMetaChip,
                  {
                    backgroundColor: isOverbooked
                      ? withAlpha(colors.danger, 0.13)
                      : withAlpha(colors.surfaceAlt, 0.82),
                    borderColor: isOverbooked
                      ? withAlpha(colors.danger, 0.45)
                      : withAlpha(colors.border, 0.82),
                  },
                ]}
              >
                <Icon
                  name={isOverbooked ? "alert-triangle" : "check-circle"}
                  size={12}
                  color={isOverbooked ? colors.danger : colors.textMuted}
                />
                <Text style={[styles.heroMetaText, { color: isOverbooked ? colors.danger : colors.text }]}>
                  {isOverbooked ? `Overbooked: ${balanceValue}` : `Available: ${balanceValue}`}
                </Text>
              </View>
            </View>,
      }}
    >
      <>

        {employeeData && (
          <>
            {/* Stats Grid */}
            <View style={styles.statsGrid}>
              <Stat
                label="Paid used"
                value={Number(pastPaidUsed.toFixed(1))}
                color={staticColors.hex_60a5fa_4ffmwj}
              />
              <Stat
                label="Paid booked"
                value={Number(upcomingPaidBooked.toFixed(1))}
                color={staticColors.hex_29bc5f_75jpdr}
              />
              <Stat
                label="Unpaid"
                value={Number(unpaid.toFixed(1))}
                color={staticColors.hex_f87171_ohxdjs}
              />
            </View>

            {isOverbooked ? (
              <View
                style={[
                  styles.balanceWarning,
                  {
                    backgroundColor: withAlpha(colors.danger, 0.12),
                    borderColor: withAlpha(colors.danger, 0.42),
                  },
                ]}
              >
                <Icon name="alert-triangle" size={18} color={colors.danger} />
                <View style={styles.balanceWarningCopy}>
                  <Text style={[styles.balanceWarningTitle, { color: colors.danger }]}>
                    Paid leave exceeds allowance by {balanceValue} days
                  </Text>
                  <Text style={[styles.balanceWarningText, { color: colors.textMuted }]}>
                    Review upcoming bookings or contact the office.
                  </Text>
                </View>
              </View>
            ) : null}

            <HolidayTableSection
              title="Requests"
              count={requestedItems.length}
              items={requestedItems}
              emptyMessage="No holiday requests waiting for approval."
              colors={colors}
              onCancel={(item) => cancelHoliday(item.holiday.id)}
            />

            <HolidayTableSection
              title="Upcoming confirmed"
              count={upcomingItems.length}
              items={upcomingItems}
              emptyMessage="No upcoming confirmed holidays."
              colors={colors}
            />

            <HolidayTableSection
              title="Past holidays"
              count={pastItems.length}
              items={pastItems}
              emptyMessage={`No confirmed holidays in ${selectedYear}.`}
              colors={colors}
              muted
            />
          </>
        )}
      </>
    </PageShell>
  );
}

/* ─────────────────────────── UI subcomponent ─────────────────────────── */
function Stat({ label, value, color }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.statBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <Text style={[styles.statLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

function HolidayTableSection({ title, count, items, emptyMessage, colors, onCancel, muted = false }) {
  return (
    <View style={styles.tableSection}>
      <View style={styles.tableSectionHeader}>
        <Text style={[styles.tableSectionTitle, { color: colors.text }]}>{title}</Text>
        <View style={[styles.tableCount, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}> 
          <Text style={[styles.tableCountText, { color: colors.textMuted }]}>{count}</Text>
        </View>
      </View>

      <View style={[styles.holidayTable, { backgroundColor: colors.surface, borderColor: colors.border }]}> 
        <View style={[styles.holidayTableHeader, { backgroundColor: colors.surfaceAlt, borderBottomColor: colors.border }]}> 
          <Text style={[styles.holidayTableHeading, styles.tableDateColumn, { color: colors.textMuted }]}>Date</Text>
          <Text style={[styles.holidayTableHeading, styles.tableDaysColumn, { color: colors.textMuted }]}>Days</Text>
          <Text style={[styles.holidayTableHeading, styles.tableTypeColumn, { color: colors.textMuted }]}>Type</Text>
          <Text style={[styles.holidayTableHeading, styles.tableTrailingColumn, { color: colors.textMuted }]}> 
            {onCancel ? "Action" : "Left"}
          </Text>
        </View>

        {items.length === 0 ? (
          <View style={styles.tableEmptyRow}>
            <Icon name="calendar" size={17} color={colors.textMuted} />
            <Text style={[styles.tableEmptyText, { color: colors.textMuted }]}>{emptyMessage}</Text>
          </View>
        ) : (
          items.map((item) => {
            const numericBalance = Number.parseFloat(item.trailingValue);
            const negativeBalance = item.trailingLabel === "Balance after" && numericBalance < 0;
            return (
              <View
                key={item.id}
                style={[
                  styles.holidayTableRow,
                  {
                    borderBottomColor: colors.border,
                    opacity: muted ? 0.82 : 1,
                  },
                ]}
              >
                <View style={styles.tableDateColumn}>
                    <Text style={[styles.tableDateText, { color: colors.text }]} numberOfLines={2}>
                      {item.start === item.end ? item.start : `${item.start} → ${item.end}`}
                    </Text>
                    {item.notes ? (
                      <Text style={[styles.tableNoteText, { color: colors.textMuted }]} numberOfLines={1}>
                        {item.notes}
                      </Text>
                    ) : null}
                </View>
                <Text style={[styles.tableCellText, styles.tableDaysColumn, { color: colors.text }]}> 
                  {item.days}
                </Text>
                <Text
                    style={[
                      styles.tableCellText,
                      styles.tableTypeColumn,
                      { color: item.typeColor },
                    ]}
                  >{item.type}</Text>
                  {onCancel ? (
                    <TouchableOpacity
                      style={[
                        styles.tableCancelButton,
                        styles.tableTrailingColumn,
                        {
                          backgroundColor: withAlpha(colors.danger, 0.12),
                          borderColor: withAlpha(colors.danger, 0.35),
                        },
                      ]}
                      onPress={() => onCancel(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Cancel holiday request from ${item.start}`}
                    >
                      <Text style={[styles.tableCancelText, { color: colors.danger }]}>Cancel</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text
                      style={[
                        styles.tableCellText,
                        styles.tableTrailingColumn,
                        { color: negativeBalance ? colors.danger : colors.text },
                      ]}
                    >
                      {Number.isFinite(numericBalance) ? numericBalance : "—"}
                    </Text>
                  )}
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

/* ────────────────────────────── Styles ────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: staticColors.hex_0b0b0b_9v81ck },
   scrollContent: { paddingHorizontal: t.spacing.sm, paddingBottom: t.spacing.xl, paddingTop: t.spacing.xl },

  heroCard: {
    position: "relative",
    marginBottom: t.spacing.xs,
  },
  heroContent: {
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.sm,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
  },
  heroBackButton: {
    width: 34,
    height: 34,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitleWrap: {
    flex: 1,
    paddingTop: t.spacing.none,
    alignItems: "center",
  },
  heroSpacer: {
    width: 34,
    height: 34,
  },
  heroEyebrow: {
    fontSize: t.typography.metadata.fontSize,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "800",
    textAlign: "center",
  },
  heroTitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.pageTitle.fontSize,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  heroSubTitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: "600",
    textAlign: "center",
  },
  heroMetaRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    justifyContent: "center",
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  heroMetaText: { fontSize: t.typography.caption.fontSize, fontWeight: "700" },
  heroActionsRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    justifyContent: "center",
  },
  heroActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
  },
  heroPrimaryBtn: { backgroundColor: staticColors.hex_fde047_pbr6r6, borderColor: staticColors.hex_fde047_pbr6r6 },
  heroActionText: { fontSize: t.typography.bodySmall.fontSize, fontWeight: "800" },

  headerCard: {
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  headerName: {
    color: staticColors.hex_fff_yhjmu8,
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
    marginBottom: t.spacing.xs,
    textAlign: "center",
  },
  pillsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    justifyContent: "space-between",
  },
  pill: {
    flexGrow: 1,
    minWidth: "45%",
    borderWidth: 1,
    borderColor: staticColors.hex_2b2b2b_650zva,
    backgroundColor: staticColors.hex_161616_a53kgx,
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
  },
  pillLabel: { color: staticColors.hex_cfcfcf_r9h9nn, fontSize: t.typography.metadata.fontSize },
  pillValue: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.bodyLarge.fontSize, fontWeight: "800", marginTop: t.spacing.none },

  statsGrid: {
    flexDirection: "row",
    gap: t.spacing.xs,
    marginBottom: t.spacing.sm,
    paddingHorizontal: t.spacing.none,
  },
  statBox: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  statLabel: {
    color: staticColors.hex_cfcfcf_r9h9nn,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  statValue: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "800", marginTop: t.spacing.none },

  balanceWarning: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
  },
  balanceWarningCopy: { flex: 1, minWidth: 0 },
  balanceWarningTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "900",
  },
  balanceWarningText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "600",
  },

  tableSection: { marginBottom: t.spacing.md },
  tableSectionHeader: {
    minHeight: t.controls.chipMinHeight,
    marginBottom: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  tableSectionTitle: {
    flex: 1,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
  },
  tableCount: {
    minWidth: t.controls.chipMinHeight,
    height: t.controls.chipMinHeight,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xs,
  },
  tableCountText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },
  holidayTable: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: t.radius.lg,
    overflow: "hidden",
  },
  holidayTableHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  holidayTableHeading: {
    fontSize: t.typography.micro.fontSize,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  holidayTableRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tableDateColumn: { flex: 1, minWidth: 0, paddingRight: t.spacing.xxs },
  tableDaysColumn: { width: 38, textAlign: "center" },
  tableTypeColumn: { width: 58, textAlign: "center" },
  tableTrailingColumn: { width: 56, textAlign: "center" },
  tableDateText: {
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "800",
  },
  tableNoteText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  tableCellText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },
  tableCancelButton: {
    minHeight: t.controls.touchMin,
    borderRadius: t.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  tableCancelText: {
    fontSize: t.typography.micro.fontSize,
    fontWeight: "900",
  },
  tableEmptyRow: {
    minHeight: 64,
    paddingHorizontal: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
  },
  tableEmptyText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    textAlign: "center",
  },

  card: {
    backgroundColor: staticColors.hex_111_yhln9z,
    borderWidth: 1,
    borderColor: staticColors.hex_222_yhlj90,
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  cardTitle: {
    color: staticColors.hex_fff_yhjmu8,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    marginBottom: t.spacing.xs,
    textAlign: "left",
  },

  table: {
    borderTopWidth: 1,
    borderColor: staticColors.hex_222_yhlj90,
    borderRadius: t.radius.md,
    overflow: "hidden",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: staticColors.hex_171717_a32dcw,
    borderBottomWidth: 1,
    borderColor: staticColors.hex_222_yhlj90,
  },
  th: {
    flex: 1,
    color: staticColors.hex_eee_yhjqv7,
    fontWeight: "800",
    textAlign: "center",
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.metadata.fontSize,
  },
  tableEmpty: { color: staticColors.hex_aaa_yhju4n, paddingVertical: t.spacing.sm, textAlign: "center" },

  tableBlock: {
    borderBottomWidth: 1,
    borderColor: staticColors.hex_222_yhlj90,
    backgroundColor: staticColors.hex_0f0f0f_9seggg,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.xxs,
    gap: t.spacing.xxs,
  },
  td: {
    flex: 1,
    color: staticColors.hex_d1d1d1_pnsuhf,
    textAlign: "center",
    fontSize: t.typography.metadata.fontSize,
  },

  tableActions: {
    paddingHorizontal: t.spacing.xxs,
    paddingBottom: t.spacing.xs,
    alignItems: "flex-end",
  },
  cancelButton: {
    backgroundColor: staticColors.hex_ef4444_sj3rhh,
    borderWidth: 1,
    borderColor: staticColors.hex_ef4444_sj3rhh,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  cancelButtonText: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.bodySmall.fontSize, fontWeight: "800" },
});
