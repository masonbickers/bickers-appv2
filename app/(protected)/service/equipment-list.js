import { useRouter } from "expo-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import PageHeaderCard from "../../../components/PageHeaderCard";
import { db } from "../../../firebaseConfig";
import { designTokens as t } from "../../../lib/design/tokens";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  inputBg: "#1A1A1A",
  chipBg: "#1F1F1F",
  chipBorder: "#3A3A3A",
};

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
    title: "Overdue - inspect today",
    description: "Next inspection date is in the past. Prioritise this equipment.",
  },
  {
    key: "due-soon",
    title: "Due in next 30 days",
    description: "Inspection is coming up within 30 days.",
  },
  {
    key: "ok",
    title: "OK / future",
    description: "Inspection date is not due soon.",
  },
  {
    key: "unknown",
    title: "No date recorded",
    description: "Missing next inspection date - update the equipment record.",
  },
];

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toDateMaybe(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const str = String(value).trim();
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const ukMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (ukMatch) {
    const [, dd, mm, yyyy] = ukMatch.map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysUntilDate(value) {
  const d = toDateMaybe(value);
  if (!d) return null;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86400000);
}

function classifyStatus(dateValue, windowDays = 30) {
  const days = daysUntilDate(dateValue);
  if (days === null) return { label: "No date", code: "unknown" };
  if (days < 0) return { label: `Overdue by ${Math.abs(days)}d`, code: "overdue" };
  if (days === 0) return { label: "Due today", code: "due-soon" };
  if (days <= windowDays) return { label: `Due in ${days}d`, code: "due-soon" };
  return { label: `In ${days}d`, code: "ok" };
}

function formatDateShort(value) {
  const d = toDateMaybe(value);
  if (!d) return "";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`;
}

export default function EquipmentListScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [equipment, setEquipment] = useState([]);
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
    const q = query(collection(db, "equipment"), orderBy("name", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEquipment(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load equipment list:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const processed = useMemo(() => {
    return equipment.map((item) => {
      const nextInspectionRaw = item.nextInspection || item.inspectionDueDate;
      const inspectionStatus = classifyStatus(nextInspectionRaw);
      return {
        ...item,
        nextInspectionRaw,
        inspectionStatus,
        worstCode: inspectionStatus.code,
      };
    });
  }, [equipment]);

  const summaryCounts = useMemo(() => {
    const counts = { overdue: 0, "due-soon": 0, ok: 0, unknown: 0 };
    processed.forEach((item) => {
      if (counts[item.worstCode] !== undefined) counts[item.worstCode] += 1;
    });
    return counts;
  }, [processed]);

  const filtered = useMemo(() => {
    let list = [...processed];
    if (search.trim()) {
      const q = normaliseKey(search);
      list = list.filter((item) =>
        [
          item.name,
          item.label,
          item.serialNumber,
          item.asset,
          item.notes,
          item.status,
          item.category,
          item.location,
        ]
          .map(normaliseKey)
          .some((value) => value.includes(q))
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((item) => item.worstCode === statusFilter);
    }
    return list;
  }, [processed, search, statusFilter]);

  const byStatus = useMemo(() => {
    const acc = { overdue: [], "due-soon": [], ok: [], unknown: [] };
    filtered.forEach((item) => {
      const key = acc[item.worstCode] ? item.worstCode : "unknown";
      acc[key].push(item);
    });
    Object.keys(acc).forEach((key) => {
      acc[key].sort((a, b) =>
        String(a.name || a.label || "").localeCompare(String(b.name || b.label || ""), "en", {
          sensitivity: "base",
        })
      );
    });
    return acc;
  }, [filtered]);

  const hasAnyEquipment =
    byStatus.overdue.length ||
    byStatus["due-soon"].length ||
    byStatus.ok.length ||
    byStatus.unknown.length;

  const toggleStatusSection = (key) => {
    setExpandedStatus((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const startInspection = (equipmentDocId) => {
    router.push({
      pathname: `/service/inspections/inspection-form/new-${Date.now()}`,
      params: { equipmentDocId },
    });
  };

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.container, { backgroundColor: colors.background || COLORS.background }]}
    >
      <PageHeaderCard
        eyebrow="Workshop"
        title="Equipment Inspections"
        subtitle="Prioritise overdue equipment, then tap to start the inspection form."
        style={styles.headerCard}
        contentStyle={styles.headerContent}
        eyebrowStyle={styles.headerEyebrow}
        titleStyle={styles.headerTitle}
        subtitleStyle={styles.headerSubtitle}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.danger || COLORS.primaryAction} />
          <Text style={[styles.loadingText, { color: colors.textMuted || COLORS.textMid }]}>
            Loading equipment data...
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={styles.summaryStrip}>
            <SummaryPill label="Overdue" value={summaryCounts.overdue} tone="danger" />
            <SummaryPill label="Due soon" value={summaryCounts["due-soon"]} tone="warning" />
            <SummaryPill label="OK" value={summaryCounts.ok} tone="success" />
            <SummaryPill label="No date" value={summaryCounts.unknown} tone="muted" />
          </View>

          <View style={styles.controlsContainer}>
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: colors.inputBackground || COLORS.inputBg,
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
                placeholder="Search by name, serial, asset, category..."
                placeholderTextColor={colors.textMuted || "#777"}
                value={search}
                onChangeText={setSearch}
                style={[styles.searchInput, { color: colors.text || COLORS.textHigh }]}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")} activeOpacity={0.7}>
                  <Icon name="x" size={14} color={colors.textMuted || COLORS.textMid} />
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

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {!hasAnyEquipment ? (
              <View style={styles.emptyState}>
                <Icon name="package" size={26} color={colors.textMuted || COLORS.textMid} />
                <Text style={[styles.emptyTitle, { color: colors.text || COLORS.textHigh }]}>
                  No equipment matches this view
                </Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted || COLORS.textMid }]}>
                  Try clearing the search or changing the status filter.
                </Text>
              </View>
            ) : (
              STATUS_SECTIONS.map((section) => {
                const list = byStatus[section.key] || [];
                if (list.length === 0) return null;
                const expanded = expandedStatus[section.key] ?? true;

                let accentColour = colors.border || COLORS.border;
                if (section.key === "overdue") accentColour = colors.danger || "#ED1C25";
                else if (section.key === "due-soon") accentColour = "#FF9500";
                else if (section.key === "ok") accentColour = colors.success || "#34C759";

                return (
                  <View key={section.key} style={styles.sectionBlock}>
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
                        <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
                          {section.title}
                        </Text>
                      </View>
                      <Text style={[styles.sectionCount, { color: colors.textMuted || COLORS.textMid }]}>
                        {list.length} item{list.length !== 1 ? "s" : ""}
                      </Text>
                    </TouchableOpacity>

                    <Text style={[styles.sectionDescription, { color: colors.textMuted || COLORS.textMid }]}>
                      {section.description}
                    </Text>

                    {expanded &&
                      list.map((item) => {
                        const name = item.name || item.label || "Unnamed equipment";
                        const category = item.category || "Uncategorised";
                        const serialOrAsset = [item.serialNumber, item.asset].filter(Boolean).join(" · ");
                        const inspectionStatusWithDate = {
                          ...item.inspectionStatus,
                          label:
                            item.inspectionStatus.label +
                            (item.nextInspectionRaw ? ` · ${formatDateShort(item.nextInspectionRaw)}` : ""),
                        };

                        let borderAccent = colors.border || COLORS.border;
                        if (item.worstCode === "overdue") borderAccent = colors.danger || "#ED1C25";
                        else if (item.worstCode === "due-soon") borderAccent = "#FF9500";
                        else if (item.worstCode === "ok") borderAccent = colors.success || "#34C759";

                        return (
                          <TouchableOpacity
                            key={item.id}
                            style={[
                              styles.equipmentCard,
                              {
                                borderLeftColor: borderAccent,
                                backgroundColor: colors.surfaceAlt || COLORS.card,
                                borderColor: colors.border || COLORS.border,
                              },
                            ]}
                            activeOpacity={0.85}
                            onPress={() => startInspection(item.id)}
                          >
                            <View style={styles.equipmentHeaderRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={[styles.equipmentTitle, { color: colors.text || COLORS.textHigh }]}>
                                  {name}
                                </Text>
                                {!!serialOrAsset && (
                                  <Text style={[styles.equipmentMeta, { color: colors.textMuted || COLORS.textMid }]}>
                                    {serialOrAsset}
                                  </Text>
                                )}
                                <Text style={[styles.equipmentMeta, { color: colors.textMuted || COLORS.textMid }]}>
                                  {[category, item.location].filter(Boolean).join(" · ")}
                                </Text>
                              </View>
                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={[styles.cardHint, { color: colors.textMuted || COLORS.textLow }]}>
                                  Tap to inspect
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
                              <StatusPill label="Inspection" status={inspectionStatusWithDate} />
                              {!!item.status && (
                                <View style={styles.neutralPill}>
                                  <Text style={styles.neutralPillText}>{item.status}</Text>
                                </View>
                              )}
                            </View>

                            <View style={styles.metaRow}>
                              <MetaItem label="Last" value={formatDateShort(item.lastInspection) || "No date"} colors={colors} />
                              <MetaItem label="Frequency" value={item.inspectionFrequency ? `${item.inspectionFrequency} wk` : "Not set"} colors={colors} />
                              <MetaItem label="Category" value={category} colors={colors} />
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

function StatusPill({ label, status }) {
  const { colors } = useTheme();
  const code = status.code;
  let bg = "rgba(74, 74, 74, 0.7)";
  let fg = colors.text || COLORS.textHigh;

  if (code === "overdue") {
    bg = "rgba(255,59,48,0.22)";
    fg = colors.danger || "#ED1C25";
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
  let fg = colors.textMuted || COLORS.textMid;
  if (tone === "danger") fg = colors.danger || "#ED1C25";
  else if (tone === "warning") fg = "#FF9500";
  else if (tone === "success") fg = colors.success || "#34C759";

  return (
    <View style={styles.summaryPill}>
      <Text style={[styles.summaryValue, { color: fg }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: colors.textMuted || COLORS.textMid }]}>
        {label}
      </Text>
    </View>
  );
}

function MetaItem({ label, value, colors }) {
  return (
    <View style={styles.metaItem}>
      <Text style={[styles.metaLabel, { color: colors.textMuted || COLORS.textLow }]}>
        {label}
      </Text>
      <Text style={[styles.metaValue, { color: colors.textMuted || COLORS.textMid }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerCard: {
    marginHorizontal: t.spacing.md,
    marginTop: 0,
    marginBottom: 0,
  },
  headerContent: {
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerEyebrow: {
    fontSize: 11,
    lineHeight: 14,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 27,
    marginTop: 1,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
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
  summaryStrip: {
    flexDirection: "row",
    paddingHorizontal: t.spacing.md,
    paddingTop: 6,
    paddingBottom: 2,
    justifyContent: "space-between",
  },
  summaryPill: {
    flex: 1,
    minHeight: 36,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginRight: 6,
  },
  summaryValue: {
    fontSize: 17,
    lineHeight: 20,
    fontWeight: "800",
  },
  summaryLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  controlsContainer: {
    paddingHorizontal: t.spacing.md,
    paddingTop: 4,
    paddingBottom: 0,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 2,
    marginRight: 6,
  },
  filterRow: {
    marginTop: 8,
    paddingBottom: 2,
  },
  filterChip: {
    minHeight: 30,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 2,
    paddingBottom: 104,
  },
  sectionBlock: {
    marginBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 4,
    paddingBottom: 2,
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
    marginBottom: 4,
  },
  equipmentCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    marginTop: 5,
    padding: 11,
    borderLeftWidth: 3,
  },
  equipmentHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  equipmentTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  equipmentMeta: {
    marginTop: 2,
    fontSize: 12,
  },
  cardHint: {
    fontSize: 11,
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
  neutralPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 4,
    backgroundColor: "rgba(142,142,147,0.22)",
  },
  neutralPillText: {
    color: COLORS.textMid,
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
  },
  metaValue: {
    fontSize: 12,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
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
