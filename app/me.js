// app/me.js
import { useRouter } from "expo-router";
import {
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";
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

// ✅ If your firebaseConfig is at project root (/firebaseConfig.js), change to "../firebaseConfig"
import { auth, db } from "../firebaseConfig";

const buttonSpacing = 12;
const screenWidth = Dimensions.get("window").width;

export default function MePage() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const employee = global.employee || null;

  // Account source
  const user = auth.currentUser;
  const isAnon = !!user?.isAnonymous;
  const account = employee
    ? {
        name: employee.name || "Unknown",
        email: employee.email || "No email",
        userCode: employee.userCode || "N/A",
      }
    : user && !isAnon
    ? {
        name: user.displayName || "Team Member",
        email: user.email || "No email",
        userCode: user.uid ? user.uid.slice(0, 8) : "N/A",
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

  // Personal data blocks
  const [myHolidays, setMyHolidays] = useState([]);
  const [nextHoliday, setNextHoliday] = useState(null);
  const [pendingHolidayCount, setPendingHolidayCount] = useState(0);

  // Allowance + used + remaining
  const [holidayAllowance, setHolidayAllowance] = useState(28); // default fallback
  const [holidayUsedDays, setHolidayUsedDays] = useState(0);
  const [holidayRemaining, setHolidayRemaining] = useState(28);

  const [timesheetStats, setTimesheetStats] = useState({
    weekHours: 0,
    pending: 0,
    lastSubmitted: null,
  });

  const loadPersonal = useCallback(async () => {
    setLoading(true);
    try {
      // If we don't know who the employee is yet, just show skeletons
      if (!employee?.userCode || !employee?.name) {
        setMyHolidays([]);
        setTimesheetStats({ weekHours: 0, pending: 0, lastSubmitted: null });
        setHolidayAllowance(28);
        setHolidayUsedDays(0);
        setHolidayRemaining(28);
        return;
      }

      /* -------------------------- Holidays for me -------------------------- */
      const holSnap = await getDocs(collection(db, "holidays"));
      const allHol = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const mine = allHol.filter(
        (h) => (h.employee || h.name) === employee.name
      );
      setMyHolidays(mine);

      const todayISO = isoDate(new Date());
      const upcoming = mine
        .filter((h) => (h.endDate || h.to || todayISO) >= todayISO)
        .sort((a, b) =>
          (a.startDate || a.from || "").localeCompare(b.startDate || b.from || "")
        );
      setNextHoliday(upcoming[0] || null);
      setPendingHolidayCount(
        mine.filter(
          (h) => {
            const s = String(h.status || h.Status || "").toLowerCase();
            return s === "pending" || s === "requested";
          }
        ).length
      );

      /* ---------------------- Employee allowance lookup -------------------- */
      // Try to find the employee doc to read allowance fields.
      // Common fields we’ll try in order:
      //   holidayAllowance, annualLeaveAllowance, holidayAllowanceDays
      let allowance = 28; // fallback
      try {
        const empQ = query(
          collection(db, "employees"),
          where("name", "==", employee.name)
        );
        const empSnap = await getDocs(empQ);
        if (!empSnap.empty) {
          const empData = empSnap.docs[0].data() || {};
          allowance =
            toNumber(empData.holidayAllowance, NaN) ??
            toNumber(empData.annualLeaveAllowance, NaN) ??
            toNumber(empData.holidayAllowanceDays, NaN) ??
            28;
          if (isNaN(allowance)) allowance = 28;
        }
      } catch {
        allowance = 28;
      }
      setHolidayAllowance(allowance);

      /* ------------------ Compute used days (current year) ----------------- */
      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);  // Jan 1
      const yearEnd = new Date(now.getFullYear(), 11, 31);  // Dec 31

      // Only approved + PAID (exclude unpaid/TOIL/etc.)
      const approvedMinePaid = mine.filter((h) => {
        const s = String(h.status || h.Status || "").toLowerCase();
        const isApproved = s === "approved" || s === "accept" || s === "approved ✅";
        return isApproved && !isUnpaidHoliday(h);
      });

      let used = 0;
      for (const h of approvedMinePaid) {
        const s = toDateSafe(h.startDate || h.from);
        const e = toDateSafe(h.endDate || h.to || h.startDate || h.from);

        if (!s) continue;
        // Clamp to current year
        const start = maxDate(s, yearStart);
        const end = minDate(e || s, yearEnd);

        if (h.halfDay) {
          used += 0.5;
        } else {
          const span = inclusiveDays(start, end); // calendar days inclusive
          used += Math.max(0, span);
        }
      }

      // Round halves nicely and prevent negatives
      used = Math.max(0, Number(used.toFixed(1)));
      const remaining = Math.max(0, Number((allowance - used).toFixed(1)));

      setHolidayUsedDays(used);
      setHolidayRemaining(remaining);

      /* ---------------------- Timesheet quick statistics ------------------- */
      const tsSnap = await getDocs(
        query(
          collection(db, "timesheets"),
          where("employeeCode", "==", employee.userCode)
        )
      );
      const tsMine = tsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // This week's Monday key
      const mondayKey = mondayISO(new Date());

      const thisWeek = tsMine.find((t) => (t.weekStart || t.weekISO) === mondayKey);
      const weekHours = toNumber(thisWeek?.totalHours, 0);

      // Pending = submitted but awaiting approval (status missing or 'pending')
      const pending = tsMine.filter((t) => {
        const submitted = !!t.submitted;
        const status = String(t.status || "").toLowerCase();
        return submitted && (!status || status === "pending");
      }).length;

      // Last submitted date
      const lastSubmitted = tsMine
        .filter((t) => !!t.submittedAt)
        .map((t) => toDate(t.submittedAt)?.toISOString() || null)
        .filter(Boolean)
        .sort((a, b) => (a > b ? -1 : 1))[0] || null;

      setTimesheetStats({ weekHours, pending, lastSubmitted });
    } finally {
      setLoading(false);
    }
  }, [employee?.userCode, employee?.name, db]);

  useEffect(() => {
    loadPersonal();
  }, [loadPersonal]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPersonal();
    setRefreshing(false);
  }, [loadPersonal]);

  // Quick action tiles (personal-focused)
  const tiles = useMemo(
    () => [
      { label: "My Schedule", icon: "calendar", onPress: () => router.push("/screens/schedule") },
      { label: "Time Sheet",  icon: "clock",    onPress: () => router.push("/timesheets") },
      { label: "Holidays",    icon: "briefcase",onPress: () => router.push("/holidaypage") },
      { label: "Work Diary",  icon: "clipboard",onPress: () => router.push("/work-diary") },
      { label: "Contacts",    icon: "users",    onPress: () => router.push("/contacts") },
      { label: "Profile",     icon: "user",     onPress: () => router.push("/edit-profile") },
    ],
    [router]
  );

  const colCount = 3;
  const buttonSize = (screenWidth - buttonSpacing * (colCount + 1)) / colCount;

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#fff"
            />
          }
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <Image
              source={require("../assets/images/bickers-action-logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <TouchableOpacity style={styles.userIcon} onPress={() => router.push("/edit-profile")}>
              <Text style={styles.userInitials}>{userInitials}</Text>
            </TouchableOpacity>
          </View>

          {/* Greeting card */}
          <View style={styles.greetingCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>{timeOfDay},</Text>
              <Text style={styles.greetingName}>{account.name}</Text>
              <Text style={styles.todayText}>
                {new Date().toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </Text>
            </View>

            {/* Quick chips */}
            <View style={styles.chipsCol}>
              <TouchableOpacity
                style={[styles.chip, styles.chipPrimary]}
                onPress={() => router.push("/edit-profile")}
              >
                <Icon name="user" size={14} color="#fff" />
                <Text style={styles.chipText}>View Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, styles.chipGhost]}
                onPress={() => router.push("/settings")}
              >
                <Icon name="settings" size={14} color="#fff" />
                <Text style={styles.chipText}>Settings</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Profile Summary */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>My Profile</Text>
            <View style={styles.cardRow}>
              <Icon name="mail" size={16} color="#cfcfcf" />
              <Text style={styles.cardRowText}>{account.email}</Text>
            </View>
            <View style={styles.cardRow}>
              <Icon name="hash" size={16} color="#cfcfcf" />
              <Text style={styles.cardRowText}>Code: {account.userCode}</Text>
            </View>
          </View>

          {/* Timesheet Snapshot */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Timesheet</Text>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <View style={styles.statRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>This Week</Text>
                    <Text style={styles.statValue}>{timesheetStats.weekHours}h</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Pending</Text>
                    <Text style={styles.statValue}>{timesheetStats.pending}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Last Submitted</Text>
                    <Text style={styles.statValue}>
                      {formatDateShort(timesheetStats.lastSubmitted) || "—"}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.chip, styles.chipPrimary, { alignSelf: "center", marginTop: 10 }]}
                  onPress={() => router.push("/timesheet")}
                >
                  <Icon name="clock" size={14} color="#fff" />
                  <Text style={styles.chipText}>Open Timesheet</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Holidays Snapshot */}
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Holidays</Text>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : myHolidays.length === 0 ? (
              <Text style={styles.statusText}>No holiday records</Text>
            ) : (
              <>
                {/* Allowance / Used / Remaining */}
                <View style={styles.statRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Allowance</Text>
                    <Text style={styles.statValue}>{holidayAllowance}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Used</Text>
                    <Text style={styles.statValue}>{holidayUsedDays}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statLabel}>Remaining</Text>
                    <Text style={styles.statValue}>{holidayRemaining}</Text>
                  </View>
                </View>

                <View style={styles.cardRow}>
                  <Icon name="calendar" size={16} color="#cfcfcf" />
                  <Text style={styles.cardRowText}>
                    Next: {formatHoliday(nextHoliday) || "—"}
                  </Text>
                </View>
                <View style={styles.cardRow}>
                  <Icon name="alert-circle" size={16} color="#cfcfcf" />
                  <Text style={styles.cardRowText}>
                    Pending requests: {pendingHolidayCount}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.chip, styles.chipGhost, { alignSelf: "center", marginTop: 10 }]}
                  onPress={() => router.push("/holidaypage")}
                >
                  <Icon name="briefcase" size={14} color="#fff" />
                  <Text style={styles.chipText}>Manage Holidays</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Personal Shortcuts */}
          <View style={{ marginBottom: 18 }}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>My Tools</Text>
              <View style={styles.groupDividerLine} />
            </View>

            <View style={[styles.grid, { justifyContent: "space-between" }]}>
              {tiles.map((t) => (
                <TouchableOpacity
                  key={t.label}
                  style={[
                    styles.button,
                    { width: buttonWidth(colCount), height: buttonWidth(colCount) },
                  ]}
                  activeOpacity={0.85}
                  onPress={t.onPress}
                >
                  <Icon name={t.icon} size={24} color="#fff" style={{ marginBottom: 6 }} />
                  <Text style={styles.buttonText}>{t.label}</Text>
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

/* ---------- helpers ---------- */
function buttonWidth(cols) {
  const w = Dimensions.get("window").width;
  return (w - buttonSpacing * (cols + 1)) / cols;
}

function isoDate(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Return Monday (YYYY-MM-DD) for the given date
function mondayISO(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun..6=Sat
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return isoDate(date);
}

function toDate(val) {
  // Firestore Timestamp or ISO string
  if (!val) return null;
  if (val.toDate && typeof val.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function toNumber(n, fallback = 28) {
  const num = Number(n);
  return isNaN(num) ? fallback : num;
}

// Parse string/TS into Date or null
function toDateSafe(val) {
  if (!val) return null;
  if (val.toDate && typeof val.toDate === "function") return val.toDate();
  const d = new Date(val);
  return isNaN(d) ? null : d;
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

// Inclusive calendar days between two dates
function inclusiveDays(a, b) {
  const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const e = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const ms = e - s;
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000) + 1; // +1 for inclusive range
}

function formatDateShort(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatHoliday(h) {
  if (!h) return null;
  const start = h.startDate || h.from;
  const end = h.endDate || h.to;
  if (!start) return null;
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const sTxt = s.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const eTxt = e ? e.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : null;
  return eTxt ? `${sTxt} → ${eTxt}` : sTxt;
}

/** Exclude UNPAID / TOIL style holidays from allowance usage */
function isUnpaidHoliday(h) {
  const toStr = (v) => String(v ?? "").toLowerCase().trim();

  // common boolean flags
  if (h?.unpaid === true || h?.isUnpaid === true) return true;
  if (h?.paid === false) return true;

  // common string fields that might carry the pay type
  const tags = [
    h?.type,
    h?.leaveType,
    h?.holidayType,
    h?.payType,
    h?.category,
    h?.dayType,
    h?.paymentType,
    h?.kind,
  ].map(toStr);

  // treat UNPAID and TOIL as not consuming allowance
  return tags.some(t =>
    t.includes("unpaid") ||
    t.includes("toil") ||
    t.includes("time off in lieu") ||
    t.includes("no pay")
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000000" },
  scrollContent: {
    paddingHorizontal: buttonSpacing,
    paddingTop: 16,
    paddingBottom: 90,
  },

  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  logo: { width: 150, height: 50 },
  userIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#2E2E2E",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3a3a3a",
  },
  userInitials: { color: "#fff", fontSize: 16, fontWeight: "bold" },

  // Greeting card
  greetingCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    backgroundColor: "#0f0f0f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f1f1f",
    marginBottom: 14,
  },
  greeting: { color: "#cfcfcf", fontSize: 13, marginBottom: 2 },
  greetingName: { color: "#fff", fontSize: 18, fontWeight: "800" },
  todayText: { color: "#9e9e9e", fontSize: 12, marginTop: 2 },
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

  // Blocks
  block: {
    backgroundColor: "#1a1a1a",
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#262626",
  },
  blockTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  statusText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 8,
  },

  cardRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  cardRowText: { color: "#ccc", fontSize: 14 },

  // Stats
  statRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  statCard: {
    flex: 1,
    backgroundColor: "#2a2a2a",
    borderWidth: 1,
    borderColor: "#3a3a3a",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  statLabel: { color: "#cfcfcf", fontSize: 12 },
  statValue: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 2 },

  // Group header
  groupHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  groupTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginRight: 10 },
  groupDividerLine: { height: 1, backgroundColor: "#333", flex: 1, borderRadius: 1, opacity: 0.7 },

  // Grid buttons
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  button: {
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: buttonSpacing,
    backgroundColor: "#2E2E2E",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    padding: 10,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    paddingHorizontal: 4,
  },
});
