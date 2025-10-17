// app/timesheet-overview.js (drop-in)
import { useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { db } from "../firebaseConfig"; // ✅ adjust path if needed

// ───────────────────────── helpers (unchanged logic) ─────────────────────────
function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function formatWeekRange(monday) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} – ${sunday.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`;
}

export default function TimesheetOverview() {
  const employee = global.employee;
  const router = useRouter();

  const [timesheets, setTimesheets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadTimesheets();
  }, []);

  const loadTimesheets = async () => {
    if (!employee) {
      setTimesheets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const snap = await getDocs(collection(db, "timesheets"));
    const mySheets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => x.employeeCode === employee.userCode);
    setTimesheets(mySheets);
    setLoading(false);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTimesheets();
    setRefreshing(false);
  }, []);

  // Past 4 weeks (including current)
  const weekOptions = useMemo(() => {
    return [...Array(4)].map((_, i) => {
      const monday = getMonday(new Date());
      monday.setDate(monday.getDate() - 7 * i);
      return {
        key: monday.toISOString().split("T")[0],
        label: formatWeekRange(monday),
      };
    });
  }, []);

  const WeekStatusPill = ({ submitted }) => (
    <View
      style={[
        styles.pill,
        submitted ? styles.pillGood : styles.pillWarn,
      ]}
    >
      <Icon
        name={submitted ? "check-circle" : "alert-circle"}
        size={14}
        color={submitted ? "#052e16" : "#7c2d12"}
        style={{ marginRight: 6 }}
      />
      <Text
        style={[
          styles.pillText,
          { color: submitted ? "#052e16" : "#7c2d12" },
        ]}
      >
        {submitted ? "Submitted" : "Not filled"}
      </Text>
    </View>
  );

  const renderWeekCard = (weekKey, label, submitted) => (
    <TouchableOpacity
      key={weekKey}
      activeOpacity={0.85}
      style={[
        styles.weekCard,
        submitted && styles.submittedCard,
      ]}
      onPress={() => router.push(`/week/${weekKey}`)}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.weekLabel}>{label}</Text>
        <Text style={styles.weekSubLabel}>
          Monday → Sunday
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <WeekStatusPill submitted={submitted} />
        <Icon
          name="chevron-right"
          size={20}
          color="#bdbdbd"
          style={{ marginTop: 6 }}
        />
      </View>
    </TouchableOpacity>
  );

  const sortedSubmitted = useMemo(
    () => timesheets.slice().sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart)),
    [timesheets]
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} style={styles.backBtn}>
          <Icon name="arrow-left" size={16} color="#d4d4d4" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={styles.title}>Timesheets</Text>
          <Text style={styles.subtitle}>Submit your weekly hours</Text>
        </View>
        <View style={{ width: 60 }} />{/* spacer to balance Back button */}
      </View>

      {/* Legend row */}
      <View style={styles.legendRow}>
        <LegendSwatch color="#bbf7d0" border="#86efac" label="Submitted" />
        <LegendSwatch color="#fed7aa" border="#fdba74" label="Not filled" />
      </View>

      {/* This month (interactive list of 4 weeks) */}
      <Text style={styles.sectionHeader}>This Month</Text>
      <View
        style={{ borderRadius: 12, overflow: "hidden", borderColor: "#262626", borderWidth: 1, marginBottom: 12 }}
      >
        {loading ? (
          <View style={{ padding: 10 }}>
            <ShimmerLine />
            <ShimmerLine width="85%" />
            <ShimmerLine width="70%" />
          </View>
        ) : (
          weekOptions.map((w, idx) => {
            const existing = timesheets.find((t) => t.weekStart === w.key);
            return (
              <View key={w.key} style={{ borderBottomWidth: idx === weekOptions.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: "#262626" }}>
                {renderWeekCard(w.key, w.label, !!existing)}
              </View>
            );
          })
        )}
      </View>

      {/* Past submissions list */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeader}>Past Submissions</Text>
        <TouchableOpacity
          onPress={onRefresh}
          activeOpacity={0.8}
          style={styles.refreshBtn}
        >
          <Icon name="refresh-ccw" size={14} color="#fff" />
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ paddingTop: 4 }}>
          <ShimmerLine />
          <ShimmerLine width="90%" />
          <ShimmerLine width="80%" />
        </View>
      ) : sortedSubmitted.length === 0 ? (
        <Text style={styles.emptyText}>No timesheets submitted yet.</Text>
      ) : (
        <FlatList
          data={sortedSubmitted}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) =>
            renderWeekCard(item.weekStart, formatWeekRange(new Date(item.weekStart)), true)
          }
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}
    </SafeAreaView>
  );
}

/* tiny components */
function LegendSwatch({ color, border, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color, borderColor: border }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function ShimmerLine({ width = "100%" }) {
  return <View style={[styles.shimmer, { width }]} />;
}

// ───────────────────────── styles (visuals only) ─────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0b", padding: 12 },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#262626",
    backgroundColor: "#141414",
  },
  backText: { color: "#d4d4d4", fontSize: 13, fontWeight: "700" },
  title: { fontSize: 18, fontWeight: "800", color: "#fff" },
  subtitle: { fontSize: 12, color: "#9ca3af", marginTop: 2 },

  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 10,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  legendText: { color: "#cfcfcf", fontSize: 12 },

  sectionHeaderRow: {
    marginTop: 6,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeader: { fontSize: 15, fontWeight: "800", color: "#ffffff", marginBottom: 6 },

  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1f2937",
    borderColor: "#374151",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  refreshText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  weekCard: {
    backgroundColor: "#111111",
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  submittedCard: { borderLeftWidth: 3, borderLeftColor: "#22c55e" },

  weekLabel: { color: "#fff", fontSize: 15, fontWeight: "700" },
  weekSubLabel: { color: "#9ca3af", fontSize: 12, marginTop: 2 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillGood: { backgroundColor: "#bbf7d0", borderColor: "#86efac" },
  pillWarn: { backgroundColor: "#fed7aa", borderColor: "#fdba74" },
  pillText: { fontSize: 12, fontWeight: "800" },

  emptyText: { color: "#9ca3af", fontStyle: "italic", marginTop: 6 },

  shimmer: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#1f1f1f",
    marginBottom: 10,
  },
});
