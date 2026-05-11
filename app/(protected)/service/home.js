// app/(protected)/service/home.js
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import PageHeaderCard from "../../../components/PageHeaderCard";
import { auth, db } from "../../../firebaseConfig";
import { resolveWorkspaceAccess } from "../../../lib/access";
import { createDashboardCardStyles } from "../../../lib/design/dashboard";
import { designTokens as t } from "../../../lib/design/tokens";
import { useAuth } from "../../../providers/AuthProvider";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------- CONSTANTS & HELPERS ---------- */

const COLORS = {
  background: "#000000",
  card: "#151517",
  border: "#2B2B31",
  textHigh: "#F5F5F5",
  textMid: "#D4D4D8",
  textLow: "#A1A1AA",
  primaryAction: "#D94B52",
  recceAction: "#D94B52",
  inputBg: "#111114",
  lightGray: "#3F3F46",
};

const SERVICE_ROUTES = {
  settings: "/(protected)/service/settings",
  serviceList: "/(protected)/service/service-list",
  equipmentList: "/(protected)/service/equipment-list",
  defects: "/(protected)/service/defects",
  advisories: "/(protected)/service/advisories",
  activityHistory: "/(protected)/service/activity-history",
  mainApp: "/screens/homescreen",
};

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeString(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function toDateMaybe(value) {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string" || value instanceof String) {
    const raw = String(value).trim();
    if (!raw) return null;

    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

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
  if (days < 0) {
    return {
      label: `Overdue by ${Math.abs(days)}d`,
      code: "overdue",
    };
  }
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

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isApprovedDefect(review) {
  const status = normaliseKey(review?.status);
  const category = normaliseKey(review?.category);

  return (
    status === "approved" &&
    (category === "general" || category === "immediate")
  );
}

function isOpenMaintenance(status) {
  const value = normaliseKey(status);

  return value !== "resolved" && value !== "complete" && value !== "completed";
}

function countOpenCheckDefects(checks) {
  return safeArray(checks).reduce((sum, check) => {
    const items = safeArray(check?.items);

    return (
      sum +
      items.filter(
        (item) =>
          isApprovedDefect(item?.review) &&
          isOpenMaintenance(item?.maintenance?.status)
      ).length
    );
  }, 0);
}

function countOpenIssueDefects(issues) {
  return safeArray(issues).filter(
    (issue) =>
      isApprovedDefect(issue?.review) &&
      isOpenMaintenance(issue?.maintenance?.status)
  ).length;
}

function countOpenManualDefects(reports) {
  return safeArray(reports).filter((report) =>
    isOpenMaintenance(report?.status)
  ).length;
}

function countMonitorItems(records) {
  return safeArray(records).reduce((sum, record) => {
    const items = safeArray(record?.monitorReport);
    return sum + items.length;
  }, 0);
}

function countDueEquipment(records) {
  return safeArray(records).filter((record) => {
    const status = classifyStatus(
      record?.nextInspection || record?.inspectionDueDate
    );

    return status.code === "overdue" || status.code === "due-soon";
  }).length;
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
  return [
    item?.vehicleName || item?.vehicle || item?.name,
    item?.registration || item?.reg,
  ]
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
  const services = safeArray(serviceRecords).map((record) => {
    const serviceType = record?.serviceType || record?.type || "Service";
    const isRepair =
      record?.recordType === "repair" ||
      normaliseKey(serviceType).includes("repair");

    return {
      id: `service-${record?.id || Math.random()}`,
      icon: isRepair ? "tool" : "clipboard",
      title: serviceType,
      subtitle:
        record?.workSummary ||
        record?.repairSummary ||
        record?.extraNotes ||
        "Service record completed",
      vehicle: getVehicleText(record),
      date: getActivityDate(record),
      route: record?.id
        ? `/(protected)/service/service-record/${record.id}`
        : null,
    };
  });

  const defects = safeArray(defectReports).map((report) => ({
    id: `defect-${report?.id || Math.random()}`,
    icon: report?.status === "resolved" ? "check-circle" : "alert-triangle",
    title: report?.status === "resolved" ? "Defect resolved" : "Defect reported",
    subtitle:
      report?.description ||
      report?.category ||
      report?.notes ||
      "Defect report logged",
    vehicle: getVehicleText(report),
    date: getActivityDate(report),
    route: SERVICE_ROUTES.defects,
  }));

  const prep = safeArray(vehiclePrepRecords).map((record) => ({
    id: `prep-${record?.id || Math.random()}`,
    icon: record?.completed ? "check-square" : "save",
    title: record?.completed ? "Vehicle prep completed" : "Vehicle prep saved",
    subtitle: record?.notes || "Vehicle prep record saved",
    vehicle: getVehicleText(record),
    date: getActivityDate(record),
    route: null,
  }));

  const mot = safeArray(motPreChecks).map((record) => ({
    id: `mot-${record?.id || Math.random()}`,
    icon: "file-text",
    title: "MOT pre-check",
    subtitle:
      record?.status ||
      record?.motPrecheckStatus ||
      record?.summary ||
      "MOT pre-check completed",
    vehicle: getVehicleText(record),
    date: getActivityDate(record),
    route: null,
  }));

  const inspections = safeArray(equipmentInspections).map((record) => ({
    id: `equipment-inspection-${record?.id || Math.random()}`,
    icon: record?.overallResult === "fail" ? "alert-circle" : "clipboard",
    title: "Equipment inspection",
    subtitle:
      record?.findings ||
      record?.recommendations ||
      record?.extraNotes ||
      `${
        record?.overallResult === "fail" ? "Failed" : "Passed"
      } equipment inspection`,
    vehicle: getEquipmentText(record),
    date: getActivityDate(record),
    route: record?.id
      ? `/(protected)/service/inspections/inspection-form/${record.id}`
      : null,
  }));

  return [...services, ...defects, ...prep, ...mot, ...inspections]
    .map((item) => ({ ...item, dateObj: toDateMaybe(item.date) }))
    .sort((a, b) => (b.dateObj?.getTime() || 0) - (a.dateObj?.getTime() || 0));
}

function snapshotToRows(snap) {
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

/* ---------- MAIN SCREEN ---------- */

export default function ServiceHomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { employee } = useAuth();

  const [vehicles, setVehicles] = useState([]);
  const [vehicleChecks, setVehicleChecks] = useState([]);
  const [vehicleIssues, setVehicleIssues] = useState([]);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [defectReports, setDefectReports] = useState([]);
  const [vehiclePrepRecords, setVehiclePrepRecords] = useState([]);
  const [motPreChecks, setMotPreChecks] = useState([]);
  const [equipmentInspections, setEquipmentInspections] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);

  const workspaceAccess = useMemo(
    () => resolveWorkspaceAccess(employee),
    [employee]
  );

  const canSwitchToMainApp = workspaceAccess.user && workspaceAccess.service;

  const safePush = (href) => {
    if (!href) return;

    try {
      router.push(href);
    } catch (err) {
      console.error("Service Home navigation error:", href, err);
    }
  };

  useEffect(() => {
    let unsubscribers = [];

    const resetData = () => {
      setVehicles([]);
      setVehicleChecks([]);
      setVehicleIssues([]);
      setServiceRecords([]);
      setDefectReports([]);
      setVehiclePrepRecords([]);
      setMotPreChecks([]);
      setEquipmentInspections([]);
      setEquipment([]);
    };

    const clearListeners = () => {
      unsubscribers.forEach((unsub) => {
        if (typeof unsub === "function") unsub();
      });
      unsubscribers = [];
    };

    const attachCollectionListener = ({
      collectionName,
      setter,
      label,
      sortByName = false,
    }) => {
      const ref = collection(db, collectionName);
      const source = sortByName ? query(ref, orderBy("name", "asc")) : ref;

      const unsubscribe = onSnapshot(
        source,
        (snap) => {
          setter(snapshotToRows(snap));
        },
        (err) => {
          if (err?.code === "permission-denied" && !auth.currentUser) return;

          console.error(`Service Home ${label} listener error:`, err);
        }
      );

      unsubscribers.push(unsubscribe);
    };

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      clearListeners();

      if (!user) {
        resetData();
        setLoading(false);
        return;
      }

      setLoading(true);

      attachCollectionListener({
        collectionName: "vehicles",
        setter: setVehicles,
        label: "vehicles",
        sortByName: true,
      });

      attachCollectionListener({
        collectionName: "vehicleChecks",
        setter: setVehicleChecks,
        label: "vehicleChecks",
      });

      attachCollectionListener({
        collectionName: "vehicleIssues",
        setter: setVehicleIssues,
        label: "vehicleIssues",
      });

      attachCollectionListener({
        collectionName: "serviceRecords",
        setter: setServiceRecords,
        label: "serviceRecords",
      });

      attachCollectionListener({
        collectionName: "defectReports",
        setter: setDefectReports,
        label: "defectReports",
      });

      attachCollectionListener({
        collectionName: "vehiclePrepRecords",
        setter: setVehiclePrepRecords,
        label: "vehiclePrepRecords",
      });

      attachCollectionListener({
        collectionName: "motPreChecks",
        setter: setMotPreChecks,
        label: "motPreChecks",
      });

      attachCollectionListener({
        collectionName: "equipmentInspections",
        setter: setEquipmentInspections,
        label: "equipmentInspections",
      });

      attachCollectionListener({
        collectionName: "equipment",
        setter: setEquipment,
        label: "equipment",
      });

      setLoading(false);
    });

    return () => {
      clearListeners();
      unsubscribeAuth();
    };
  }, []);

  const openDefectCount = useMemo(
    () =>
      countOpenCheckDefects(vehicleChecks) +
      countOpenIssueDefects(vehicleIssues) +
      countOpenManualDefects(defectReports),
    [defectReports, vehicleChecks, vehicleIssues]
  );

  const advisoryCount = useMemo(
    () => countMonitorItems(serviceRecords) + countMonitorItems(equipmentInspections),
    [equipmentInspections, serviceRecords]
  );

  const equipmentDueCount = useMemo(() => countDueEquipment(equipment), [equipment]);

  const recentActivity = useMemo(
    () =>
      buildActivityItems({
        serviceRecords,
        defectReports,
        vehiclePrepRecords,
        motPreChecks,
        equipmentInspections,
      }).slice(0, 20),
    [
      defectReports,
      equipmentInspections,
      motPreChecks,
      serviceRecords,
      vehiclePrepRecords,
    ]
  );

  const processed = useMemo(() => {
    return safeArray(vehicles).map((v) => {
      const motDateRaw =
        v?.nextMOT || v?.nextMot || v?.nextMotDate || v?.motDueDate || v?.motExpiryDate;
      const serviceDateRaw =
        v?.nextService || v?.nextServiceDate || v?.serviceDueDate || v?.nextSvc;

      const motStatus = classifyStatus(motDateRaw);
      const serviceStatus = classifyStatus(serviceDateRaw);
      const defects = safeArray(v?.defects);
      const hasDefects = defects.length > 0;

      return {
        ...v,
        motStatus,
        serviceStatus,
        motDateRaw,
        serviceDateRaw,
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

    const defects = openDefectCount;

    return { total, overdue, dueSoon, defects };
  }, [openDefectCount, processed]);

  const attentionVehicles = useMemo(() => {
    const overdue = processed.filter(
      (v) =>
        v.motStatus.code === "overdue" || v.serviceStatus.code === "overdue"
    );

    const dueSoon = processed.filter(
      (v) =>
        v.motStatus.code === "due-soon" || v.serviceStatus.code === "due-soon"
    );

    const seen = new Set();
    const dedupedCombined = [...overdue, ...dueSoon].filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });

    const byUrgency = dedupedCombined.sort((a, b) => {
      const aMot = daysUntilDate(a.motDateRaw);
      const aService = daysUntilDate(a.serviceDateRaw);
      const bMot = daysUntilDate(b.motDateRaw);
      const bService = daysUntilDate(b.serviceDateRaw);

      const aWorst = Math.min(
        aMot ?? Number.POSITIVE_INFINITY,
        aService ?? Number.POSITIVE_INFINITY
      );

      const bWorst = Math.min(
        bMot ?? Number.POSITIVE_INFINITY,
        bService ?? Number.POSITIVE_INFINITY
      );

      return aWorst - bWorst;
    });

    return byUrgency.slice(0, 5);
  }, [processed]);

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      <PageHeaderCard
        eyebrow="Workshop"
        title="Service & Maintenance"
        subtitle="Overview of MOT, servicing, defects and workshop activity."
        style={styles.headerCard}
        contentStyle={styles.headerContent}
        topSlot={
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Image
                source={require("../../../assets/images/bickers-action-logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>

            {canSwitchToMainApp && (
              <TouchableOpacity
                style={[
                  styles.profileButton,
                  { borderColor: colors.border || COLORS.border },
                ]}
                onPress={() => safePush(SERVICE_ROUTES.mainApp)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Switch to main app"
              >
                <Icon
                  name="grid"
                  size={21}
                  color={colors.text || COLORS.textHigh}
                />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.profileButton,
                { borderColor: colors.border || COLORS.border },
              ]}
              onPress={() => safePush(SERVICE_ROUTES.settings)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Open service settings"
            >
              <Icon
                name="user"
                size={22}
                color={colors.text || COLORS.textHigh}
              />
            </TouchableOpacity>
          </View>
        }
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={colors.primary || COLORS.primaryAction}
          />
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
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* FLEET SUMMARY CARD */}
          <View
            style={[
              styles.infoCard,
              {
                borderLeftColor: colors.primary || COLORS.primaryAction,
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
                    ? "#ED1C25"
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
            </View>

            <View style={[styles.summaryRow, { marginTop: 10 }]}>
              <SummaryItem
                label="Due soon (30d)"
                value={summary.dueSoon}
                color={
                  summary.dueSoon > 0
                    ? "#FF9500"
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
              <SummaryItem
                label="With defects"
                value={summary.defects}
                color={
                  summary.defects > 0
                    ? "#ED1C25"
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
              onPress={() => safePush(SERVICE_ROUTES.serviceList)}
              colors={colors}
            />
            <QuickActionCard
              icon="package"
              title="Equipment"
              subtitle={
                equipmentDueCount > 0
                  ? `${equipmentDueCount} due or overdue`
                  : "Inspection dates OK"
              }
              badgeCount={equipmentDueCount}
              onPress={() => safePush(SERVICE_ROUTES.equipmentList)}
              colors={colors}
            />
          </View>

          <View style={[styles.quickRow, { marginTop: 10 }]}>
            <QuickActionCard
              icon="alert-triangle"
              title="Defects & Issues"
              subtitle={
                openDefectCount > 0
                  ? `${openDefectCount} open defect${
                      openDefectCount === 1 ? "" : "s"
                    } need attention`
                  : "No open approved defects"
              }
              badgeCount={openDefectCount}
              onPress={() => safePush(SERVICE_ROUTES.defects)}
              colors={colors}
            />
            <QuickActionCard
              icon="eye"
              title="Advisories"
              subtitle={
                advisoryCount > 0
                  ? `${advisoryCount} amber item${
                      advisoryCount === 1 ? "" : "s"
                    } to monitor`
                  : "No amber advisories"
              }
              badgeCount={advisoryCount}
              onPress={() => safePush(SERVICE_ROUTES.advisories)}
              colors={colors}
            />
          </View>

          <View style={[styles.quickRow, { marginTop: 10 }]}>
            <QuickActionCard
              icon="activity"
              title="Activity History"
              subtitle={
                recentActivity.length > 0
                  ? `${recentActivity.length} recent update${
                      recentActivity.length === 1 ? "" : "s"
                    }`
                  : "Services, repairs and defects"
              }
              badgeCount={recentActivity.length}
              onPress={() => safePush(SERVICE_ROUTES.activityHistory)}
              colors={colors}
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
              const vehicleId = safeString(v?.id);
              const name = v?.name || v?.vehicleName || "Unnamed vehicle";
              const reg = v?.reg || v?.registration || "";
              const manufacturer = v?.manufacturer || "";
              const model = v?.model || "";
              const worstCode = v?.worstCode;

              const motStatusWithDate = {
                ...v.motStatus,
                label:
                  v.motStatus.label +
                  (v.motDateRaw ? ` · ${formatDateShort(v.motDateRaw)}` : ""),
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
              if (worstCode === "overdue") borderAccent = "#ED1C25";
              else if (worstCode === "due-soon") borderAccent = "#FF9500";

              return (
                <TouchableOpacity
                  key={vehicleId || `${name}-${reg}`}
                  style={[
                    styles.vehicleCard,
                    {
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderLeftColor: borderAccent,
                    },
                  ]}
                  activeOpacity={0.85}
                  disabled={!vehicleId}
                  onPress={() => {
                    if (!vehicleId) {
                      console.warn("Cannot open vehicle. Missing vehicle id:", v);
                      return;
                    }

                    safePush(`/(protected)/service/vehicles/${vehicleId}`);
                  }}
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
                            styles.vehicleReg,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          {manufacturer}
                          {manufacturer && model ? " · " : ""}
                          {model}
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
                    <StatusPill label="MOT" status={motStatusWithDate} />
                    <StatusPill label="Service" status={serviceStatusWithDate} />

                    {v.hasDefects && (
                      <View style={styles.defectPill}>
                        <Icon
                          name="alert-triangle"
                          size={14}
                          color={COLORS.textHigh}
                          style={{ marginRight: 4 }}
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
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function SummaryItem({ label, value, color, labelColor }) {
  return (
    <View style={summaryStyles.item}>
      <Text style={[summaryStyles.value, { color }]}>{value}</Text>
      <Text style={[summaryStyles.label, { color: labelColor }]}>{label}</Text>
    </View>
  );
}

function QuickActionCard({
  icon,
  title,
  subtitle,
  badgeCount = 0,
  onPress,
  colors,
}) {
  const dashboardCards = createDashboardCardStyles({
    surface: colors.surface || COLORS.card,
    surfaceAlt: colors.surfaceAlt || COLORS.card,
    border: colors.border || COLORS.border,
  });

  return (
    <TouchableOpacity
      style={[quickStyles.card, dashboardCards.quickActionCard]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={quickStyles.iconWrap}>
        <Icon name={icon} size={18} color={COLORS.textHigh} />
        {badgeCount > 0 && (
          <View style={quickStyles.badge}>
            <Text style={quickStyles.badgeText}>
              {badgeCount > 99 ? "99+" : badgeCount}
            </Text>
          </View>
        )}
      </View>

      <Text style={[quickStyles.title, { color: colors.text || COLORS.textHigh }]}>
        {title}
      </Text>

      <Text
        style={[
          quickStyles.subtitle,
          { color: colors.textMuted || COLORS.textLow || COLORS.textMid },
        ]}
      >
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

function StatusPill({ label, status }) {
  const { colors } = useTheme();
  const code = status?.code;

  let bg = "rgba(74, 74, 74, 0.7)";
  let fg = COLORS.textHigh;

  if (code === "overdue") {
    bg = "rgba(255,59,48,0.22)";
    fg = "#ED1C25";
  } else if (code === "due-soon") {
    bg = "rgba(255,149,0,0.22)";
    fg = "#FF9500";
  } else if (code === "ok") {
    bg = "rgba(52,199,89,0.22)";
    fg = "#34C759";
  } else if (code === "unknown") {
    bg = "rgba(142,142,147,0.22)";
    fg = colors.textMuted || COLORS.textMid;
  }

  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillText, { color: fg }]}>
        {label}: {status?.label || "No date"}
      </Text>
    </View>
  );
}

/* ---------- STYLES ---------- */

const summaryStyles = StyleSheet.create({
  item: {
    flex: 1,
    paddingRight: 12,
  },
  value: {
    fontSize: 20,
    fontWeight: "800",
  },
  label: {
    fontSize: 13,
    marginTop: 2,
  },
});

const quickStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 4,
    borderWidth: 1,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#262626",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  badge: {
    position: "absolute",
    top: -7,
    right: -9,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ED1C25",
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerCard: {
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.xs,
    marginBottom: 0,
  },
  headerContent: {
    paddingTop: 4,
    paddingBottom: t.spacing.sm,
  },
  header: {
    paddingHorizontal: 0,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
  },
  logo: {
    width: 140,
    height: 40,
    marginBottom: 0,
  },
  pageTitle: {
    color: COLORS.textHigh,
    fontSize: 22,
    fontWeight: "800",
  },
  pageSubtitle: {
    marginTop: t.spacing.xxs,
    color: COLORS.textMid,
    fontSize: 13,
  },
  profileButton: {
    marginLeft: 12,
    width: t.controls.iconButtonSm,
    height: t.controls.iconButtonSm,
    borderRadius: t.controls.iconButtonSm / 2,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: t.spacing.sm,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: 0,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    padding: t.controls.cardPadding,
    borderRadius: t.radius.sm,
    marginBottom: t.spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryAction,
  },
  infoTextTitle: {
    color: COLORS.textHigh,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: "row",
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    color: COLORS.textHigh,
    fontSize: 16,
    fontWeight: "700",
    paddingRight: 10,
  },
  quickRow: {
    flexDirection: "row",
    marginHorizontal: -4,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
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
  vehicleCard: {
    backgroundColor: COLORS.card,
    padding: t.controls.cardPadding,
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.border,
  },
  vehicleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  vehicleTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
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
  defectPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.recceAction,
    marginBottom: 4,
  },
  defectText: {
    fontSize: 11,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
});