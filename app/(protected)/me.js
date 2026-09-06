import { AppButton, AppText as Text, AppPressable as TouchableOpacity, Checkbox, FormField, IconButton } from "../../components/ui/AppPrimitives";
// app/(protected)/me.js
import {
  useRouter } from "expo-router";
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
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  Alert,
  StyleSheet,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import Icon from "react-native-vector-icons/Feather";

import {
  EmptyState,
  LoadingState,
} from "../../components/AsyncState";
import PageShell from "../../components/layout/PageShell";
import { createDashboardCardStyles } from "../../lib/design/dashboard";
import { designTokens as t } from "../../lib/design/tokens";
import {
  calculateRemainingHolidayAllowance,
  holidayBelongsToYear,
} from "../../lib/holidayYear";
import { employeeMatchesHoliday } from "../../lib/holidayOwnership";
import { computeTimesheetWeekHours } from "../../lib/timesheetHours";
import {
  useEmployeeTimesheets,
  useEmployees,
  useHolidays,
  useTimesheetQueries,
} from "../../hooks/useOperationalData";

// 🔑 Provider + Firebase
import { auth, db } from "../../firebaseConfig";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { useDataCache } from "../../providers/DataCacheProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";


const ME_CACHE_TTL_MS = 10 * 60 * 1000;

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
  const employeesResource = useEmployees();
  const holidaysResource = useHolidays();
  const timesheetsResource = useEmployeeTimesheets();
  const queriesResource = useTimesheetQueries();
  const employeeRows = employeesResource.data;
  const holidayRows = holidaysResource.data;
  const employeeTimesheets = timesheetsResource.data;
  const employeeTimesheetQueries = queriesResource.data;
  const refreshEmployees = employeesResource.refresh;
  const refreshHolidays = holidaysResource.refresh;
  const refreshEmployeeTimesheets = timesheetsResource.refresh;
  const refreshEmployeeTimesheetQueries = queriesResource.refresh;
  const dashboardCards = useMemo(() => createDashboardCardStyles(colors), [colors]);

  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [personalError, setPersonalError] = useState(null);
  const [hasPersonalContent, setHasPersonalContent] = useState(false);

  // Personal data blocks
  const [myHolidays, setMyHolidays] = useState([]);
  const [nextHoliday, setNextHoliday] = useState(null);
  const [pendingHolidayCount, setPendingHolidayCount] = useState(0);

  // Allowance + used + booked + remaining (CURRENT YEAR)
  const [holidayAllowance, setHolidayAllowance] = useState(0); // totalAllowance (allowance + carryover)
  const [holidayUsedDays, setHolidayUsedDays] = useState(0);
  const [holidayBookedDays, setHolidayBookedDays] = useState(0);
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
  const [noteComposerOpen, setNoteComposerOpen] = useState(false);
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
  const dataCache = useDataCache();

  const hydrateDashboardState = useCallback((payload) => {
    const safePayload = payload || {};

    setMyHolidays(Array.isArray(safePayload.myHolidays) ? safePayload.myHolidays : []);
    setNextHoliday(safePayload.nextHoliday || null);
    setPendingHolidayCount(safePayload.pendingHolidayCount || 0);
    setHolidayAllowance(safePayload.holidayAllowance || 0);
    setHolidayUsedDays(safePayload.holidayUsedDays || 0);
    setHolidayBookedDays(safePayload.holidayBookedDays || 0);
    setHolidayRemaining(safePayload.holidayRemaining || 0);
    setTimesheetStats(
      safePayload.timesheetStats && typeof safePayload.timesheetStats === "object"
        ? {
            weekHours: safePayload.timesheetStats.weekHours || 0,
            pending: safePayload.timesheetStats.pending || 0,
            lastSubmitted: safePayload.timesheetStats.lastSubmitted || null,
          }
        : { weekHours: 0, pending: 0, lastSubmitted: null }
    );
    setLatestTimesheetQuery(safePayload.latestTimesheetQuery || null);
  }, []);

  const loadPersonal = useCallback(async (options = {}) => {
    const forceRefresh = Boolean(options?.forceRefresh);
    const cacheKey = employee?.userCode || employee?.employeeId || user?.uid || "";
    const cacheRecordKey = cacheKey ? `me-dashboard:v3:${cacheKey}` : "";
    let cachedRecord = null;

    if (cacheRecordKey && dataCache?.read) {
      try {
        cachedRecord = await dataCache.read(cacheRecordKey);
        if (!forceRefresh && cachedRecord && !dataCache.isExpired(cachedRecord, ME_CACHE_TTL_MS)) {
          hydrateDashboardState(cachedRecord.data || {});
          setHasPersonalContent(true);
          setPersonalError(null);
          setBusy(false);
          return;
        }

        if (cachedRecord?.data) {
          hydrateDashboardState(cachedRecord.data || {});
          setHasPersonalContent(true);
        }
      } catch (err) {
        console.warn("Failed to read dashboard cache:", err);
      }
    }

    setBusy(!cachedRecord?.data);
    setPersonalError(null);
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
        setHolidayBookedDays(0);
        setHolidayRemaining(0);
        setTimesheetStats({ weekHours: 0, pending: 0, lastSubmitted: null });
        setLatestTimesheetQuery(null);
        return;
      }

      // ============================================================
      // 1) Find employee record (same approach as HolidayPage)
      // ============================================================
      const empRecord = employeeRows.find((candidate) => {
        const candidateCode = String(candidate.userCode || "").trim();
        const candidateEmail = String(candidate.email || "").trim().toLowerCase();
        const candidateName = String(candidate.name || candidate.displayName || "")
          .trim()
          .toLowerCase();
        return (
          (!!userCode && candidateCode === String(userCode).trim()) ||
          (!!email && candidateEmail === String(email).trim().toLowerCase()) ||
          (!!empName && candidateName === String(empName).trim().toLowerCase())
        );
      }) || null;

      // ============================================================
      // 2) Load my holidays (filter like HolidayPage: name OR code)
      // ============================================================
      const mine = holidayRows.filter((holiday) =>
        employeeMatchesHoliday(holiday, empRecord, employee, user)
      );
      const mineForYear = mine.filter((holiday) =>
        holidayBelongsToYear(holiday, currentYear, getHolidayStart(holiday))
      );

      setMyHolidays(mineForYear);

      // ============================================================
      // 3) CURRENT YEAR allowance (match HolidayPage maps)
      // ============================================================
      const { allowance, carryOver } = getAllowanceForYear(empRecord, currentYear);
      const totalAllowance = (allowance || 0) + (carryOver || 0);

      setHolidayAllowance(roundToHalf(totalAllowance));

      // ============================================================
      // 4) CURRENT YEAR taken / available (Paid only, approved only)
      //    - assigns the full holiday to the year in which it starts
      //    - ✅ supports half-days
      //    - ✅ excludes weekends + bank holidays
      // ============================================================
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let paidTaken = 0;
      let paidBooked = 0;

      for (const h of mineForYear) {
        if (!isApproved(h)) continue;

        const { displayType } = displayTypeAndColor(h);
        if (displayType !== "Paid") continue;

        const origS = getHolidayStart(h);
        const origE = getHolidayEnd(h) || origS;
        if (!origS) continue;

        const days = computeBusinessDaysClamped(h, origS, origE, origS, origE, isBankHoliday);
        if (origE < today) paidTaken += days;
        else paidBooked += days;
      }

      const used = roundToHalf(paidTaken);
      const booked = roundToHalf(paidBooked);
      const remaining = roundToHalf(
        calculateRemainingHolidayAllowance(totalAllowance, used, booked)
      );

      setHolidayUsedDays(used);
      setHolidayBookedDays(booked);
      setHolidayRemaining(remaining);

      // ============================================================
      // 5) Next holiday + pending count (simple, based on mine)
      // ============================================================
      const pendingCount = mineForYear.filter((h) => {
        return isRequestedHoliday(h);
      }).length;
      setPendingHolidayCount(pendingCount);

      const upcomingApproved = mineForYear
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

      const nextHolidayValue = upcomingApproved[0] || null;
      setNextHoliday(nextHolidayValue);

      // ============================================================
      // 6) Timesheet stats (unchanged)
      // ============================================================
      const tsMine = userCode ? employeeTimesheets : [];

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
        const allQueries = employeeTimesheetQueries;

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
      setHasPersonalContent(true);

      if (cacheRecordKey && dataCache?.write) {
        await dataCache.write(
          cacheRecordKey,
          {
            myHolidays: mineForYear,
            nextHoliday: nextHolidayValue,
            pendingHolidayCount: pendingCount,
            holidayAllowance: roundToHalf(totalAllowance),
            holidayUsedDays: used,
            holidayBookedDays: booked,
            holidayRemaining: remaining,
            timesheetStats: {
              weekHours,
              pending,
              lastSubmitted,
            },
            latestTimesheetQuery: latestQuery,
          },
          ME_CACHE_TTL_MS
        );
      }
    } catch (err) {
      setPersonalError(err);
      if (cachedRecord?.data) {
        hydrateDashboardState(cachedRecord.data || {});
        setHasPersonalContent(true);
      } else {
        setHasPersonalContent(false);
        setMyHolidays([]);
        setNextHoliday(null);
        setPendingHolidayCount(0);
        setHolidayAllowance(0);
        setHolidayUsedDays(0);
        setHolidayBookedDays(0);
        setHolidayRemaining(0);
        setTimesheetStats({ weekHours: 0, pending: 0, lastSubmitted: null });
        setLatestTimesheetQuery(null);
      }
      console.warn("Failed to load dashboard data:", err);
    } finally {
      setBusy(false);
    }
  }, [
    dataCache,
    employee,
    employeeRows,
    employeeTimesheetQueries,
    employeeTimesheets,
    holidayRows,
    user,
    currentYear,
    isBankHoliday,
    hydrateDashboardState,
  ]);

  useEffect(() => {
    loadPersonal({ forceRefresh: true });
  }, [loadPersonal]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refreshEmployees(),
        refreshHolidays(),
        refreshEmployeeTimesheets(),
        refreshEmployeeTimesheetQueries(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [
    refreshEmployeeTimesheetQueries,
    refreshEmployeeTimesheets,
    refreshEmployees,
    refreshHolidays,
  ]);

  const noteTone = staticColors.hex_0f766e_adtgo2;
  const noteMarkedDates = useMemo(() => {
    const marks = {};
    const start = parseYMD(noteStartDate);
    const end = parseYMD(noteDateMode === "multi" ? noteEndDate || noteStartDate : noteStartDate);

    if (!start || !end) return marks;

    eachDateInclusive(start, end).forEach((day) => {
      const date = isoDate(day);
      marks[date] = {
        color: withAlpha(noteTone, 0.42),
        textColor: staticColors.hex_fff_yhjmu8,
      };
    });

    marks[noteStartDate] = {
      ...(marks[noteStartDate] || {}),
      startingDay: true,
      color: noteTone,
      textColor: staticColors.hex_fff_yhjmu8,
    };

    const endDate = noteDateMode === "multi" ? noteEndDate || noteStartDate : noteStartDate;
    marks[endDate] = {
      ...(marks[endDate] || {}),
      endingDay: true,
      color: noteTone,
      textColor: staticColors.hex_fff_yhjmu8,
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
  const profileTone = staticColors.hex_64748b_4jwrvh;
  const holidayTone = staticColors.hex_16a34a_a5i1hi;
  const holidayUsageProgress = holidayAllowance > 0
    ? Math.min(1, Math.max(0, (holidayUsedDays + holidayBookedDays) / holidayAllowance))
    : 0;
  const profileInitials = String(account.name || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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
    <PageShell
      refresh={{ refreshing, onRefresh }}
      state={{
        resources: [
          employeesResource,
          holidaysResource,
          timesheetsResource,
          queriesResource,
          {
            isInitialLoading: busy,
            isRefreshing: refreshing,
            error: personalError,
          },
        ],
        hasContent: hasPersonalContent,
        onRetry: onRefresh,
        loadingLabel: "Loading your profile…",
      }}
    >
          {/* Compact profile identity */}
          <View
            style={[
              styles.sectionCard,
              dashboardCards.sectionCard,
              styles.profileCard,
            ]}
          >
            <View style={styles.profileIdentityRow}>
              <View
                style={[
                  styles.profileAvatar,
                  {
                    backgroundColor: withAlpha(profileTone, 0.14),
                    borderColor: withAlpha(profileTone, 0.42),
                  },
                ]}
              >
                <Text style={[styles.profileAvatarText, { color: profileTone }]}>
                  {profileInitials || "ME"}
                </Text>
              </View>
              <View style={styles.profileIdentityCopy}>
                <Text style={[styles.profileTitle, { color: colors.text }]} numberOfLines={1}>
                  {account.name}
                </Text>
                <Text style={[styles.profileMeta, { color: colors.textMuted }]} numberOfLines={1}>
                  {account.email}
                </Text>
                <Text style={[styles.profileCode, { color: colors.textMuted }]}>Code {account.userCode}</Text>
              </View>
              <View style={styles.profileActionRow}>
                <TouchableOpacity
                  style={[
                    styles.profileActionButton,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => router.push("/settings")}
                  accessibilityRole="button"
                  accessibilityLabel="Open settings"
                >
                  <Icon name="settings" size={16} color={colors.text} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.profileEditButton,
                    {
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => router.push("/edit-profile")}
                  accessibilityRole="button"
                  accessibilityLabel="Edit my profile"
                >
                  <Icon name="edit-2" size={14} color={colors.text} />
                  <Text style={[styles.profileEditText, { color: colors.text }]}>Edit</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Availability */}
          <View
            style={[
              styles.sectionCard,
              dashboardCards.sectionCard,
              styles.flatSectionCard,
            ]}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleWrap}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Availability</Text>
                <Text style={[styles.sectionSubTitle, { color: colors.textMuted }]}>
                  Tell the office when you cannot be booked
                </Text>
              </View>
              <View style={styles.availabilityActions}>
                <TouchableOpacity
                  style={[
                    styles.noteHistoryButton,
                    {
                      backgroundColor: withAlpha(noteTone, 0.13),
                      borderColor: withAlpha(noteTone, 0.4),
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => setNoteComposerOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityLabel={noteComposerOpen ? "Close availability form" : "Add availability"}
                  accessibilityState={{ expanded: noteComposerOpen }}
                >
                  <Icon name={noteComposerOpen ? "x" : "plus"} size={13} color={noteTone} />
                  <Text style={[styles.noteHistoryButtonText, { color: noteTone }]}>
                    {noteComposerOpen ? "Close" : "Add"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.historyTextButton}
                  activeOpacity={0.85}
                  onPress={toggleNoteHistory}
                  accessibilityRole="button"
                  accessibilityLabel={noteHistoryOpen ? "Hide sent note history" : "Show sent note history"}
                  accessibilityState={{ expanded: noteHistoryOpen }}
                >
                  <Icon name="clock" size={13} color={colors.textMuted} />
                  <Text style={[styles.historyTextButtonLabel, { color: colors.textMuted }]}>History</Text>
                </TouchableOpacity>
              </View>
            </View>

            {noteComposerOpen ? <View
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
                      accessibilityRole="radio"
                      accessibilityLabel={`${mode.label} note date range`}
                      accessibilityState={{ checked: active }}
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
                  accessibilityRole="button"
                  accessibilityLabel={`Select note start date, ${formatDateCompact(noteStartDate) || "not selected"}`}
                  accessibilityState={{ expanded: activeNoteDateField === "start" }}
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
                    accessibilityRole="button"
                    accessibilityLabel={`Select note end date, ${formatDateCompact(noteEndDate || noteStartDate) || "not selected"}`}
                    accessibilityState={{ expanded: activeNoteDateField === "end" }}
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
                      selectedDayTextColor: staticColors.hex_fff_yhjmu8,
                      todayTextColor: noteTone,
                    }}
                  />
                </View>
              ) : null}

              <FormField
                label="Note"
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Short note"
                hint="Enter a short note for the office"
              />

              <View style={styles.noteFooterRow}>
                <Checkbox
                  checked={noteBlocksBookings}
                  onChange={setNoteBlocksBookings}
                  label="Block bookings"
                />

                <AppButton
                  label={savingNote ? "Sending" : "Send"}
                  icon="send"
                  variant="secondary"
                  onPress={submitNote}
                  disabled={savingNote}
                  loading={savingNote}
                  accessibilityLabel="Send availability note"
                />
              </View>
            </View> : null}

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
                  <LoadingState label="Loading notes…" compact />
                ) : sentNotes.length === 0 ? (
                  <EmptyState
                    icon="message-square"
                    title="No sent notes"
                    message="Notes sent to the office will appear here."
                    compact
                  />
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
                      <IconButton
                        icon="trash-2"
                        tone="danger"
                        onPress={() => deleteSentNote(item)}
                        disabled={deletingNoteKey === item.key}
                        loading={deletingNoteKey === item.key}
                        label={`Delete note for ${formatNoteHistoryRange(item)}`}
                      />
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
              {(
                <>
                  <TouchableOpacity
                    style={styles.summaryLink}
                    onPress={() => router.push("/timesheet")}
                    accessibilityRole="button"
                    accessibilityLabel="Open timesheets"
                    accessibilityHint="View weekly hours and approvals"
                  >
                    <View style={styles.statRow}>
                      <View style={[styles.statCard, styles.flatStatCard]}>
                        <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={1}>This Week</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>
                          {formatTimesheetHours(timesheetStats.weekHours)}
                        </Text>
                      </View>

                      <View style={[styles.statCard, styles.flatStatCard]}>
                        <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={1}>Pending</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{timesheetStats.pending}</Text>
                      </View>

                      <View style={[styles.statCard, styles.flatStatCard]}>
                        <Text style={[styles.statLabel, { color: colors.textMuted }]} numberOfLines={1}>Last Submitted</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>
                          {formatDateShort(timesheetStats.lastSubmitted) || "—"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.summaryChevron} pointerEvents="none">
                      <Icon name="chevron-right" size={18} color={colors.textMuted} />
                    </View>
                  </TouchableOpacity>

                  {queryCard && (
                    <TouchableOpacity
                      style={[
                        styles.queryCard,
                        { borderColor: staticColors.hex_f97316_oh807u, backgroundColor: colors.surface },
                      ]}
                      activeOpacity={0.9}
                      onPress={() => router.push(`/(protected)/query/${queryCard.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel="Open manager timesheet query"
                      accessibilityHint="Review the queried week and respond"
                    >
                      <View style={styles.queryIcon}>
                        <Icon name="alert-circle" size={16} color={staticColors.hex_f97316_oh807u} />
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

                </>
              )}
            </View>
          </View>

          {/* Expenses and monthly receipts */}
          <View
            style={[
              styles.sectionCard,
              dashboardCards.sectionCard,
              styles.flatSectionCard,
            ]}
          >
            <View style={styles.sectionHeader}>
              <View style={styles.sectionTitleWrap}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Expenses & Receipts</Text>
                <Text style={[styles.sectionSubTitle, { color: colors.textMuted }]}>Job costs and monthly VAT receipts</Text>
              </View>
            </View>

            <View style={[styles.sectionPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.actionGrid}>
                <TouchableOpacity
                  style={[
                    styles.actionTile,
                    { backgroundColor: withAlpha(staticColors.hex_3b82f6_9w6unh, 0.13), borderColor: withAlpha(staticColors.hex_3b82f6_9w6unh, 0.4) },
                  ]}
                  onPress={() => router.push("/expenses")}
                  accessibilityRole="button"
                  accessibilityLabel="Open expenses"
                >
                  <Icon name="credit-card" size={18} color={staticColors.hex_3b82f6_9w6unh} />
                  <Text style={[styles.actionTileTitle, { color: colors.text }]}>Expenses</Text>
                  <Text style={[styles.actionTileSubtitle, { color: colors.textMuted }]}>Job costs</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionTile,
                    { backgroundColor: withAlpha(staticColors.hex_3b82f6_9w6unh, 0.13), borderColor: withAlpha(staticColors.hex_3b82f6_9w6unh, 0.4) },
                  ]}
                  onPress={() => router.push("/receipts")}
                  accessibilityRole="button"
                  accessibilityLabel="Open monthly receipts"
                >
                  <Icon name="file-text" size={18} color={staticColors.hex_3b82f6_9w6unh} />
                  <Text style={[styles.actionTileTitle, { color: colors.text }]}>Receipts</Text>
                  <Text style={[styles.actionTileSubtitle, { color: colors.textMuted }]}>Monthly VAT</Text>
                </TouchableOpacity>
              </View>
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
              {myHolidays.length === 0 ? (
                <EmptyState
                  icon="umbrella"
                  title="No holiday records"
                  message="Approved and pending holiday requests will appear here."
                  compact
                />
              ) : (
                <>
                  <View style={styles.statRow}>
                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Allowance</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayAllowance)}</Text>
                    </View>

                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Taken</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayUsedDays)}</Text>
                    </View>

                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Booked</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayBookedDays)}</Text>
                    </View>

                    <View style={[styles.statCard, styles.flatStatCard]}>
                      <Text style={[styles.statLabel, { color: colors.textMuted }]}>Available</Text>
                      <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayRemaining)}</Text>
                    </View>
                  </View>

                  <View style={styles.holidayProgressRow}>
                    <View style={[styles.holidayProgressTrack, { backgroundColor: withAlpha(holidayTone, 0.14) }]}>
                      <View
                        style={[
                          styles.holidayProgressFill,
                          {
                            backgroundColor: holidayTone,
                            width: `${holidayUsageProgress * 100}%`,
                          },
                        ]}
                      />
                    </View>
                    <Text style={[styles.holidayProgressText, { color: colors.textMuted }]}>
                      {fmtHalf(holidayRemaining)} remaining
                    </Text>
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
                    accessibilityRole="button"
                    accessibilityLabel="Manage holidays"
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

    </PageShell>
  );
}

/* ───────────────────────── Helpers (match HolidayPage) ───────────────────────── */
function safeStr(v) {
  return String(v ?? "").trim().toLowerCase();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "");
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
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}
function yearKey(y) {
  return String(y);
}
function getAllowanceForYear(emp, y) {
  const Y = yearKey(y);

  const holidayAllowances = emp?.holidayAllowances || emp?.holidayAllowanceByYear || {};
  const carryoverByYear =
    emp?.carryoverByYear || emp?.carryOverByYear || emp?.carriedOverByYear || {};

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
    displayType = "Paid";
    typeColor = staticColors.hex_29bc5f_75jpdr;
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
  container: { flex: 1, backgroundColor: staticColors.hex_0b0b0b_9v81ck },
  scrollContent: {
    paddingHorizontal: t.spacing.sm,
    paddingTop: t.spacing.md,
    paddingBottom: 200,
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
    gap: t.spacing.xs,
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
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xxs,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  badgeText: {
    color: staticColors.hex_0b0b0b_9v81ck,
    fontSize: t.typography.micro.fontSize,
    fontWeight: "900",
  },
  userIcon: {
    width: t.controls.iconButton,
    height: t.controls.iconButton,
    borderRadius: t.controls.iconButton / 2,
    justifyContent: "center",
    alignItems: "center",
  },
  userInitials: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "900", letterSpacing: 0.4 },

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
    marginTop: t.spacing.xxs,
    fontSize: t.typography.pageTitle.fontSize,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  heroSubTitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "600",
    lineHeight: t.typography.bodySmall.lineHeight,
  },
  heroMetaRow: {
    marginTop: t.spacing.sm,
    flexDirection: "row",
    gap: t.spacing.xs,
    flexWrap: "wrap",
  },
  heroMetaAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    minHeight: t.controls.chipMinHeight,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  heroMetaActionPrimary: {},
  heroMetaActionText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    minHeight: t.controls.chipMinHeight,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderWidth: 1,
    maxWidth: "100%",
  },
  heroMetaText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
    flexShrink: 1,
  },

  sectionCard: {
    marginBottom: t.spacing.md,
    borderRadius: t.radius.xl,
    paddingHorizontal: t.spacing.none,
    paddingTop: t.spacing.none,
    paddingBottom: t.spacing.none,
  },
  flatSectionCard: {
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  profileCard: {
    padding: t.spacing.sm,
    borderWidth: 0,
  },
  profileIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  profileAvatar: {
    width: 48,
    height: 48,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
  },
  profileIdentityCopy: { flex: 1, minWidth: 0 },
  profileMeta: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  profileCode: {
    marginTop: t.spacing.none,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  panelSectionCard: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
  },
  sectionTitleWrap: {
    flex: 1,
    paddingRight: t.spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  sectionTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  profileTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    lineHeight: t.typography.sectionTitle.lineHeight,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  sectionSubTitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  sectionCountPill: {
    minHeight: 30,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.sm,
    borderWidth: 1,
  },
  sectionPanel: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
  },
  sectionCountText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },
  noteHistoryButton: {
    minHeight: 30,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderWidth: 1,
  },
  noteHistoryButtonText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    borderRadius: t.radius.lg,
    minHeight: t.controls.buttonHeight,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
  infoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  profileActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  profileActionButton: {
    width: t.controls.iconButton,
    height: t.controls.iconButton,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  profileEditButton: {
    minHeight: t.controls.iconButton,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  profileEditText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },
  availabilityActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  historyTextButton: {
    minHeight: t.controls.chipMinHeight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  historyTextButtonLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    marginTop: t.spacing.sm,
    paddingHorizontal: t.spacing.xxs,
  },
  cardRowText: { fontSize: t.typography.body.fontSize, fontWeight: "600", flexShrink: 1 },
  loadingWrap: {
    paddingVertical: t.spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },

  statRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    gap: t.spacing.xs,
    marginTop: t.spacing.none,
  },
  statCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: t.radius.lg,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.xxs,
    alignItems: "center",
  },
  flatStatCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingHorizontal: t.spacing.none,
  },
  statLabel: { fontSize: t.typography.caption.fontSize, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.2 },
  statValue: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "900", marginTop: t.spacing.xxs },
  summaryLink: {
    minHeight: t.controls.buttonHeightLg,
    position: "relative",
    paddingRight: t.spacing.lg,
  },
  summaryChevron: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
  },

  queryCard: {
    flexDirection: "row",
    padding: t.controls.cardPadding,
    borderRadius: t.radius.lg,
    marginTop: t.spacing.xs,
    gap: t.spacing.xs,
    borderWidth: 1,
  },
  queryIcon: {
    width: 26,
    height: 26,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_fff7ed_pfszcm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing.none,
  },
  queryTitle: { fontSize: t.typography.bodySmall.fontSize, fontWeight: "800", marginBottom: t.spacing.none },
  querySubtitle: { fontSize: t.typography.metadata.fontSize, marginBottom: t.spacing.none },
  queryBody: { fontSize: t.typography.metadata.fontSize, fontStyle: "italic", marginBottom: t.spacing.xxs },
  queryFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  queryFooterText: { fontSize: t.typography.caption.fontSize, fontWeight: "600" },

  sectionAction: {
    marginTop: t.spacing.md,
    alignSelf: "center",
    minHeight: t.controls.buttonHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
  },
  sectionActionPrimary: {},
  sectionActionText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  expensesIntro: {
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    marginBottom: t.spacing.sm,
  },
  actionGrid: {
    flexDirection: "row",
    gap: t.spacing.xs,
  },
  actionTile: {
    flex: 1,
    minHeight: 88,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
    justifyContent: "center",
  },
  actionTileTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "900",
  },
  actionTileSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "600",
  },
  holidayProgressRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  holidayProgressTrack: {
    flex: 1,
    height: 6,
    borderRadius: t.radius.pill,
    overflow: "hidden",
  },
  holidayProgressFill: {
    height: "100%",
    borderRadius: t.radius.pill,
  },
  holidayProgressText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },
  notePanelCompact: {
    padding: t.spacing.xs,
    borderRadius: t.radius.md,
  },
  noteModeRow: {
    flexDirection: "row",
    gap: t.spacing.xxs,
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.xxs,
    marginBottom: t.spacing.xs,
  },
  noteModeButton: {
    flex: 1,
    minHeight: 30,
    borderWidth: 1,
    borderRadius: t.radius.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
  },
  noteModeText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
  },
  dateSelectRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  dateSelectButton: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xs,
    paddingTop: t.spacing.xs,
    paddingBottom: t.spacing.xs,
  },
  dateSelectValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  dateSelectValue: {
    flex: 1,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "800",
  },
  calendarWrap: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.xs,
    overflow: "hidden",
  },
  inputLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.2,
    marginBottom: t.spacing.xxs,
  },
  noteInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
  },
  noteFooterRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  checkRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    minHeight: 32,
  },
  checkRowText: {
    flex: 1,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
  },
  noteSendAction: {
    marginTop: t.spacing.none,
    minHeight: 34,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.sm,
  },
  noteHistoryPanel: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    marginTop: t.spacing.xs,
    padding: t.spacing.xs,
    gap: t.spacing.xs,
  },
  noteHistoryLoading: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
  },
  noteHistoryMeta: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
    textAlign: "center",
  },
  noteHistoryItem: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  noteHistoryTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  noteHistoryDate: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
    marginBottom: t.spacing.none,
  },
  noteHistoryText: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
  },
  statusText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    textAlign: "center",
    marginTop: t.spacing.xs,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.xs,
  },
  emptyStateTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyStateText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    lineHeight: t.typography.metadata.lineHeight,
    textAlign: "center",
  },

});
