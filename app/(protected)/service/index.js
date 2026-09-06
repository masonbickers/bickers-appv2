import { AppText as Text, AppPressable as TouchableOpacity } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
// app/(protected)/service/index.jsx
import { useRouter } from "expo-router";
import { useMemo } from "react";
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

function toDateMaybe(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
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

export default function ServiceOverviewScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const { rows: vehicles, loading } = useServiceCollection("vehicles", {
    label: "vehicles for service overview",
    orderByField: "name",
  });

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

  const summary = useMemo(() => {
    const total = processed.length;
    const overdue = processed.filter(
      (v) =>
        v.motStatus.code === "overdue" || v.serviceStatus.code === "overdue"
    ).length;
    const dueSoon = processed.filter(
      (v) =>
        v.motStatus.code === "due-soon" || v.serviceStatus.code === "due-soon"
    ).length;
    const defects = processed.filter((v) => v.hasDefects).length;

    return { total, overdue, dueSoon, defects };
  }, [processed]);

  const attentionVehicles = useMemo(() => {
    const overdue = processed.filter(
      (v) =>
        v.motStatus.code === "overdue" || v.serviceStatus.code === "overdue"
    );
    const dueSoon = processed.filter(
      (v) =>
        v.motStatus.code === "due-soon" || v.serviceStatus.code === "due-soon"
    );

    return [...overdue, ...dueSoon].slice(0, 5);
  }, [processed]);

  return (
    <PageShell customHeader={<View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <Text
          style={[
            styles.pageTitle,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          Service & Maintenance
        </Text>
        <Text
          style={[
            styles.pageSubtitle,
            { color: colors.textMuted || COLORS.textMid },
          ]}
        >
          Overview of MOT, servicing, defects and workshop activity.
        </Text>
      </View>} customHeaderPlacement="fixed">
      {/* HEADER */}
      

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primaryAction} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading fleet data…
          </Text>
        </View>
      ) : (
        <>
          {/* FLEET SUMMARY CARD */}
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

            <View style={styles.summaryRow}>
              <SummaryItem
                label="Total vehicles"
                value={summary.total}
                color={colors.text || COLORS.textHigh}
                labelColor={colors.textMuted || COLORS.textMid}
              />
              <SummaryItem
                label="Overdue"
                value={summary.overdue}
                color={
                  summary.overdue > 0
                    ? colors.danger || staticColors.hex_ed1c25_4py4qa
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
            </View>

            <View style={[styles.summaryRow, { marginTop: t.spacing.xs }]}>
              <SummaryItem
                label="Due soon (30d)"
                value={summary.dueSoon}
                color={
                  summary.dueSoon > 0
                    ? staticColors.hex_ff9500_5c3jxm
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
              <SummaryItem
                label="With defects"
                value={summary.defects}
                color={
                  summary.defects > 0
                    ? colors.danger || staticColors.hex_ed1c25_4py4qa
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
            </View>
          </View>

          {/* QUICK ACTIONS */}
          <View style={styles.sectionDivider}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Quick Actions
            </Text>
          </View>

          <View style={styles.quickRow}>
            <QuickActionCard
              icon="clipboard"
              title="All MOT & Service"
              subtitle="See full maintenance list"
              onPress={() => router.push("/service/service-list")}
            />
            <QuickActionCard
              icon="alert-triangle"
              title="Defects & Issues"
              subtitle="View reported problems"
              onPress={() => router.push("/service/defects")}
            />
          </View>

          <View style={[styles.quickRow, { marginTop: t.spacing.xs }]}>
            <QuickActionCard
              icon="tool"
              title="Book Workshop"
              subtitle="Off-road, repairs, tyres, etc."
              onPress={() => router.push("/service/book-work")}
            />
          </View>

          {/* ATTENTION NEEDED */}
          <View style={styles.sectionDivider}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Attention Needed
            </Text>
          </View>

          {attentionVehicles.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                name="check-circle"
                size={30}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Nothing urgent
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                No MOT or service items are overdue or due soon.
              </Text>
            </View>
          ) : (
            attentionVehicles.map((v) => {
              const name = getVehicleName(v) || "Unnamed vehicle";
              const reg = getVehicleRegistration(v);
              const worstCode = v.worstCode;

              let borderAccent = COLORS.border;
              if (worstCode === "overdue") borderAccent = staticColors.hex_ed1c25_4py4qa;
              else if (worstCode === "due-soon") borderAccent = staticColors.hex_ff9500_5c3jxm;

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

                  <View style={styles.statusRow}>
                    <StatusPill label="MOT" status={v.motStatus} />
                    <StatusPill label="Service" status={v.serviceStatus} />
                    {v.hasDefects && (
                      <View style={styles.defectPill}>
                        <Icon
                          name="alert-triangle"
                          size={14}
                          color={COLORS.textHigh}
                          style={{ marginRight: t.spacing.xxs }}
                        />
                        <Text style={styles.defectText}>
                          {v.defects.length} defect
                          {v.defects.length > 1 ? "s" : ""}
                        </Text>
                      </View>
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

/* Small components */

function SummaryItem({ label, value, color, labelColor }) {
  return (
    <View style={summaryStyles.item}>
      <Text style={[summaryStyles.value, { color }]}>{value}</Text>
      <Text style={[summaryStyles.label, { color: labelColor || COLORS.textMid }]}>
        {label}
      </Text>
    </View>
  );
}

function QuickActionCard({ icon, title, subtitle, onPress }) {
  return (
    <TouchableOpacity style={quickStyles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={quickStyles.iconWrap}>
        <Icon name={icon} size={18} color={COLORS.textHigh} />
      </View>
      <Text style={quickStyles.title}>{title}</Text>
      <Text style={quickStyles.subtitle}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

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

/* Styles */

const summaryStyles = StyleSheet.create({
  item: {
    flex: 1,
    minWidth: 0,
    paddingRight: t.spacing.sm,
  },
  value: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  label: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
});

const quickStyles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_262626_70t9oi,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: t.spacing.xs,
  },
  title: {
    color: COLORS.textHigh,
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    marginBottom: t.spacing.none,
    flexShrink: 1,
  },
  subtitle: {
    color: COLORS.textLow,
    fontSize: t.typography.metadata.fontSize,
    flexShrink: 1,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pageTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  pageSubtitle: {
    marginTop: t.spacing.xxs,
    color: COLORS.textMid,
    fontSize: t.typography.bodySmall.fontSize,
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
    marginBottom: t.spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
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
  quickRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: t.spacing.xs,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing.xxs,
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
    marginBottom: t.spacing.xxs,
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
});
