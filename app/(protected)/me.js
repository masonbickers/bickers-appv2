// app/(protected)/me.js
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calendar } from "react-native-calendars";
import Icon from "react-native-vector-icons/Feather";

import { createDashboardCardStyles } from "../../lib/design/dashboard";
import { designTokens as t } from "../../lib/design/tokens";

// 🔑 Provider + Firebase
import { auth, db } from "../../firebaseConfig";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

const TIMESHEET_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const TIMESHEET_WEEKEND_SET = new Set(["Saturday", "Sunday"]);
const DEFAULT_YARD_START = "08:00";
const DEFAULT_YARD_END = "16:30";

function timeToMinutes(value) {
  const raw = String(value || "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function normaliseTimeValue(value) {
  const mins = timeToMinutes(value);
  if (mins == null) return null;
  const hour = Math.floor(mins / 60);
  const minute = mins % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timesheetBoolish(value) {
  if (value === true) return true;
  if (value === false) return false;
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "y";
}

function durationMinutes(startTime, endTime) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start == null || end == null) return 0;
  return end >= start ? end - start : end + 24 * 60 - start;
}

function parseHoursValue(value) {
  const hours = Number(String(value ?? "").trim().replace(",", "."));
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return hours;
}

function normaliseYardSegments(entry) {
  const defaultStart = normaliseTimeValue(entry?.leaveTime) || DEFAULT_YARD_START;
  const defaultEnd = normaliseTimeValue(entry?.arriveBack) || DEFAULT_YARD_END;
  const segments = Array.isArray(entry?.yardSegments) ? entry.yardSegments : [];

  if (segments.length === 0) {
    return [{ start: defaultStart, end: defaultEnd }];
  }

  return segments.map((seg) => ({
    start: normaliseTimeValue(seg?.start) || defaultStart,
    end: normaliseTimeValue(seg?.end) || defaultEnd,
  }));
}

function computeTimesheetDayMinutes(entry) {
  const mode = String(entry?.mode || "off").trim().toLowerCase();
  if (mode === "off" || mode === "holiday" || mode === "bankholiday" || mode === "unpaid") {
    return 0;
  }

  if (mode === "yard") {
    if (entry?.isTurnaround === true) return 0;
    let total = normaliseYardSegments(entry).reduce(
      (sum, segment) => sum + durationMinutes(segment.start, segment.end),
      0
    );
    if (timesheetBoolish(entry?.yardTravelEnabled)) {
      total += durationMinutes(entry?.yardTravelLeaveTime, entry?.yardTravelArriveTime);
    }
    if (!timesheetBoolish(entry?.lunchSup) && total > 0) total = Math.max(0, total - 30);
    return total;
  }

  if (mode === "travel") {
    return durationMinutes(entry?.leaveTime, entry?.arriveTime);
  }

  if (mode === "workshop") {
    const segments = Array.isArray(entry?.yardSegments) ? entry.yardSegments : [];
    if (segments.length > 0) {
      return segments.reduce(
        (sum, segment) => sum + durationMinutes(segment?.start, segment?.end),
        0
      );
    }

    const rows = Array.isArray(entry?.workshopJobs) ? entry.workshopJobs : [];
    return rows.reduce((sum, row) => sum + parseHoursValue(row?.hours) * 60, 0);
  }

  if (mode === "onset") {
    let baseStart = entry?.leaveTime || entry?.arriveTime || entry?.callTime || null;
    let baseEnd = entry?.arriveBack || entry?.wrapTime || null;

    if (entry?.callTime && entry?.wrapTime) {
      baseStart = entry.callTime;
      baseEnd = entry.wrapTime;
    } else if (!baseEnd && entry?.wrapTime) {
      baseEnd = entry.wrapTime;
    }

    let mins = durationMinutes(baseStart, baseEnd);
    if (entry?.callTime && entry?.precallDuration) {
      mins += Math.max(0, durationMinutes(entry.precallDuration, entry.callTime));
    }
    return mins;
  }

  return 0;
}

function computeTimesheetWeekHours(timesheet) {
  const storedHours = toNumber(timesheet?.totalHours, 0);
  if (storedHours > 0) return storedHours;

  const days = timesheet?.days || {};
  const totalMinutes = TIMESHEET_DAYS.reduce((sum, day) => {
    const fallback = { mode: TIMESHEET_WEEKEND_SET.has(day) ? "off" : "yard" };
    return sum + computeTimesheetDayMinutes(days?.[day] || fallback);
  }, 0);

  return Math.round((totalMinutes / 60) * 100) / 100;
}

