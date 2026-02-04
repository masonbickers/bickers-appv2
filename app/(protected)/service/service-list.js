// app/(protected)/service-list.jsx
import { useRouter } from "expo-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

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
  primaryAction: "#FF3B30", // red accent
  inputBg: "#1A1A1A",
  chipBg: "#1F1F1F",
  chipBorder: "#3A3A3A",
};

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

function formatDateShort(value) {
  const d = toDateMaybe(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

/* ---------- FILTER HELPERS ---------- */

const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "due-soon", label: "Due soon" },
  { key: "ok", label: "OK" },
  { key: "unknown", label: "No date" },
];

const STATUS_SECTIONS = [
  {
    key: "overdue",
    title: "Overdue – book today",
    description: "MOT or service date is in the past. Prioritise these vehicles.",
  },
  {
    key: "due-soon",
    title: "Due in next 30 days",
    description: "MOT or service coming up within 30 days.",
  },
  {
    key: "ok",
    title: "OK / future",
    description: "Nothing due soon. Keep an eye on mileage and upcoming dates.",
  },
  {
    key: "unknown",
    title: "No date recorded",
    description: "Missing MOT or service dates – update vehicle records.",
  },
];

/* ---------- MAIN SCREEN ---------- */

export default function ServiceListScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedStatus, setExpandedStatus] = useState({
    overdue: true,
    "due-soon": true,
    ok: true,
    unknown: true,
  });

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
        console.error("Failed to load vehicles for service-list:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const processed = useMemo(() => {
    return vehicles.map((v) => {
      const motDateRaw =
        v.nextMOT ||
        v.nextMot ||
        v.nextMotDate ||
        v.motDueDate ||
        v.motExpiryDate;
      const serviceDateRaw =
        v.nextService ||
        v.nextServiceDate ||
        v.serviceDueDate ||
        v.nextSvc;

      const motStatus = classifyStatus(motDateRaw);
      const serviceStatus = classifyStatus(serviceDateRaw);

      return {
        ...v,
        motStatus,
        serviceStatus,
        motDateRaw,
        serviceDateRaw,
        worstCode: pickWorstStatusCode(motStatus.code, serviceStatus.code),
      };
    });
  }, [vehicles]);

  const summaryCounts = useMemo(() => {
    const counts = {
      overdue: 0,
      "due-soon": 0,
      ok: 0,
      unknown: 0,
    };
    processed.forEach((v) => {
      if (counts[v.worstCode] !== undefined) {
        counts[v.worstCode] += 1;
      }
    });
    return counts;
  }, [processed]);

  const filtered = useMemo(() => {
    let list = [...processed];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((v) => {
        const name = (v.name || v.vehicleName || "").toLowerCase();
        const reg = (v.registration || v.reg || "").toLowerCase();
        const manufacturer = (v.manufacturer || "").toLowerCase();
        const model = (v.model || "").toLowerCase();
        return (
          name.includes(q) ||
          reg.includes(q) ||
          manufacturer.includes(q) ||
          model.includes(q)
        );
      });
    }

    if (statusFilter !== "all") {
      list = list.filter((v) => v.worstCode === statusFilter);
    }

    return list;
  }, [processed, search, statusFilter]);

  // Group by status code for separate sections
  const byStatus = useMemo(() => {
    const acc = {
      overdue: [],
      "due-soon": [],
      ok: [],
      unknown: [],
    };

    filtered.forEach((v) => {
      const key = acc[v.worstCode] ? v.worstCode : "unknown";
      acc[key].push(v);
    });

    // Sort each list by vehicle name for consistency
    Object.keys(acc).forEach((key) => {
      acc[key].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", "en", {
          sensitivity: "base",
        })
      );
    });

    return acc;
  }, [filtered]);

  const toggleStatusSection = (key) => {
    setExpandedStatus((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const hasAnyVehicles =
    byStatus.overdue.length ||
    byStatus["due-soon"].length ||
    byStatus.ok.length ||
    byStatus.unknown.length;

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
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.pageTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            MOT & Service – Full List
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Use the status sections to see what needs booking first, then tap a
            vehicle to view details and book work.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.danger || COLORS.primaryAction} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading maintenance data…
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* QUICK SUMMARY STRIP */}
          <View style={styles.summaryStrip}>
            <SummaryPill
              label="Overdue"
              value={summaryCounts.overdue}
              tone="danger"
            />
            <SummaryPill
              label="Due soon"
              value={summaryCounts["due-soon"]}
              tone="warning"
            />
            <SummaryPill
              label="OK"
              value={summaryCounts.ok}
              tone="success"
            />
            <SummaryPill
              label="No date"
              value={summaryCounts.unknown}
              tone="muted"
            />
          </View>

          {/* SEARCH + FILTERS */}
          <View style={styles.controlsContainer}>
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor:
                    colors.inputBackground || COLORS.inputBg,
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
            >
              <Icon
                name="search"
                size={16}
                color={colors.textMuted || COLORS.textMid}
                style={{ marginRight: 6 }}
              />
              <TextInput
                placeholder="Search by name, reg, manufacturer, model…"
                placeholderTextColor={colors.textMuted || "#777"}
                value={search}
                onChangeText={setSearch}
                style={[
                  styles.searchInput,
                  { color: colors.text || COLORS.textHigh },
                ]}
              />
              {search.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearch("")}
                  activeOpacity={0.7}
                >
                  <Icon
                    name="x"
                    size={14}
                    color={colors.textMuted || COLORS.textMid}
                  />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              {FILTER_OPTIONS.map((opt) => {
                const active = statusFilter === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.filterChip,
                      {
                        borderColor: active
                          ? colors.accent || COLORS.primaryAction
                          : colors.border || COLORS.chipBorder,
                        backgroundColor: active
                          ? colors.accentSoft || "rgba(255,59,48,0.18)"
                          : colors.surfaceAlt || COLORS.chipBg,
                      },
                    ]}
                    onPress={() => setStatusFilter(opt.key)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        {
                          color: active
                            ? colors.accent || COLORS.primaryAction
                            : colors.textMuted || COLORS.textMid,
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* LIST SECTIONS */}
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {!hasAnyVehicles ? (
              <View style={styles.emptyState}>
                <Icon
                  name="file-text"
                  size={26}
                  color={colors.textMuted || COLORS.textMid}
                />
                <Text
                  style={[
                    styles.emptyTitle,
                    { color: colors.text || COLORS.textHigh },
                  ]}
                >
                  No vehicles match this view
                </Text>
                <Text
                  style={[
                    styles.emptySubtitle,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  Try clearing the search or changing the status filter.
                </Text>
              </View>
            ) : (
              STATUS_SECTIONS.map((section) => {
                const list = byStatus[section.key] || [];
                if (list.length === 0) return null;

                const expanded = expandedStatus[section.key] ?? true;

                let accentColour = colors.border || COLORS.border;
                if (section.key === "overdue") accentColour = colors.danger || "#FF3B30";
                else if (section.key === "due-soon") accentColour = "#FF9500";
                else if (section.key === "ok") accentColour = colors.success || "#34C759";

                return (
                  <View key={section.key} style={styles.sectionBlock}>
                    {/* Section header */}
                    <TouchableOpacity
                      style={styles.sectionHeaderRow}
                      onPress={() => toggleStatusSection(section.key)}
                      activeOpacity={0.8}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Icon
                          name={expanded ? "chevron-down" : "chevron-right"}
                          size={16}
                          color={accentColour}
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={[
                            styles.sectionTitle,
                            { color: colors.text || COLORS.textHigh },
                          ]}
                        >
                          {section.title}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.sectionCount,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                      >
                        {list.length} vehicle{list.length !== 1 ? "s" : ""}
                      </Text>
                    </TouchableOpacity>

                    <Text
                      style={[
                        styles.sectionDescription,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      {section.description}
                    </Text>

                    {/* Vehicles in this status */}
                    {expanded &&
                      list.map((v) => {
                        const name = v.name || v.vehicleName || "Unnamed vehicle";
                        const reg = v.registration || v.reg || "";
                        const manufacturer = v.manufacturer || "";
                        const model = v.model || "";
                        const taxStatus = v.taxStatus || "Unknown";
                        const insuranceStatus = v.insuranceStatus || "Unknown";

                        const motStatusWithDate = {
                          ...v.motStatus,
                          label:
                            v.motStatus.label +
                            (v.motDateRaw
                              ? ` · ${formatDateShort(v.motDateRaw)}`
                              : ""),
                        };
                        const serviceStatusWithDate = {
                          ...v.serviceStatus,
                          label:
                            v.serviceStatus.label +
                            (v.serviceDateRaw
                              ? ` · ${formatDateShort(v.serviceDateRaw)}`
                              : ""),
                        };

                        let borderAccent = colors.border || COLORS.border;
                        if (v.worstCode === "overdue")
                          borderAccent = colors.danger || "#FF3B30";
                        else if (v.worstCode === "due-soon")
                          borderAccent = "#FF9500";
                        else if (v.worstCode === "ok")
                          borderAccent = colors.success || "#34C759";

                        return (
                          <TouchableOpacity
                            key={v.id}
                            style={[
                              styles.vehicleCard,
                              {
                                borderLeftColor: borderAccent,
                                backgroundColor:
                                  colors.surfaceAlt || COLORS.card,
                                borderColor: colors.border || COLORS.border,
                              },
                            ]}
                            activeOpacity={0.85}
                            onPress={() =>
                              router.push(`/service/vehicles/${v.id}`)
                            }
                          >
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
                                      {
                                        color:
                                          colors.textMuted || COLORS.textMid,
                                      },
                                    ]}
                                  >
                                    {reg}
                                  </Text>
                                )}
                                {(manufacturer || model) && (
                                  <Text
                                    style={[
                                      styles.vehicleReg,
                                      {
                                        color:
                                          colors.textMuted || COLORS.textMid,
                                      },
                                    ]}
                                  >
                                    {manufacturer}
                                    {manufacturer && model ? " · " : ""}
                                    {model}
                                  </Text>
                                )}
                              </View>
                              <View style={{ alignItems: "flex-end" }}>
                                <Text
                                  style={[
                                    styles.cardHint,
                                    {
                                      color:
                                        colors.textMuted || COLORS.textLow,
                                    },
                                  ]}
                                >
                                  Tap to view & book work
                                </Text>
                                <Icon
                                  name="chevron-right"
                                  size={18}
                                  color={colors.textMuted || COLORS.textMid}
                                  style={{ marginTop: 2 }}
                                />
                              </View>
                            </View>

                            <View style={styles.statusRow}>
                              <StatusPill label="MOT" status={motStatusWithDate} />
                              <StatusPill
                                label="Service"
                                status={serviceStatusWithDate}
                              />
                            </View>

                            <View style={styles.metaRow}>
                              <View style={styles.metaItem}>
                                <Text
                                  style={[
                                    styles.metaLabel,
                                    {
                                      color:
                                        colors.textMuted || COLORS.textLow,
                                    },
                                  ]}
                                >
                                  Tax
                                </Text>
                                <Text
                                  style={[
                                    styles.metaValue,
                                    {
                                      color:
                                        colors.textMuted || COLORS.textMid,
                                    },
                                  ]}
                                >
                                  {taxStatus}
                                </Text>
                              </View>
                              <View style={styles.metaItem}>
                                <Text
                                  style={[
                                    styles.metaLabel,
                                    {
                                      color:
                                        colors.textMuted || COLORS.textLow,
                                    },
                                  ]}
                                >
                                  Insurance
                                </Text>
                                <Text
                                  style={[
                                    styles.metaValue,
                                    {
                                      color:
                                        colors.textMuted || COLORS.textMid,
                                    },
                                  ]}
                                >
                                  {insuranceStatus}
                                </Text>
                              </View>
                              {typeof v.mileage === "number" && (
                                <View style={styles.metaItem}>
                                  <Text
                                    style={[
                                      styles.metaLabel,
                                      {
                                        color:
                                          colors.textMuted || COLORS.textLow,
                                      },
                                    ]}
                                  >
                                    Odo
                                  </Text>
                                  <Text
                                    style={[
                                      styles.metaValue,
                                      {
                                        color:
                                          colors.textMuted || COLORS.textMid,
                                      },
                                    ]}
                                  >
                                    {v.mileage.toLocaleString("en-GB")} mi
                                  </Text>
                                </View>
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                );
              })
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function StatusPill({ label, status }) {
  const { colors } = useTheme();
  const code = status.code;
  let bg = "rgba(74, 74, 74, 0.7)";
  let fg = colors.text || COLORS.textHigh;

  if (code === "overdue") {
    bg = "rgba(255,59,48,0.22)";
    fg = colors.danger || "#FF3B30";
  } else if (code === "due-soon") {
    bg = "rgba(255,149,0,0.22)";
    fg = "#FF9500";
  } else if (code === "ok") {
    bg = "rgba(52,199,89,0.22)";
    fg = colors.success || "#34C759";
  } else if (code === "unknown") {
    bg = "rgba(142,142,147,0.22)";
    fg = colors.textMuted || COLORS.textMid;
  }

  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillText, { color: fg }]}>
        {label}: {status.label}
      </Text>
    </View>
  );
}

function SummaryPill({ label, value, tone }) {
  const { colors } = useTheme();
  let border = colors.border || COLORS.border;
  let fg = colors.textMuted || COLORS.textMid;

  if (tone === "danger") {
    border = colors.danger || "#FF3B30";
    fg = colors.danger || "#FF3B30";
  } else if (tone === "warning") {
    border = "#FF9500";
    fg = "#FF9500";
  } else if (tone === "success") {
    border = colors.success || "#34C759";
    fg = colors.success || "#34C759";
  }

  return (
    <View style={[styles.summaryPill, { borderColor: border }]}>
      <Text style={[styles.summaryValue, { color: fg }]}>{value}</Text>
      <Text
        style={[
          styles.summaryLabel,
          { color: colors.textMuted || COLORS.textMid },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  pageSubtitle: {
    marginTop: 3,
    fontSize: 12,
    color: COLORS.textMid,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    color: COLORS.textMid,
    fontSize: 13,
  },

  /* SUMMARY STRIP */
  summaryStrip: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    justifyContent: "space-between",
  },
  summaryPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginRight: 6,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "700",
  },
  summaryLabel: {
    fontSize: 11,
    color: COLORS.textMid,
  },

  controlsContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 2,
    marginRight: 6,
  },
  filterRow: {
    marginTop: 10,
    paddingBottom: 2,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },

  /* STATUS SECTIONS */
  sectionBlock: {
    marginBottom: 14,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  sectionCount: {
    fontSize: 12,
  },
  sectionDescription: {
    fontSize: 11,
    color: COLORS.textMid,
    marginBottom: 6,
  },

  vehicleCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    marginTop: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 3,
  },
  vehicleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  vehicleTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  vehicleReg: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  cardHint: {
    fontSize: 11,
    color: COLORS.textLow,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
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
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
  },
  metaItem: {
    marginRight: 16,
    marginBottom: 2,
  },
  metaLabel: {
    fontSize: 11,
    color: COLORS.textLow,
  },
  metaValue: {
    fontSize: 12,
    color: COLORS.textMid,
  },

  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
  },
});
