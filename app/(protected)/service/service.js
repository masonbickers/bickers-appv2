import { AppText as Text, AppPressable as TouchableOpacity } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
// app/protected/service.jsx

import { useRouter } from "expo-router";
import { useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import {
  getVehicleName,
  getVehicleNextMot,
  getVehicleNextService,
  getVehicleRegistration,
  isVehicleMotApplicable,
  isVehicleServiceApplicable,
} from "../../../lib/fleetSchema";
import { useServiceCollection } from "../../../hooks/useServiceData";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";

/* ---------- CONSTANTS & HELPERS ---------- */

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

  const { rows: vehicles, loading } = useServiceCollection("vehicles", {
    label: "vehicles",
    orderByField: "name",
  });
  const [filter, setFilter] = useState("all");

  const processed = useMemo(() => {
    return vehicles.map((v) => {
      const motStatus = isVehicleMotApplicable(v)
        ? classifyStatus(getVehicleNextMot(v))
        : { label: "N/A", code: "not-applicable" };
      const serviceStatus = isVehicleServiceApplicable(v)
        ? classifyStatus(getVehicleNextService(v))
        : { label: "N/A", code: "not-applicable" };
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
    <PageShell header={{
      variant: "compact",
      title: "Service & MOT",
      onBack: router.back,
    }}>
      {/* HEADER */}
      

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
        <>
          {/* SUMMARY CARD */}
          <View
            style={[
              styles.infoCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
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
                      ? colors.danger || staticColors.hex_ed1c25_4py4qa
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
                      ? staticColors.hex_ff9500_5c3jxm
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
                      ? colors.danger || staticColors.hex_ed1c25_4py4qa
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
              const name = getVehicleName(v) || "Unnamed vehicle";
              const reg = getVehicleRegistration(v);
              const { motStatus, serviceStatus, hasDefects, defects, worstCode } =
                v;

              const borderAccent =
                worstCode === "overdue"
                  ? staticColors.hex_ed1c25_4py4qa
                  : worstCode === "due-soon"
                  ? staticColors.hex_ff9500_5c3jxm
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
                  onPress={() => router.push(`/service/vehicles/${v.id}`)}
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
                          style={{ marginRight: t.spacing.xxs }}
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
        </>
      )}
    </PageShell>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function StatusPill({ label, status }) {
  const code = status.code;
  let bg = staticColors.rgba_17yqod0;
  let fg = COLORS.textHigh;

  if (code === "overdue") {
    bg = staticColors.rgba_mxg8sy;
    fg = staticColors.hex_ed1c25_4py4qa;
  } else if (code === "due-soon") {
    bg = staticColors.rgba_nffwhq;
    fg = staticColors.hex_ff9500_5c3jxm;
  } else if (code === "ok") {
    bg = staticColors.rgba_dg0wlz;
    fg = staticColors.hex_34c759_8tm7fd;
  } else if (code === "unknown") {
    bg = staticColors.rgba_y8isnm;
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
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  pageTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: t.spacing.xs,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: t.spacing.xs,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryAction,
  },
  infoTextTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "700",
    marginBottom: t.spacing.xxs,
  },
  infoTextDetail: {
    color: COLORS.textMid,
    fontSize: t.typography.body.fontSize,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: t.spacing.xs,
  },
  filterChip: {
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    marginRight: t.spacing.xs,
    marginBottom: t.spacing.xs,
    backgroundColor: COLORS.card,
  },
  filterText: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.xs,
  },
  sectionTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    paddingRight: t.spacing.xs,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing.sm,
    paddingHorizontal: t.spacing.xl,
  },
  emptyTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.body.fontSize,
    textAlign: "center",
  },
  vehicleCard: {
    backgroundColor: COLORS.card,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.border,
  },
  vehicleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.xs,
  },
  vehicleTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
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
  defectPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    backgroundColor: COLORS.recceAction,
    marginBottom: t.spacing.xxs,
  },
  defectText: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: t.spacing.xxs,
  },
  metaText: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
    marginRight: t.spacing.sm,
    marginTop: t.spacing.none,
  },
});
