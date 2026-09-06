import { AppText as Text, AppPressable as TouchableOpacity } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
import { useLocalSearchParams,
  useRouter } from "expo-router";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { useServiceCollection } from "../../../../hooks/useServiceData";
import { useTheme } from "../../../../providers/ThemeProvider";
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

function getVehicleLabel(vehicle, params) {
  const name = vehicle?.name || vehicle?.vehicleName || params.name || "Vehicle";
  const reg = vehicle?.registration || vehicle?.reg || params.registration || "";
  return reg ? `${name} · ${reg}` : name;
}

function buildResolvedDefectRouteId(vehicleId, itemIndex = "") {
  return encodeURIComponent(["vehicles", vehicleId, itemIndex].join("|"));
}

function buildManualResolvedDefectRouteId(reportId) {
  return encodeURIComponent(["defectReports", reportId, ""].join("|"));
}

function matchesVehicle(item, vehicleId, vehicle) {
  if (!item) return false;
  if (item.vehicleId === vehicleId || item.vehicleDocId === vehicleId) return true;

  const itemReg = normaliseKey(item.registration || item.reg);
  const vehicleReg = normaliseKey(vehicle?.registration || vehicle?.reg);
  if (itemReg && vehicleReg && itemReg === vehicleReg) return true;

  const itemName = normaliseKey(item.vehicleName || item.vehicle || item.name);
  const vehicleNames = [
    vehicle?.name,
    vehicle?.vehicleName,
    vehicle?.vehicle,
  ].map(normaliseKey);
  return !!itemName && vehicleNames.includes(itemName);
}

function getActivityDate(item) {
  return (
    item?.completedAt ||
    item?.updatedAt ||
    item?.createdAt ||
    item?.serviceDateOnly ||
    item?.serviceDate ||
    item?.completedDate ||
    item?.precheckDateOnly ||
    item?.precheckDateTime ||
    item?.prepDate ||
    item?.date ||
    item?.recordedAt ||
    null
  );
}

function photosFromRecord(record) {
  const globalURLs = Array.isArray(record?.photoURLs) ? record.photoURLs : [];
  const globalURIs = Array.isArray(record?.photoURIs) ? record.photoURIs : [];
  const global = globalURLs.length > 0 ? globalURLs : globalURIs;
  if (global.length > 0) return global;

  const checkURLs = record?.checkPhotoURLs || {};
  const checkURIs = record?.checkPhotoURIs || {};
  const checkPhotos =
    Object.keys(checkURLs).length > 0 ? checkURLs : checkURIs;
  if (!checkPhotos || typeof checkPhotos !== "object") return [];
  return Object.values(checkPhotos).flat().filter(Boolean);
}

