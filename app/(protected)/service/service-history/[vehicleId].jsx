import { AppText as Text, AppPressable as TouchableOpacity } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
// app/(protected)/service/service-history/[vehicleId].jsx
import { useLocalSearchParams,
  useRouter } from "expo-router";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import {
  getVehicleLastService,
  getVehicleMileage,
  getVehicleNextService,
} from "../../../../lib/fleetSchema";
import { useServiceCollectionReader } from "../../../../hooks/useServiceData";
import { useTheme } from "../../../../providers/ThemeProvider";
import { staticColors } from "../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../lib/design/tokens";
import PageShell from "../../../../components/layout/PageShell";

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

function getServiceDateValue(item) {
  return (
    item?.completedDate ||
    item?.date ||
    item?.recordedAt ||
    item?.serviceDateOnly ||
    item?.serviceDate ||
    item?.completedAt ||
    item?.createdAt ||
    null
  );
}

function buildMetaLine(parts) {
  return parts.filter(Boolean).join(" · ");
}

export default function ServiceHistoryListScreen() {
  const { vehicleId, name, registration } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const readServiceCollection = useServiceCollectionReader();

  const [loading, setLoading] = useState(true);
  const [vehicle, setVehicle] = useState(null);
  const [serviceForms, setServiceForms] = useState([]);

  useEffect(() => {
    if (!vehicleId) return;

    const load = async () => {
      setLoading(true);
      try {
        const [vehicles, serviceRecords] = await Promise.all([
          readServiceCollection("vehicles", { orderByField: "name" }),
          readServiceCollection("serviceRecords"),
        ]);
        setVehicle(
          vehicles.find((item) => String(item.id) === String(vehicleId)) || null
        );
        const forms = serviceRecords.filter(
          (record) => String(record.vehicleId || "") === String(vehicleId)
        );
        setServiceForms(forms);
      } catch (err) {
        console.error("Failed to load vehicle/service history:", err);
        setVehicle((prev) => prev ?? null);
        setServiceForms([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [readServiceCollection, vehicleId]);

  const fromForms = useMemo(() => {
    if (!serviceForms || serviceForms.length === 0) return [];

    return serviceForms
      .map((f) => {
        const date = getServiceDateValue(f);
        const odo = f.odometer ?? f.mileage ?? null;
        const summary =
          f.workSummary || f.extraNotes || f.summary || f.notes || "";
        const type = f.serviceType || f.type || "Service";

        return {
          id: f.id,
          date,
          odometer: odo,
          summary,
          type,
        };
      })
      .sort((a, b) => {
        const da = toDateMaybe(a.date)?.getTime() || 0;
        const db = toDateMaybe(b.date)?.getTime() || 0;
        return db - da; // newest first
      });
  }, [serviceForms]);

  const fromEmbedded = useMemo(() => {
    if (!vehicle || !Array.isArray(vehicle.serviceHistory)) return [];
    return [...vehicle.serviceHistory]
      .map((item, idx) => {
        if (typeof item === "string") {
          return {
            id: `embedded-${idx}`,
            date: null,
            odometer: null,
            summary: item,
            type: "Service",
          };
        }
        return {
          id: item.id || item.serviceRecordId || `embedded-${idx}`,
          date: getServiceDateValue(item),
          odometer: item.odometer ?? null,
          summary: item.notes || item.summary || "",
          type: item.type || "Service",
        };
      })
      .sort((a, b) => {
        const da = toDateMaybe(a.date)?.getTime() || 0;
        const db = toDateMaybe(b.date)?.getTime() || 0;
        return db - da;
      });
  }, [vehicle]);

  // Prefer standalone service records; fallback to embedded array
  const serviceHistory = fromForms.length > 0 ? fromForms : fromEmbedded;

  const headerName =
    vehicle?.name || vehicle?.vehicleName || name || "Vehicle";
  const headerReg = vehicle?.registration || vehicle?.reg || registration || "";

  const latestRecord = serviceHistory[0] || null;
  const totalServices = serviceHistory.length;
  const lastServiceDate = latestRecord?.date
    ? formatDateShort(latestRecord.date)
    : null;
  const lastServiceOdo =
    typeof latestRecord?.odometer === "number"
      ? `${latestRecord.odometer.toLocaleString("en-GB")} mi`
      : latestRecord?.odometer || null;
  const mileageValue = getVehicleMileage(vehicle);
  const vehicleLastService = getVehicleLastService(vehicle);
  const vehicleNextService = getVehicleNextService(vehicle);

  const handleOpenRecord = (id) => {
    router.push(`/service/service-record/${id}`);
  };

  return (
    <PageShell header={{
      variant: "compact",
      title: "Service history",
      subtitle: [headerReg, headerName].filter(Boolean).join(" · "),
      onBack: router.back,
    }}>
      {/* HEADER */}
      

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.textMuted || COLORS.textMid} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading services…
          </Text>
        </View>
      ) : !vehicle ? (
        <View style={styles.loadingContainer}>
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Vehicle not found.
          </Text>
        </View>
      ) : (
        <>
          {/* VEHICLE SUMMARY CARD */}
          <View
            style={[
              styles.vehicleCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View style={styles.vehicleRowTop}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.vehicleNameText,
                    { color: colors.text || COLORS.textHigh },
                  ]}
                  numberOfLines={1}
                >
                  {headerName}
                </Text>
                {!!headerReg && (
                  <Text
                    style={[
                      styles.vehicleRegText,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {headerReg}
                  </Text>
                )}
              </View>
              {typeof mileageValue === "number" && (
                <View style={styles.mileageChip}>
                  <Icon
                    name="activity"
                    size={12}
                    color={COLORS.textMid}
                    style={{ marginRight: t.spacing.xxs }}
                  />
                  <Text style={styles.mileageChipText}>
                    {mileageValue.toLocaleString("en-GB")} mi
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.vehicleMetaRow}>
              <View style={styles.metaItem}>
                <Text style={[styles.metaLabel, { color: colors.textMuted || COLORS.textLow }]}>
                  Last service
                </Text>
                <Text style={[styles.metaValue, { color: colors.text || COLORS.textHigh }]}>
                  {vehicleLastService
                    ? formatDateShort(vehicleLastService)
                    : lastServiceDate || "—"}
                </Text>
              </View>
              <View
                style={[
                  styles.metaDivider,
                  { backgroundColor: colors.border || COLORS.border },
                ]}
              />
              <View style={styles.metaItem}>
                <Text style={[styles.metaLabel, { color: colors.textMuted || COLORS.textLow }]}>
                  Next service
                </Text>
                <Text style={[styles.metaValue, { color: colors.text || COLORS.textHigh }]}>
                  {vehicleNextService
                    ? formatDateShort(vehicleNextService)
                    : "—"}
                </Text>
              </View>
            </View>
          </View>

          {/* STATS STRIP */}
          <View
            style={[
              styles.statsStrip,
              {
                backgroundColor: colors.surfaceAlt || staticColors.hex_111111_a7aqp2,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View style={styles.statsItem}>
              <Text style={[styles.statsLabel, { color: colors.textMuted || COLORS.textLow }]}>
                Total services
              </Text>
              <Text style={[styles.statsValue, { color: colors.text || COLORS.textHigh }]}>
                {totalServices || 0}
              </Text>
            </View>
            <View style={styles.statsItem}>
              <Text style={[styles.statsLabel, { color: colors.textMuted || COLORS.textLow }]}>
                Last date
              </Text>
              <Text style={[styles.statsValue, { color: colors.text || COLORS.textHigh }]}>
                {lastServiceDate || "—"}
              </Text>
            </View>
            <View style={styles.statsItem}>
              <Text style={[styles.statsLabel, { color: colors.textMuted || COLORS.textLow }]}>
                Last mileage
              </Text>
              <Text style={[styles.statsValue, { color: colors.text || COLORS.textHigh }]}>
                {lastServiceOdo || "—"}
              </Text>
            </View>
          </View>

          {/* HISTORY LIST */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            {serviceHistory.length === 0 ? (
              <Text style={styles.emptyText}>
                No service entries recorded for this vehicle yet.
              </Text>
            ) : (
              serviceHistory.map((item, index) => {
                const dateLabel = item.date ? formatDateShort(item.date) : "";
                const odoLabel =
                  typeof item.odometer === "number"
                    ? `${item.odometer.toLocaleString("en-GB")} mi`
                    : item.odometer || null;
                const metaLine = buildMetaLine([dateLabel, odoLabel]);

                const isMostRecent = index === 0;

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.row}
                    activeOpacity={0.85}
                    onPress={() => handleOpenRecord(item.id)}
                  >
                    <View style={styles.rowHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.rowTitleRow}>
                          <View style={styles.typePill}>
                            <Icon
                              name="tool"
                              size={12}
                              color={COLORS.textHigh}
                              style={{ marginRight: t.spacing.xxs }}
                            />
                            <Text style={styles.typePillText}>
                              {item.type || "Service"}
                            </Text>
                          </View>
                          {isMostRecent && (
                            <View style={styles.recentPill}>
                              <Text style={styles.recentPillText}>
                                Most recent
                              </Text>
                            </View>
                          )}
                        </View>

                        {!!metaLine && (
                          <Text
                            style={[
                              styles.rowMeta,
                              { color: colors.textMuted || COLORS.textLow },
                            ]}
                          >
                            {metaLine}
                          </Text>
                        )}
                      </View>
                      <Icon
                        name="chevron-right"
                        size={18}
                        color={colors.textMuted || COLORS.textLow}
                      />
                    </View>

                    {!!item.summary && (
                      <Text
                        style={[
                          styles.rowSummary,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                        numberOfLines={2}
                      >
                        {item.summary}
                      </Text>
                    )}

                    <Text
                      style={[
                        styles.tapHint,
                        { color: colors.textMuted || COLORS.textLow },
                      ]}
                    >
                      Tap to view full checklist
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          <View style={{ height: 24 }} />
        </>
      )}
    </PageShell>
  );
}

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
    width: 32,
    height: 32,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
  },
  title: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: t.typography.metadata.fontSize,
    marginTop: t.spacing.none,
    color: COLORS.textMid,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.body.fontSize,
    color: COLORS.textMid,
  },
  content: {
    padding: t.spacing.md,
  },

  /* Vehicle summary */
  vehicleCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: t.spacing.xs,
  },
  vehicleRowTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.xs,
  },
  vehicleNameText: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleRegText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
  mileageChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.chipBg,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
  },
  mileageChipText: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textMid,
    fontWeight: "600",
  },
  vehicleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: t.spacing.xxs,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
  },
  metaValue: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
  metaDivider: {
    width: 1,
    height: 26,
    backgroundColor: COLORS.border,
    marginHorizontal: t.spacing.xs,
    opacity: 0.8,
  },

  /* Stats strip */
  statsStrip: {
    flexDirection: "row",
    backgroundColor: staticColors.hex_111111_a7aqp2,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    marginBottom: t.spacing.sm,
  },
  statsItem: {
    flex: 1,
    paddingHorizontal: t.spacing.xxs,
  },
  statsLabel: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
  },
  statsValue: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textHigh,
    fontWeight: "600",
    marginTop: t.spacing.none,
  },

  /* History list */
  card: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  row: {
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: staticColors.rgba_5ns94m,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.none,
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.xxs,
  },
  typePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.chipBg,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
  },
  typePillText: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  recentPill: {
    marginLeft: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.accentSoft,
  },
  recentPillText: {
    fontSize: t.typography.micro.fontSize,
    color: COLORS.accent,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  rowMeta: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
  },
  rowSummary: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.xxs,
  },
  tapHint: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
    marginTop: t.spacing.xxs,
  },
});
