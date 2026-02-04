// app/(protected)/timesheet-overview.js
import { useRouter } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
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

import { db } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider"; // 👈 theme

/* helpers */
function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function formatWeekRange(monday) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  })} – ${sunday.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}
function safeStr(v) {
  return String(v ?? "").trim().toLowerCase();
}
function isTimesheetApproved(ts) {
  if (!ts) return false;
  const status = safeStr(ts.status);
  return (
    status === "approved" ||
    ts.approved === true ||
    !!ts.approvedAt
  );
}

export default function TimesheetOverview() {
  const router = useRouter();
  const { employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme(); // 🎨

  const [timesheets, setTimesheets] = useState([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // weekStart (YYYY-MM-DD) -> true if there is an open manager query
  const [queryWeeksMap, setQueryWeeksMap] = useState({});

  const loadTimesheets = useCallback(async () => {
    if (loading) return;
    if (!isAuthed || !employee) {
      setTimesheets([]);
      setBusy(false);
      setQueryWeeksMap({});
      return;
    }
    try {
      setBusy(true);

      // 1) Load timesheets for this employee
      const qTs = query(
        collection(db, "timesheets"),
        where("employeeCode", "==", employee.userCode || "")
      );
      const snapTs = await getDocs(qTs);
      const mySheets = snapTs.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTimesheets(mySheets);

      // 2) Load manager queries for this employee to flag weeks
      const qQueries = query(
        collection(db, "timesheetQueries"),
        where("employeeCode", "==", employee.userCode || "")
      );
      const snapQueries = await getDocs(qQueries);

      const weekMap = {};
      snapQueries.docs.forEach((docu) => {
        const data = docu.data();
        const status = String(data.status || "open").toLowerCase();
        const weekStart = data.weekStart;

        // Only flag "open-ish" queries
        if (!weekStart) return;
        if (status === "closed" || status === "resolved") return;

        weekMap[weekStart] = true;
      });

      setQueryWeeksMap(weekMap);
    } finally {
      setBusy(false);
    }
  }, [employee?.userCode, isAuthed, loading]);

  useEffect(() => {
    loadTimesheets();
  }, [loadTimesheets]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTimesheets();
    setRefreshing(false);
  }, [loadTimesheets]);

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

  // sort newest → oldest
  const sortedTimesheets = useMemo(
    () =>
      timesheets
        .slice()
        .sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart)),
    [timesheets]
  );

  // only real submissions for the bottom list
  const submittedSheets = useMemo(
    () => sortedTimesheets.filter((t) => t.submitted === true),
    [sortedTimesheets]
  );

  const WeekStatusPill = ({ status }) => {
    // status: "approved" | "submitted" | "draft" | "none"
    let bgStyle, textColor, iconName, label;

    if (status === "approved") {
      bgStyle = styles.pillApproved;
      textColor = "#022c22";
      iconName = "check-circle";
      label = "Approved";
    } else if (status === "submitted") {
      bgStyle = styles.pillSubmitted;
      textColor = "#052e16";
      iconName = "check-circle";
      label = "Submitted";
    } else if (status === "draft") {
      bgStyle = styles.pillDraft;
      textColor = "#1e293b";
      iconName = "edit-3";
      label = "Draft saved";
    } else {
      bgStyle = styles.pillNotFilled;
      textColor = "#7c2d12";
      iconName = "alert-circle";
      label = "Not filled";
    }

    return (
      <View style={[styles.pill, bgStyle]}>
        <Icon
          name={iconName}
          size={14}
          color={textColor}
          style={{ marginRight: 6 }}
        />
        <Text style={[styles.pillText, { color: textColor }]}>{label}</Text>
      </View>
    );
  };

  const renderWeekCard = (weekKey, label, status, hasQuery = false) => (
    <TouchableOpacity
      key={weekKey}
      activeOpacity={0.85}
      style={[
        styles.weekCard,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        status === "submitted" && styles.submittedCard,
        status === "approved" && styles.approvedCard,
      ]}
      onPress={() => router.push(`/week/${weekKey}`)}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.weekLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.weekSubLabel, { color: colors.textMuted }]}>
          Monday → Sunday
        </Text>

        {hasQuery && (
          <View style={styles.queryRow}>
            <Icon name="alert-circle" size={13} color="#f97316" />
            <Text style={styles.queryRowText}>Manager query pending</Text>
          </View>
        )}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <WeekStatusPill status={status} />
        <Icon
          name="chevron-right"
          size={20}
          color={colors.textMuted}
          style={{ marginTop: 6 }}
        />
      </View>
    </TouchableOpacity>
  );

  // follow me.js: render nothing while auth resolving or unauthenticated
  if (loading || !isAuthed) return null;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.8}
          style={[
            styles.backBtn,
            {
              backgroundColor: colors.background,
              borderColor: colors.background,
            },
          ]}
        >
          <Icon name="arrow-left" size={16} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>Timesheets</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            Submit your weekly hours
          </Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Legend row */}
      <View style={styles.legendRow}>
        <LegendSwatch
          color="#22c55e"
          border="#16a34a"
          label="Approved"
          textColor={colors.text}
        />
        <LegendSwatch
          color="#bbf7d0"
          border="#86efac"
          label="Submitted"
          textColor={colors.text}
        />
        <LegendSwatch
          color="#fee2b3"
          border="#fed7aa"
          label="Draft saved"
          textColor={colors.text}
        />
        <LegendSwatch
          color="#fed7aa"
          border="#fdba74"
          label="Not filled"
          textColor={colors.text}
        />
      </View>

      {/* This month (interactive list of 4 weeks) */}
      <Text style={[styles.sectionHeader, { color: colors.text }]}>
        This Month
      </Text>
      <View
        style={{
          borderRadius: 12,
          overflow: "hidden",
          borderColor: colors.border,
          borderWidth: 1,
          marginBottom: 12,
          backgroundColor: colors.surface,
        }}
      >
        {busy ? (
          <View style={{ padding: 10 }}>
            <ShimmerLine />
            <ShimmerLine width="85%" />
            <ShimmerLine width="70%" />
          </View>
        ) : (
          weekOptions.map((w, idx) => {
            const existing = timesheets.find((t) => t.weekStart === w.key);

            let status = "none"; // default: no timesheet
            if (existing) {
              const approved = isTimesheetApproved(existing);
              if (approved) {
                status = "approved";
              } else if (existing.submitted === true) {
                status = "submitted";
              } else {
                status = "draft";
              }
            }

            // ❗ hide query badge if approved
            const hasQuery =
              !!queryWeeksMap[w.key] && status !== "approved";

            return (
              <View
                key={w.key}
                style={{
                  borderBottomWidth:
                    idx === weekOptions.length - 1
                      ? 0
                      : StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                }}
              >
                {renderWeekCard(w.key, w.label, status, hasQuery)}
              </View>
            );
          })
        )}
      </View>

      {/* Past submissions list */}
      <View className="row" style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionHeader, { color: colors.text }]}>
          Past Submissions
        </Text>
        <TouchableOpacity
          onPress={onRefresh}
          activeOpacity={0.8}
          style={[
            styles.refreshBtn,
            {
              backgroundColor: colors.surfaceAlt,
              borderColor: colors.border,
            },
          ]}
        >
          <Icon name="refresh-ccw" size={14} color={colors.text} />
          <Text
            style={[
              styles.refreshText,
              { color: colors.text, fontWeight: "700" },
            ]}
          >
            Refresh
          </Text>
        </TouchableOpacity>
      </View>

      {busy ? (
        <View style={{ paddingTop: 4 }}>
          <ShimmerLine />
          <ShimmerLine width="90%" />
          <ShimmerLine width="80%" />
        </View>
      ) : submittedSheets.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          No timesheets submitted yet.
        </Text>
      ) : (
        <FlatList
          data={submittedSheets}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            const approved = isTimesheetApproved(item);
            const status = approved ? "approved" : "submitted";

            // ❗ hide query badge if approved
            const hasQuery =
              !!queryWeeksMap[item.weekStart] && !approved;

            return renderWeekCard(
              item.weekStart,
              formatWeekRange(new Date(item.weekStart)),
              status,
              hasQuery
            );
          }}
          contentContainerStyle={{ paddingBottom: 16 }}
        />
      )}
    </SafeAreaView>
  );
}

