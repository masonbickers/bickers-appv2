import { AppButton, AppText as Text, Banner, Checkbox, FormStep, SegmentedControl, TextArea } from "../../components/ui/AppPrimitives";
// app/holiday-request.js
import {
  useRouter } from "expo-router";
import { collection,
  doc,
  getDocs,
  setDoc } from "firebase/firestore";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  StyleSheet,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../firebaseConfig";
import { designTokens as t } from "../../lib/design/tokens";
import { runOrQueueFirestoreMutation } from "../../lib/sync/firestoreQueue";
import { useAuth } from "../../providers/AuthProvider";
import { useDataCache } from "../../providers/DataCacheProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import PageShell from "../../components/layout/PageShell";

export default function HolidayRequestPage() {
  const router = useRouter();
  const { employee, user, isAuthed, loading } = useAuth();
  const { invalidate } = useDataCache();
  const { colors } = useTheme();

  const [startDate, setStartDate] = useState(null); // "YYYY-MM-DD"
  const [endDate, setEndDate] = useState(null); // "YYYY-MM-DD"

  // Paid | Unpaid | Accrued
  const [paidStatus, setPaidStatus] = useState("Paid");

  const [notes, setNotes] = useState("");

  // UI extras
  const [halfDay, setHalfDay] = useState(false); // single-day only
  const [halfDayPeriod, setHalfDayPeriod] = useState("AM"); // AM | PM

  // Resolve employee record
  const [empRecord, setEmpRecord] = useState(null);
  const [empLoading, setEmpLoading] = useState(true);

  // Existing data (for validation)
  const [holidays, setHolidays] = useState([]);
  const [holidaysLoading, setHolidaysLoading] = useState(true);

  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);

  const [holidayConflictMsg, setHolidayConflictMsg] = useState("");
  const [jobConflictMsg, setJobConflictMsg] = useState("");

  const isSingleDay = !!startDate && (endDate ?? startDate) === startDate;

  // If user extends selection to multi-day, disable half-day automatically (UI only)
  useEffect(() => {
    if (!isSingleDay && halfDay) setHalfDay(false);
  }, [isSingleDay, halfDay]);

  /* ---------------- helpers ---------------- */
  const norm = (v) => String(v ?? "").trim().toLowerCase();

  const toDate = (v) => {
    if (!v) return null;
    if (typeof v?.toDate === "function") return v.toDate(); // Firestore Timestamp
    // supports "YYYY-MM-DD" or ISO
    const d = new Date(v);
    return Number.isNaN(+d) ? null : d;
  };

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  const sameYMD = (a, b) =>
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const isWeekend = (d) => {
    const day = d.getDay();
    return day === 0 || day === 6;
  };

  const eachDateInclusive = (start, end) => {
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const out = [];
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(new Date(d));
    return out;
  };

  const fmt = (d) => {
    if (!d) return "—";
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Half-day rules for single-day same date:
  // - Full day conflicts with anything on that date
  // - AM conflicts with AM/full, PM conflicts with PM/full
  const halfDayOverlaps = (newHalf, newWhen, oldHalf, oldWhen) => {
    if (!newHalf || !oldHalf) return true; // if either is full-day => overlap
    if (!newWhen || !oldWhen) return true;
    return String(newWhen).toUpperCase() === String(oldWhen).toUpperCase();
  };

  // ✅ strict paid detection (same intention as web HR page)
  const isPaidHoliday = (h = {}) => {
    const ps = String(h.paidStatus ?? h.paid ?? h.isPaid ?? "").trim().toLowerCase();
    const lt = String(h.leaveType ?? h.type ?? "").trim().toLowerCase();

    if (h.isPaid === true || h.paid === true || h.paid === 1) return true;
    if (ps.includes("unpaid") || lt.includes("unpaid")) return false;
    if (ps.includes("paid")) return true;
    if (lt.includes("paid")) return true;

    // default: don't count unless explicitly paid
    return false;
  };

  const requestedDays = useMemo(() => {
    if (!startDate) return 0;
    const s = toDate(startDate);
    const e = toDate(endDate || startDate);
    if (!s || !e) return 0;

    const days = eachDateInclusive(s, e);
    let total = 0;
    for (let i = 0; i < days.length; i++) {
      const d = days[i];
      if (isWeekend(d)) continue;

      let inc = 1;
      const single = sameYMD(s, e);
      if (single && halfDay) inc = 0.5;
      total += inc;
    }
    return Number(total.toFixed(2));
  }, [startDate, endDate, halfDay]);

  /* ---------------- employee resolve ---------------- */
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      if (loading || !isAuthed) {
        if (mounted) {
          setEmpRecord(null);
          setEmpLoading(false);
        }
        return;
      }
      setEmpLoading(true);
      try {
        const snap = await getDocs(collection(db, "employees"));
        const employees = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const byCode =
          employee?.userCode &&
          employees.find((e) => e.userCode === employee.userCode);

        const emailToMatch = (employee?.email || user?.email || "").toLowerCase();
        const byEmail =
          !byCode &&
          emailToMatch &&
          employees.find((e) => (e.email || "").toLowerCase() === emailToMatch);

        const resolved = byCode || byEmail || null;
        if (mounted) setEmpRecord(resolved);
      } catch (e) {
        if (mounted) setEmpRecord(null);
        console.warn("Failed to resolve employee:", e);
      } finally {
        if (mounted) setEmpLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [loading, isAuthed, employee?.userCode, employee?.email, user?.email]);

  /* ---------------- load existing holidays + bookings ---------------- */
  useEffect(() => {
    let mounted = true;

    const loadHolidays = async () => {
      setHolidaysLoading(true);
      try {
        const snap = await getDocs(collection(db, "holidays"));
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (mounted) setHolidays(all);
      } catch (e) {
        console.warn("Failed to load holidays:", e);
        if (mounted) setHolidays([]);
      } finally {
        if (mounted) setHolidaysLoading(false);
      }
    };

    const loadBookings = async () => {
      setBookingsLoading(true);
      try {
        // ✅ If your collection is not "bookings", change it here.
        const snap = await getDocs(collection(db, "bookings"));
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (mounted) setBookings(all);
      } catch (e) {
        // if no bookings collection in this app build, don’t crash
        console.warn("Failed to load bookings:", e);
        if (mounted) setBookings([]);
      } finally {
        if (mounted) setBookingsLoading(false);
      }
    };

    if (isAuthed && !loading) {
      loadHolidays();
      loadBookings();
    } else {
      setHolidays([]);
      setBookings([]);
      setHolidaysLoading(false);
      setBookingsLoading(false);
    }

    return () => {
      mounted = false;
    };
  }, [isAuthed, loading]);

  /* ---------------- allowance calc (paid remaining) ---------------- */
  const allowanceInfo = useMemo(() => {
    const yr = startDate ? toDate(startDate)?.getFullYear() : new Date().getFullYear();
    const name = empRecord?.name || employee?.name || user?.displayName || user?.email || "";

    const daysForHoliday = (h) => {
      const hs = toDate(h.startDate);
      const he = toDate(h.endDate) || hs;
      if (!hs || !he) return 0;

      const days = eachDateInclusive(hs, he);
      const single = sameYMD(hs, he);

      const startIsHalf = h.startHalfDay === true || norm(h.startHalfDay) === "true";
      const endIsHalf = h.endHalfDay === true || norm(h.endHalfDay) === "true";

      let total = 0;
      for (let i = 0; i < days.length; i++) {
        const d = days[i];
        if (isWeekend(d)) continue;

        let inc = 1;
        if (single) {
          if (startIsHalf || endIsHalf) inc = 0.5;
        } else {
          if (i === 0 && startIsHalf) inc = 0.5;
          if (i === days.length - 1 && endIsHalf) inc = 0.5;
        }
        total += inc;
      }
      return total;
    };

    // allowance: holidayAllowances[year] preferred, else legacy holidayAllowance
    const yrKey = String(yr);
    const allowance =
      typeof empRecord?.holidayAllowances?.[yrKey] === "number"
        ? empRecord.holidayAllowances[yrKey]
        : typeof empRecord?.holidayAllowance === "number"
        ? empRecord.holidayAllowance
        : 0;

    const usedPaidApproved = holidays
      .filter((h) => {
        if (String(h.employee || "").trim() !== String(name).trim()) return false;
        const st = String(h.status || "").toLowerCase();
        if (st !== "approved") return false;

        const hs = toDate(h.startDate);
        const he = toDate(h.endDate) || hs;
        if (!hs || !he) return false;
        if (hs.getFullYear() !== yr || he.getFullYear() !== yr) return false;

        return isPaidHoliday(h);
      })
      .reduce((acc, h) => acc + daysForHoliday(h), 0);

    const remainingPaid = Number((allowance - usedPaidApproved).toFixed(2));

    return {
      year: yr,
      name,
      allowance: Number(allowance || 0),
      usedPaidApproved: Number(usedPaidApproved.toFixed(2)),
      remainingPaid,
    };
  }, [startDate, empRecord, employee?.name, user?.displayName, user?.email, holidays]);

  // Force unpaid if no paid left
  useEffect(() => {
    if (allowanceInfo.remainingPaid <= 0 && paidStatus === "Paid") {
      setPaidStatus("Unpaid");
    }
  }, [allowanceInfo.remainingPaid, paidStatus]);

  /* ---------------- holiday overlap conflict ---------------- */
  const holidayConflict = useMemo(() => {
    setHolidayConflictMsg("");

    const rangesOverlap = (aStart, aEnd, bStart, bEnd) => {
      if (!aStart || !aEnd || !bStart || !bEnd) return false;
      const as = startOfDay(aStart).getTime();
      const ae = endOfDay(aEnd).getTime();
      const bs = startOfDay(bStart).getTime();
      const be = endOfDay(bEnd).getTime();
      return as <= be && bs <= ae;
    };

    const name = allowanceInfo.name;
    if (!name) return null;
    if (!startDate) return null;

    const s = toDate(startDate);
    const e = toDate(endDate || startDate);
    if (!s || !e) return null;

    const conflicts = holidays.filter((h) => {
      if (String(h.employee || "").trim() !== String(name).trim()) return false;

      const st = String(h.status || "").toLowerCase();
      if (st === "declined" || st === "cancelled" || st === "canceled") return false;

      const hs = toDate(h.startDate);
      const he = toDate(h.endDate) || hs;
      if (!hs || !he) return false;

      if (!rangesOverlap(s, e, hs, he)) return false;

      // Allow AM+PM split only if both are single-day and same date
      const newSingle = sameYMD(s, e);
      const oldSingle = sameYMD(hs, he);

      if (newSingle && oldSingle && sameYMD(s, hs)) {
        const newIsHalf = !!halfDay;
        const newWhen = newIsHalf ? halfDayPeriod : null;

        const oldIsHalf =
          h.startHalfDay === true ||
          h.halfDay === true ||
          norm(h.startHalfDay) === "true" ||
          norm(h.halfDay) === "true";

        const oldWhen = String(h.startAMPM || h.halfDayPeriod || h.halfDayType || "")
          .toUpperCase()
          .trim();

        return halfDayOverlaps(newIsHalf, newWhen, oldIsHalf, oldWhen);
      }

      return true;
    });

    if (!conflicts.length) return null;

    const h = conflicts[0];
    return {
      id: h.id,
      from: toDate(h.startDate),
      to: toDate(h.endDate) || toDate(h.startDate),
      type: String(h.paidStatus || h.leaveType || "Holiday"),
      status: String(h.status || "requested"),
    };
  }, [allowanceInfo.name, startDate, endDate, holidays, halfDay, halfDayPeriod]);

  useEffect(() => {
    if (!holidayConflict) {
      setHolidayConflictMsg("");
      return;
    }
    setHolidayConflictMsg(
      `⚠️ You already have a holiday that overlaps: ${fmt(holidayConflict.from)} → ${fmt(
        holidayConflict.to
      )} (${holidayConflict.type}, ${holidayConflict.status}).`
    );
  }, [holidayConflict]);

  /* ---------------- booking/job conflict ---------------- */
  const jobConflict = useMemo(() => {
    setJobConflictMsg("");

    const rangesOverlap = (aStart, aEnd, bStart, bEnd) => {
      if (!aStart || !aEnd || !bStart || !bEnd) return false;
      const as = startOfDay(aStart).getTime();
      const ae = endOfDay(aEnd).getTime();
      const bs = startOfDay(bStart).getTime();
      const be = endOfDay(bEnd).getTime();
      return as <= be && bs <= ae;
    };

    const bookingIsActive = (b) => {
      const st = norm(b.status || b.bookingStatus || b.state);
      if (st.includes("cancel")) return false;
      if (st.includes("declin")) return false;
      return true;
    };

    const bookingHasEmployee = (b, empName) => {
      const target = norm(empName);
      if (!target) return false;

      const candidates = [
        b.employees,
        b.crew,
        b.staff,
        b.assignedEmployees,
        b.employeeNames,
        b.people,
      ];

      for (const c of candidates) {
        if (!c) continue;

        if (Array.isArray(c)) {
          if (c.some((x) => norm(x?.name ?? x) === target)) return true;
        }

        if (typeof c === "object" && !Array.isArray(c)) {
          const keys = Object.keys(c);
          if (keys.some((k) => norm(k) === target)) return true;
          const vals = Object.values(c);
          if (vals.some((v) => norm(v?.name ?? v) === target)) return true;
        }
      }

      if (typeof b.employee === "string" && norm(b.employee) === target) return true;

      return false;
    };

    const bookingRange = (b) => {
      const s = toDate(b.startDate) || toDate(b.date) || null;
      const e = toDate(b.endDate) || toDate(b.date) || null;

      if (s && e) return { start: s, end: e };

      if (Array.isArray(b.dates) && b.dates.length) {
        const parsed = b.dates.map(toDate).filter(Boolean);
        if (!parsed.length) return { start: null, end: null };
        parsed.sort((a, b) => +a - +b);
        return { start: parsed[0], end: parsed[parsed.length - 1] };
      }

      return { start: null, end: null };
    };

    const name = allowanceInfo.name;
    if (!name) return null;
    if (!startDate) return null;

    const s = toDate(startDate);
    const e = toDate(endDate || startDate);
    if (!s || !e) return null;

    const conflicts = bookings.filter((b) => {
      if (!bookingIsActive(b)) return false;
      if (!bookingHasEmployee(b, name)) return false;

      const r = bookingRange(b);
      if (!r.start || !r.end) return false;

      return rangesOverlap(s, e, r.start, r.end);
    });

    if (!conflicts.length) return null;

    const b = conflicts[0];
    const r = bookingRange(b);

    const title =
      b.jobNumber ||
      b.jobNo ||
      b.job ||
      b.title ||
      b.production ||
      b.client ||
      "Job";

    const where = b.location || b.toLocation || b.fromLocation || "";

    return { id: b.id, title: String(title), where: String(where || ""), from: r.start, to: r.end };
  }, [allowanceInfo.name, startDate, endDate, bookings]);

  useEffect(() => {
    if (!jobConflict) {
      setJobConflictMsg("");
      return;
    }
    setJobConflictMsg(
      `⚠️ You are booked on a job during these dates: ${jobConflict.title}${
        jobConflict.where ? ` (${jobConflict.where})` : ""
      } — ${fmt(jobConflict.from)} → ${fmt(jobConflict.to)}.`
    );
  }, [jobConflict]);

  /* ---------------- calendar marks ---------------- */
  const markedDates = useMemo(() => {
    const m = {};
    if (startDate) {
      m[startDate] = {
        startingDay: true,
        color: colors.accent,
        textColor: staticColors.hex_fff_yhjmu8,
      };
    }

    const last = endDate || startDate;
    if (last) {
      m[last] = { ...(m[last] || {}), endingDay: true, color: colors.accent, textColor: staticColors.hex_fff_yhjmu8 };
    }

    if (startDate && last) {
      let cur = new Date(startDate);
      const endD = new Date(last);
      while (cur <= endD) {
        const s = cur.toISOString().split("T")[0];
        if (!m[s]) m[s] = { color: withAlpha(colors.accent, 0.45), textColor: staticColors.hex_fff_yhjmu8 };
        cur.setDate(cur.getDate() + 1);
      }
      if (isSingleDay && halfDay && startDate) {
        m[startDate] = { ...(m[startDate] || {}), color: withAlpha(colors.accent, 0.8), textColor: staticColors.hex_fff_yhjmu8 };
      }
    }

    return m;
  }, [startDate, endDate, isSingleDay, halfDay, colors.accent]);

  const handleDayPress = (day) => {
    const d = day.dateString;
    if (!startDate || (startDate && endDate)) {
      setStartDate(d);
      setEndDate(null);
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

  /* ---------------- submit ---------------- */
  const submitRequest = async () => {
    if (loading || !isAuthed) return alert("Please sign in first.");
    if (empLoading) return;
    if (holidaysLoading || bookingsLoading) return alert("Loading validation data… please try again.");

    const name = allowanceInfo.name;

    if (!name) return alert("Your employee profile is incomplete.");
    if (!startDate) return alert("Please pick a start date.");

    const startStr = startDate;
    const endStr = endDate || startDate;

    if (!notes.trim()) return alert("Please enter a reason for the holiday.");

    const s = new Date(startStr);
    const eDate = new Date(endStr);
    if (isNaN(+s) || isNaN(+eDate) || s > eDate) {
      return alert("End date must be the same or after start date.");
    }

    // Block: holiday overlap
    if (holidayConflict) return alert(holidayConflictMsg || "Holiday overlaps an existing request.");

    // Block: job overlap
    if (jobConflict) return alert(jobConflictMsg || "Holiday overlaps a job you are booked on.");

    // Paid allowance rules
    const remainingPaid = allowanceInfo.remainingPaid;
    if (paidStatus === "Paid") {
      if (remainingPaid <= 0) return alert("No paid holiday remaining — you can only book unpaid holiday.");
      if (requestedDays > remainingPaid) {
        return alert(
          `Not enough paid holiday remaining.\nRemaining: ${remainingPaid} day(s)\nThis request: ${requestedDays} day(s)\n\nBook as Unpaid or shorten/split the request.`
        );
      }
    }

    // Normalised flags
    const isUnpaid = paidStatus === "Unpaid";
    const isAccrued = paidStatus === "Accrued";
    const paid = paidStatus === "Paid";
    const leaveType = paidStatus;

    try {
      // ✅ Save half-day fields for single-day (so web + conflict rules stay consistent)
      const single = startStr === endStr;
      const holidayRef = doc(collection(db, "holidays"));
      const holidayId = holidayRef.id;

      const holidayData = {
        employee: name,
        employeeCode: employee?.userCode || empRecord?.userCode || null,
        userCode: employee?.userCode || empRecord?.userCode || null,
        employeeEmail: employee?.email || empRecord?.email || user?.email || null,

        // keep as strings (your web + HR parser supports these)
        startDate: startStr,
        endDate: endStr,
        holidayYear: s.getFullYear(),

        // ✅ optional, but recommended for consistency:
        startHalfDay: single ? !!halfDay : false,
        startAMPM: single && halfDay ? halfDayPeriod : null,
        endHalfDay: false,
        endAMPM: null,

        holidayReason: notes,
        paidStatus,
        isUnpaid,
        isAccrued,
        paid,
        leaveType,

        createdAt: new Date(),
        status: "requested",
      };

      const { queued } = await runOrQueueFirestoreMutation({
        run: () => setDoc(holidayRef, holidayData, { merge: false }),
        mutation: {
          operation: "set",
          docPath: `holidays/${holidayId}`,
          data: holidayData,
          options: { merge: false },
          entityType: "holiday",
          entityId: holidayId,
          meta: { employeeCode: employee?.userCode || null },
        },
      });
      await Promise.all([
        invalidate("collection:holidays"),
        invalidate("me-dashboard:"),
      ]);

      if (queued) {
        alert("📥 Holiday request queued offline. It will sync automatically.");
      } else {
        alert("✅ Holiday request submitted!");
      }
      router.back();
    } catch (err) {
      console.error("Holiday submit failed:", err);
      alert(`❌ Error submitting request\n${(err.code || "")} ${(err.message || "")}`.trim());
    }
  };

  const paidAllowed = allowanceInfo.remainingPaid > 0;

  /* ---------------- loading gate ---------------- */
  if (loading || empLoading) {
    return (
      <PageShell mode="form" width="form" header={{ variant: "compact", title: "Request Holiday", onBack: router.back }}>
        <View style={{ padding: t.spacing.md }}>
          <Text style={{ color: colors.textMuted }}>Loading…</Text>
        </View>
      </PageShell>
    );
  }

  return (
    <PageShell mode="form" width="form" header={{ variant: "compact", title: "Request Holiday", onBack: router.back }}>
        <View style={styles.heroCard}>
          <View style={styles.heroContent}>
            <View style={styles.heroMetaRow}>
              <View
                style={[
                  styles.heroMetaChip,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                    borderColor: withAlpha(colors.border, 0.75),
                  },
                ]}
              >
                <Icon name="clock" size={12} color={colors.textMuted} />
                <Text style={[styles.heroMetaText, { color: colors.text }]}>
                  {startDate ? `${requestedDays} day(s)` : "Pick dates"}
                </Text>
              </View>
              <View
                style={[
                  styles.heroMetaChip,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                    borderColor: withAlpha(colors.border, 0.75),
                  },
                ]}
              >
                <Icon name="briefcase" size={12} color={colors.textMuted} />
                <Text style={[styles.heroMetaText, { color: colors.text }]}>
                  {paidStatus}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <FormStep number="1" title="Choose dates" hint="Select the first and last day of leave">
          <Calendar
            onDayPress={handleDayPress}
            markedDates={markedDates}
            markingType="period"
            theme={{
              calendarBackground: colors.surfaceAlt,
              dayTextColor: colors.text,
              monthTextColor: colors.text,
              arrowColor: colors.accent,
              selectedDayBackgroundColor: colors.accent,
              selectedDayTextColor: staticColors.hex_fff_yhjmu8,
              todayTextColor: colors.accent,
            }}
          />

        <View style={{ gap: t.spacing.xxs, marginTop: t.spacing.sm }}>
          <Text style={{ color: colors.textMuted }}>
            Start:{" "}
            <Text style={{ color: colors.text }}>{startDate || "Not selected"}</Text>
            {isSingleDay && halfDay ? <Text style={{ color: staticColors.hex_86efac_dg95e1 }}> ({halfDayPeriod} half)</Text> : null}
          </Text>
          <Text style={{ color: colors.textMuted }}>
            End: <Text style={{ color: colors.text }}>{endDate || startDate || "Not selected"}</Text>
          </Text>
        </View>
        </FormStep>

        {/* Allowance + request size */}
        {startDate ? (
          <Banner title={`Allowance check (${allowanceInfo.year})`} tone="info">
            <Text style={{ color: colors.textMuted }}>
              Allowance: <Text style={{ color: colors.text, fontWeight: "800" }}>{allowanceInfo.allowance}</Text>{" "}
              • Used (approved paid):{" "}
              <Text style={{ color: colors.text, fontWeight: "800" }}>{allowanceInfo.usedPaidApproved}</Text>{" "}
              • Remaining paid:{" "}
              <Text style={{ color: colors.text, fontWeight: "800" }}>{allowanceInfo.remainingPaid}</Text>
            </Text>
            <Text style={{ color: colors.textMuted, marginTop: t.spacing.xxs }}>
              This request: <Text style={{ color: colors.text, fontWeight: "800" }}>{requestedDays}</Text> day(s) (weekdays only)
            </Text>

            {allowanceInfo.remainingPaid <= 0 ? (
              <Text style={{ color: colors.danger || staticColors.hex_f87171_ohxdjs, marginTop: t.spacing.xs, fontWeight: "800" }}>
                No paid holiday remaining — you can only book unpaid holiday.
              </Text>
            ) : null}
          </Banner>
        ) : null}

        {/* Conflict warnings */}
        {holidayConflictMsg ? (
          <Banner title="Holiday conflict" tone="danger">
            <Text style={{ color: colors.textMuted, marginTop: t.spacing.xxs }}>{holidayConflictMsg}</Text>
          </Banner>
        ) : null}

        {jobConflictMsg ? (
          <Banner title="Job conflict" tone="warning">
            <Text style={{ color: colors.textMuted, marginTop: t.spacing.xxs }}>{jobConflictMsg}</Text>
          </Banner>
        ) : null}

        {/* Leave Type – Paid / Unpaid / Accrued */}
        <FormStep number="2" title="Leave type" hint="Choose how this leave is recorded">

          <SegmentedControl
            value={paidStatus}
            onChange={setPaidStatus}
            options={[
              { value: "Paid", label: paidAllowed ? "Paid holiday" : "Paid unavailable", disabled: !paidAllowed },
              { value: "Unpaid", label: "Unpaid holiday" },
            ]}
          />

          {paidStatus === "Paid" && paidAllowed && requestedDays > allowanceInfo.remainingPaid ? (
            <Text style={{ color: colors.danger || staticColors.hex_f87171_ohxdjs, marginTop: t.spacing.xs, fontWeight: "800" }}>
              Not enough paid remaining for this request — choose Unpaid or shorten/split.
            </Text>
          ) : null}
        </FormStep>



        {/* Half-day (single only) */}
        <FormStep number="3" title="Half day" hint="Available for single-day requests">

          <Checkbox
            checked={halfDay}
            onChange={setHalfDay}
            disabled={!isSingleDay}
            label={isSingleDay ? "Book as half day" : "Half-day only available for a single day"}
          />

          {isSingleDay && halfDay && (
            <SegmentedControl
              value={halfDayPeriod}
              onChange={setHalfDayPeriod}
              options={[{ value: "AM", label: "AM" }, { value: "PM", label: "PM" }]}
            />
          )}

          <Text style={{ color: colors.textMuted, marginTop: t.spacing.xs, fontSize: t.typography.metadata.fontSize }}>
            Half-days are only for a single-day request.
          </Text>
        </FormStep>

        {/* Notes */}
        <FormStep number="4" title="Notes" hint="Optional context for the approver" last>
          <TextArea
            label="Notes / Reason"
            placeholder="Add notes or reason..."
            value={notes}
            onChangeText={setNotes}
          />
        </FormStep>

        {/* Submit */}
        <AppButton
          label={holidaysLoading || bookingsLoading ? "Loading…" : "Submit Request"}
          onPress={submitRequest}
          disabled={!!holidayConflict || !!jobConflict}
          loading={holidaysLoading || bookingsLoading}
          fullWidth
        />
    </PageShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: staticColors.hex_0b0b0b_9v81ck },

  heroCard: {
    marginHorizontal: t.spacing.sm,
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroBackButton: {
    width: 38,
    height: 38,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  heroTitleWrap: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: t.spacing.sm,
  },
  heroSpacer: {
    width: 38,
    height: 38,
  },
  heroContent: {
    paddingBottom: t.spacing.xxs,
    paddingTop: t.spacing.none,
  },
  heroTitle: {
    ...t.typography.pageTitle,
    letterSpacing: 0.2,
    textAlign: "center",
  },
  heroSubTitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: "600",
    textAlign: "center",
  },
  heroMetaRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    gap: t.spacing.xs,
    flexWrap: "wrap",
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
  heroMetaText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },

});
