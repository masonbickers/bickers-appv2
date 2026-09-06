import { AppText as Text, AppPressable as TouchableOpacity } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
// app/(protected)/service-history.jsx
import { useRouter } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import {
  getVehicleLastMot,
  getVehicleLastService,
  getVehicleManufacturer,
  getVehicleName,
  getVehicleNextMot,
  getVehicleNextService,
  getVehicleRegistration,
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

function formatDateShort(value) {
  const d = toDateMaybe(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function wasRecently(dateValue, daysWindow = 60) {
  const d = toDateMaybe(dateValue);
  if (!d) return false;
  const today = new Date();
  const diffMs = today.getTime() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= daysWindow;
}

export default function ServiceHistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const { rows: vehicles, loading } = useServiceCollection("vehicles", {
    label: "vehicles for service history",
    orderByField: "name",
  });

  const processed = useMemo(() => {
    return vehicles
      .map((v) => {
        const lastMOT = getVehicleLastMot(v);
        const nextMOT = getVehicleNextMot(v);
        const lastService = getVehicleLastService(v);
        const nextService = getVehicleNextService(v);

        const recentMOT = wasRecently(lastMOT, 365); // within last year
        const recentService = wasRecently(lastService, 365);
        const latestCompletedDate =
          [lastService, lastMOT]
            .map((value) => toDateMaybe(value))
            .filter(Boolean)
            .sort((a, b) => b.getTime() - a.getTime())[0] || null;

        return {
          ...v,
          lastMOT,
          nextMOT,
          lastService,
          nextService,
          recentMOT,
          recentService,
          latestCompletedDate,
        };
      })
      .sort((a, b) => {
        const aTime = a.latestCompletedDate?.getTime() || 0;
        const bTime = b.latestCompletedDate?.getTime() || 0;
        if (aTime !== bTime) return bTime - aTime;

        const aName = a.name || a.vehicleName || "";
        const bName = b.name || b.vehicleName || "";
        return aName.localeCompare(bName);
      });
  }, [vehicles]);

  const summary = useMemo(() => {
    const total = processed.length;
    const withMOTHistory = processed.filter((v) => v.lastMOT).length;
    const withServiceHistory = processed.filter((v) => v.lastService).length;
    const recentMOTs = processed.filter((v) => v.recentMOT).length;
    const recentServices = processed.filter((v) => v.recentService).length;
    return {
      total,
      withMOTHistory,
      withServiceHistory,
      recentMOTs,
      recentServices,
    };
  }, [processed]);

  const handleOpenVehicleHistory = (vehicle) => {
    const name = getVehicleName(vehicle) || "";
    const reg = getVehicleRegistration(vehicle) || "";

    router.push({
      pathname: "/service/service-history/[vehicleId]",
      params: {
        vehicleId: vehicle.id,
        name,
        registration: reg,
      },
    });
  };

  return (
    <PageShell header={{
      variant: "compact",
      title: "Service History",
      subtitle: "Last MOT and service dates for each vehicle in the fleet.",
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
            Loading service history…
          </Text>
        </View>
      ) : (
        <>
          {/* SUMMARY CARD */}
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Text
              style={[
                styles.summaryTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Fleet Summary
            </Text>
            <View style={styles.summaryRow}>
              <SummaryItem label="Vehicles" value={summary.total} />
              <SummaryItem
                label="With MOT history"
                value={summary.withMOTHistory}
              />
            </View>
            <View style={styles.summaryRow}>
              <SummaryItem
                label="With service history"
                value={summary.withServiceHistory}
              />
              <SummaryItem
                label="MOT in last 12m"
                value={summary.recentMOTs}
              />
            </View>
            <View style={styles.summaryRow}>
              <SummaryItem
                label="Service in last 12m"
                value={summary.recentServices}
              />
            </View>
          </View>

          {/* VEHICLE CARDS */}
          {processed.length === 0 ? (
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
                No vehicles found
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Add vehicles in the main system to see service history here.
              </Text>
            </View>
          ) : (
            processed.map((v) => {
              const name = getVehicleName(v) || "Unnamed vehicle";
              const reg = getVehicleRegistration(v);
              const manufacturer = getVehicleManufacturer(v);
              const model = v.model || "";

              const lastMOTText = formatDateShort(v.lastMOT);
              const nextMOTText = formatDateShort(v.nextMOT);
              const lastServiceText = formatDateShort(v.lastService);
              const nextServiceText = formatDateShort(v.nextService);

              const hasHistory = v.lastMOT || v.lastService;
              const borderAccent = hasHistory
                ? colors.accent || COLORS.primaryAction
                : colors.border || COLORS.border;

              return (
                <View
                  key={v.id}
                  style={[
                    styles.vehicleCard,
                    {
                      borderLeftColor: borderAccent,
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderColor: colors.border || COLORS.border,
                    },
                  ]}
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
                      {(manufacturer || model) && (
                        <Text
                          style={[
                            styles.vehicleSub,
                            { color: colors.textMuted || COLORS.textLow },
                          ]}
                        >
                          {manufacturer}
                          {manufacturer && model ? " · " : ""}
                          {model}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.historyBlock}>
                    <Text
                      style={[
                        styles.blockTitle,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      MOT
                    </Text>
                    <HistoryRow label="Last MOT" value={lastMOTText} />
                    <HistoryRow label="Next MOT" value={nextMOTText} />
                  </View>

                  <View style={styles.historyBlock}>
                    <Text
                      style={[
                        styles.blockTitle,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      Service
                    </Text>
                    <HistoryRow
                      label="Last service"
                      value={lastServiceText}
                    />
                    <HistoryRow
                      label="Next service"
                      value={nextServiceText}
                    />
                  </View>

                  {typeof v.mileage === "number" && (
                    <View style={styles.historyBlock}>
                      <Text
                        style={[
                          styles.blockTitle,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                      >
                        Odometer
                      </Text>
                      <HistoryRow
                        label="Current"
                        value={`${v.mileage.toLocaleString("en-GB")} mi`}
                      />
                    </View>
                  )}

                  {v.notes ? (
                    <View style={styles.notesBlock}>
                      <Text
                        style={[
                          styles.notesLabel,
                          { color: colors.textMuted || COLORS.textLow },
                        ]}
                      >
                        Notes
                      </Text>
                      <Text
                        style={[
                          styles.notesText,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                      >
                        {v.notes}
                      </Text>
                    </View>
                  ) : null}

                  {/* View full history button */}
                  <TouchableOpacity
                    style={[
                      styles.viewHistoryButton,
                      {
                        backgroundColor: colors.surface || staticColors.hex_1f2933_8in7ju,
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => handleOpenVehicleHistory(v)}
                  >
                    <Text
                      style={[
                        styles.viewHistoryText,
                        { color: colors.text || COLORS.textHigh },
                      ]}
                    >
                      View full history
                    </Text>
                    <Icon
                      name="chevron-right"
                      size={14}
                      color={colors.text || COLORS.textHigh}
                    />
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </>
      )}
    </PageShell>
  );
}

function SummaryItem({ label, value }) {
  const { colors } = useTheme();
  return (
    <View style={summaryStyles.item}>
      <Text
        style={[
          summaryStyles.value,
          { color: colors.text || COLORS.textHigh },
        ]}
      >
        {value}
      </Text>
      <Text
        style={[
          summaryStyles.label,
          { color: colors.textMuted || COLORS.textMid },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function HistoryRow({ label, value }) {
  const { colors } = useTheme();
  return (
    <View style={styles.historyRow}>
      <Text
        style={[
          styles.historyLabel,
          { color: colors.textMuted || COLORS.textLow },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.historyValue,
          { color: colors.text || COLORS.textHigh },
        ]}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

/* ---------- STYLES ---------- */

const summaryStyles = StyleSheet.create({
  item: {
    flex: 1,
    minWidth: 0,
    marginBottom: t.spacing.xxs,
  },
  value: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  label: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
    flexShrink: 1,
  },
});

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
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  pageSubtitle: {
    marginTop: t.spacing.none,
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
  },
  scrollContent: {
    padding: t.spacing.md,
  },
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: t.spacing.xs,
  },
  summaryRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
    marginTop: t.spacing.none,
  },
  vehicleCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
  },
  vehicleHeaderRow: {
    flexDirection: "row",
    marginBottom: t.spacing.xxs,
  },
  vehicleTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
  vehicleSub: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
    marginTop: t.spacing.none,
  },
  historyBlock: {
    marginTop: t.spacing.xs,
  },
  blockTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
    color: COLORS.textMid,
    marginBottom: t.spacing.xxs,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: t.spacing.none,
  },
  historyLabel: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
  },
  historyValue: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textHigh,
  },
  notesBlock: {
    marginTop: t.spacing.xs,
  },
  notesLabel: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
    marginBottom: t.spacing.none,
  },
  notesText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing["2xl"],
    paddingHorizontal: t.spacing.xl,
  },
  emptyTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  emptySubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    textAlign: "center",
    color: COLORS.textMid,
  },
  viewHistoryButton: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_1f2933_8in7ju,
  },
  viewHistoryText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textHigh,
    fontWeight: "600",
    marginRight: t.spacing.xxs,
  },
});
