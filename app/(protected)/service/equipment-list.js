import { AppText as Text, AppPressable as TouchableOpacity, FormField } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
import { useRouter } from "expo-router";
import { useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import PageShell from "../../../components/layout/PageShell";
import { designTokens as t } from "../../../lib/design/tokens";
import {
  getEquipmentCategory,
  getEquipmentLastInspection,
  getEquipmentName,
  getEquipmentNextInspection,
  getEquipmentStatus,
} from "../../../lib/fleetSchema";
import { useServiceCollection } from "../../../hooks/useServiceData";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";

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

  const { rows: equipment, loading } = useServiceCollection("equipment", {
    label: "equipment list",
    orderByField: "name",
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedStatus, setExpandedStatus] = useState({
    overdue: true,
    "due-soon": true,
    ok: true,
    unknown: true,
  });

  const processed = useMemo(() => {
    return equipment.map((item) => {
      const nextInspectionRaw = getEquipmentNextInspection(item);
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
          getEquipmentName(item),
          item.label,
          item.serialNumber,
          item.asset,
          item.notes,
          getEquipmentStatus(item),
          getEquipmentCategory(item),
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
        String(getEquipmentName(a)).localeCompare(String(getEquipmentName(b)), "en", {
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
    <PageShell
      header={{
        variant: "hero",
        eyebrow: "Workshop",
        title: "Equipment Inspections",
        subtitle: "Prioritise overdue equipment, then tap to start the inspection form.",
      }}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.danger || COLORS.primaryAction} />
          <Text style={[styles.loadingText, { color: colors.textMuted || COLORS.textMid }]}>
            Loading equipment data...
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.summaryStrip}>
            <SummaryPill label="Overdue" value={summaryCounts.overdue} tone="danger" />
            <SummaryPill label="Due soon" value={summaryCounts["due-soon"]} tone="warning" />
            <SummaryPill label="OK" value={summaryCounts.ok} tone="success" />
            <SummaryPill label="No date" value={summaryCounts.unknown} tone="muted" />
          </View>

          <View style={styles.controlsContainer}>
            <FormField
              label="Search equipment"
              placeholder="Search by name, serial, asset, category..."
              value={search}
              onChangeText={setSearch}
              inputProps={{ returnKeyType: "search" }}
            />

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
                          ? colors.accentSoft || staticColors.rgba_mxgb17
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

          <>
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
                if (section.key === "overdue") accentColour = colors.danger || staticColors.hex_ed1c25_4py4qa;
                else if (section.key === "due-soon") accentColour = staticColors.hex_ff9500_5c3jxm;
                else if (section.key === "ok") accentColour = colors.success || staticColors.hex_34c759_8tm7fd;

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
                          style={{ marginRight: t.spacing.xxs }}
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
                        const name = getEquipmentName(item) || "Unnamed equipment";
                        const category = getEquipmentCategory(item) || "Uncategorised";
                        const status = getEquipmentStatus(item);
                        const lastInspection = getEquipmentLastInspection(item);
                        const serialOrAsset = [item.serialNumber, item.asset].filter(Boolean).join(" · ");
                        const inspectionStatusWithDate = {
                          ...item.inspectionStatus,
                          label:
                            item.inspectionStatus.label +
                            (item.nextInspectionRaw ? ` · ${formatDateShort(item.nextInspectionRaw)}` : ""),
                        };

                        let borderAccent = colors.border || COLORS.border;
                        if (item.worstCode === "overdue") borderAccent = colors.danger || staticColors.hex_ed1c25_4py4qa;
                        else if (item.worstCode === "due-soon") borderAccent = staticColors.hex_ff9500_5c3jxm;
                        else if (item.worstCode === "ok") borderAccent = colors.success || staticColors.hex_34c759_8tm7fd;

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
                                  style={{ marginTop: t.spacing.none }}
                                />
                              </View>
                            </View>

                            <View style={styles.statusRow}>
                              <StatusPill label="Inspection" status={inspectionStatusWithDate} />
                              {!!status && (
                                <View style={styles.neutralPill}>
                                  <Text style={styles.neutralPillText}>{status}</Text>
                                </View>
                              )}
                            </View>

                            <View style={styles.metaRow}>
                              <MetaItem label="Last" value={formatDateShort(lastInspection) || "No date"} colors={colors} />
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

          </>
        </>
      )}
    </PageShell>
  );
}

function StatusPill({ label, status }) {
  const { colors } = useTheme();
  const code = status.code;
  let bg = staticColors.rgba_17yqod0;
  let fg = colors.text || COLORS.textHigh;

  if (code === "overdue") {
    bg = staticColors.rgba_mxg8sy;
    fg = colors.danger || staticColors.hex_ed1c25_4py4qa;
  } else if (code === "due-soon") {
    bg = staticColors.rgba_nffwhq;
    fg = staticColors.hex_ff9500_5c3jxm;
  } else if (code === "ok") {
    bg = staticColors.rgba_dg0wlz;
    fg = colors.success || staticColors.hex_34c759_8tm7fd;
  } else if (code === "unknown") {
    bg = staticColors.rgba_y8isnm;
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
  if (tone === "danger") fg = colors.danger || staticColors.hex_ed1c25_4py4qa;
  else if (tone === "warning") fg = staticColors.hex_ff9500_5c3jxm;
  else if (tone === "success") fg = colors.success || staticColors.hex_34c759_8tm7fd;

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
    marginTop: t.spacing.none,
    marginBottom: t.spacing.none,
  },
  headerContent: {
    paddingTop: t.spacing.xs,
    paddingBottom: t.spacing.xs,
  },
  headerEyebrow: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
  },
  headerTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    lineHeight: t.typography.titleSmall.lineHeight,
    marginTop: t.spacing.none,
  },
  headerSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: t.spacing.xs,
    color: COLORS.textMid,
    fontSize: t.typography.bodySmall.fontSize,
  },
  summaryStrip: {
    flexDirection: "row",
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.xxs,
    paddingBottom: t.spacing.none,
    justifyContent: "space-between",
  },
  summaryPill: {
    flex: 1,
    minHeight: 36,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xxs,
    marginRight: t.spacing.xxs,
  },
  summaryValue: {
    fontSize: t.typography.sectionTitle.fontSize,
    lineHeight: t.typography.sectionTitle.lineHeight,
    fontWeight: "800",
  },
  summaryLabel: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
  },
  controlsContainer: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.xxs,
    paddingBottom: t.spacing.none,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  searchInput: {
    flex: 1,
    fontSize: t.typography.bodySmall.fontSize,
    paddingVertical: t.spacing.none,
    marginRight: t.spacing.xxs,
  },
  filterRow: {
    marginTop: t.spacing.xs,
    paddingBottom: t.spacing.none,
  },
  filterChip: {
    minHeight: 30,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    marginRight: t.spacing.xs,
  },
  filterChipText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  scrollContent: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.none,
    paddingBottom: 104,
  },
  sectionBlock: {
    marginBottom: t.spacing.xs,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: t.spacing.xxs,
    paddingBottom: t.spacing.none,
  },
  sectionTitle: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
  },
  sectionCount: {
    fontSize: t.typography.metadata.fontSize,
  },
  sectionDescription: {
    fontSize: t.typography.caption.fontSize,
    marginBottom: t.spacing.xxs,
  },
  equipmentCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    marginTop: t.spacing.xxs,
    padding: t.spacing.sm,
    borderLeftWidth: 3,
  },
  equipmentHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.xxs,
  },
  equipmentTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
  },
  equipmentMeta: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
  },
  cardHint: {
    fontSize: t.typography.caption.fontSize,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: t.spacing.xxs,
    alignItems: "center",
  },
  statusPill: {
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    marginRight: t.spacing.xs,
    marginBottom: t.spacing.xxs,
  },
  statusPillText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "600",
  },
  neutralPill: {
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    marginRight: t.spacing.xs,
    marginBottom: t.spacing.xxs,
    backgroundColor: staticColors.rgba_y8isnm,
  },
  neutralPillText: {
    color: COLORS.textMid,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: t.spacing.xs,
  },
  metaItem: {
    marginRight: t.spacing.md,
    marginBottom: t.spacing.none,
  },
  metaLabel: {
    fontSize: t.typography.caption.fontSize,
  },
  metaValue: {
    fontSize: t.typography.metadata.fontSize,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing.sm,
    paddingHorizontal: t.spacing.xl,
  },
  emptyTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    textAlign: "center",
  },
});
