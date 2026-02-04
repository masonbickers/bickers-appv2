// app/(protected)/me.js
import { useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

// ✅ notification inbox helpers
import { getInbox } from "../../lib/notificationInbox";

// 🔑 Provider + Firebase
import { auth, db } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

const buttonSpacing = 12;

export default function MePage() {
  const router = useRouter();
  const { user, employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();

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

  // notifications badge
  const [notifUnread, setNotifUnread] = useState(0);

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

  const userInitials = (account.name || "U")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const timeOfDay = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  // load unread notifications count from inbox (AsyncStorage)
  const loadNotifBadge = useCallback(async () => {
    try {
      const list = await getInbox();
      const unread = Array.isArray(list) ? list.filter((n) => !n.read).length : 0;
      setNotifUnread(unread);
    } catch {
      setNotifUnread(0);
    }
  }, []);

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
      const empSnap = await getDocs(collection(db, "employees"));
      const employees = empSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      let empRecord = null;

      if (userCode) {
        empRecord =
          employees.find((e) => safeStr(e.userCode) === safeStr(userCode)) ||
          (email ? employees.find((e) => safeStr(e.email) === safeStr(email)) : null);
      } else if (email) {
        empRecord = employees.find((e) => safeStr(e.email) === safeStr(email));
      } else if (empName) {
        empRecord = employees.find((e) => safeStr(e.name) === safeStr(empName));
      }

      // ============================================================
      // 2) Load my holidays (filter like HolidayPage: name OR code)
      // ============================================================
      const holSnap = await getDocs(collection(db, "holidays"));
      const allHol = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const mine = allHol.filter((h) => {
        if (empRecord) {
          const matchByName = safeStr(h.employee) === safeStr(empRecord.name);
          const matchByCode = safeStr(h.employeeCode) === safeStr(empRecord.userCode);
          return matchByName || matchByCode;
        }

        const codeMatch =
          !!userCode &&
          [h.employeeCode, h.userCode].map(safeStr).some((v) => v === safeStr(userCode));
        const nameMatch =
          !!empName && [h.employee, h.name].map(safeStr).some((v) => v === safeStr(empName));
        return codeMatch || nameMatch;
      });

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

        const origS = toDateSafe(h.startDate || h.from);
        const origE = toDateSafe(h.endDate || h.to) || origS;
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
        const s = safeStr(h.status || h.Status);
        return s === "pending" || s === "requested";
      }).length;
      setPendingHolidayCount(pendingCount);

      const upcomingApproved = mine
        .filter((h) => isApproved(h))
        .filter((h) => {
          const end = toDateSafe(h.endDate || h.to || h.startDate || h.from);
          return end && end >= today;
        })
        .sort((a, b) => {
          const as = toDateSafe(a.startDate || a.from) ?? new Date(8640000000000000);
          const bs = toDateSafe(b.startDate || b.from) ?? new Date(8640000000000000);
          return as - bs;
        });

      setNextHoliday(upcomingApproved[0] || null);

      // ============================================================
      // 6) Timesheet stats (unchanged)
      // ============================================================
      let tsMine = [];
      if (userCode) {
        const tsSnap = await getDocs(
          query(collection(db, "timesheets"), where("employeeCode", "==", userCode))
        );
        tsMine = tsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      const mondayKey = mondayISO(new Date());
      const thisWeek = tsMine.find((t) => (t.weekStart || t.weekISO) === mondayKey);
      const weekHours = toNumber(thisWeek?.totalHours, 0);

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
          query(collection(db, "timesheetQueries"), where("employeeCode", "==", userCode))
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
    employee?.userCode,
    employee?.name,
    employee?.email,
    user?.email,
    currentYear,
    isBankHoliday,
  ]);

  useEffect(() => {
    loadPersonal();
    loadNotifBadge();
  }, [loadPersonal, loadNotifBadge]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadPersonal(), loadNotifBadge()]);
    setRefreshing(false);
  }, [loadPersonal, loadNotifBadge]);

  const tiles = useMemo(
    () => [
      { label: "My Schedule", icon: "calendar", onPress: () => router.push("/screens/schedule") },
      { label: "Contacts", icon: "users", onPress: () => router.push("/contacts") },
      { label: "Profile", icon: "user", onPress: () => router.push("/edit-profile") },
    ],
    [router]
  );

  if (loading || !isAuthed) return null;

  const queryCard = latestTimesheetQuery;
  const queryWeekLabel = queryCard?.weekStart ? formatWeekLabel(queryCard.weekStart) : null;
  const queryFieldLabel = fieldLabel(queryCard?.field);
  const queryDay = queryCard?.day;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <Image
              source={require("../../assets/images/bickers-action-logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />

            <View style={styles.headerRight}>
              {/* Notifications bell w/ badge */}
              <TouchableOpacity
                style={[
                  styles.notifBtn,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                ]}
                activeOpacity={0.85}
                onPress={() => router.push("/(protected)/notifications")}
              >
                <Icon name="bell" size={18} color={colors.text} />
                {notifUnread > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                    <Text style={styles.badgeText}>
                      {notifUnread > 99 ? "99+" : String(notifUnread)}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Profile */}
              <TouchableOpacity
                style={[
                  styles.userIcon,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                ]}
                onPress={() => router.push("/edit-profile")}
              >
                <Text style={[styles.userInitials, { color: colors.text }]}>{userInitials}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Greeting card */}
          <View
            style={[
              styles.greetingCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.greeting, { color: colors.textMuted }]}>{timeOfDay},</Text>
              <Text style={[styles.greetingName, { color: colors.text }]}>{account.name}</Text>
              <Text style={[styles.todayText, { color: colors.textMuted }]}>
                {new Date().toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            </View>

            <View style={styles.chipsCol}>
              <TouchableOpacity
                style={[
                  styles.chip,
                  styles.chipPrimary,
                  { backgroundColor: colors.accent, borderColor: colors.accent },
                ]}
                onPress={() => router.push("/edit-profile")}
              >
                <Icon name="user" size={14} color="#fff" />
                <Text style={[styles.chipText, { color: "#fff" }]}>View Profile</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.chip,
                  styles.chipGhost,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                ]}
                onPress={() => router.push("/settings")}
              >
                <Icon name="settings" size={14} color={colors.text} />
                <Text style={[styles.chipText, { color: colors.text }]}>Settings</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* My Profile */}
          <View style={[styles.block, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.blockTitle, { color: colors.text }]}>My Profile</Text>

            <View style={styles.cardRow}>
              <Icon name="mail" size={16} color={colors.textMuted} />
              <Text style={[styles.cardRowText, { color: colors.text }]}>{account.email}</Text>
            </View>

            <View style={styles.cardRow}>
              <Icon name="hash" size={16} color={colors.textMuted} />
              <Text style={[styles.cardRowText, { color: colors.text }]}>
                Code: {account.userCode}
              </Text>
            </View>
          </View>

          {/* Timesheet Snapshot */}
          <View style={[styles.block, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.blockTitle, { color: colors.text }]}>Timesheet</Text>

            {busy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <View style={styles.statRow}>
                  <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>This Week</Text>
                    <Text style={[styles.statValue, { color: colors.text }]}>{timesheetStats.weekHours}h</Text>
                  </View>

                  <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>Pending</Text>
                    <Text style={[styles.statValue, { color: colors.text }]}>{timesheetStats.pending}</Text>
                  </View>

                  <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
                    styles.chip,
                    styles.chipPrimary,
                    {
                      alignSelf: "center",
                      marginTop: 10,
                      backgroundColor: colors.accent,
                      borderColor: colors.accent,
                    },
                  ]}
                  onPress={() => router.push("/timesheet")}
                >
                  <Icon name="clock" size={14} color="#fff" />
                  <Text style={[styles.chipText, { color: "#fff" }]}>Open Timesheet</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Holidays Snapshot (CURRENT YEAR, allowance includes carryover) */}
          <View style={[styles.block, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text style={[styles.blockTitle, { color: colors.text }]}>Holidays</Text>

            {busy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : myHolidays.length === 0 ? (
              <Text style={[styles.statusText, { color: colors.textMuted }]}>No holiday records</Text>
            ) : (
              <>
                <View style={styles.statRow}>
                  <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>
                      Allowance ({currentYear})
                    </Text>
                    <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayAllowance)}</Text>
                  </View>

                  <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={[styles.statLabel, { color: colors.textMuted }]}>Used</Text>
                    <Text style={[styles.statValue, { color: colors.text }]}>{fmtHalf(holidayUsedDays)}</Text>
                  </View>

                  <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
                    styles.chip,
                    styles.chipGhost,
                    {
                      alignSelf: "center",
                      marginTop: 10,
                      backgroundColor: colors.surfaceAlt,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => router.push("/holidaypage")}
                >
                  <Icon name="briefcase" size={14} color={colors.text} />
                  <Text style={[styles.chipText, { color: colors.text }]}>Manage Holidays</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Personal Shortcuts */}
          <View style={{ marginBottom: 18 }}>
            <View style={styles.groupHeader}>
              <Text style={[styles.groupTitle, { color: colors.text }]}>My Tools</Text>
              <View style={[styles.groupDividerLine, { backgroundColor: colors.border, opacity: 0.7 }]} />
            </View>

            <View style={[styles.grid, { justifyContent: "space-between" }]}>
              {tiles.map((t) => (
                <TouchableOpacity
                  key={t.label}
                  style={[
                    styles.button,
                    {
                      width: buttonWidth(3),
                      height: buttonWidth(3),
                      backgroundColor: colors.surfaceAlt,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={t.onPress}
                >
                  <Icon name={t.icon} size={24} color={colors.text} style={{ marginBottom: 6 }} />
                  <Text style={[styles.buttonText, { color: colors.text }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
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

  const origStart = origS || toDateSafe(h.startDate || h.from);
  const origEnd = origE || toDateSafe(h.endDate || h.to) || origStart;

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
    displayType = "Paid";
    typeColor = "#29bc5f";
  }
  return { displayType, typeColor };
}

function isApproved(h) {
  const s = safeStr(h.status || h.Status);
  return s === "approved" || s === "accept" || s === "approved ✅";
}

function formatDateShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatHoliday(h) {
  if (!h) return null;
  const s = toDateSafe(h.startDate || h.from);
  const e = toDateSafe(h.endDate || h.to);
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

function buttonWidth(cols) {
  const w = Dimensions.get("window").width;
  return (w - buttonSpacing * (cols + 1)) / cols;
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  scrollContent: {
    paddingHorizontal: buttonSpacing,
    paddingTop: 16,
    paddingBottom: 90,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  notifBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
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
    borderColor: "#000",
  },
  badgeText: {
    color: "#0b0b0b",
    fontSize: 10,
    fontWeight: "900",
  },

  logo: { width: 150, height: 50 },

  userIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  userInitials: { fontSize: 16, fontWeight: "bold" },

  greetingCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  greeting: { fontSize: 13, marginBottom: 2 },
  greetingName: { fontSize: 18, fontWeight: "800" },
  todayText: { fontSize: 12, marginTop: 2 },

  chipsCol: { justifyContent: "center", alignItems: "flex-end", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipPrimary: { backgroundColor: "#C8102E", borderColor: "#C8102E" },
  chipGhost: { backgroundColor: "#141414", borderColor: "#232323" },
  chipText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  block: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  statusText: {
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },

  cardRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  cardRowText: { fontSize: 14 },

  statRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  statLabel: { fontSize: 12 },
  statValue: { fontSize: 16, fontWeight: "800", marginTop: 2 },

  queryCard: {
    flexDirection: "row",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    gap: 8,
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
  queryTitle: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
  querySubtitle: { fontSize: 12, marginBottom: 2 },
  queryBody: { fontSize: 12, fontStyle: "italic", marginBottom: 4 },
  queryFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  queryFooterText: { fontSize: 11 },

  groupHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  groupTitle: { fontSize: 18, fontWeight: "800", marginRight: 10 },
  groupDividerLine: { height: 1, flex: 1, borderRadius: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  button: {
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: buttonSpacing,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    padding: 10,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 4,
  },
});
