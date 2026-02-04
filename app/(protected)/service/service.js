// app/protected/service.jsx

import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

// Firebase
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { db } from "../../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

/* ---------- CONSTANTS & HELPERS ---------- */

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#2176FF",
  recceAction: "#FF3B30",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "due-soon", label: "Due Soon" },
  { key: "overdue", label: "Overdue" },
  { key: "mot", label: "MOT" },
  { key: "service", label: "Service" },
  { key: "defects", label: "Defects" },
];

function toDateMaybe(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate(); // Firestore Timestamp
  if (typeof value === "string" || value instanceof String) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (value instanceof Date) return value;
  return null;
}

function daysUntilDate(value) {
  const d = toDateMaybe(value);
  if (!d) return null;
  const today = new Date();
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = target.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function classifyStatus(dateValue, windowDays = 30) {
  const days = daysUntilDate(dateValue);
  if (days === null) return { label: "No date", code: "unknown" };
  if (days < 0) return { label: `Overdue by ${Math.abs(days)}d`, code: "overdue" };
  if (days === 0) return { label: "Due today", code: "due-soon" };
  if (days <= windowDays) return { label: `Due in ${days}d`, code: "due-soon" };
  return { label: `In ${days}d`, code: "ok" };
}

function pickWorstStatusCode(motCode, serviceCode) {
  const codes = [motCode, serviceCode];
  if (codes.includes("overdue")) return "overdue";
  if (codes.includes("due-soon")) return "due-soon";
  if (codes.includes("ok")) return "ok";
  return "unknown";
}

/* ---------- MAIN SCREEN ---------- */

export default function ServiceScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const q = query(collection(db, "vehicles"), orderBy("name", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setVehicles(data);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load vehicles:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const processed = useMemo(() => {
    return vehicles.map((v) => {
      const motStatus = classifyStatus(v.nextMotDate || v.motDueDate);
      const serviceStatus = classifyStatus(
        v.nextServiceDate || v.serviceDueDate
      );
      const defects = Array.isArray(v.defects) ? v.defects : [];
      const hasDefects = defects.length > 0;

      return {
        ...v,
        motStatus,
        serviceStatus,
        defects,
        hasDefects,
        worstCode: pickWorstStatusCode(motStatus.code, serviceStatus.code),
      };
    });
  }, [vehicles]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "due-soon":
        return processed.filter(
          (v) =>
            v.motStatus.code === "due-soon" ||
            v.serviceStatus.code === "due-soon"
        );
      case "overdue":
        return processed.filter(
          (v) =>
            v.motStatus.code === "overdue" ||
            v.serviceStatus.code === "overdue"
        );
      case "mot":
        return processed.filter(
          (v) =>
            v.motStatus.code === "due-soon" ||
            v.motStatus.code === "overdue"
        );
      case "service":
        return processed.filter(
          (v) =>
            v.serviceStatus.code === "due-soon" ||
            v.serviceStatus.code === "overdue"
        );
      case "defects":
        return processed.filter((v) => v.hasDefects);
      case "all":
      default:
        return processed;
    }
  }, [processed, filter]);

  const overdueCount = processed.filter(
    (v) =>
      v.motStatus.code === "overdue" || v.serviceStatus.code === "overdue"
  ).length;
  const dueSoonCount = processed.filter(
    (v) =>
      v.motStatus.code === "due-soon" || v.serviceStatus.code === "due-soon"
  ).length;
  const defectCount = processed.filter((v) => v.hasDefects).length;

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity onPress={router.back} style={styles.backButton}>
          <Icon
            name="arrow-left"
            size={24}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
        <Text
          style={[
            styles.pageTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          Service & MOT
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={colors.accent || COLORS.primaryAction}
          />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading vehicle maintenance...
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* SUMMARY CARD */}
          <View
            style={[
              styles.infoCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderLeftColor: colors.accent || COLORS.primaryAction,
              },
            ]}
          >
            <Text
              style={[
                styles.infoTextTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Fleet Overview
            </Text>
            <Text
              style={[
                styles.infoTextDetail,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Vehicles: {processed.length}
            </Text>
            <Text
              style={[
                styles.infoTextDetail,
                {
                  color:
                    overdueCount > 0
                      ? colors.danger || "#FF3B30"
                      : colors.textMuted || COLORS.textMid,
                },
              ]}
            >
              Overdue: {overdueCount}
            </Text>
            <Text
              style={[
                styles.infoTextDetail,
                {
                  color:
                    dueSoonCount > 0
                      ? "#FF9500"
                      : colors.textMuted || COLORS.textMid,
                },
              ]}
            >
              Due Soon (30 days): {dueSoonCount}
            </Text>
            <Text
              style={[
                styles.infoTextDetail,
                {
                  color:
                    defectCount > 0
                      ? colors.danger || "#FF3B30"
                      : colors.textMuted || COLORS.textMid,
                },
              ]}
            >
              Vehicles with Defects: {defectCount}
            </Text>
          </View>

          {/* FILTERS */}
          <View style={styles.filterRow}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[
                    styles.filterChip,
                    {
                      borderColor: active
                        ? colors.accent || COLORS.primaryAction
                        : colors.border || COLORS.lightGray,
                      backgroundColor: active
                        ? colors.accent || COLORS.primaryAction
                        : colors.surfaceAlt || COLORS.card,
                    },
                  ]}
                  onPress={() => setFilter(f.key)}
                >
                  <Text
                    style={[
                      styles.filterText,
                      {
                        color: active
                          ? COLORS.textHigh
                          : colors.textMuted || COLORS.textMid,
                      },
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* SECTION TITLE */}
          <View style={styles.sectionDivider}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Upcoming Services & MOTs
            </Text>
          </View>

          {/* EMPTY STATE */}
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                name="check-circle"
                size={36}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Nothing to action
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                No vehicles match this filter. Try switching to another view.
              </Text>
            </View>
          ) : (
            filtered.map((v) => {
              const name = v.name || v.vehicleName || "Unnamed vehicle";
              const reg = v.reg || v.registration || "";
              const { motStatus, serviceStatus, hasDefects, defects, worstCode } =
                v;

              const borderAccent =
                worstCode === "overdue"
                  ? "#FF3B30"
                  : worstCode === "due-soon"
                  ? "#FF9500"
                  : colors.border || COLORS.border;

              return (
                <TouchableOpacity
                  key={v.id}
                  style={[
                    styles.vehicleCard,
                    {
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderLeftColor: borderAccent,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => router.push(`/vehicles/${v.id}`)} // adjust if your detail route differs
                >
                  {/* Top row */}
                  <View style={styles.vehicleHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.vehicleTitle,
                          { color: colors.text || COLORS.textHigh },
                        ]}
                      >
                        {name}
                      </Text>
                      {!!reg && (
                        <Text
                          style={[
                            styles.vehicleReg,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          {reg}
                        </Text>
                      )}
                    </View>
                    <Icon
                      name="chevron-right"
                      size={18}
                      color={colors.textMuted || COLORS.textMid}
                    />
                  </View>

                  {/* Status pills */}
                  <View style={styles.statusRow}>
                    <StatusPill label="MOT" status={motStatus} />
                    <StatusPill label="Service" status={serviceStatus} />
                    {hasDefects && (
                      <View style={styles.defectPill}>
                        <Icon
                          name="alert-triangle"
                          size={14}
                          color={COLORS.textHigh}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.defectText}>
                          {defects.length} defect
                          {defects.length > 1 ? "s" : ""}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Bottom meta row */}
                  <View style={styles.metaRow}>
                    {typeof v.mileage === "number" && (
                      <Text
                        style={[
                          styles.metaText,
                          { color: colors.textMuted || COLORS.textLow },
                        ]}
                      >
                        Mileage: {v.mileage.toLocaleString()} miles
                      </Text>
                    )}
                    {!!v.location && (
                      <Text
                        style={[
                          styles.metaText,
                          { color: colors.textMuted || COLORS.textLow },
                        ]}
                      >
                        Location: {v.location}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function StatusPill({ label, status }) {
  const code = status.code;
  let bg = "rgba(74, 74, 74, 0.7)";
  let fg = COLORS.textHigh;

  if (code === "overdue") {
    bg = "rgba(255,59,48,0.22)";
    fg = "#FF3B30";
  } else if (code === "due-soon") {
    bg = "rgba(255,149,0,0.22)";
    fg = "#FF9500";
  } else if (code === "ok") {
    bg = "rgba(52,199,89,0.22)";
    fg = "#34C759";
  } else if (code === "unknown") {
    bg = "rgba(142,142,147,0.22)";
    fg = COLORS.textMid;
  }

  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillText, { color: fg }]}>
        {label}: {status.label}
      </Text>
    </View>
  );
}

/* ---------- STYLES (MATCHING RECCE STYLE) ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: 10,
  },
  pageTitle: {
    color: COLORS.textHigh,
    fontSize: 22,
    fontWeight: "800",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryAction,
  },
  infoTextTitle: {
    color: COLORS.textHigh,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 5,
  },
  infoTextDetail: {
    color: COLORS.textMid,
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: COLORS.card,
  },
  filterText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textMid,
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 15,
  },
  sectionTitle: {
    color: COLORS.textHigh,
    fontSize: 16,
    fontWeight: "700",
    paddingRight: 10,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 18,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 14,
    textAlign: "center",
  },
  vehicleCard: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderRadius: 10,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.border,
  },
  vehicleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  vehicleTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    marginBottom: 4,
    alignItems: "center",
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  defectPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.recceAction,
    marginBottom: 4,
  },
  defectText: {
    fontSize: 11,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },
  metaText: {
    fontSize: 11,
    color: COLORS.textLow,
    marginRight: 12,
    marginTop: 2,
  },
});