function formatTimesheetHours(hours) {
  const totalMinutes = Math.max(0, Math.round(toNumber(hours, 0) * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (m === 0) return `${h}h`;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export default function MePage() {
  const router = useRouter();
  const { user, employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();
  const dashboardCards = useMemo(() => createDashboardCardStyles(colors), [colors]);

  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(true);

  // Personal data blocks
  const [myHolidays, setMyHolidays] = useState([]);
  const [nextHoliday, setNextHoliday] = useState(null);
  const [pendingHolidayCount, setPendingHolidayCount] = useState(0);

  // Allowance + used + remaining (CURRENT YEAR)
  const [holidayAllowance, setHolidayAllowance] = useState(0); // totalAllowance (allowance + carryover)
  const [holidayUsedDays, setHolidayUsedDays] = useState(0);
  const [holidayRemaining, setHolidayRemaining] = useState(0);

  const [timesheetStats, setTimesheetStats] = useState({
    weekHours: 0,
    pending: 0,
    lastSubmitted: null,
  });

  // latest manager query on a timesheet
  const [latestTimesheetQuery, setLatestTimesheetQuery] = useState(null);

  const [noteStartDate, setNoteStartDate] = useState(() => isoDate(new Date()));
  const [noteEndDate, setNoteEndDate] = useState("");
  const [noteDateMode, setNoteDateMode] = useState("single");
  const [activeNoteDateField, setActiveNoteDateField] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [noteBlocksBookings, setNoteBlocksBookings] = useState(true);
  const [savingNote, setSavingNote] = useState(false);
  const [noteHistoryOpen, setNoteHistoryOpen] = useState(false);
  const [noteHistoryLoading, setNoteHistoryLoading] = useState(false);
  const [sentNotes, setSentNotes] = useState([]);
  const [deletingNoteKey, setDeletingNoteKey] = useState("");

  // ✅ Bank holidays (UK Gov JSON) for current year
  const currentYear = new Date().getFullYear();
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

  // Account card
  const firebaseUser = user ?? auth.currentUser;
  const isAnon = !!firebaseUser?.isAnonymous;

  const account = employee
    ? {
        name: employee.name || employee.displayName || "Employee",
        email: employee.email || "No email",
        userCode: employee.userCode || "N/A",
      }
    : firebaseUser && !isAnon
    ? {
        name: firebaseUser.displayName || "Manager",
        email: firebaseUser.email || "No email",
        userCode: "N/A",
      }
    : { name: "Unknown User", email: "No email", userCode: "N/A" };

  const loadPersonal = useCallback(async () => {
    setBusy(true);
    try {
      const userCode = employee?.userCode || "";
      const empName = employee?.name || employee?.displayName || "";
      const email = employee?.email || user?.email || "";

      if (!userCode && !empName && !email) {
        setMyHolidays([]);
        setNextHoliday(null);
        setPendingHolidayCount(0);
        setHolidayAllowance(0);
        setHolidayUsedDays(0);
        setHolidayRemaining(0);
        setTimesheetStats({ weekHours: 0, pending: 0, lastSubmitted: null });
        setLatestTimesheetQuery(null);
        return;
      }

      // ============================================================
      // 1) Find employee record (same approach as HolidayPage)
      // ============================================================
      let empRecord = null;
      const employeeLookups = [];
      if (userCode) {
        employeeLookups.push(query(collection(db, "employees"), where("userCode", "==", userCode), limit(1)));
      }
      if (email) {
        employeeLookups.push(query(collection(db, "employees"), where("email", "==", email), limit(1)));
      }
      if (empName) {
        employeeLookups.push(query(collection(db, "employees"), where("name", "==", empName), limit(1)));
      }

      for (const employeeQuery of employeeLookups) {
        const snap = await getDocs(employeeQuery);
        if (!snap.empty) {
          const docSnap = snap.docs[0];
          empRecord = { id: docSnap.id, ...docSnap.data() };
          break;
        }
      }

      // ============================================================
      // 2) Load my holidays (filter like HolidayPage: name OR code)
      // ============================================================
      const holidaySnap = await getDocs(collection(db, "holidays"));
      const mine = holidaySnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((h) => employeeMatchesHoliday(h, empRecord, employee, user));

      setMyHolidays(mine);

      // ============================================================
      // 3) CURRENT YEAR allowance (match HolidayPage maps)
      // ============================================================
      const { allowance, carryOver } = getAllowanceForYear(empRecord, currentYear);
      const totalAllowance = (allowance || 0) + (carryOver || 0);

      setHolidayAllowance(roundToHalf(totalAllowance));

      // ============================================================
      // 4) CURRENT YEAR used / remaining (Paid only, approved only)
      //    - clamps holidays spanning years
      //    - ✅ supports half-days
      //    - ✅ excludes weekends + bank holidays
      // ============================================================
      const yearStart = new Date(currentYear, 0, 1);
      const yearEnd = new Date(currentYear, 11, 31);

      let used = 0;

      for (const h of mine) {
        if (!isApproved(h)) continue;

        const { displayType } = displayTypeAndColor(h);
        if (displayType !== "Paid") continue;

        const origS = getHolidayStart(h);
        const origE = getHolidayEnd(h) || origS;
        if (!origS) continue;

        if (origE < yearStart || origS > yearEnd) continue;

        const clampS = maxDate(origS, yearStart);
        const clampE = minDate(origE, yearEnd);

        used += computeBusinessDaysClamped(h, clampS, clampE, origS, origE, isBankHoliday);
      }

      used = roundToHalf(used);
      const remaining = roundToHalf(Math.max(0, totalAllowance - used));

      setHolidayUsedDays(used);
      setHolidayRemaining(remaining);

      // ============================================================
      // 5) Next holiday + pending count (simple, based on mine)
      // ============================================================
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const pendingCount = mine.filter((h) => {
        return isRequestedHoliday(h);
      }).length;
      setPendingHolidayCount(pendingCount);

      const upcomingApproved = mine
        .filter((h) => isApproved(h))
        .filter((h) => {
          const end = getHolidayEnd(h) || getHolidayStart(h);
          return end && end >= today;
        })
        .sort((a, b) => {
          const as = getHolidayStart(a) ?? new Date(8640000000000000);
          const bs = getHolidayStart(b) ?? new Date(8640000000000000);
          return as - bs;
        });

      setNextHoliday(upcomingApproved[0] || null);

      // ============================================================
      // 6) Timesheet stats (unchanged)
      // ============================================================
      let tsMine = [];
      if (userCode) {
        const tsSnap = await getDocs(
          query(collection(db, "timesheets"), where("employeeCode", "==", userCode), limit(60))
        );
        tsMine = tsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      const mondayKey = mondayISO(new Date());
      const thisWeek = tsMine.find((t) => (t.weekStart || t.weekISO) === mondayKey);
      const weekHours = computeTimesheetWeekHours(thisWeek);

      const pending = tsMine.filter((t) => {
        const submitted = !!t.submitted;
        const status = safeStr(t.status);
        return submitted && (!status || status === "pending");
      }).length;

      const lastSubmitted =
        tsMine
          .filter((t) => !!t.submittedAt)
          .map((t) => toDateSafe(t.submittedAt)?.toISOString() || null)
          .filter(Boolean)
          .sort((a, b) => (a > b ? -1 : 1))[0] || null;

      setTimesheetStats({ weekHours, pending, lastSubmitted });

      // ============================================================
      // 7) Latest timesheet query (unchanged)
      // ============================================================
      let latestQuery = null;
      if (userCode) {
        const qSnap = await getDocs(
          query(collection(db, "timesheetQueries"), where("employeeCode", "==", userCode), limit(30))
        );
        const allQueries = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const openUnapproved = allQueries.filter((qObj) => {
          const qStatus = safeStr(qObj.status || "open");
          const isOpen = !qStatus || qStatus === "open" || qStatus === "pending";
          if (!isOpen) return false;

          const tsForQuery =
            tsMine.find((t) => t.id === qObj.timesheetId) ||
            (qObj.weekStart
              ? tsMine.find((t) => safeStr(t.weekStart) === safeStr(qObj.weekStart))
              : null);

          const tsApproved =
            tsForQuery &&
            (safeStr(tsForQuery.status) === "approved" ||
              tsForQuery.approved === true ||
              !!tsForQuery.approvedAt);

          return !tsApproved;
        });

        openUnapproved.sort((a, b) => {
          const da = toDateSafe(a.createdAt) ?? new Date(0);
          const dbb = toDateSafe(b.createdAt) ?? new Date(0);
          return dbb - da;
        });

        latestQuery = openUnapproved[0] || null;
      }
      setLatestTimesheetQuery(latestQuery);
    } finally {
      setBusy(false);
    }
  }, [
    employee,
    user,
    currentYear,
    isBankHoliday,
  ]);

  useEffect(() => {
    loadPersonal();
  }, [loadPersonal]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPersonal();
    setRefreshing(false);
  }, [loadPersonal]);

  const noteTone = "#0F766E";
  const noteMarkedDates = useMemo(() => {
    const marks = {};
    const start = parseYMD(noteStartDate);
    const end = parseYMD(noteDateMode === "multi" ? noteEndDate || noteStartDate : noteStartDate);

    if (!start || !end) return marks;

    eachDateInclusive(start, end).forEach((day) => {
      const date = isoDate(day);
      marks[date] = {
        color: withAlpha(noteTone, 0.42),
        textColor: "#fff",
      };
    });

    marks[noteStartDate] = {
      ...(marks[noteStartDate] || {}),
      startingDay: true,
      color: noteTone,
      textColor: "#fff",
    };

    const endDate = noteDateMode === "multi" ? noteEndDate || noteStartDate : noteStartDate;
    marks[endDate] = {
      ...(marks[endDate] || {}),
      endingDay: true,
      color: noteTone,
      textColor: "#fff",
    };

    return marks;
  }, [noteStartDate, noteEndDate, noteDateMode, noteTone]);

  const handleNoteDayPress = (day) => {
    const selected = day?.dateString;
    if (!selected) return;

    if (activeNoteDateField === "end") {
      if (noteStartDate && parseYMD(selected) < parseYMD(noteStartDate)) {
        setNoteEndDate(noteStartDate);
        setNoteStartDate(selected);
      } else {
        setNoteEndDate(selected === noteStartDate ? "" : selected);
      }
      setActiveNoteDateField(null);
      return;
    }

    if (noteEndDate && parseYMD(selected) > parseYMD(noteEndDate)) {
      setNoteStartDate(selected);
      setNoteEndDate("");
      setActiveNoteDateField(null);
      return;
    }

    setNoteStartDate(selected);
    setActiveNoteDateField(null);
  };

  if (loading || !isAuthed) return null;

  const queryCard = latestTimesheetQuery;
  const queryWeekLabel = queryCard?.weekStart ? formatWeekLabel(queryCard.weekStart) : null;
  const queryFieldLabel = fieldLabel(queryCard?.field);
  const queryDay = queryCard?.day;
  const profileTone = "#64748B";
  const timesheetTone = "#CA8A04";
  const holidayTone = "#16A34A";
  const currentNoteEmployeeName = String(
    employee?.name ||
      employee?.displayName ||
      user?.displayName ||
      (account.name === "Unknown User" ? "" : account.name) ||
      ""
  ).trim();
  const currentNoteCreatorId = user?.uid || employee?.employeeId || "";
  const currentNoteAuditEmail = String(
    user?.email ||
      employee?.email ||
      (account.email === "No email" ? "" : account.email) ||
      ""
  ).trim();

  const loadSentNotes = async () => {
    const noteMap = new Map();
    const lookups = [];

    if (currentNoteCreatorId) {
      lookups.push(
        query(collection(db, "notes"), where("createdByUid", "==", currentNoteCreatorId), limit(120))
      );
    }
    if (currentNoteEmployeeName) {
      lookups.push(
        query(collection(db, "notes"), where("employee", "==", currentNoteEmployeeName), limit(120)),
        query(collection(db, "notes"), where("employeeName", "==", currentNoteEmployeeName), limit(120))
      );
    }

    if (lookups.length === 0) {
      setSentNotes([]);
      return;
    }

    setNoteHistoryLoading(true);
    try {
      const snaps = await Promise.all(lookups.map((qRef) => getDocs(qRef)));
      snaps.forEach((snap) => {
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const isMine =
            (currentNoteCreatorId && data.createdByUid === currentNoteCreatorId) ||
            (data.source === "mobile" &&
              currentNoteEmployeeName &&
              [data.employee, data.employeeName, data.createdByName].includes(currentNoteEmployeeName));

          if (isMine) noteMap.set(docSnap.id, { id: docSnap.id, ...data });
        });
      });

      setSentNotes(groupSentNotes(Array.from(noteMap.values())));
    } catch (error) {
      console.warn("Failed to load sent notes:", error);
      Alert.alert("Could not load notes", "Please try again.");
    } finally {
      setNoteHistoryLoading(false);
    }
  };

  const toggleNoteHistory = async () => {
    const nextOpen = !noteHistoryOpen;
    setNoteHistoryOpen(nextOpen);
    if (nextOpen) await loadSentNotes();
  };

  const deleteSentNote = (noteGroup) => {
    Alert.alert("Delete note", "Remove this sent note from the dashboard?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingNoteKey(noteGroup.key);
          try {
            const batch = writeBatch(db);
            noteGroup.docIds.forEach((id) => {
              batch.delete(doc(db, "notes", id));
            });
            await batch.commit();
            setSentNotes((prev) => prev.filter((item) => item.key !== noteGroup.key));
          } catch (error) {
            console.warn("Failed to delete sent note:", error);
            Alert.alert("Could not delete note", "Please try again.");
          } finally {
            setDeletingNoteKey("");
          }
        },
      },
    ]);
  };

  const submitNote = async () => {
    const text = noteText.trim();
    const start = parseYMD(noteStartDate);
    const end = parseYMD(noteDateMode === "multi" ? noteEndDate || noteStartDate : noteStartDate);
    const employeeName = currentNoteEmployeeName;
    const auditEmail = currentNoteAuditEmail;

    if (!start) {
      Alert.alert("Check date", "Enter a start date as YYYY-MM-DD.");
      return;
    }
    if (!end) {
      Alert.alert("Check date", "Enter an end date as YYYY-MM-DD, or leave it blank.");
      return;
    }
    if (end < start) {
      Alert.alert("Check date", "End date cannot be before the start date.");
      return;
    }
    if (!text) {
      Alert.alert("Add note", "Write the note you want to send.");
      return;
    }
    if (noteBlocksBookings && !employeeName) {
      Alert.alert("Missing employee", "Your employee name is needed to block bookings.");
      return;
    }

    const days = eachDateInclusive(start, end);
    if (days.length > 366) {
      Alert.alert("Date range too long", "Please send notes for one year or less at a time.");
      return;
    }

    const startISO = isoDate(start);
    const endISO = isoDate(end);
    const isMultiDay = days.length > 1;
    const noteBatchId = doc(collection(db, "notes")).id;

    setSavingNote(true);
    try {
      const batch = writeBatch(db);

      days.forEach((day) => {
        const date = isoDate(day);
        const ref = doc(collection(db, "notes"));
        batch.set(ref, {
          employee: employeeName,
          employeeName,
          blocksEmployeeBooking: noteBlocksBookings,
          date,
          text,
          noteBatchId,
          isMultiDay,
          ...(isMultiDay ? { startDate: startISO, endDate: endISO } : {}),
          createdAt: serverTimestamp(),
          createdByUid: user?.uid || employee?.employeeId || null,
          createdByEmail: auditEmail || null,
          createdByName: employeeName,
          source: "mobile",
        });
      });

      await batch.commit();
      setNoteText("");
      setNoteEndDate("");
      if (noteHistoryOpen) await loadSentNotes();
      Alert.alert("Note sent", isMultiDay ? "Your notes have been added for each day." : "Your note has been added.");
    } catch (error) {
      console.warn("Failed to submit profile note:", error);
      Alert.alert("Could not send note", "Please try again.");
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
        >
          {/* My Profile */}
          <View
            style={[
              styles.sectionCard,
              dashboardCards.sectionCard,
            ]}
          >
            <View style={styles.sectionHeader}>
              <Text style={[styles.profileTitle, { color: colors.text }]}>My Profile</Text>
              <View style={styles.profileActionRow}>
                <TouchableOpacity
                  style={[
                    styles.sectionCountPill,
                    {
                      backgroundColor: withAlpha(profileTone, 0.13),
                      borderColor: withAlpha(profileTone, 0.4),
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => router.push("/settings")}
                >
                  <Icon name="settings" size={13} color={profileTone} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.sectionCountPill,
                    {
                      backgroundColor: withAlpha(profileTone, 0.13),
                      borderColor: withAlpha(profileTone, 0.4),
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => router.push("/edit-profile")}
                >
                  <Icon name="user" size={13} color={profileTone} />
                </TouchableOpacity>
              </View>
            </View>

            <View
              style={[
                styles.infoRow,
                dashboardCards.nestedCard,
              ]}
            >
              <View
                style={[
                  styles.infoIconWrap,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.9),
                    borderColor: withAlpha(colors.border, 0.82),
                  },
                ]}
              >
                <Icon name="mail" size={14} color={colors.textMuted} />
              </View>
              <Text style={[styles.cardRowText, { color: colors.text }]} numberOfLines={1}>
                {account.email}
              </Text>
            </View>

            <View
              style={[
                styles.infoRow,
                dashboardCards.nestedCard,
              ]}
            >
              <View
                style={[
                  styles.infoIconWrap,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.9),
                    borderColor: withAlpha(colors.border, 0.82),
                  },
                ]}
              >
                <Icon name="hash" size={14} color={colors.textMuted} />
              </View>
              <Text style={[styles.cardRowText, { color: colors.text }]}>Code: {account.userCode}</Text>
            </View>
          </View>

          {/* Add Note */}
          <View
            style={[
              styles.sectionCard,
              dashboardCards.sectionCard,
              styles.flatSectionCard,
            ]}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleWrap}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Add Note</Text>
                <Text style={[styles.sectionSubTitle, { color: colors.textMuted }]}>
                  Availability update
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.noteHistoryButton,
                  {
                    backgroundColor: withAlpha(noteTone, 0.13),
                    borderColor: withAlpha(noteTone, 0.4),
                  },
                ]}
                activeOpacity={0.85}
                onPress={toggleNoteHistory}
              >
                <Icon name={noteHistoryOpen ? "chevron-up" : "clock"} size={13} color={noteTone} />
                <Text style={[styles.noteHistoryButtonText, { color: noteTone }]}>
                  {noteHistoryOpen ? "Hide" : "History"}
                </Text>
              </TouchableOpacity>
            </View>

            <View
              style={[
                styles.sectionPanel,
                styles.notePanelCompact,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.noteModeRow,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
              >
                {[
                  { key: "single", label: "Single day" },
                  { key: "multi", label: "Multi day" },
                ].map((mode) => {
                  const active = noteDateMode === mode.key;
                  return (
                    <TouchableOpacity
                      key={mode.key}
                      style={[
                        styles.noteModeButton,
                        {
                          backgroundColor: active ? withAlpha(noteTone, 0.16) : "transparent",
                          borderColor: active ? withAlpha(noteTone, 0.55) : "transparent",
                        },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => {
                        setNoteDateMode(mode.key);
                        setActiveNoteDateField(null);
                        if (mode.key === "single") setNoteEndDate("");
                      }}
                    >
                      <Icon
                        name={active ? "check-circle" : "circle"}
                        size={14}
                        color={active ? noteTone : colors.textMuted}
                      />
                      <Text
                        style={[
                          styles.noteModeText,
                          { color: active ? noteTone : colors.textMuted },
                        ]}
                      >
                        {mode.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.dateSelectRow}>
                <TouchableOpacity
                  style={[
                    styles.dateSelectButton,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor:
                        activeNoteDateField === "start" ? noteTone : colors.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() =>
                    setActiveNoteDateField((field) => (field === "start" ? null : "start"))
                  }
                >
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Start</Text>
                  <View style={styles.dateSelectValueRow}>
                    <Text style={[styles.dateSelectValue, { color: colors.text }]}>
                      {formatDateCompact(noteStartDate) || "Select date"}
                    </Text>
                    <Icon name="calendar" size={15} color={noteTone} />
                  </View>
                </TouchableOpacity>

                {noteDateMode === "multi" ? (
                  <TouchableOpacity
                    style={[
                      styles.dateSelectButton,
                      {
                        backgroundColor: colors.surfaceAlt,
                        borderColor: activeNoteDateField === "end" ? noteTone : colors.border,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() =>
                      setActiveNoteDateField((field) => (field === "end" ? null : "end"))
                    }
                  >
                    <Text style={[styles.inputLabel, { color: colors.textMuted }]}>End</Text>
                    <View style={styles.dateSelectValueRow}>
                      <Text style={[styles.dateSelectValue, { color: colors.text }]}>
                        {formatDateCompact(noteEndDate || noteStartDate) || "Select date"}
                      </Text>
                      <Icon name="calendar" size={15} color={noteTone} />
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>

              {activeNoteDateField ? (
                <View
                  style={[
                    styles.calendarWrap,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Calendar
                    current={
                      activeNoteDateField === "end"
                        ? noteEndDate || noteStartDate
                        : noteStartDate
                    }
                    onDayPress={handleNoteDayPress}
                    markedDates={noteMarkedDates}
                    markingType="period"
                    theme={{
                      calendarBackground: colors.surfaceAlt,
                      dayTextColor: colors.text,
                      monthTextColor: colors.text,
                      arrowColor: noteTone,
                      selectedDayBackgroundColor: noteTone,
                      selectedDayTextColor: "#fff",
                      todayTextColor: noteTone,
                    }}
                  />
                </View>
              ) : null}

              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Note</Text>
              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Short note"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.noteInput,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
              />

              <View style={styles.noteFooterRow}>
                <TouchableOpacity
                  style={styles.checkRow}
                  activeOpacity={0.85}
                  onPress={() => setNoteBlocksBookings((v) => !v)}
                >
                  <Icon
                    name={noteBlocksBookings ? "check-square" : "square"}
                    size={17}
                    color={noteBlocksBookings ? noteTone : colors.textMuted}
                  />
                  <Text style={[styles.checkRowText, { color: colors.text }]}>
                    Block bookings
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.sectionAction,
                    styles.noteSendAction,
                    {
                      backgroundColor: withAlpha(noteTone, savingNote ? 0.08 : 0.13),
                      borderColor: withAlpha(noteTone, 0.4),
                      opacity: savingNote ? 0.65 : 1,
                    },
                  ]}
                  onPress={submitNote}
                  activeOpacity={0.9}
                  disabled={savingNote}
                >
                  {savingNote ? (
                    <ActivityIndicator size="small" color={noteTone} />
                  ) : (
                    <Icon name="send" size={14} color={noteTone} />
                  )}
                  <Text style={[styles.sectionActionText, { color: noteTone }]}>
                    {savingNote ? "Sending" : "Send"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {noteHistoryOpen ? (
              <View
                style={[
                  styles.noteHistoryPanel,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                {noteHistoryLoading ? (
                  <View style={styles.noteHistoryLoading}>
                    <ActivityIndicator size="small" color={noteTone} />
                    <Text style={[styles.noteHistoryMeta, { color: colors.textMuted }]}>
                      Loading notes
                    </Text>
                  </View>
                ) : sentNotes.length === 0 ? (
                  <Text style={[styles.noteHistoryMeta, { color: colors.textMuted }]}>
                    No sent notes yet
                  </Text>
                ) : (
                  sentNotes.map((item) => (
                    <View
                      key={item.key}
                      style={[
                        styles.noteHistoryItem,
                        {
                          backgroundColor: colors.surfaceAlt,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.noteHistoryTextWrap}>
                        <Text style={[styles.noteHistoryDate, { color: noteTone }]}>
                          {formatNoteHistoryRange(item)}
                        </Text>
                        <Text
                          style={[styles.noteHistoryText, { color: colors.text }]}
                          numberOfLines={2}
                        >
                          {item.text}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.noteHistoryDelete,
                          {
                            backgroundColor: withAlpha(colors.danger || "#dc2626", 0.12),
                            borderColor: withAlpha(colors.danger || "#dc2626", 0.35),
                          },
                        ]}
                        activeOpacity={0.85}
                        onPress={() => deleteSentNote(item)}
                        disabled={deletingNoteKey === item.key}
                      >
                        {deletingNoteKey === item.key ? (
                          <ActivityIndicator size="small" color={colors.danger || "#dc2626"} />
                        ) : (
                          <Icon name="trash-2" size={14} color={colors.danger || "#dc2626"} />
                        )}
                      </TouchableOpacity>
                    </View>
                  ))
                )}
              </View>
            ) : null}
          </View>

          {/* Timesheet Snapshot */}
          <View
            style={[
              styles.sectionCard,
              dashboardCards.sectionCard,
              styles.flatSectionCard,
            ]}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleWrap}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Timesheet</Text>
                <Text style={[styles.sectionSubTitle, { color: colors.textMuted }]}>
                  Weekly hours and approvals
                </Text>
              </View>
              <View
                style={[
                  styles.sectionCountPill,
                  {
                    backgroundColor: withAlpha(timesheetTone, 0.13),
                    borderColor: withAlpha(timesheetTone, 0.4),
                  },
                ]}
              >
                <Text style={[styles.sectionCountText, { color: timesheetTone }]}>
                  Pending: {timesheetStats.pending}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.sectionPanel,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {busy ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                </View>
              ) : (
                <>
                  <View style={styles.statRow}>
                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>This Week</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>
                        {formatTimesheetHours(timesheetStats.weekHours)}
                      </Text>
                    </View>

                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Pending</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{timesheetStats.pending}</Text>
                    </View>

                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Last Submitted</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>
                        {formatDateShort(timesheetStats.lastSubmitted) || "—"}
                      </Text>
                    </View>
                  </View>

                  {queryCard && (
                    <TouchableOpacity
                      style={[
                        styles.queryCard,
                        { borderColor: "#f97316", backgroundColor: colors.surface },
                      ]}
                      activeOpacity={0.9}
                      onPress={() => router.push(`/(protected)/query/${queryCard.id}`)}
                    >
                      <View style={styles.queryIcon}>
                        <Icon name="alert-circle" size={16} color="#f97316" />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={[styles.queryTitle, { color: colors.text }]}>
                          Manager queried your timesheet
                        </Text>

                        <Text style={[styles.querySubtitle, { color: colors.textMuted }]}>
                          {queryWeekLabel
                            ? `Week of ${queryWeekLabel}${queryDay ? ` – ${queryDay}` : ""}`
                            : "Recent submission"}
                        </Text>

                        <Text style={[styles.queryBody, { color: colors.text }]} numberOfLines={2}>
                          “{queryCard.note || "Please review this week’s times."}”
                          {queryFieldLabel ? ` (about ${queryFieldLabel})` : ""}
                        </Text>

                        <View style={styles.queryFooterRow}>
                          <Text style={[styles.queryFooterText, { color: colors.textMuted }]}>
                            Tap to view preview & respond
                          </Text>
                          <Icon name="chevron-right" size={14} color={colors.textMuted} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.sectionAction,
                      styles.sectionActionPrimary,
                      {
                        backgroundColor: withAlpha(timesheetTone, 0.13),
                        borderColor: withAlpha(timesheetTone, 0.4),
                      },
                    ]}
                    onPress={() => router.push("/timesheet")}
                  >
                    <Icon name="clock" size={14} color={timesheetTone} />
                    <Text style={[styles.sectionActionText, { color: timesheetTone }]}>
                      Open Timesheet
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

          {/* Holidays Snapshot (CURRENT YEAR, allowance includes carryover) */}
          <View
            style={[
              styles.sectionCard,
              dashboardCards.sectionCard,
              styles.flatSectionCard,
            ]}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleWrap}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Holidays</Text>
                <Text style={[styles.sectionSubTitle, { color: colors.textMuted }]}>
                  Allowance, usage and requests
                </Text>
              </View>
              <View
                style={[
                  styles.sectionCountPill,
                  {
                    backgroundColor: withAlpha(holidayTone, 0.13),
                    borderColor: withAlpha(holidayTone, 0.4),
                  },
                ]}
              >
                <Text style={[styles.sectionCountText, { color: holidayTone }]}>
                  {currentYear}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.sectionPanel,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {busy ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="small" color={colors.textMuted} />
                </View>
              ) : myHolidays.length === 0 ? (
                <Text style={[styles.statusText, { color: colors.textMuted }]}>No holiday records</Text>
              ) : (
                <>
                  <View style={styles.statRow}>
                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                        Allowance ({currentYear})
                      </Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayAllowance)}</Text>
                    </View>

                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Used</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayUsedDays)}</Text>
                    </View>

                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Remaining</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayRemaining)}</Text>
                    </View>
                  </View>

                  <View style={styles.cardRow}>
                    <Icon name="calendar" size={16} color={colors.textMuted} />
                    <Text style={[styles.cardRowText, { color: colors.text }]}>
                      Next: {formatHoliday(nextHoliday) || "—"}
                    </Text>
                  </View>

                  <View style={styles.cardRow}>
                    <Icon name="alert-circle" size={16} color={colors.textMuted} />
                    <Text style={[styles.cardRowText, { color: colors.text }]}>
                      Pending requests: {pendingHolidayCount}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.sectionAction,
                      {
                        backgroundColor: withAlpha(holidayTone, 0.13),
                        borderColor: withAlpha(holidayTone, 0.4),
                      },
                    ]}
                    onPress={() => router.push("/holidaypage")}
                  >
                    <Icon name="briefcase" size={14} color={holidayTone} />
                    <Text style={[styles.sectionActionText, { color: holidayTone }]}>
                      Manage Holidays
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

          <View style={{ height: 12 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

/* ───────────────────────── Helpers (match HolidayPage) ───────────────────────── */
function safeStr(v) {
  return String(v ?? "").trim().toLowerCase();
}

function canonicalEmployeeCode(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits ? digits.padStart(4, "0") : safeStr(raw);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function employeeMatchesHoliday(h, empRecord, sessionEmployee, user) {
  const employeeIds = [
    empRecord?.id,
    empRecord?.employeeId,
    empRecord?.uid,
    empRecord?.authUid,
    sessionEmployee?.employeeId,
    sessionEmployee?.id,
    sessionEmployee?.uid,
    user?.uid,
  ]
    .map(safeStr)
    .filter(Boolean);

  const holidayIds = [
    h?.employeeId,
    h?.employeeDocId,
    h?.staffId,
    h?.userId,
    h?.uid,
    h?.authUid,
    h?.employeeUid,
  ]
    .map(safeStr)
    .filter(Boolean);

  if (holidayIds.some((id) => employeeIds.includes(id))) return true;

  const employeeCodes = [
    empRecord?.userCode,
    empRecord?.employeeCode,
    empRecord?.code,
    sessionEmployee?.userCode,
    sessionEmployee?.employeeCode,
    sessionEmployee?.code,
  ]
    .map(canonicalEmployeeCode)
    .filter(Boolean);

  const holidayCodes = [
    h?.employeeCode,
    h?.userCode,
    h?.code,
    h?.staffCode,
    h?.requestedByCode,
    h?.createdByCode,
    h?.driverCode,
  ]
    .map(canonicalEmployeeCode)
    .filter(Boolean);

  if (holidayCodes.some((code) => employeeCodes.includes(code))) return true;

  const employeeNames = [
    empRecord?.name,
    empRecord?.displayName,
    sessionEmployee?.name,
    sessionEmployee?.displayName,
    sessionEmployee?.fullName,
    user?.displayName,
  ]
    .map(safeStr)
    .filter(Boolean);

  const holidayNames = [
    h?.employee,
    h?.name,
    h?.employeeName,
    h?.displayName,
    h?.staffName,
    h?.requestedBy,
    h?.requestedByName,
    h?.createdByName,
  ]
    .map(safeStr)
    .filter(Boolean);

  if (holidayNames.some((name) => employeeNames.includes(name))) return true;

  const employeeEmails = [empRecord?.email, sessionEmployee?.email, user?.email]
    .map(safeStr)
    .filter(Boolean);

  const holidayEmails = [
    h?.email,
    h?.employeeEmail,
    h?.userEmail,
    h?.requestedByEmail,
    h?.createdByEmail,
  ]
    .map(safeStr)
    .filter(Boolean);

  return holidayEmails.some((email) => employeeEmails.includes(email));
}

function roundToHalf(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 2) / 2;
}

function fmtHalf(n) {
  const x = roundToHalf(n);
  return String(x).includes(".") ? String(x).replace(/\.0$/, "") : String(x);
}

function numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function yearKey(y) {
  return String(y);
}
function getAllowanceForYear(emp, y) {
  const Y = yearKey(y);

  const holidayAllowances = emp?.holidayAllowances || emp?.holidayAllowanceByYear || {};
  const carryoverByYear =
    emp?.carryoverByYear || emp?.carryOverByYear || emp?.carriedOverByYear || {};

  const allowance = numOrZero(holidayAllowances?.[Y]) || numOrZero(emp?.holidayAllowance);
  const carryOver =
    numOrZero(carryoverByYear?.[Y]) ||
    numOrZero(emp?.carriedOverDays) ||
    numOrZero(emp?.carryOverDays);

  return { allowance, carryOver };
}

/** Parse "YYYY-MM-DD" safely at local midnight (no TZ shift). */
function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const [, Y, M, D] = m.map(Number);
  return new Date(Y, M - 1, D, 0, 0, 0, 0);
}

/** Safer Firestore -> Date conversion (prefers strict YMD strings). */
function toDateSafe(val) {
  if (!val) return null;
  if (typeof val === "string") {
    const strict = parseYMD(val);
    if (strict) return strict;
    const d = new Date(val);
    return Number.isNaN(+d) ? null : d;
  }
  if (val?.toDate && typeof val.toDate === "function") return val.toDate();
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getHolidayStart(h) {
  return toDateSafe(
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
    toDateSafe(
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

function isoDate(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function mondayISO(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return isoDate(date);
}
function toNumber(n, fallback = 0) {
  const num = Number(n);
  return Number.isNaN(num) ? fallback : num;
}
function minDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
function maxDate(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/* ---------- business days + half-days (matches HolidayPage schema) ---------- */
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

function eachDateInclusive(start, end) {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const out = [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

function countBusinessDaysInclusive(start, end, isBankHolidayFn = null) {
  return eachDateInclusive(start, end).filter((d) => {
    if (isWeekend(d)) return false;
    if (isBankHolidayFn && isBankHolidayFn(d)) return false;
    return true;
  }).length;
}

const normaliseAMPM = (v) => {
  const s = String(v || "").trim().toUpperCase();
  if (["AM", "A.M.", "MORNING"].includes(s)) return "AM";
  if (["PM", "P.M.", "AFTERNOON"].includes(s)) return "PM";
  return null;
};

function boolish(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = safeStr(v);
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function getHalfMeta(h) {
  const startHalfFlag = boolish(h.startHalfDay ?? h.startHalf ?? h.startHalfday);
  const endHalfFlag = boolish(h.endHalfDay ?? h.endHalf ?? h.endHalfday);

  const startAMPM = normaliseAMPM(
    h.startAMPM ?? h.startPeriod ?? h.halfDayPeriod ?? h.halfDayType
  );
  const endAMPM = normaliseAMPM(h.endAMPM ?? h.endPeriod);

  const legacySingleHalf =
    boolish(h.halfDay) || boolish(h.isHalfDay) || boolish(h.isHalf) || boolish(h.half);

  return { startHalfFlag, endHalfFlag, startAMPM, endAMPM, legacySingleHalf };
}

/**
 * ✅ Clamp-safe business-day length with half-day adjustments
 * Excludes weekends + bank holidays. Applies 0.5 reduction ONLY when clamped boundary equals original boundary.
 */
function computeBusinessDaysClamped(h, clampS, clampE, origS, origE, isBankHolidayFn = null) {
  if (!clampS || !clampE) return 0;

  const days = countBusinessDaysInclusive(clampS, clampE, isBankHolidayFn);
  if (days <= 0) return 0;

  const { startHalfFlag, endHalfFlag, startAMPM, endAMPM, legacySingleHalf } = getHalfMeta(h);

  const origStart = origS || getHolidayStart(h);
  const origEnd = origE || getHolidayEnd(h) || origStart;

  const origSingle =
    origStart && origEnd && origStart.toDateString() === origEnd.toDateString();

  const clampSingle = clampS.toDateString() === clampE.toDateString();
  if (clampSingle) {
    const nonWorking =
      isWeekend(clampS) || (isBankHolidayFn ? isBankHolidayFn(clampS) : false);
    if (nonWorking) return 0;

    const anyHalf =
      startHalfFlag || endHalfFlag || !!startAMPM || !!endAMPM || legacySingleHalf;

    if (origSingle && anyHalf) return 0.5;

    const isOrigStartDay = origStart && clampS.toDateString() === origStart.toDateString();
    const isOrigEndDay = origEnd && clampS.toDateString() === origEnd.toDateString();

    if ((isOrigStartDay && (startHalfFlag || !!startAMPM)) || (isOrigEndDay && (endHalfFlag || !!endAMPM))) {
      return 0.5;
    }

    return 1;
  }

  let reduction = 0;

  if (
    origStart &&
    clampS.toDateString() === origStart.toDateString() &&
    (startHalfFlag || !!startAMPM)
  ) {
    const startIsBusiness =
      !isWeekend(clampS) && !(isBankHolidayFn ? isBankHolidayFn(clampS) : false);
    if (startIsBusiness) reduction += 0.5;
  }

  if (
    origEnd &&
    clampE.toDateString() === origEnd.toDateString() &&
    (endHalfFlag || !!endAMPM)
  ) {
    const endIsBusiness =
      !isWeekend(clampE) && !(isBankHolidayFn ? isBankHolidayFn(clampE) : false);
    if (endIsBusiness) reduction += 0.5;
  }

  if (reduction === 0 && legacySingleHalf && origSingle) {
    if (
      origStart &&
      origEnd &&
      clampS.toDateString() === origStart.toDateString() &&
      clampE.toDateString() === origEnd.toDateString()
    ) {
      reduction += 0.5;
    }
  }

  return roundToHalf(Math.max(0, days - reduction));
}

function displayTypeAndColor(h) {
  let displayType = "Other";
  let typeColor = "#22d3ee";
  const typeStr = (h.leaveType || h.paidStatus || h.type || h.holidayType || "").toLowerCase();

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
    displayType = "Paid";
    typeColor = "#29bc5f";
  }
  return { displayType, typeColor };
}

function isApproved(h) {
  const s = safeStr(h.status || h.Status);
  return (
    s === "approved" ||
    s === "accept" ||
    s === "accepted" ||
    s === "confirmed" ||
    s === "authorised" ||
    s === "authorized" ||
    s.startsWith("approved")
  );
}

function isRequestedHoliday(h) {
  const s = safeStr(h.status || h.Status);
  return (
    !s ||
    s === "requested" ||
    s === "request" ||
    s === "pending" ||
    s === "submitted" ||
    s.includes("awaiting")
  );
}

function formatDateShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatDateCompact(iso) {
  const d = parseYMD(iso);
  if (!d) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}

function noteCreatedMillis(note) {
  const value = note?.createdAt;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate().getTime();
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}

function groupSentNotes(notes) {
  const groups = new Map();

  notes.forEach((note) => {
    const groupKey =
      note.noteBatchId ||
      `${note.text || ""}::${note.startDate || note.date || ""}::${note.endDate || note.date || ""}::${
        note.createdByUid || ""
      }`;
    const existing =
      groups.get(groupKey) || {
        key: groupKey,
        text: note.text || "",
        startDate: note.startDate || note.date,
        endDate: note.endDate || note.date,
        docIds: [],
        createdAtMs: 0,
        blocksEmployeeBooking: !!note.blocksEmployeeBooking,
      };

    existing.docIds.push(note.id);
    existing.createdAtMs = Math.max(existing.createdAtMs, noteCreatedMillis(note));
    existing.blocksEmployeeBooking =
      existing.blocksEmployeeBooking || !!note.blocksEmployeeBooking;
    if (note.date && (!existing.startDate || note.date < existing.startDate)) {
      existing.startDate = note.date;
    }
    if (note.date && (!existing.endDate || note.date > existing.endDate)) {
      existing.endDate = note.date;
    }
    groups.set(groupKey, existing);
  });

  return Array.from(groups.values())
    .sort((a, b) => {
      const aDate = a.startDate || "";
      const bDate = b.startDate || "";
      if (aDate !== bDate) return aDate > bDate ? -1 : 1;
      return b.createdAtMs - a.createdAtMs;
    })
    .slice(0, 20);
}

function formatNoteHistoryRange(note) {
  const start = formatDateCompact(note.startDate);
  const end = formatDateCompact(note.endDate);
  if (!start) return "No date";
  if (!end || end === start) return start;
  return `${start} - ${end}`;
}

function formatHoliday(h) {
  if (!h) return null;
  const s = getHolidayStart(h);
  const e = getHolidayEnd(h);
  if (!s) return null;
  const sTxt = s.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const eTxt = e ? e.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null;
  return eTxt ? `${sTxt} → ${eTxt}` : sTxt;
}

function formatWeekLabel(weekStartISO) {
  const d = new Date(weekStartISO);
  if (Number.isNaN(d.getTime())) return weekStartISO;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function fieldLabel(field) {
  const f = safeStr(field || "");
  if (!f) return "";
  if (f === "travel") return "travel times";
  if (f === "onset" || f === "on-set") return "on-set times";
  if (f === "yard") return "yard times";
  if (f === "notes") return "notes";
  if (f === "holiday") return "holiday / day off";
  return "this day";
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0b" },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.lg,
  },

  heroCard: {
    position: "relative",
    borderRadius: t.radius.xl,
    marginBottom: t.spacing.lg,
    overflow: "hidden",
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: t.spacing.sm,
    paddingTop: t.spacing.md,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  notifBtn: {
    width: t.controls.iconButton,
    height: t.controls.iconButton,
    borderRadius: t.controls.iconButton / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  badgeText: {
    color: "#0b0b0b",
    fontSize: 10,
    fontWeight: "900",
  },
  userIcon: {
    width: t.controls.iconButton,
    height: t.controls.iconButton,
    borderRadius: t.controls.iconButton / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  userInitials: { fontSize: 15, fontWeight: "900", letterSpacing: 0.4 },

  heroContent: {
    paddingHorizontal: t.spacing.sm,
    paddingBottom: t.spacing.sm,
    paddingTop: t.spacing.sm,
  },
  heroEyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },
  heroTitle: {
    marginTop: 3,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  heroSubTitle: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  heroMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  heroMetaAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: t.controls.chipMinHeight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroMetaActionPrimary: {},
  heroMetaActionText: {
    fontSize: 11,
    fontWeight: "800",
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: t.controls.chipMinHeight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    maxWidth: "100%",
  },
  heroMetaText: {
    fontSize: 11,
    fontWeight: "700",
    flexShrink: 1,
  },

  sectionCard: {
    marginBottom: 16,
    borderRadius: 16,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  flatSectionCard: {
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  panelSectionCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  sectionTitleWrap: {
    flex: 1,
    paddingRight: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  profileTitle: {
    ...t.typography.pageTitle,
    marginTop: 3,
    letterSpacing: 0.2,
  },
  sectionSubTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "600",
  },
  sectionCountPill: {
    minHeight: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  sectionPanel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  sectionCountText: {
    fontSize: 11,
    fontWeight: "900",
  },
  noteHistoryButton: {
    minHeight: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  noteHistoryButtonText: {
    fontSize: 11,
    fontWeight: "900",
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    minHeight: t.controls.buttonHeight,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  profileActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  cardRowText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  loadingWrap: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  statRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 0 },
  statCard: {
    flex: 1,
    minWidth: 94,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  flatStatCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: 0,
  },
  statLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.2 },
  statValue: { fontSize: 16, fontWeight: "900", marginTop: 3 },

  queryCard: {
    flexDirection: "row",
    padding: t.controls.cardPadding,
    borderRadius: 14,
    marginTop: 10,
    gap: 8,
    borderWidth: 1,
  },
  queryIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  queryTitle: { fontSize: 13, fontWeight: "800", marginBottom: 2 },
  querySubtitle: { fontSize: 12, marginBottom: 2 },
  queryBody: { fontSize: 12, fontStyle: "italic", marginBottom: 4 },
  queryFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  queryFooterText: { fontSize: 11, fontWeight: "600" },

  sectionAction: {
    marginTop: 18,
    alignSelf: "center",
    minHeight: t.controls.buttonHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  sectionActionPrimary: {},
  sectionActionText: {
    fontSize: 12,
    fontWeight: "800",
  },
  notePanelCompact: {
    padding: 10,
    borderRadius: 12,
  },
  noteModeRow: {
    flexDirection: "row",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    padding: 3,
    marginBottom: 8,
  },
  noteModeButton: {
    flex: 1,
    minHeight: 30,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  noteModeText: {
    fontSize: 12,
    fontWeight: "900",
  },
  dateSelectRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  dateSelectButton: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 7,
  },
  dateSelectValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  dateSelectValue: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  calendarWrap: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
    overflow: "hidden",
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  noteInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    fontWeight: "600",
  },
  noteFooterRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  checkRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 32,
  },
  checkRowText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  noteSendAction: {
    marginTop: 0,
    minHeight: 34,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  noteHistoryPanel: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
    padding: 8,
    gap: 8,
  },
  noteHistoryLoading: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  noteHistoryMeta: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  noteHistoryItem: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noteHistoryTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  noteHistoryDate: {
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 2,
  },
  noteHistoryText: {
    fontSize: 13,
    fontWeight: "700",
  },
  noteHistoryDelete: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    paddingHorizontal: 10,
  },
  emptyStateTitle: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyStateText: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center",
  },

});