function buildTimelineItems({
  vehicle,
  vehicleId,
  serviceRecords,
  defectReports,
  vehiclePrepRecords,
  motPreChecks,
}) {
  const serviceItems = serviceRecords
    .filter((record) => matchesVehicle(record, vehicleId, vehicle))
    .map((record) => {
      const serviceType = record.serviceType || record.type || "Service";
      const key = normaliseKey(serviceType);
      const isRepair = record.recordType === "repair" || key.includes("repair");
      const isInterim = key.includes("interim") || key.includes("minor");
      return {
        id: `service-${record.id}`,
        icon: isRepair ? "tool" : isInterim ? "settings" : "clipboard",
        title: serviceType,
        subtitle: record.workSummary || record.repairSummary || record.extraNotes || "",
        meta: [record.signedBy || record.completedBy, record.partsUsed ? `Parts: ${record.partsUsed}` : ""]
          .filter(Boolean)
          .join(" · "),
        date: getActivityDate(record),
        photos: photosFromRecord(record),
        route: record.id ? `/service/service-record/${record.id}` : null,
      };
    });

  const defectItems = defectReports
    .filter((report) => matchesVehicle(report, vehicleId, vehicle))
    .map((report) => ({
      id: `defect-${report.id}`,
      icon: report.status === "resolved" ? "check-circle" : "alert-triangle",
      title: report.status === "resolved" ? "Defect resolved" : "Defect reported",
      subtitle: report.description || report.category || report.notes || "",
      meta: [report.reportedBy || report.reporterName || report.driverName, report.status]
        .filter(Boolean)
        .join(" · "),
      date: getActivityDate(report),
      photos: photosFromRecord(report),
      route:
        report.status === "resolved"
          ? `/service/resolved-defects/${buildManualResolvedDefectRouteId(report.id)}`
          : "/service/defects",
    }));

  const prepItems = vehiclePrepRecords
    .filter((record) => matchesVehicle(record, vehicleId, vehicle))
    .map((record) => ({
      id: `prep-${record.id}`,
      icon: record.completed ? "check-square" : "save",
      title: record.completed ? "Vehicle prep completed" : "Vehicle prep saved",
      subtitle: record.notes || "",
      meta: "",
      date: getActivityDate(record),
      photos: [],
      route: null,
    }));

  const motItems = motPreChecks
    .filter((record) => matchesVehicle(record, vehicleId, vehicle))
    .map((record) => ({
      id: `mot-${record.id}`,
      icon: "file-text",
      title: "MOT pre-check",
      subtitle: record.status || record.motPrecheckStatus || record.summary || "",
      meta: [record.signedBy, record.faultsFound ? `Faults: ${record.faultsFound}` : ""]
        .filter(Boolean)
        .join(" · "),
      date: getActivityDate(record),
      photos: [],
      route: null,
    }));

  const embeddedServices = Array.isArray(vehicle?.serviceHistory)
    ? vehicle.serviceHistory.map((item, index) => ({
        id: `embedded-service-${index}`,
        icon: "archive",
        title: item?.type || "Service history",
        subtitle: item?.summary || item?.notes || "",
        meta: item?.partsUsed ? `Parts: ${item.partsUsed}` : "",
        date: getActivityDate(item),
        photos: [],
        route: item?.serviceRecordId ? `/service/service-record/${item.serviceRecordId}` : null,
      }))
    : [];

  const embeddedRepairs = Array.isArray(vehicle?.repairHistory)
    ? vehicle.repairHistory.map((item, index) => ({
        id: `embedded-repair-${index}`,
        icon: "tool",
        title: item?.type || "General repair",
        subtitle: item?.summary || item?.repairSummary || item?.notes || "",
        meta: item?.partsUsed ? `Parts: ${item.partsUsed}` : "",
        date: getActivityDate(item),
        photos: [],
        route: item?.serviceRecordId ? `/service/service-record/${item.serviceRecordId}` : null,
      }))
    : [];

  const embeddedDefects = Array.isArray(vehicle?.defectHistory)
    ? vehicle.defectHistory.map((item, index) => ({
        id: `embedded-defect-${index}`,
        icon: "check-circle",
        title: item?.title || "Resolved defect",
        subtitle: item?.completionNote || item?.description || item?.notes || "",
        meta: item?.category || "",
        date: item?.completedAt || item?.resolvedAt || item?.recordedAt,
        photos: [],
        route: `/service/resolved-defects/${buildResolvedDefectRouteId(vehicleId, index)}`,
      }))
    : [];

  const uniqueById = new Map();
  [
    ...serviceItems,
    ...defectItems,
    ...prepItems,
    ...motItems,
    ...embeddedServices,
    ...embeddedRepairs,
    ...embeddedDefects,
  ].forEach((item) => {
    uniqueById.set(item.id, { ...item, dateObj: toDateMaybe(item.date) });
  });

  return Array.from(uniqueById.values()).sort(
    (a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0)
  );
}

function useCollectionRows(collectionName) {
  const { rows } = useServiceCollection(collectionName);
  return rows;
}

