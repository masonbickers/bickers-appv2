import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

/* ---------- CONSTANTS ---------- */

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  chipBg: "#262626",
  primaryAction: "#FF3B30",
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

/* ---------- MAIN SCREEN ---------- */

export default function VehicleDetailScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();

  const [vehicle, setVehicle] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      try {
        const ref = doc(db, "vehicles", String(id));
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setVehicle({ id: snap.id, ...snap.data() });
        } else {
          setVehicle(null);
        }
      } catch (err) {
        console.error("Failed to load vehicle detail:", err);
        setVehicle(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const motStatus = useMemo(() => {
    if (!vehicle) return null;
    const raw =
      vehicle.nextMOT ||
      vehicle.nextMot ||
      vehicle.motDueDate ||
      vehicle.motExpiryDate;
    const base = classifyStatus(raw);
    return {
      ...base,
      display: base.label + (raw ? ` · ${formatDateShort(raw)}` : ""),
    };
  }, [vehicle]);

  const serviceStatus = useMemo(() => {
    if (!vehicle) return null;
    const raw =
      vehicle.nextService ||
      vehicle.nextServiceDate ||
      vehicle.serviceDueDate ||
      vehicle.nextSvc;
    const base = classifyStatus(raw);
    return {
      ...base,
      display: base.label + (raw ? ` · ${formatDateShort(raw)}` : ""),
    };
  }, [vehicle]);

  const taxStatus = vehicle?.taxStatus || "Unknown";
  const insuranceStatus = vehicle?.insuranceStatus || "Unknown";
  const mileageDisplay =
    typeof vehicle?.mileage === "number"
      ? `${vehicle.mileage.toLocaleString("en-GB")} mi`
      : vehicle?.mileage || "—";

  const isLorry = useMemo(() => {
    const cat = (vehicle?.category || "").toLowerCase();
    return cat.includes("lorry") || cat.includes("lorries");
  }, [vehicle]);

  // serviceHistory can be an array (old style) or a string summary (new web edit)
  const serviceHistory = useMemo(() => {
    if (Array.isArray(vehicle?.serviceHistory)) {
      return [...vehicle.serviceHistory].sort((a, b) => {
        const da = toDateMaybe(a?.date)?.getTime() || 0;
        const db = toDateMaybe(b?.date)?.getTime() || 0;
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

  /* ---------- ACTION HANDLERS ---------- */

  const handleStartFullService = async () => {
    if (!vehicle) return;

    const nextServiceRaw =
      vehicle.nextService ||
      vehicle.nextServiceDate ||
      vehicle.serviceDueDate ||
      vehicle.nextSvc;

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
          vehicleName: vehicle.name || vehicle.vehicleName || "",
          registration: vehicle.registration || vehicle.reg || "",
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
        vehicleName: vehicle.name || vehicle.vehicleName || "",
        registration: vehicle.registration || vehicle.reg || "",
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
        name: vehicle.name || vehicle.vehicleName || "",
        registration: vehicle.registration || vehicle.reg || "",
      },
    });
  };

  return (
    <SafeAreaView
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
            size={20}
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
                  {vehicle.name || vehicle.vehicleName || "Unnamed vehicle"}
                </Text>

                {!!(vehicle.registration || vehicle.reg) && (
                  <Text
                    style={[
                      styles.reg,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {vehicle.registration || vehicle.reg}
                  </Text>
                )}

                {(vehicle.manufacturer || vehicle.model) && (
                  <Text
                    style={[
                      styles.sub,
                      { color: colors.textMuted || COLORS.textLow },
                    ]}
                  >
                    {vehicle.manufacturer}
                    {vehicle.manufacturer && vehicle.model ? " · " : ""}
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
            <View style={styles.statusRow}>
              <StatusPill label="MOT" status={motStatus} />
              <StatusPill label="Service" status={serviceStatus} />
            </View>

            <View style={styles.divider} />

            <Field
              label="Last MOT"
              value={vehicle.lastMOT || vehicle.lastMot || "—"}
              colors={colors}
            />
            <Field
              label="Next MOT"
              value={
                vehicle.nextMOT ||
                vehicle.nextMot ||
                vehicle.motDueDate ||
                vehicle.motExpiryDate ||
                "—"
              }
              colors={colors}
            />
            <Field
              label="Last service"
              value={vehicle.lastService || "—"}
              colors={colors}
            />
            <Field
              label="Next service"
              value={
                vehicle.nextService ||
                vehicle.nextServiceDate ||
                vehicle.serviceDueDate ||
                "—"
              }
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
                  const dateLabel = item?.date
                    ? formatDateShort(item.date)
                    : "No date";
                  const odoLabel =
                    typeof item?.odometer === "number"
                      ? `${item.odometer.toLocaleString("en-GB")} mi`
                      : item?.odometer || null;

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
                      {!!item?.summary && (
                        <Text
                          style={[
                            styles.historySummary,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          {item.summary}
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

          {/* PRE-CHECKS / DAILY INSPECTIONS */}
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
            <Text
              style={[
                styles.notesText,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              {vehicle.preChecksSummary ||
                vehicle.preChecksNotes ||
                vehicle.preChecks ||
                "No pre-checks or daily inspection notes recorded."}
            </Text>

            <AttachmentList
              label="Pre-checks attachments"
              files={vehicle.preChecksFiles}
              colors={colors}
            />
          </View>

          {/* PAPERWORK / CERTIFICATES / V5 / DVLA / WARRANTY */}
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
            <Field
              label="V5 status"
              value={vehicle.v5Present || vehicle.v5Status || "—"}
              colors={colors}
            />
            <Field
              label="V5 reference"
              value={vehicle.v5Reference || "—"}
              colors={colors}
            />
            <Field
              label="Certificates"
              value={
                vehicle.certificatesSummary ||
                vehicle.certificateType ||
                "—"
              }
              colors={colors}
            />
            <Field
              label="DVLA status"
              value={vehicle.dvlaStatus || "—"}
              colors={colors}
            />
            <Field
              label="DVLA reference"
              value={vehicle.dvlaRef || "—"}
              colors={colors}
            />
            <Field
              label="DVLA contact"
              value={vehicle.dvlaContact || "—"}
              colors={colors}
            />
            <Field
              label="DVLA notes"
              value={vehicle.dvlaNotes || vehicle.dlvaNotes || "—"}
              colors={colors}
            />
            <Field
              label="Warranty"
              value={vehicle.warranty || vehicle.warrantyProvider || "—"}
              colors={colors}
            />
            <Field
              label="Warranty expiry"
              value={
                vehicle.warrantyExpiry
                  ? formatDateShort(vehicle.warrantyExpiry)
                  : "—"
              }
              colors={colors}
            />

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
              {vehicle.notes || "No notes recorded for this vehicle."}
            </Text>
          </View>

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
        {value || "—"}
      </Text>
    </View>
  );
}

function StatusPill({ label, status }) {
  if (!status) return null;

  const code = status.code;
  let bg = "rgba(74,74,74,0.7)";
  let fg = COLORS.textHigh;

  if (code === "overdue") {
    bg = "rgba(255,59,48,0.22)";
    fg = "#FF3B30";
  } else if (code === "due-soon") {
    bg = "rgba(255,149,0,0.22)";
    fg = "#FF9500";
  } else if (code === "ok") {
    bg = "rgba(52,199,89,0.22)";
    fg = "#34C759";
  } else if (code === "unknown") {
    bg = "rgba(142,142,147,0.22)";
    fg = COLORS.textMid;
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
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 12,
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
