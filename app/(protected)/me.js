// app/(protected)/me.js
import { useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { getInbox } from "../../lib/notificationInbox";
import { createDashboardCardStyles } from "../../lib/design/dashboard";
import { designTokens as t } from "../../lib/design/tokens";

// 🔑 Provider + Firebase
import { auth, db } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
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

  // load unread notifications count from inbox (AsyncStorage)
  const loadNotifBadge = useCallback(async () => {
    try {
      const list = await getInbox();
      void list;
    } catch {
      return;
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
    employee?.displayName,
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

  if (loading || !isAuthed) return null;

  const queryCard = latestTimesheetQuery;
  const queryWeekLabel = queryCard?.weekStart ? formatWeekLabel(queryCard.weekStart) : null;
  const queryFieldLabel = fieldLabel(queryCard?.field);
  const queryDay = queryCard?.day;
  const profileTone = "#64748B";
  const timesheetTone = "#CA8A04";
  const holidayTone = "#16A34A";
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
                      <Text style={[styles.statValue, { color: colors.text }]}>{timesheetStats.weekHours}h</Text>
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
  statusText: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },

});
