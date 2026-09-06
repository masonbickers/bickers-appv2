import { AppText as Text, AppPressable as TouchableOpacity, FormField } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
// app/(protected)/service-list.jsx
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
  getVehicleOperationalStatus,
  getVehicleManufacturer,
  getVehicleName,
  getVehicleNextMot,
  getVehicleNextService,
  getVehicleRegistration,
  isVehicleActiveForMaintenance,
  isVehicleMotApplicable,
  isVehicleServiceApplicable,
} from "../../../lib/fleetSchema";
import { useServiceCollection } from "../../../hooks/useServiceData";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";

/* ---------- CONSTANTS & HELPERS ---------- */

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
  { key: "inactive", label: "Inactive" },
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
  {
    key: "inactive",
    title: "Inactive vehicles",
    description: "Hidden from MOT and service attention until marked active again.",
  },
];

/* ---------- MAIN SCREEN ---------- */

export default function ServiceListScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const { rows: vehicles, loading } = useServiceCollection("vehicles", {
    label: "vehicles for service list",
    orderByField: "name",
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedStatus, setExpandedStatus] = useState({
    overdue: true,
    "due-soon": true,
    ok: true,
    unknown: true,
    inactive: true,
  });


  const processed = useMemo(() => {
    return vehicles.map((v) => {
      const activeForMaintenance = isVehicleActiveForMaintenance(v);
      const motDateRaw = getVehicleNextMot(v);
      const serviceDateRaw = getVehicleNextService(v);

      const motStatus = activeForMaintenance && isVehicleMotApplicable(v)
        ? classifyStatus(motDateRaw)
        : { label: "Inactive", code: "inactive" };
      const serviceStatus = activeForMaintenance && isVehicleServiceApplicable(v)
        ? classifyStatus(serviceDateRaw)
        : { label: "Inactive", code: "inactive" };
      const worstCode = activeForMaintenance
        ? pickWorstStatusCode(motStatus.code, serviceStatus.code)
        : "inactive";

      return {
        ...v,
        activeForMaintenance,
        motStatus,
        serviceStatus,
        motDateRaw,
        serviceDateRaw,
        worstCode,
      };
    });
  }, [vehicles]);

  const summaryCounts = useMemo(() => {
    const counts = {
      overdue: 0,
      "due-soon": 0,
      ok: 0,
      unknown: 0,
      inactive: 0,
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
        const name = String(getVehicleName(v)).toLowerCase();
        const reg = String(getVehicleRegistration(v)).toLowerCase();
        const manufacturer = String(getVehicleManufacturer(v)).toLowerCase();
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
      inactive: [],
    };

    filtered.forEach((v) => {
      const key = acc[v.worstCode] ? v.worstCode : "unknown";
      acc[key].push(v);
    });

    // Sort each list by vehicle name for consistency
    Object.keys(acc).forEach((key) => {
      acc[key].sort((a, b) =>
        String(getVehicleName(a)).localeCompare(String(getVehicleName(b)), "en", {
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
    byStatus.unknown.length ||
    byStatus.inactive.length;

  return (
    <PageShell
      header={{
        variant: "compact",
        eyebrow: "Workshop",
        title: "MOT & Service",
        subtitle: "Prioritise overdue vehicles, review details and book work.",
      }}
    >
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
        <>
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
            <SummaryPill
              label="Inactive"
              value={summaryCounts.inactive}
              tone="muted"
            />
          </View>

          {/* SEARCH + FILTERS */}
          <View style={styles.controlsContainer}>
            <FormField
              label="Search vehicles"
              placeholder="Search by name, reg, manufacturer, model…"
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

          {/* LIST SECTIONS */}
          <>
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
                if (section.key === "overdue") accentColour = colors.danger || staticColors.hex_ed1c25_4py4qa;
                else if (section.key === "due-soon") accentColour = staticColors.hex_ff9500_5c3jxm;
                else if (section.key === "ok") accentColour = colors.success || staticColors.hex_34c759_8tm7fd;
                else if (section.key === "inactive") accentColour = colors.textMuted || COLORS.textLow;

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
                          style={{ marginRight: t.spacing.xxs }}
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
                        const name = getVehicleName(v) || "Unnamed vehicle";
                        const reg = getVehicleRegistration(v);
                        const manufacturer = getVehicleManufacturer(v);
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
                          borderAccent = colors.danger || staticColors.hex_ed1c25_4py4qa;
                        else if (v.worstCode === "due-soon")
                          borderAccent = staticColors.hex_ff9500_5c3jxm;
                        else if (v.worstCode === "ok")
                          borderAccent = colors.success || staticColors.hex_34c759_8tm7fd;
                        else if (v.worstCode === "inactive")
                          borderAccent = colors.textMuted || COLORS.textLow;

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
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.vehicleTitle,
                                  { color: colors.text || COLORS.textHigh },
                                ]}
                              >
                                {name}
                              </Text>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.vehicleIdentity,
                                  { color: colors.textMuted || COLORS.textMid },
                                ]}
                              >
                                {[
                                  reg,
                                  [manufacturer, model].filter(Boolean).join(" · "),
                                ].filter(Boolean).join(" · ")}
                              </Text>
                            </View>

                            <View style={styles.statusRow}>
                              {v.worstCode === "inactive" ? (
                                <StatusPill
                                  label="Status"
                                  status={{
                                    code: "inactive",
                                    label: getVehicleOperationalStatus(v) || "Inactive",
                                  }}
                                />
                              ) : (
                                <>
                                  <StatusPill label="MOT" status={motStatusWithDate} />
                                  <StatusPill
                                    label="Service"
                                    status={serviceStatusWithDate}
                                  />
                                </>
                              )}
                            </View>

                            <Text
                              numberOfLines={1}
                              style={[styles.metaSummary, { color: colors.textMuted || COLORS.textMid }]}
                            >
                              {[
                                `Tax: ${taxStatus}`,
                                `Insurance: ${insuranceStatus}`,
                                typeof v.mileage === "number"
                                  ? `${v.mileage.toLocaleString("en-GB")} mi`
                                  : null,
                              ].filter(Boolean).join(" · ")}
                            </Text>
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

/* ---------- SMALL COMPONENTS ---------- */

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
  } else if (code === "inactive") {
    bg = staticColors.rgba_z8bc9h;
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

  if (tone === "danger") {
    fg = colors.danger || staticColors.hex_ed1c25_4py4qa;
  } else if (tone === "warning") {
    fg = staticColors.hex_ff9500_5c3jxm;
  } else if (tone === "success") {
    fg = colors.success || staticColors.hex_34c759_8tm7fd;
  }

  return (
    <View style={styles.summaryPill}>
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
  headerCard: {
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.none,
    marginBottom: t.spacing.none,
  },
  header: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: t.controls.iconButtonSm,
    height: t.controls.iconButtonSm,
    borderRadius: t.controls.iconButtonSm / 2,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
  },
  pageTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
  },
  pageSubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
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

  /* SUMMARY STRIP */
  summaryStrip: {
    flexDirection: "row",
    gap: t.spacing.xxs,
    justifyContent: "space-between",
  },
  summaryPill: {
    flex: 1,
    minHeight: 36,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xxs,
  },
  summaryValue: {
    fontSize: t.typography.sectionTitle.fontSize,
    lineHeight: t.typography.sectionTitle.lineHeight,
    fontWeight: "800",
  },
  summaryLabel: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    color: COLORS.textMid,
  },

  controlsContainer: {
    gap: t.spacing.xs,
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
    paddingBottom: 140,
  },

  /* STATUS SECTIONS */
  sectionBlock: {
    gap: t.spacing.xxs,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: t.spacing.xxs,
    paddingBottom: t.spacing.none,
  },
  sectionTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
  },
  sectionCount: {
    fontSize: t.typography.metadata.fontSize,
  },
  sectionDescription: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textMid,
  },

  vehicleCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.xs,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  vehicleHeaderRow: {
    marginBottom: t.spacing.xxs,
  },
  vehicleTitle: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
  },
  vehicleIdentity: {
    marginTop: t.spacing.none,
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textMid,
  },
  cardHint: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
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
  metaSummary: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textMid,
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
