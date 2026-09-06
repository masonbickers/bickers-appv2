import { AppText as Text, AppPressable as TouchableOpacity, FormField } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
import { useRouter } from "expo-router";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { useServiceCollection } from "../../../hooks/useServiceData";
import { getVehicleDisplayLabel } from "../../../lib/fleetSchema";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";

const ACTIVITY_ICON_COLORS = {
  services: staticColors.hex_2563eb_6ywilf,
  repairs: staticColors.hex_d97706_6cn8pp,
  defects: COLORS.primaryAction,
  inspections: staticColors.hex_64748b_4jwrvh,
  mot: staticColors.hex_2563eb_6ywilf,
  prep: staticColors.hex_64748b_4jwrvh,
};

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

function formatDate(value) {
  const d = toDateMaybe(value);
  if (!d) return "No date";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getActivityDate(item) {
  return (
    item?.completedAt ||
    item?.updatedAt ||
    item?.createdAt ||
    item?.inspectionDateISO ||
    item?.serviceDateOnly ||
    item?.serviceDate ||
    item?.completedDate ||
    item?.precheckDateOnly ||
    item?.precheckDateTime ||
    item?.prepDate ||
    item?.date ||
    null
  );
}

function getVehicleText(item, vehicles) {
  return getVehicleDisplayLabel(item, vehicles);
}

function getEquipmentText(item) {
  return [
    item?.equipmentName || item?.name,
    item?.serialNumber || item?.equipmentId,
    item?.asset,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildResolvedDefectRouteId(source, docId, itemIndex = "") {
  return encodeURIComponent([source, docId, itemIndex].join("|"));
}

function getActivityIconColor(typeKey) {
  return ACTIVITY_ICON_COLORS[typeKey] || COLORS.primaryAction;
}

function buildActivityItems({
  serviceRecords,
  defectReports,
  vehicles,
  vehiclePrepRecords,
  motPreChecks,
  equipmentInspections,
}) {
  const services = serviceRecords.map((record) => {
    const serviceType = record.serviceType || record.type || "Service";
    const key = normaliseKey(serviceType);
    const isRepair = record.recordType === "repair" || key.includes("repair");
    const isInterim = key.includes("interim") || key.includes("minor");

    return {
      id: `service-${record.id}`,
      icon: isRepair ? "tool" : isInterim ? "settings" : "clipboard",
      typeKey: isRepair ? "repairs" : "services",
      title: serviceType,
      subtitle: record.workSummary || record.repairSummary || record.extraNotes || "Service record completed",
      vehicle: getVehicleText(record, vehicles),
      technician: record.signedBy || record.completedBy || "",
      date: getActivityDate(record),
      route: record.id ? `/service/service-record/${record.id}` : null,
    };
  });

  const defects = defectReports.map((report) => ({
    id: `defect-${report.id}`,
    icon: report.status === "resolved" ? "check-circle" : "alert-triangle",
    typeKey: "defects",
    title: report.status === "resolved" ? "Defect resolved" : "Defect reported",
    subtitle:
      report.status === "resolved" && report.completionNote
        ? report.completionNote
        : report.description || report.category || report.notes || "Defect report logged",
    vehicle: getVehicleText(report, vehicles),
    technician: report.reportedBy || report.reporterName || report.driverName || "",
    date: getActivityDate(report),
    route:
      report.status === "resolved"
        ? `/service/resolved-defects/${buildResolvedDefectRouteId("defectReports", report.id)}`
        : `/service/defects/${buildResolvedDefectRouteId("defectReports", report.id)}`,
  }));

  const completedVehicleDefects = vehicles.flatMap((vehicle) => {
    const defectHistory = Array.isArray(vehicle?.defectHistory)
      ? vehicle.defectHistory
      : [];

    return defectHistory
      .filter((item) => item?.source !== "defectReports")
      .map((item, index) => ({
        id: `vehicle-defect-${vehicle.id || "vehicle"}-${item?.sourceDocId || index}-${item?.itemIndex ?? "item"}`,
        icon: "check-circle",
        typeKey: "defects",
        title: "Defect resolved",
        subtitle: item?.completionNote || item?.description || item?.title || item?.sourceLabel || "Defect resolved",
        vehicle: getVehicleText({
          vehicleName: vehicle?.name || vehicle?.vehicleName || item?.vehicleName,
          registration: vehicle?.registration || vehicle?.reg || item?.registration,
        }, vehicles),
        technician: item?.completedBy || item?.resolvedBy || item?.reporter || "",
        date: item?.completedAt || item?.resolvedAt || item?.recordedAt,
        route: `/service/resolved-defects/${buildResolvedDefectRouteId("vehicles", vehicle.id, index)}`,
      }));
  });

  const prep = vehiclePrepRecords.map((record) => ({
    id: `prep-${record.id}`,
    icon: record.completed ? "check-square" : "save",
    typeKey: "prep",
    title: record.completed ? "Vehicle prep completed" : "Vehicle prep saved",
    subtitle: record.notes || "Vehicle prep record saved",
    vehicle: getVehicleText(record, vehicles),
    technician: record.completedBy || record.signedBy || "",
    date: getActivityDate(record),
    route: null,
  }));

  const mot = motPreChecks.map((record) => ({
    id: `mot-${record.id}`,
    icon: "file-text",
    typeKey: "mot",
    title: "MOT pre-check",
    subtitle: record.status || record.motPrecheckStatus || record.summary || "MOT pre-check completed",
    vehicle: getVehicleText(record, vehicles),
    technician: record.signedBy || record.completedBy || "",
    date: getActivityDate(record),
    route: null,
  }));

  const inspections = equipmentInspections.map((record) => ({
    id: `equipment-inspection-${record.id}`,
    icon: record.overallResult === "fail" ? "alert-circle" : "clipboard",
    typeKey: "inspections",
    title: "Equipment inspection",
    subtitle:
      record.findings ||
      record.recommendations ||
      record.extraNotes ||
      `${record.overallResult === "fail" ? "Failed" : "Passed"} equipment inspection`,
    vehicle: getEquipmentText(record),
    technician: record.signedBy || record.inspectedBy || "",
    date: getActivityDate(record),
    route: record.id ? `/service/inspections/inspection-form/${record.id}` : null,
  }));

  return [...services, ...defects, ...completedVehicleDefects, ...prep, ...mot, ...inspections]
    .map((item) => ({ ...item, dateObj: toDateMaybe(item.date) }))
    .sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0));
}

function useCollectionRows(collectionName, onErrorLabel) {
  const { rows } = useServiceCollection(collectionName, {
    label: onErrorLabel,
  });
  return rows;
}

export default function ActivityHistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const serviceRecords = useCollectionRows("serviceRecords", "service activity");
  const defectReports = useCollectionRows("defectReports", "defect activity");
  const vehicles = useCollectionRows("vehicles", "vehicle defect history");
  const vehiclePrepRecords = useCollectionRows("vehiclePrepRecords", "vehicle prep activity");
  const motPreChecks = useCollectionRows("motPreChecks", "MOT pre-check activity");
  const equipmentInspections = useCollectionRows("equipmentInspections", "equipment inspection activity");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const activity = useMemo(
    () =>
      buildActivityItems({
        serviceRecords,
        defectReports,
        vehicles,
        vehiclePrepRecords,
        motPreChecks,
        equipmentInspections,
      }),
    [defectReports, equipmentInspections, motPreChecks, serviceRecords, vehiclePrepRecords, vehicles]
  );

  const summary = useMemo(() => {
    const repairs = activity.filter((item) =>
      normaliseKey(item.title).includes("repair")
    ).length;
    const services = activity.filter((item) =>
      ["service", "interim", "minor"].some((key) => normaliseKey(item.title).includes(key))
    ).length;
    const defects = activity.filter((item) =>
      normaliseKey(item.title).includes("defect")
    ).length;
    const inspections = activity.filter((item) => item.typeKey === "inspections").length;

    return { total: activity.length, services, repairs, defects, inspections };
  }, [activity]);

  const filteredActivity = useMemo(() => {
    const queryText = normaliseKey(searchText);
    const now = new Date();

    return activity.filter((item) => {
      if (typeFilter !== "all" && item.typeKey !== typeFilter) return false;

      if (dateFilter !== "all") {
        if (!item.dateObj) return false;
        const diffDays =
          (now.getTime() - item.dateObj.getTime()) / (1000 * 60 * 60 * 24);
        if (dateFilter === "today" && diffDays > 1) return false;
        if (dateFilter === "7d" && diffDays > 7) return false;
        if (dateFilter === "30d" && diffDays > 30) return false;
      }

      if (!queryText) return true;
      const haystack = [
        item.title,
        item.subtitle,
        item.vehicle,
        item.technician,
      ]
        .map(normaliseKey)
        .join(" ");
      return haystack.includes(queryText);
    });
  }, [activity, dateFilter, searchText, typeFilter]);

  return (
    <PageShell header={{
      variant: "compact",
      title: "Activity History",
      subtitle: "Recent services, repairs, defects and inspections.",
      onBack: router.back,
    }}>
      

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
            Loading activity...
          </Text>
        </View>
      ) : (
        <>
          <View
            style={styles.summaryCard}
          >
            <SummaryItem label="Total" value={summary.total} colors={colors} />
            <SummaryItem label="Services" value={summary.services} colors={colors} />
            <SummaryItem label="Repairs" value={summary.repairs} colors={colors} />
            <SummaryItem label="Defects" value={summary.defects} colors={colors} />
            <SummaryItem label="Inspections" value={summary.inspections} colors={colors} />
          </View>

          <View
            style={styles.filterCard}
          >
            <FormField
              label="Search"
              placeholder="Search vehicle, equipment, reg, notes, technician..."
              value={searchText}
              onChangeText={setSearchText}
              inputProps={{ returnKeyType: "search" }}
            />

            <FilterRow
              label="Type"
              value={typeFilter}
              options={[
                ["all", "All"],
                ["services", "Services"],
                ["repairs", "Repairs"],
                ["defects", "Defects"],
                ["inspections", "Insp."],
                ["mot", "MOT"],
                ["prep", "Prep"],
              ]}
              onChange={setTypeFilter}
              colors={colors}
            />

            <FilterRow
              label="Date"
              value={dateFilter}
              options={[
                ["all", "All"],
                ["today", "Today"],
                ["7d", "7 days"],
                ["30d", "30 days"],
              ]}
              onChange={setDateFilter}
              colors={colors}
            />
          </View>

          {filteredActivity.length === 0 ? (
            <View
              style={[
                styles.emptyState,
                {
                  backgroundColor: colors.surfaceAlt || COLORS.card,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
            >
              <Icon
                name="activity"
                size={30}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text style={[styles.emptyTitle, { color: colors.text || COLORS.textHigh }]}>
                No activity yet
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Completed services, general repairs, prep records, inspections and defects will appear here.
              </Text>
            </View>
          ) : (
            filteredActivity.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.activityCard,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
                activeOpacity={item.route ? 0.85 : 1}
                onPress={() => {
                  if (item.route) router.push(item.route);
                }}
              >
                <View
                  style={[
                    styles.iconWrap,
                    { backgroundColor: getActivityIconColor(item.typeKey) },
                  ]}
                >
                  <Icon name={item.icon} size={18} color={COLORS.textHigh} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.activityHeaderRow}>
                    <Text
                      style={[
                        styles.activityTitle,
                        { color: colors.text || COLORS.textHigh },
                      ]}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={[
                        styles.activityDate,
                        { color: colors.textMuted || COLORS.textLow },
                      ]}
                    >
                      {formatDate(item.date)}
                    </Text>
                  </View>
                  {!!item.vehicle && (
                    <Text
                      style={[
                        styles.activityVehicle,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      {item.vehicle}
                    </Text>
                  )}
                  {!!item.subtitle && (
                    <Text
                      style={[
                        styles.activitySubtitle,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                      numberOfLines={2}
                    >
                      {item.subtitle}
                    </Text>
                  )}
                  {!!item.route && (
                    <Icon
                      name="chevron-right"
                      size={16}
                      color={colors.textMuted || COLORS.textLow}
                      style={styles.cardChevron}
                    />
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </>
      )}
    </PageShell>
  );
}

function SummaryItem({ label, value, colors }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={[styles.summaryValue, { color: colors.text || COLORS.textHigh }]}>
        {value}
      </Text>
      <Text style={[styles.summaryLabel, { color: colors.textMuted || COLORS.textMid }]}>
        {label}
      </Text>
    </View>
  );
}

function FilterRow({ label, value, options, onChange, colors }) {
  return (
    <View style={styles.filterBlock}>
      <Text
        style={[
          styles.filterLabel,
          { color: colors.textMuted || COLORS.textMid },
        ]}
      >
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChipsContent}
      >
        {options.map(([optionValue, optionLabel]) => {
          const active = value === optionValue;
          return (
            <TouchableOpacity
              key={optionValue}
              style={[
                styles.filterChip,
                {
                  borderColor: active
                    ? COLORS.primaryAction
                    : colors.border || COLORS.border,
                  backgroundColor: active
                    ? staticColors.rgba_qyx9xt
                    : colors.surface || COLORS.card,
                },
              ]}
              onPress={() => onChange(optionValue)}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.filterChipText,
                  {
                    color: active
                      ? COLORS.textHigh
                      : colors.textMuted || COLORS.textMid,
                  },
                ]}
              >
                {optionLabel}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
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
    paddingRight: t.spacing.xs,
  },
  pageTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingBottom: t.spacing["2xl"],
  },
  summaryCard: {
    flexDirection: "row",
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    marginBottom: t.spacing.xs,
  },
  summaryItem: {
    flex: 1,
    paddingRight: t.spacing.xs,
  },
  summaryValue: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
  },
  summaryLabel: {
    fontSize: t.typography.micro.fontSize,
  },
  filterCard: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    marginBottom: t.spacing.sm,
  },
  searchBox: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  searchInput: {
    flex: 1,
    minHeight: 36,
    fontSize: t.typography.bodySmall.fontSize,
  },
  filterBlock: {
    marginTop: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
  },
  filterLabel: {
    width: 42,
    fontSize: t.typography.micro.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    marginRight: t.spacing.xs,
  },
  filterChipsContent: {
    paddingRight: t.spacing.md,
  },
  filterChipText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  activityCard: {
    flexDirection: "row",
    position: "relative",
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.xs,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
    backgroundColor: COLORS.primaryAction,
  },
  activityHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  activityTitle: {
    flex: 1,
    paddingRight: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
  },
  activityDate: {
    maxWidth: 112,
    fontSize: t.typography.caption.fontSize,
    textAlign: "right",
  },
  activityVehicle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
  },
  activitySubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    paddingRight: t.spacing.sm,
  },
  cardChevron: {
    position: "absolute",
    right: 0,
    bottom: 0,
  },
  emptyState: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.xl,
  },
  emptyTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
  },
  emptySubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    textAlign: "center",
  },
});