/* tiny components */
function LegendSwatch({ color, border, label, textColor }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendDot,
          { backgroundColor: color, borderColor: border },
        ]}
      />
      <Text style={[styles.legendText, { color: textColor }]}>{label}</Text>
    </View>
  );
}
function ShimmerLine({ width = "100%" }) {
  return <View style={[styles.shimmer, { width }]} />;
}

/* styles */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0b", padding: 12 },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
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
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 10,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  legendText: { color: "#cfcfcf", fontSize: 11 },

  sectionHeaderRow: {
    marginTop: 6,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 6,
  },

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
  refreshText: { color: "#fff", fontSize: 12 },

  weekCard: {
    backgroundColor: "#111111",
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  submittedCard: { borderLeftWidth: 3, borderLeftColor: "#22c55e" },
  approvedCard: { borderLeftWidth: 3, borderLeftColor: "#16a34a" },

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
  pillApproved: { backgroundColor: "#22c55e", borderColor: "#16a34a" },
  pillSubmitted: { backgroundColor: "#bbf7d0", borderColor: "#86efac" },
  pillDraft: { backgroundColor: "#fee2b3", borderColor: "#fed7aa" },
  pillNotFilled: { backgroundColor: "#fed7aa", borderColor: "#fdba74" },
  pillText: { fontSize: 12, fontWeight: "800" },

  queryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  queryRowText: {
    fontSize: 11,
    color: "#f97316",
    fontWeight: "600",
  },

  emptyText: { color: "#9ca3af", fontStyle: "italic", marginTop: 6 },

  shimmer: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#1f1f1f",
    marginBottom: 10,
  },
});