export default function VehicleTimelineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const vehicleId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [vehicle, setVehicle] = useState(null);
  const [loadingVehicle, setLoadingVehicle] = useState(true);
  const serviceRecords = useCollectionRows("serviceRecords");
  const defectReports = useCollectionRows("defectReports");
  const vehiclePrepRecords = useCollectionRows("vehiclePrepRecords");
  const motPreChecks = useCollectionRows("motPreChecks");
  const vehiclesResource = useServiceCollection("vehicles");

  useEffect(() => {
    if (!vehicleId) return;
    setVehicle(
      vehiclesResource.data.find((row) => String(row.id) === String(vehicleId)) || null
    );
    setLoadingVehicle(vehiclesResource.isInitialLoading);
  }, [vehicleId, vehiclesResource.data, vehiclesResource.isInitialLoading]);

  const timeline = useMemo(
    () =>
      buildTimelineItems({
        vehicle,
        vehicleId,
        serviceRecords,
        defectReports,
        vehiclePrepRecords,
        motPreChecks,
      }),
    [defectReports, motPreChecks, serviceRecords, vehicle, vehicleId, vehiclePrepRecords]
  );

  const headerLabel = getVehicleLabel(vehicle, params);

  return (
    <PageShell header={{
      variant: "compact",
      title: "Vehicle Timeline",
      subtitle: headerLabel,
      onBack: router.back,
    }}>
      

      {loadingVehicle ? (
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
            Loading timeline...
          </Text>
        </View>
      ) : (
        <>
          {timeline.length === 0 ? (
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
                name="clock"
                size={30}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text style={[styles.emptyTitle, { color: colors.text || COLORS.textHigh }]}>
                No timeline yet
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Services, repairs, defects, MOT checks, prep records and photos will appear here.
              </Text>
            </View>
          ) : (
            timeline.map((item, index) => (
              <TouchableOpacity
                key={`${item.id}-${index}`}
                style={styles.timelineRow}
                activeOpacity={item.route ? 0.85 : 1}
                onPress={() => {
                  if (item.route) router.push(item.route);
                }}
              >
                <View style={styles.timelineRail}>
                  <View style={styles.iconWrap}>
                    <Icon name={item.icon} size={17} color={COLORS.textHigh} />
                  </View>
                  {index < timeline.length - 1 && <View style={styles.railLine} />}
                </View>

                <View
                  style={[
                    styles.timelineCard,
                    {
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderColor: colors.border || COLORS.border,
                    },
                  ]}
                >
                  <View style={styles.timelineHeaderRow}>
                    <Text
                      style={[
                        styles.timelineTitle,
                        { color: colors.text || COLORS.textHigh },
                      ]}
                    >
                      {item.title}
                    </Text>
                    <Text
                      style={[
                        styles.timelineDate,
                        { color: colors.textMuted || COLORS.textLow },
                      ]}
                    >
                      {formatDate(item.date)}
                    </Text>
                  </View>
                  {!!item.meta && (
                    <Text
                      style={[
                        styles.timelineMeta,
                        { color: colors.textMuted || COLORS.textLow },
                      ]}
                    >
                      {item.meta}
                    </Text>
                  )}
                  {!!item.subtitle && (
                    <Text
                      style={[
                        styles.timelineSubtitle,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      {item.subtitle}
                    </Text>
                  )}
                  {Array.isArray(item.photos) && item.photos.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginTop: t.spacing.xs }}
                    >
                      {item.photos.slice(0, 8).map((uri) => (
                        <Image key={uri} source={{ uri }} style={styles.photoThumb} />
                      ))}
                    </ScrollView>
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
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingBottom: t.spacing["2xl"],
  },
  timelineRow: {
    flexDirection: "row",
  },
  timelineRail: {
    width: 38,
    alignItems: "center",
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primaryAction,
  },
  railLine: {
    flex: 1,
    width: 2,
    backgroundColor: COLORS.border,
  },
  timelineCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  timelineHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  timelineTitle: {
    flex: 1,
    paddingRight: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
  },
  timelineDate: {
    maxWidth: 112,
    fontSize: t.typography.caption.fontSize,
    textAlign: "right",
  },
  timelineMeta: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
  },
  timelineSubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
  },
  photoThumb: {
    width: 70,
    height: 70,
    borderRadius: t.radius.sm,
    marginRight: t.spacing.xs,
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
