import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { useServiceCacheActions, useServiceCollection } from "../../../../hooks/useServiceData";
import {
  getVehicleInsuranceExpiry,
  getVehicleLastMot,
  getVehicleLastService,
  getVehicleManufacturer,
  getVehicleMileage,
  getVehicleName,
  getVehicleNextMot,
  getVehicleNextService,
  getVehicleOperationalStatus,
  getVehicleRegistration,
  isVehicleActiveForMaintenance,
  isVehicleMotApplicable,
  isVehicleServiceApplicable,
} from "../../../../lib/fleetSchema";
import { useTheme } from "../../../../providers/ThemeProvider";

/* ---------- CONSTANTS ---------- */

const COLORS = {
  background: "#000000",
  card: "#151517",
  border: "#2B2B31",
  textHigh: "#F5F5F5",
  textMid: "#D4D4D8",
  textLow: "#A1A1AA",
  chipBg: "#1D1D21",
  primaryAction: "#D94B52",
};

const SERVICE_DRAFTS_KEY = "serviceFormDrafts_v1";
const MINOR_SERVICE_DRAFTS_KEY = "minorServiceFormDrafts_v1";

/* ---------- DATE HELPERS ---------- */

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

function formatDateShort(value) {
  const d = toDateMaybe(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatFieldValue(value) {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "object") {
    const d = typeof value.toDate === "function" ? value.toDate() : null;
    return d ? formatDateShort(d) : "—";
  }

  const text = String(value);
  const looksLikeDate =
    /^\d{4}-\d{1,2}-\d{1,2}(?:[T\s].*)?$/.test(text) ||
    /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(text);

  if (looksLikeDate) return formatDateShort(text) || text;
  return text || "—";
}

function hasMeaningfulValue(value) {
  const display = formatFieldValue(value);
  return display !== "—" && display !== "";
}

function buildResolvedDefectRouteId(vehicleId, itemIndex = "") {
  return encodeURIComponent(["vehicles", vehicleId, itemIndex].join("|"));
}

function isRepairHistoryItem(item) {
  const type = String(item?.type || item?.serviceType || item?.recordType || "")
    .trim()
    .toLowerCase();
  return (
    type.includes("repair") ||
    !!item?.repairRecordId ||
    item?.recordType === "repair"
  );
}

/* ---------- MAIN SCREEN ---------- */

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const { patchServiceRow } = useServiceCacheActions();
  const vehiclesResource = useServiceCollection("vehicles");

  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => {
    if (!id) return;
    setVehicle(
      vehiclesResource.data.find((row) => String(row.id) === String(id)) || null
    );
    setLoading(vehiclesResource.isInitialLoading);
  }, [id, vehiclesResource.data, vehiclesResource.isInitialLoading]);

  const motStatus = useMemo(() => {
    if (!vehicle) return null;
    if (!isVehicleMotApplicable(vehicle)) {
      return { label: "N/A", code: "not-applicable", display: "N/A" };
    }
    const raw = getVehicleNextMot(vehicle);
    const base = classifyStatus(raw);
    return {
      ...base,
      display: base.label + (raw ? ` · ${formatDateShort(raw)}` : ""),
    };
  }, [vehicle]);

  const serviceStatus = useMemo(() => {
    if (!vehicle) return null;
    if (!isVehicleServiceApplicable(vehicle)) {
      return { label: "N/A", code: "not-applicable", display: "N/A" };
    }
    const raw = getVehicleNextService(vehicle);
    const base = classifyStatus(raw);
    return {
      ...base,
      display: base.label + (raw ? ` · ${formatDateShort(raw)}` : ""),
    };
  }, [vehicle]);

  const taxStatus = vehicle?.taxStatus || "Unknown";
  const insuranceStatus = vehicle?.insuranceStatus || "Unknown";
  const insuranceExpiry = getVehicleInsuranceExpiry(vehicle);
  const mileageValue = getVehicleMileage(vehicle);
  const mileageDisplay =
    typeof mileageValue === "number"
      ? `${mileageValue.toLocaleString("en-GB")} mi`
      : mileageValue || "—";
  const activeForMaintenance = vehicle
    ? isVehicleActiveForMaintenance(vehicle)
    : true;
  const operationalStatus = getVehicleOperationalStatus(vehicle) || "Active";

  const isLorry = useMemo(() => {
    const cat = (vehicle?.category || "").toLowerCase();
    return cat.includes("lorry") || cat.includes("lorries");
  }, [vehicle]);

  // serviceHistory can be an array (old style) or a string summary (new web edit)
  const serviceHistory = useMemo(() => {
    if (Array.isArray(vehicle?.serviceHistory)) {
      return [...vehicle.serviceHistory]
        .filter((item) => !isRepairHistoryItem(item))
        .sort((a, b) => {
          const da =
            toDateMaybe(a?.completedDate || a?.date || a?.recordedAt)?.getTime() ||
            0;
          const db =
            toDateMaybe(b?.completedDate || b?.date || b?.recordedAt)?.getTime() ||
            0;
          return db - da;
        });
    }
    return [];
  }, [vehicle]);

  const serviceHistorySummary =
    !Array.isArray(vehicle?.serviceHistory) &&
    typeof vehicle?.serviceHistory === "string"
      ? vehicle.serviceHistory
      : null;

  const repairHistory = useMemo(() => {
    const fromRepairs = Array.isArray(vehicle?.repairHistory)
      ? vehicle.repairHistory
      : [];
    const legacyRepairs = Array.isArray(vehicle?.serviceHistory)
      ? vehicle.serviceHistory.filter(isRepairHistoryItem)
      : [];

    return [...fromRepairs, ...legacyRepairs].sort((a, b) => {
      const da =
        toDateMaybe(a?.completedDate || a?.date || a?.recordedAt)?.getTime() || 0;
      const db =
        toDateMaybe(b?.completedDate || b?.date || b?.recordedAt)?.getTime() || 0;
      return db - da;
    });
  }, [vehicle]);

  const defectHistory = useMemo(() => {
    if (!Array.isArray(vehicle?.defectHistory)) return [];
    return vehicle.defectHistory.map((item, index) => ({ ...item, historyIndex: index })).sort((a, b) => {
      const da =
        toDateMaybe(a?.completedAt || a?.resolvedAt || a?.recordedAt)?.getTime() || 0;
      const db =
        toDateMaybe(b?.completedAt || b?.resolvedAt || b?.recordedAt)?.getTime() || 0;
      return db - da;
    });
  }, [vehicle]);

  const paperworkRows = useMemo(() => {
    if (!vehicle) return [];

    return [
      ["V5 status", vehicle.v5Present || vehicle.v5Status],
      ["V5 reference", vehicle.v5Reference],
      ["Certificates", vehicle.certificatesSummary || vehicle.certificateType],
      ["DVLA status", vehicle.dvlaStatus],
      ["DVLA reference", vehicle.dvlaRef],
      ["DVLA contact", vehicle.dvlaContact],
      ["DVLA notes", vehicle.dvlaNotes || vehicle.dlvaNotes],
      ["Warranty", vehicle.warranty || vehicle.warrantyProvider],
      [
        "Warranty expiry",
        vehicle.warrantyExpiry ? formatDateShort(vehicle.warrantyExpiry) : "",
      ],
    ].filter(([, value]) => hasMeaningfulValue(value));
  }, [vehicle]);

  const hasPaperworkFiles =
    Array.isArray(vehicle?.v5Files) && vehicle.v5Files.length > 0 ||
    Array.isArray(vehicle?.dvlaFiles) && vehicle.dvlaFiles.length > 0;
  const hasPaperwork = paperworkRows.length > 0 || hasPaperworkFiles;
  const hasMaintenanceStatusPills =
    activeForMaintenance &&
    ((!!motStatus && motStatus.code !== "unknown") ||
      (!!serviceStatus && serviceStatus.code !== "unknown"));
  const preChecksText =
    (typeof vehicle?.preChecksSummary === "string" && vehicle.preChecksSummary) ||
    (typeof vehicle?.preChecksNotes === "string" && vehicle.preChecksNotes) ||
    (typeof vehicle?.preChecks === "string" && vehicle.preChecks) ||
    "";
  const hasPreChecks =
    !!preChecksText ||
    (Array.isArray(vehicle?.preChecksFiles) && vehicle.preChecksFiles.length > 0);
  const hasVehicleNotes = !!String(vehicle?.notes || "").trim();

  /* ---------- ACTION HANDLERS ---------- */

  const handleStartFullService = async () => {
    if (!vehicle) return;

    const nextServiceRaw = getVehicleNextService(vehicle);

    const days = daysUntilDate(nextServiceRaw);

    const proceed = async () => {
      try {
        const raw = await AsyncStorage.getItem(SERVICE_DRAFTS_KEY);
        const allDrafts = raw ? JSON.parse(raw) || {} : {};

        const existingEntry = Object.entries(allDrafts).find(
          ([, draft]) => draft.selectedVehicleId === vehicle.id
        );

        if (existingEntry) {
          const [existingId] = existingEntry;
          router.push(`/service/service-form/${existingId}`);
          return;
        }

        const formId = `svc-${vehicle.id}-${Date.now()}`;

        const newDraft = {
          selectedVehicleId: vehicle.id,
          vehicleName: getVehicleName(vehicle) || "",
          registration: getVehicleRegistration(vehicle) || "",
          serviceType: "Full service",
          serviceDate: undefined,
          serviceTime: undefined,
          odometer: "",
          workSummary: "",
          partsUsed: "",
          extraNotes: "",
          signedBy: "",
          checks: {},
          checkRatings: {},
          checkNA: {},
          photoURIs: [],
        };

        allDrafts[formId] = newDraft;
        await AsyncStorage.setItem(
          SERVICE_DRAFTS_KEY,
          JSON.stringify(allDrafts)
        );

        router.push(`/service/service-form/${formId}`);
      } catch (err) {
        console.error("Failed to start full service form:", err);
      }
    };

    if (days !== null && days > 30) {
      Alert.alert(
        "Service not due yet",
        `This vehicle is not due a service for ${days} days. Are you sure you want to start a full service?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Start anyway", style: "destructive", onPress: proceed },
        ]
      );
    } else {
      proceed();
    }
  };

  const handleStartMinorService = async () => {
    if (!vehicle) return;

    try {
      const raw = await AsyncStorage.getItem(MINOR_SERVICE_DRAFTS_KEY);
      const allDrafts = raw ? JSON.parse(raw) || {} : {};

      const existingEntry = Object.entries(allDrafts).find(
        ([, draft]) => draft.selectedVehicleId === vehicle.id
      );

      if (existingEntry) {
        const [existingId] = existingEntry;
        router.push(`/service/minor-service/${existingId}`);
        return;
      }

      const formId = `minor-${vehicle.id}-${Date.now()}`;

      const newDraft = {
        selectedVehicleId: vehicle.id,
        vehicleName: getVehicleName(vehicle) || "",
        registration: getVehicleRegistration(vehicle) || "",
        serviceType: "Interim / minor service",
        serviceDate: undefined,
        serviceTime: undefined,
        odometer: "",
        workSummary: "",
        partsUsed: "",
        extraNotes: "",
        signedBy: "",
        checks: {},
        checkRatings: {},
        checkNA: {},
        photoURIs: [],
      };

      allDrafts[formId] = newDraft;
      await AsyncStorage.setItem(
        MINOR_SERVICE_DRAFTS_KEY,
        JSON.stringify(allDrafts)
      );

      router.push(`/service/minor-service/${formId}`);
    } catch (err) {
      console.error("Failed to start minor service form:", err);
    }
  };

  const handleViewAllServiceHistory = () => {
    if (!vehicle) return;
    router.push({
      pathname: "/service/service-history/[vehicleId]",
      params: {
        vehicleId: vehicle.id,
        name: getVehicleName(vehicle) || "",
        registration: getVehicleRegistration(vehicle) || "",
      },
    });
  };

  const handleViewTimeline = () => {
    if (!vehicle) return;
    router.push({
      pathname: "/service/vehicle-timeline/[id]",
      params: {
        id: vehicle.id,
        name: getVehicleName(vehicle) || "",
        registration: getVehicleRegistration(vehicle) || "",
      },
    });
  };

  const handleSetMaintenanceStatus = async (nextStatus) => {
    if (!vehicle?.id || savingStatus) return;

    const nextActive = nextStatus === "Active";
    const update = {
      operationalStatus: nextStatus,
      fleetStatus: nextStatus,
      vehicleStatus: nextStatus,
      active: nextActive,
      inactive: !nextActive,
      updatedAt: serverTimestamp(),
    };

    setSavingStatus(true);
    try {
      await updateDoc(doc(db, "vehicles", String(vehicle.id)), update);
      await patchServiceRow("vehicles", vehicle.id, update);
      setVehicle((prev) => (prev ? { ...prev, ...update } : prev));
    } catch (err) {
      console.error("Failed to update vehicle maintenance status:", err);
      Alert.alert("Could not update status", "Please try again.");
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Icon
            name="chevron-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.title,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Vehicle overview
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Snapshot of maintenance, status and notes.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primaryAction} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading vehicle…
          </Text>
        </View>
      ) : !vehicle ? (
        <View style={styles.loadingContainer}>
          <Text
            style={[
              styles.loadingText,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Vehicle not found.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* OVERVIEW CARD */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View style={styles.overviewHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.mainName,
                    { color: colors.text || COLORS.textHigh },
                  ]}
                >
                  {getVehicleName(vehicle) || "Unnamed vehicle"}
                </Text>

                {!!getVehicleRegistration(vehicle) && (
                  <Text
                    style={[
                      styles.reg,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {getVehicleRegistration(vehicle)}
                  </Text>
                )}

                {(getVehicleManufacturer(vehicle) || vehicle.model) && (
                  <Text
                    style={[
                      styles.sub,
                      { color: colors.textMuted || COLORS.textLow },
                    ]}
                  >
                    {getVehicleManufacturer(vehicle)}
                    {getVehicleManufacturer(vehicle) && vehicle.model ? " · " : ""}
                    {vehicle.model}
                  </Text>
                )}
              </View>

              <View style={{ alignItems: "flex-end" }}>
                {vehicle.category && (
                  <View style={styles.chip}>
                    <Icon
                      name="truck"
                      size={12}
                      color={COLORS.textMid}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.chipText}>{vehicle.category}</Text>
                  </View>
                )}
                <View style={[styles.chip, { marginTop: 6 }]}>
                  <Icon
                    name="activity"
                    size={12}
                    color={COLORS.textMid}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.chipText}>{mileageDisplay}</Text>
                </View>
              </View>
            </View>
          </View>

          <View
            style={[
              styles.statusControlCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.statusControlTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Maintenance status
              </Text>
              <Text
                style={[
                  styles.statusControlSub,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                {operationalStatus}: {activeForMaintenance
                  ? "Active vehicles appear in MOT and service attention."
                  : "Inactive vehicles are hidden from MOT and service attention."}
              </Text>
            </View>

            <View style={styles.statusToggle}>
              {["Active", "Inactive"].map((option) => {
                const selected =
                  option === "Active" ? activeForMaintenance : !activeForMaintenance;
                return (
                  <TouchableOpacity
                    key={option}
                    style={[
                      styles.statusToggleButton,
                      selected && styles.statusToggleButtonActive,
                    ]}
                    onPress={() => handleSetMaintenanceStatus(option)}
                    disabled={savingStatus || selected}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.statusToggleText,
                        selected && styles.statusToggleTextActive,
                      ]}
                    >
                      {option}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.timelineButton,
              {
                borderColor: colors.border || COLORS.border,
                backgroundColor: colors.surfaceAlt || COLORS.card,
              },
            ]}
            activeOpacity={0.9}
            onPress={handleViewTimeline}
          >
            <View style={styles.timelineIconWrap}>
              <Icon name="clock" size={18} color={COLORS.textHigh} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.timelineButtonTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                View full timeline
              </Text>
              <Text
                style={[
                  styles.timelineButtonSub,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Services, repairs, defects, MOT checks and prep history
              </Text>
            </View>
            <Icon
              name="chevron-right"
              size={18}
              color={colors.textMuted || COLORS.textMid}
            />
          </TouchableOpacity>

          {/* QUICK ACTIONS – SERVICE BUTTONS */}
          <SectionHeader label="Quick maintenance actions" colors={colors} />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Text
              style={[
                styles.actionsHint,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Start a service form for this vehicle. If a draft already exists,
              we’ll open it.
            </Text>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionButton, styles.actionFull]}
                activeOpacity={0.9}
                onPress={handleStartFullService}
              >
                <Icon
                  name="tool"
                  size={16}
                  color={COLORS.textHigh}
                  style={{ marginRight: 6 }}
                />
                <View>
                  <Text style={styles.actionLabel}>Full service</Text>
                  <Text style={styles.actionSub}>
                    Full checklist, parts & notes
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, styles.actionMinor]}
                activeOpacity={0.9}
                onPress={handleStartMinorService}
              >
                <Icon
                  name="refresh-ccw"
                  size={16}
                  color={COLORS.textHigh}
                  style={{ marginRight: 6 }}
                />
                <View>
                  <Text style={styles.actionLabel}>Minor / interim</Text>
                  <Text style={styles.actionSub}>
                    Oil, filters & safety checks
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* MAINTENANCE SECTION */}
          <SectionHeader label="Maintenance" colors={colors} />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            {hasMaintenanceStatusPills && (
              <>
                <View style={styles.statusRow}>
                  <StatusPill label="MOT" status={motStatus} />
                  <StatusPill label="Service" status={serviceStatus} />
                </View>

                <View style={styles.divider} />
              </>
            )}

            <Field
              label="Last MOT"
              value={getVehicleLastMot(vehicle) || "—"}
              colors={colors}
            />
            <Field
              label="Next MOT"
              value={isVehicleMotApplicable(vehicle) ? getVehicleNextMot(vehicle) || "—" : "N/A"}
              colors={colors}
            />
            <Field
              label="Last service"
              value={getVehicleLastService(vehicle) || "—"}
              colors={colors}
            />
            <Field
              label="Next service"
              value={isVehicleServiceApplicable(vehicle) ? getVehicleNextService(vehicle) || "—" : "N/A"}
              colors={colors}
            />
          </View>

          {/* SERVICE HISTORY */}
          <SectionHeader label="Service history" colors={colors} />

          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <TouchableOpacity
              onPress={handleViewAllServiceHistory}
              style={styles.viewAllButton}
              activeOpacity={0.9}
            >
              <Icon
                name="list"
                size={16}
                color={COLORS.textHigh}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.viewAllButtonText}>
                View all service history
              </Text>
            </TouchableOpacity>

            {(serviceHistorySummary || serviceHistory.length > 0) && (
              <>
                {serviceHistorySummary && (
                  <Text
                    style={[
                      styles.notesText,
                      {
                        marginBottom: 8,
                        color: colors.textMuted || COLORS.textMid,
                      },
                    ]}
                  >
                    {serviceHistorySummary}
                  </Text>
                )}
                {serviceHistory.map((item, index) => {
                  const dateValue =
                    item?.completedDate || item?.date || item?.recordedAt;
                  const dateLabel = dateValue
                    ? formatDateShort(dateValue)
                    : "No date";
                  const odoLabel =
                    typeof item?.odometer === "number"
                      ? `${item.odometer.toLocaleString("en-GB")} mi`
                      : item?.odometer || null;
                  const summaryText = item?.summary || item?.notes;

                  return (
                    <View key={index} style={styles.historyItem}>
                      <View style={styles.historyHeaderRow}>
                        <Text
                          style={[
                            styles.historyTitle,
                            { color: colors.text || COLORS.textHigh },
                          ]}
                        >
                          {item?.type || "Service"}
                        </Text>
                        <Text
                          style={[
                            styles.historyMeta,
                            { color: colors.textMuted || COLORS.textLow },
                          ]}
                        >
                          {dateLabel}
                          {odoLabel ? ` · ${odoLabel}` : ""}
                        </Text>
                      </View>
                      {!!summaryText && (
                        <Text
                          style={[
                            styles.historySummary,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                          numberOfLines={2}
                        >
                          {summaryText}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </>
            )}

            <AttachmentList
              label="Service history files"
              files={vehicle.serviceHistoryFiles}
              colors={colors}
            />
          </View>

          {/* REPAIR HISTORY */}
          {repairHistory.length > 0 && (
            <>
              <SectionHeader label="Repair history" colors={colors} />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                {repairHistory.slice(0, 5).map((item, index) => {
                const dateValue =
                  item?.completedDate || item?.date || item?.recordedAt;
                const dateLabel = dateValue
                  ? formatDateShort(dateValue)
                  : "No date";
                const odoLabel =
                  typeof item?.odometer === "number"
                    ? `${item.odometer.toLocaleString("en-GB")} mi`
                    : item?.odometer || null;
                const summaryText =
                  item?.summary ||
                  item?.repairSummary ||
                  item?.notes ||
                  item?.reason ||
                  "";
                const partsText = item?.partsUsed ? `Parts: ${item.partsUsed}` : "";

                return (
                  <View
                    key={`${item?.repairRecordId || item?.serviceRecordId || index}-${index}`}
                    style={styles.historyItem}
                  >
                    <View style={styles.historyHeaderRow}>
                      <Text
                        style={[
                          styles.historyTitle,
                          { color: colors.text || COLORS.textHigh },
                        ]}
                      >
                        {item?.type || "General repair"}
                      </Text>
                      <Text
                        style={[
                          styles.historyMeta,
                          { color: colors.textMuted || COLORS.textLow },
                        ]}
                      >
                        {dateLabel}
                        {odoLabel ? ` · ${odoLabel}` : ""}
                      </Text>
                    </View>
                    {!!summaryText && (
                      <Text
                        style={[
                          styles.historySummary,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                        numberOfLines={2}
                      >
                        {summaryText}
                      </Text>
                    )}
                    {!!partsText && (
                      <Text
                        style={[
                          styles.historySummary,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                        numberOfLines={2}
                      >
                        {partsText}
                      </Text>
                    )}
                  </View>
                );
                })}
              </View>
            </>
          )}

          {/* DEFECT HISTORY */}
          <SectionHeader label="Defect history" colors={colors} />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            {defectHistory.length > 0 ? (
              defectHistory.slice(0, 5).map((item, index) => {
                const dateValue =
                  item?.completedAt || item?.resolvedAt || item?.recordedAt;
                const dateLabel = dateValue
                  ? formatDateShort(dateValue)
                  : "No date";
                const category =
                  item?.category === "immediate" ? "Immediate" : "General";
                const summaryText =
                  item?.completionNote ||
                  item?.description ||
                  item?.notes ||
                  item?.sourceLabel ||
                  "";

                return (
                  <TouchableOpacity
                    key={`${item?.sourceDocId || index}-${index}`}
                    style={styles.historyItem}
                    activeOpacity={0.85}
                    onPress={() => {
                      router.push(
                        `/service/resolved-defects/${buildResolvedDefectRouteId(
                          vehicle.id,
                          item.historyIndex
                        )}`
                      );
                    }}
                  >
                    <View style={styles.historyHeaderRow}>
                      <Text
                        style={[
                          styles.historyTitle,
                          { color: colors.text || COLORS.textHigh },
                        ]}
                      >
                        {item?.title || "Resolved defect"}
                      </Text>
                      <Text
                        style={[
                          styles.historyMeta,
                          { color: colors.textMuted || COLORS.textLow },
                        ]}
                      >
                        {category} · {dateLabel}
                      </Text>
                    </View>
                    {!!summaryText && (
                        <Text
                          style={[
                            styles.historySummary,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                          numberOfLines={2}
                        >
                          {summaryText}
                        </Text>
                      )}
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text
                style={[
                  styles.notesText,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                No completed defects recorded for this vehicle.
              </Text>
            )}
          </View>

          {/* PRE-CHECKS / DAILY INSPECTIONS */}
          {hasPreChecks && (
            <>
              <SectionHeader
                label="Pre-checks & daily inspections"
                colors={colors}
              />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                {!!preChecksText && (
                  <Text
                    style={[
                      styles.notesText,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {preChecksText}
                  </Text>
                )}

                <AttachmentList
                  label="Pre-checks attachments"
                  files={vehicle.preChecksFiles}
                  colors={colors}
                />
              </View>
            </>
          )}

          {/* PAPERWORK / CERTIFICATES / V5 / DVLA / WARRANTY */}
          {hasPaperwork && (
            <>
              <SectionHeader label="Paperwork & certificates" colors={colors} />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                {paperworkRows.map(([label, value]) => (
                  <Field key={label} label={label} value={value} colors={colors} />
                ))}

                <AttachmentList
                  label="V5 & certificate files"
                  files={vehicle.v5Files}
                  colors={colors}
                />
                <AttachmentList
                  label="DVLA paperwork files"
                  files={vehicle.dvlaFiles}
                  colors={colors}
                />
              </View>
            </>
          )}

          {/* LORRY-ONLY: INSPECTIONS + TACHO CALIBRATION */}
          {isLorry && (
            <>
              <SectionHeader label="Lorry inspections & tacho" colors={colors} />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                <Field
                  label="Inspection interval (weeks)"
                  value={
                    typeof vehicle.lorryInspectionFreq === "number"
                      ? String(vehicle.lorryInspectionFreq)
                      : vehicle.lorryInspectionFreq ||
                        (typeof vehicle.inspectionIntervalWeeks === "number"
                          ? String(vehicle.inspectionIntervalWeeks)
                          : vehicle.inspectionIntervalWeeks || "—")
                  }
                  colors={colors}
                />
                <Field
                  label="Last inspection"
                  value={
                    vehicle.lastLorryInspection
                      ? formatDateShort(vehicle.lastLorryInspection)
                      : vehicle.lastInspectionDate
                      ? formatDateShort(vehicle.lastInspectionDate)
                      : "—"
                  }
                  colors={colors}
                />
                <Field
                  label="Next inspection"
                  value={
                    vehicle.nextLorryInspection
                      ? formatDateShort(vehicle.nextLorryInspection)
                      : vehicle.nextInspectionDate
                      ? formatDateShort(vehicle.nextInspectionDate)
                      : "—"
                  }
                  colors={colors}
                />

                <View style={styles.divider} />

                <Field
                  label="Last tacho calibration"
                  value={
                    vehicle.lastTachoCalibration
                      ? formatDateShort(vehicle.lastTachoCalibration)
                      : vehicle.tachoLastCalibration
                      ? formatDateShort(vehicle.tachoLastCalibration)
                      : "—"
                  }
                  colors={colors}
                />
                <Field
                  label="Next tacho calibration"
                  value={
                    vehicle.nextTachoCalibration
                      ? formatDateShort(vehicle.nextTachoCalibration)
                      : vehicle.tachoNextCalibration
                      ? formatDateShort(vehicle.tachoNextCalibration)
                      : "—"
                  }
                  colors={colors}
                />

                <AttachmentList
                  label="Tacho calibration files"
                  files={vehicle.tachoCalibrationFiles}
                  colors={colors}
                />
                <AttachmentList
                  label="Lorry inspection files"
                  files={vehicle.lorryInspectionFiles}
                  colors={colors}
                />
              </View>
            </>
          )}

          {/* STATUS SECTION */}
          <SectionHeader label="Status & compliance" colors={colors} />
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Field label="Tax status" value={taxStatus} colors={colors} />
            <Field
              label="Insurance status"
              value={insuranceStatus}
              colors={colors}
            />
            <Field
              label="Insurance expiry"
              value={insuranceExpiry ? formatDateShort(insuranceExpiry) : "—"}
              colors={colors}
            />
            <Field
              label="MOT frequency (weeks)"
              value={
                typeof vehicle.motFreq === "number"
                  ? String(vehicle.motFreq)
                  : vehicle.motFreq || "—"
              }
              colors={colors}
            />
          </View>

          {/* NOTES SECTION */}
          {hasVehicleNotes && (
            <>
              <SectionHeader label="Notes" colors={colors} />
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.notesText,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  {vehicle.notes}
                </Text>
              </View>
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function SectionHeader({ label, colors }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Text
        style={[
          styles.sectionTitle,
          { color: colors?.text || COLORS.textHigh },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function Field({ label, value, colors }) {
  const display = formatFieldValue(value);

  return (
    <View style={styles.fieldRow}>
      <Text
        style={[
          styles.fieldLabel,
          { color: colors?.textMuted || COLORS.textLow },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.fieldValue,
          { color: colors?.textMuted || COLORS.textMid },
        ]}
      >
        {display}
      </Text>
    </View>
  );
}

function StatusPill({ label, status }) {
  if (!status) return null;

  const code = status.code;
  if (code === "unknown") return null;

  let bg = "rgba(74,74,74,0.7)";
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
  }

  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillText, { color: fg }]}>
        {label}: {status.display}
      </Text>
    </View>
  );
}

function AttachmentList({ label, files, colors }) {
  const list = Array.isArray(files) ? files : [];
  const router = useRouter();

  if (!list.length) return null;

  const handlePress = (file) => {
    if (!file?.url) return;

    router.push({
      pathname: "/service/vehicles/file-viewer",
      params: {
        url: file.url,
        name: file.name || "",
      },
    });
  };

  return (
    <View style={{ marginTop: 12 }}>
      <Text
        style={[
          styles.attachmentsLabel,
          { color: colors?.textMuted || COLORS.textLow },
        ]}
      >
        {label}
      </Text>
      {list.map((file, idx) => (
        <TouchableOpacity
          key={`${file.url || idx}`}
          style={[
            styles.attachmentButton,
            {
              backgroundColor: colors?.surfaceAlt || "#191919",
              borderColor: colors?.border || COLORS.border,
            },
          ]}
          onPress={() => handlePress(file)}
          activeOpacity={0.85}
        >
          <View style={styles.attachmentIconWrap}>
            <Icon name="file-text" size={16} color={COLORS.textHigh} />
          </View>

          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.attachmentName,
                { color: colors?.text || COLORS.textHigh },
              ]}
              numberOfLines={1}
            >
              {file.name || `File ${idx + 1}`}
            </Text>
            <Text
              style={[
                styles.attachmentSub,
                { color: colors?.textMuted || COLORS.textLow },
              ]}
            >
              Tap to open
            </Text>
          </View>

          <Icon
            name="chevron-right"
            size={16}
            color={colors?.textMuted || COLORS.textMid}
            style={styles.attachmentChevron}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

/* ---------- STYLES ---------- */

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
  title: {
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
    color: COLORS.textMid,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textMid,
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  overviewHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  mainName: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  reg: {
    marginTop: 4,
    fontSize: 14,
    color: COLORS.textMid,
  },
  sub: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textLow,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.chipBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 11,
    color: COLORS.textMid,
    fontWeight: "600",
  },
  statusControlCard: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statusControlTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  statusControlSub: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  statusToggle: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 999,
    backgroundColor: "rgba(100,116,139,0.14)",
  },
  statusToggleButton: {
    minWidth: 72,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    paddingHorizontal: 10,
  },
  statusToggleButtonActive: {
    backgroundColor: COLORS.primaryAction,
  },
  statusToggleText: {
    fontSize: 12,
    fontWeight: "800",
    color: COLORS.textLow,
  },
  statusToggleTextActive: {
    color: COLORS.textHigh,
  },
  sectionHeaderRow: {
    marginTop: 6,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  fieldLabel: {
    fontSize: 13,
    color: COLORS.textLow,
  },
  fieldValue: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  notesText: {
    fontSize: 13,
    color: COLORS.textMid,
    lineHeight: 18,
    marginTop: 6,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 8,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 8,
    opacity: 0.6,
  },

  /* ACTIONS */
  actionsHint: {
    fontSize: 12,
    color: COLORS.textMid,
    marginBottom: 10,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  actionButton: {
    flex: 1,
    minWidth: "48%",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  actionFull: {
    backgroundColor: COLORS.primaryAction,
  },
  actionMinor: {
    backgroundColor: "#444",
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  actionSub: {
    fontSize: 11,
    color: COLORS.textMid,
    marginTop: 1,
  },
  timelineButton: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  timelineIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: COLORS.primaryAction,
  },
  timelineButtonTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  timelineButtonSub: {
    marginTop: 2,
    fontSize: 12,
  },

  /* SERVICE HISTORY LIST */
  historyItem: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.03)",
  },
  historyHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  historyMeta: {
    fontSize: 11,
    color: COLORS.textLow,
  },
  historySummary: {
    fontSize: 12,
    color: COLORS.textMid,
  },

  /* FULL-WIDTH VIEW ALL BUTTON */
  viewAllButton: {
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#191919",
  },
  viewAllButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textHigh,
  },

  /* ATTACHMENTS */
  attachmentsLabel: {
    marginTop: 12,
    marginBottom: 4,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textLow,
  },
  attachmentButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#191919",
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 6,
  },
  attachmentIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.chipBg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  attachmentName: {
    fontSize: 13,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  attachmentSub: {
    fontSize: 11,
    color: COLORS.textLow,
    marginTop: 1,
  },
  attachmentChevron: {
    marginLeft: 8,
  },
});
