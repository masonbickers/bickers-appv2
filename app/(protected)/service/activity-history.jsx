import { useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
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

import { db } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
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

function getVehicleText(item) {
  return [item?.vehicleName || item?.vehicle || item?.name, item?.registration || item?.reg]
    .filter(Boolean)
    .join(" · ");
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

function buildActivityItems({
  serviceRecords,
  defectReports,
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
      vehicle: getVehicleText(record),
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
    subtitle: report.description || report.category || report.notes || "Defect report logged",
    vehicle: getVehicleText(report),
    technician: report.reportedBy || report.reporterName || report.driverName || "",
    date: getActivityDate(report),
    route: "/service/defects",
  }));

  const prep = vehiclePrepRecords.map((record) => ({
    id: `prep-${record.id}`,
    icon: record.completed ? "check-square" : "save",
    typeKey: "prep",
    title: record.completed ? "Vehicle prep completed" : "Vehicle prep saved",
    subtitle: record.notes || "Vehicle prep record saved",
    vehicle: getVehicleText(record),
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
    vehicle: getVehicleText(record),
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

  return [...services, ...defects, ...prep, ...mot, ...inspections]
    .map((item) => ({ ...item, dateObj: toDateMaybe(item.date) }))
    .sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0));
}

function useCollectionRows(collectionName, onErrorLabel) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, collectionName),
      (snap) => {
        setRows(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error(`Failed to load ${onErrorLabel}:`, err);
      }
    );

    return () => unsub();
  }, [collectionName, onErrorLabel]);

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
        vehiclePrepRecords,
        motPreChecks,
        equipmentInspections,
      }),
    [defectReports, equipmentInspections, motPreChecks, serviceRecords, vehiclePrepRecords]
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
    <SafeAreaView
      edges={["left", "right"]}
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Icon
            name="chevron-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}>
            Activity History
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Recent completed services, repairs, defects, inspections and workshop updates.
          </Text>
        </View>
      </View>

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
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <SummaryItem label="Recent updates" value={summary.total} colors={colors} />
            <SummaryItem label="Services" value={summary.services} colors={colors} />
            <SummaryItem label="Repairs" value={summary.repairs} colors={colors} />
            <SummaryItem label="Defects" value={summary.defects} colors={colors} />
            <SummaryItem label="Inspections" value={summary.inspections} colors={colors} />
          </View>

          <View
            style={[
              styles.filterCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: colors.inputBackground || "#111114",
                  borderColor: colors.inputBorder || colors.border || COLORS.border,
                },
              ]}
            >
              <Icon
                name="search"
                size={16}
                color={colors.textMuted || COLORS.textMid}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={[
                  styles.searchInput,
                  { color: colors.text || COLORS.textHigh },
                ]}
                placeholder="Search vehicle, equipment, reg, notes, technician..."
                placeholderTextColor={colors.textMuted || COLORS.textLow}
                value={searchText}
                onChangeText={setSearchText}
              />
            </View>

            <FilterRow
              label="Type"
              value={typeFilter}
              options={[
                ["all", "All"],
                ["services", "Services"],
                ["repairs", "Repairs"],
                ["defects", "Defects"],
                ["inspections", "Inspections"],
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
                <View style={styles.iconWrap}>
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
                    >
                      {item.subtitle}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
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
      <Text style={[styles.filterLabel, { color: colors.textMuted || COLORS.textMid }]}>
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
                    ? "rgba(237,28,37,0.18)"
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: 10,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
  },
  summaryCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 14,
  },
  summaryItem: {
    flex: 1,
    paddingRight: 8,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: "800",
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 11,
  },
  filterCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  searchBox: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 42,
    fontSize: 14,
  },
  filterBlock: {
    marginTop: 8,
  },
  filterLabel: {
    marginBottom: 6,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "800",
  },
  activityCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: COLORS.primaryAction,
  },
  activityHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  activityTitle: {
    flex: 1,
    paddingRight: 10,
    fontSize: 15,
    fontWeight: "800",
  },
  activityDate: {
    maxWidth: 112,
    fontSize: 11,
    textAlign: "right",
  },
  activityVehicle: {
    marginTop: 3,
    fontSize: 12,
  },
  activitySubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 24,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "800",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
});
