// app/(protected)/service/service-record/[id].jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteDoc, deleteField, doc, getDoc, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { db } from "../../../../firebaseConfig";
import { useServiceCacheActions, useServiceCollection } from "../../../../hooks/useServiceData";
import { useTheme } from "../../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  chipBg: "#262626",
  primaryAction: "#ED1C25",
};

const CHECK_STATUS_META = {
  green: { label: "Green", color: "#22C55E" },
  amber: { label: "Amber", color: "#F59E0B" },
  red: { label: "Red", color: "#EF4444" },
};

const WHEEL_POSITIONS = [
  { key: "frontLeft", label: "Front left", shortLabel: "FL" },
  { key: "frontRight", label: "Front right", shortLabel: "FR" },
  { key: "rearLeft", label: "Rear left", shortLabel: "RL" },
  { key: "rearRight", label: "Rear right", shortLabel: "RR" },
];

const DEFECT_ACTION_LABELS = {
  repaired: "Repaired",
  replaced: "Replaced",
  not_repaired: "Not repaired",
};

function normalizeCheckStatus(value) {
  if (typeof value === "string") {
    const status = value.trim().toLowerCase();
    if (CHECK_STATUS_META[status]) return status;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 4) return "green";
    if (value >= 2) return "amber";
    return "red";
  }

  return "";
}

function normalizeWheelInspection(value) {
  return WHEEL_POSITIONS.reduce((acc, wheel) => {
    const source = value?.[wheel.key] || {};
    acc[wheel.key] = {
      tread: source.tread !== undefined && source.tread !== null ? String(source.tread) : "",
      pressure:
        source.pressure !== undefined && source.pressure !== null ? String(source.pressure) : "",
      brakeWear:
        source.brakeWear !== undefined && source.brakeWear !== null
          ? String(source.brakeWear)
          : "",
      note: source.note !== undefined && source.note !== null ? String(source.note) : "",
    };
    return acc;
  }, {});
}

function hasWheelInspectionData(value) {
  return WHEEL_POSITIONS.some((wheel) => {
    const item = value?.[wheel.key] || {};
    return ["tread", "pressure", "brakeWear", "note"].some((field) =>
      String(item[field] || "").trim()
    );
  });
}

function parseMetricNumber(value) {
  const cleaned = String(value || "").replace(/[^\d.]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTreadStatus(value) {
  const tread = parseMetricNumber(value);
  if (tread === null) return "";
  if (tread >= 4) return "green";
  if (tread >= 2) return "amber";
  return "red";
}

function getBrakeWearStatus(value) {
  const wear = parseMetricNumber(value);
  if (wear === null) return "";
  if (wear < 60) return "green";
  if (wear < 80) return "amber";
  return "red";
}

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

function formatDateLong(value) {
  const d = toDateMaybe(value);
  if (!d) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

export default function ServiceRecordViewScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const { removeServiceRow } = useServiceCacheActions();
  const recordsResource = useServiceCollection("serviceRecords");

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    setRecord(
      recordsResource.data.find((row) => String(row.id) === String(id)) || null
    );
    setLoading(recordsResource.isInitialLoading);
  }, [id, recordsResource.data, recordsResource.isInitialLoading]);

  const title = record?.serviceType || "Service record";
  const vehicleName = record?.vehicleName || "Vehicle";
  const reg = record?.registration || "";
  const serviceFormNumber = record?.serviceFormNumber || "";
  const wheelInspection = normalizeWheelInspection(record?.wheelInspection);
  const hasWheelInspection = hasWheelInspectionData(wheelInspection);
  const serviceDefectActions = record?.serviceDefectActions || {};
  const serviceDefectActionList = Object.values(serviceDefectActions).filter(
    (item) => item?.title
  );
  const monitorReport = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
  const serviceDateDisplay =
    record?.serviceDate ||
    record?.serviceDateOnly ||
    record?.createdAt ||
    null;

  const fullDate = formatDateLong(serviceDateDisplay);

  // ---- Build full checklist items from stored maps -----------------
  const checklistItems = useMemo(() => {
    if (!record) return [];
    const checks = record.checks || {};
    const ratings = record.checkRatings || {};
    const na = record.checkNA || {};
    const notes = record.checkNotes || {};
    const checkPhotoURIs = record.checkPhotoURIs || record.checkPhotoURLs || {};

    const labelsSet = new Set([
      ...Object.keys(checks),
      ...Object.keys(ratings),
      ...Object.keys(na),
      ...Object.keys(notes),
      ...Object.keys(checkPhotoURIs),
    ]);

    return Array.from(labelsSet)
      .sort((a, b) => a.localeCompare(b))
      .map((label) => {
        const photosForLabel = checkPhotoURIs[label];
        return {
          label,
          checked: !!checks[label],
          rating: ratings[label] ?? null,
          status: normalizeCheckStatus(ratings[label]),
          na: !!na[label],
          note: typeof notes[label] === "string" ? notes[label] : "",
          photos: Array.isArray(photosForLabel) ? photosForLabel : [],
        };
      });
  }, [record]);

  const handleDeleteRecord = () => {
    if (!record?.id) return;

    Alert.alert(
      "Delete service record?",
      "This will permanently delete this record from the service history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const recordId = String(record.id);

              if (record.vehicleId) {
                const vehicleRef = doc(db, "vehicles", String(record.vehicleId));
                const vehicleSnap = await getDoc(vehicleRef);

                if (vehicleSnap.exists()) {
                  const vehicle = vehicleSnap.data() || {};
                  const updatePayload = {};

                  if (Array.isArray(vehicle.serviceHistory)) {
                    updatePayload.serviceHistory = vehicle.serviceHistory.filter(
                      (item) =>
                        item?.serviceRecordId !== recordId &&
                        item?.repairRecordId !== recordId
                    );
                  }

                  if (Array.isArray(vehicle.repairHistory)) {
                    updatePayload.repairHistory = vehicle.repairHistory.filter(
                      (item) =>
                        item?.serviceRecordId !== recordId &&
                        item?.repairRecordId !== recordId
                    );
                  }

                  if (vehicle.lastRepair?.serviceRecordId === recordId) {
                    updatePayload.lastRepair = deleteField();
                  }

                  if (Object.keys(updatePayload).length > 0) {
                    await updateDoc(vehicleRef, updatePayload);
                  }
                }
              }

              await deleteDoc(doc(db, "serviceRecords", recordId));
              await removeServiceRow("serviceRecords", recordId);

              Alert.alert("Deleted", "The service record has been deleted.", [
                { text: "OK", onPress: () => router.back() },
              ]);
            } catch (err) {
              console.error("Failed to delete service record:", err);
              Alert.alert("Error", "Could not delete this service record.");
            } finally {
              setDeleting(false);
            }
          },
        },
      ]
    );
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
          <Feather
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
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
            numberOfLines={1}
          >
            {reg}
            {reg && vehicleName ? " · " : ""}
            {vehicleName}
          </Text>
        </View>
        {record && (
          <TouchableOpacity
            style={[
              styles.editButton,
              {
                backgroundColor: colors.surfaceAlt || COLORS.chipBg,
                borderColor: colors.border || COLORS.border,
              },
            ]}
            onPress={() =>
              router.push({
                pathname: "/service/service-form/[id]",
                params: {
                  id: `edit-${record.id}`,
                  recordId: record.id,
                },
              })
            }
            activeOpacity={0.85}
          >
            <Feather name="edit-3" size={15} color={colors.text || COLORS.textHigh} />
            <Text style={[styles.editButtonText, { color: colors.text || COLORS.textHigh }]}>
              Edit
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={colors.textMuted || COLORS.textMid}
          />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading service record…
          </Text>
        </View>
      ) : !record ? (
        <View style={styles.loadingContainer}>
          <Text
            style={[
              styles.loadingText,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service record not found.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* SUMMARY CARD */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View className="summaryHeader" style={styles.summaryHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.mainTitle, { color: colors.text || COLORS.textHigh }]}>
                  {title}
                </Text>
                {!!fullDate && (
                  <Text style={[styles.summaryMeta, { color: colors.textMuted || COLORS.textMid }]}>
                    {fullDate}
                  </Text>
                )}
              </View>
              {typeof record.odometer === "number" && (
                <View
                  style={[
                    styles.chip,
                    {
                      backgroundColor: colors.surface || COLORS.chipBg,
                      borderColor: colors.border || COLORS.border,
                    },
                  ]}
                >
                  <Feather
                    name="activity"
                    size={12}
                    color={colors.textMuted || COLORS.textMid}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.chipText, { color: colors.textMuted || COLORS.textMid }]}>
                    {record.odometer.toLocaleString("en-GB")} mi
                  </Text>
                </View>
              )}
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border || COLORS.border }]} />

            <Field
              label="Vehicle"
              value={`${vehicleName}${reg ? ` · ${reg}` : ""}`}
            />
            <Field label="Service form no." value={serviceFormNumber || "—"} />
            <Field label="Service type" value={record.serviceType} />
            <Field label="Service date" value={fullDate} />
            <Field
              label="Next service due"
              value={record.nextService || record.nextServiceDate || "—"}
            />
            <Field
              label="Technician"
              value={record.signedBy || "Not recorded"}
            />
          </View>

          {/* WORKSHOP NOTES */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
              Workshop notes
            </Text>
            <NoteField
              label="Work carried out"
              value={record.workSummary || "—"}
            />
            <NoteField label="Parts used" value={record.partsUsed || "—"} />
            <NoteField
              label="Extra notes"
              value={record.extraNotes || "No additional notes."}
            />
          </View>

          {/* TYRES & BRAKES FOOTPRINT */}
          <View
            style={[
              hasWheelInspection ? styles.card : styles.emptyCard,
              {
                backgroundColor: hasWheelInspection
                  ? colors.surfaceAlt || COLORS.card
                  : "transparent",
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
              Tyres & brakes footprint
            </Text>
            {!hasWheelInspection ? (
              <Text style={[styles.checkSummaryText, { color: colors.textMuted || COLORS.textMid }]}>
                No wheel inspection data saved for this service.
              </Text>
            ) : (
              <View style={styles.wheelGrid}>
                {WHEEL_POSITIONS.map((wheel) => {
                  const item = wheelInspection[wheel.key] || {};
                  return (
                    <View
                      key={wheel.key}
                      style={[
                        styles.wheelRecordCard,
                        {
                          backgroundColor: colors.surface || COLORS.card,
                          borderColor: colors.border || COLORS.border,
                        },
                      ]}
                    >
                      <View style={styles.wheelRecordHeader}>
                        <View style={styles.wheelRecordBadge}>
                          <Text style={styles.wheelRecordBadgeText}>{wheel.shortLabel}</Text>
                        </View>
                        <Text style={[styles.wheelRecordTitle, { color: colors.text || COLORS.textHigh }]}>
                          {wheel.label}
                        </Text>
                      </View>
                      <WheelRecordMetric
                        label="Tread"
                        value={item.tread}
                        suffix="mm"
                        status={getTreadStatus(item.tread)}
                      />
                      <WheelRecordMetric label="Pressure" value={item.pressure} suffix="psi" />
                      <WheelRecordMetric
                        label="Brake wear"
                        value={item.brakeWear}
                        suffix="%"
                        status={getBrakeWearStatus(item.brakeWear)}
                      />
                      {item.note ? (
                        <Text
                          style={[
                            styles.wheelRecordNote,
                            {
                              borderTopColor: colors.border || COLORS.border,
                              color: colors.textMuted || COLORS.textMid,
                            },
                          ]}
                        >
                          {item.note}
                        </Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* MONITOR REPORT */}
          {monitorReport.length > 0 && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceAlt || COLORS.card,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
                Monitor report
              </Text>
              {monitorReport.map((item) => (
                <View
                  key={item.key}
                  style={[
                    styles.monitorRecordRow,
                    { borderBottomColor: colors.border || COLORS.border },
                  ]}
                >
                  <View style={styles.monitorRecordBadge}>
                    <Text style={styles.monitorRecordBadgeText}>M</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.monitorRecordTitle, { color: colors.text || COLORS.textHigh }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.monitorRecordDetails, { color: colors.textMuted || COLORS.textLow }]}>
                      {item.details}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* DEFECT ACTIONS */}
          {serviceDefectActionList.length > 0 && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceAlt || COLORS.card,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
                Defect report actions
              </Text>
              {serviceDefectActionList.map((item) => (
                <View
                  key={item.key}
                  style={[
                    styles.defectActionRecordRow,
                    { borderBottomColor: colors.border || COLORS.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.defectActionRecordTitle, { color: colors.text || COLORS.textHigh }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.defectActionRecordMeta, { color: colors.textMuted || COLORS.textLow }]}>
                      {item.value}
                      {item.unit} recorded
                      {item.defectReportId ? ` · Report ${item.defectReportId}` : ""}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.defectActionRecordBadge,
                      { color: colors.textMuted || COLORS.textMid },
                      item.action === "not_repaired" && { color: COLORS.primaryAction },
                    ]}
                  >
                    {DEFECT_ACTION_LABELS[item.action] || "Not marked"}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* FULL CHECKLIST DETAILS */}
          <View
            style={[
              checklistItems.length > 0 ? styles.card : styles.emptyCard,
              {
                backgroundColor: checklistItems.length > 0
                  ? colors.surfaceAlt || COLORS.card
                  : "transparent",
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
              Checklist details
            </Text>
            {checklistItems.length === 0 ? (
              <Text style={[styles.checkSummaryText, { color: colors.textMuted || COLORS.textMid }]}>
                No checklist data saved for this service.
              </Text>
            ) : (
              checklistItems.map((item) => (
                <View
                  key={item.label}
                  style={[
                    styles.checkRowWrapper,
                    { borderBottomColor: colors.border || COLORS.border },
                  ]}
                >
                  {/* Row: tick / N/A / label + status */}
                  <View style={styles.checkRowTop}>
                    {/* Left: icon + label */}
                    <View style={styles.checkLeft}>
                      <View style={styles.checkIconWrap}>
                        {item.na ? (
                          <View style={styles.naIcon}>
                            <Text style={styles.naIconText}>N/A</Text>
                          </View>
                        ) : item.checked ? (
                          <View
                            style={[
                              styles.checkIconFilled,
                              item.status && {
                                backgroundColor: CHECK_STATUS_META[item.status].color,
                              },
                            ]}
                          >
                            <Feather
                              name="check"
                              size={16}
                              color={COLORS.textHigh}
                            />
                          </View>
                        ) : (
                          <View style={styles.checkIconEmpty} />
                        )}
                      </View>
                      <Text style={[styles.checkLabel, { color: colors.textMuted || COLORS.textMid }]}>
                        {item.label}
                      </Text>
                    </View>

                    {/* Right: status */}
                    <View style={styles.checkRight}>
                      {item.na ? (
                        <Text style={[styles.checkRightText, { color: colors.textMuted || COLORS.textLow }]}>
                          N/A
                        </Text>
                      ) : item.status ? (
                        <Text
                          style={[
                            styles.checkRightText,
                            { color: CHECK_STATUS_META[item.status].color },
                          ]}
                        >
                          {CHECK_STATUS_META[item.status].label}
                        </Text>
                      ) : (
                        <Text style={[styles.checkRightText, { color: colors.textMuted || COLORS.textLow }]}>
                          No status
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Note for this check */}
                  {item.note ? (
                    <Text style={[styles.checkNoteText, { color: colors.textMuted || COLORS.textMid }]}>
                      {item.note}
                    </Text>
                  ) : null}

                  {/* Photos for this check */}
                  {Array.isArray(item.photos) && item.photos.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={{ marginTop: 6 }}
                    >
                      {item.photos.map((uri) => (
                        <View
                          key={uri}
                          style={styles.checkPhotoThumbWrapper}
                        >
                          <Image
                            source={{ uri }}
                            style={styles.checkPhotoThumb}
                          />
                        </View>
                      ))}
                    </ScrollView>
                  )}
                </View>
              ))
            )}
          </View>

          {/* PHOTOS — OVERALL */}
          {Array.isArray(record.photoURIs || record.photoURLs) &&
            (record.photoURIs || record.photoURLs).length > 0 && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceAlt || COLORS.card,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
                Photos
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 8 }}
              >
                {(record.photoURIs || record.photoURLs).map((uri) => (
                  <View key={uri} style={styles.photoThumbWrapper}>
                    <Image source={{ uri }} style={styles.photoThumb} />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.deleteButton,
              { borderColor: COLORS.primaryAction },
              deleting && styles.deleteButtonDisabled,
            ]}
            onPress={handleDeleteRecord}
            activeOpacity={0.85}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator
                size="small"
                color={COLORS.primaryAction}
                style={{ marginRight: 8 }}
              />
            ) : (
              <Feather
                name="trash-2"
                size={17}
                color={COLORS.primaryAction}
                style={{ marginRight: 8 }}
              />
            )}
            <Text style={styles.deleteButtonText}>
              {deleting ? "Deleting..." : "Delete service record"}
            </Text>
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* SMALL REUSABLE FIELD */

function Field({ label, value }) {
  const { colors } = useTheme();

  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textLow }]}>
        {label}
      </Text>
      <Text style={[styles.fieldValue, { color: colors.text || COLORS.textMid }]}>
        {formatFieldValue(value)}
      </Text>
    </View>
  );
}

function NoteField({ label, value }) {
  const { colors } = useTheme();

  return (
    <View style={styles.noteField}>
      <Text style={[styles.noteLabel, { color: colors.textMuted || COLORS.textLow }]}>
        {label}
      </Text>
      <Text style={[styles.noteValue, { color: colors.text || COLORS.textMid }]}>
        {formatFieldValue(value)}
      </Text>
    </View>
  );
}

function WheelRecordMetric({ label, value, suffix, status }) {
  const { colors } = useTheme();
  const displayValue = String(value || "").trim();
  const statusMeta = CHECK_STATUS_META[status] || null;

  return (
    <View style={styles.wheelRecordMetric}>
      <View style={styles.wheelRecordMetricLabelRow}>
        <Text style={[styles.wheelRecordMetricLabel, { color: colors.textMuted || COLORS.textLow }]}>
          {label}
        </Text>
        {statusMeta ? (
          <View style={[styles.wheelRecordStatusDot, { backgroundColor: statusMeta.color }]} />
        ) : null}
      </View>
      <Text style={[styles.wheelRecordMetricValue, { color: colors.text || COLORS.textMid }]}>
        {displayValue ? `${displayValue} ${suffix}` : "—"}
      </Text>
    </View>
  );
}

/* STYLES */

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
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginLeft: 8,
  },
  editButtonText: {
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 5,
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
    paddingBottom: 28,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyCard: {
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  mainTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  summaryMeta: {
    fontSize: 12,
    color: COLORS.textMid,
    marginTop: 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    marginLeft: 10,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    opacity: 0.6,
    marginVertical: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 6,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  fieldLabel: {
    fontSize: 12,
    color: COLORS.textLow,
  },
  fieldValue: {
    fontSize: 12,
    color: COLORS.textMid,
    textAlign: "right",
    flex: 1,
    marginLeft: 10,
  },
  noteField: {
    paddingTop: 8,
  },
  noteLabel: {
    fontSize: 12,
    color: COLORS.textLow,
    marginBottom: 3,
  },
  noteValue: {
    fontSize: 13,
    color: COLORS.textMid,
    lineHeight: 18,
    textAlign: "left",
  },
  checkSummaryText: {
    fontSize: 12,
    color: COLORS.textMid,
  },
  wheelGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  wheelRecordCard: {
    width: "48%",
    minWidth: 132,
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    padding: 10,
  },
  wheelRecordHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  wheelRecordBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelRecordBadgeText: {
    color: COLORS.textHigh,
    fontSize: 10,
    fontWeight: "900",
  },
  wheelRecordTitle: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: 12,
    fontWeight: "800",
  },
  wheelRecordMetric: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    paddingVertical: 3,
  },
  wheelRecordMetricLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  wheelRecordMetricLabel: {
    color: COLORS.textLow,
    fontSize: 11,
    fontWeight: "700",
  },
  wheelRecordStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wheelRecordMetricValue: {
    color: COLORS.textMid,
    fontSize: 11,
    fontWeight: "800",
  },
  wheelRecordNote: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    color: COLORS.textMid,
    fontSize: 11,
    lineHeight: 15,
  },
  defectActionRecordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  defectActionRecordTitle: {
    color: COLORS.textHigh,
    fontSize: 12,
    fontWeight: "800",
  },
  defectActionRecordMeta: {
    color: COLORS.textLow,
    fontSize: 11,
    marginTop: 2,
  },
  defectActionRecordBadge: {
    color: COLORS.textMid,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "right",
  },
  monitorRecordRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  monitorRecordBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#F59E0B",
    alignItems: "center",
    justifyContent: "center",
  },
  monitorRecordBadgeText: {
    color: COLORS.textHigh,
    fontSize: 11,
    fontWeight: "900",
  },
  monitorRecordTitle: {
    color: COLORS.textHigh,
    fontSize: 12,
    fontWeight: "800",
  },
  monitorRecordDetails: {
    color: COLORS.textLow,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16,
  },

  /* Checklist details */
  checkRowWrapper: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  checkRowTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 8,
  },
  checkIconWrap: {
    marginRight: 8,
  },
  checkIconEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.textLow,
  },
  checkIconFilled: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  naIcon: {
    minWidth: 32,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.textMid,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    backgroundColor: "rgba(142,142,147,0.15)",
  },
  naIconText: {
    fontSize: 10,
    color: COLORS.textMid,
    fontWeight: "600",
  },
  checkLabel: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textMid,
  },
  checkRight: {
    minWidth: 70,
    alignItems: "flex-end",
  },
  checkRightText: {
    fontSize: 11,
    color: COLORS.textLow,
  },

  checkNoteText: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textMid,
  },

  checkPhotoThumbWrapper: {
    marginRight: 8,
  },
  checkPhotoThumb: {
    width: 70,
    height: 70,
    borderRadius: 8,
  },

  // Overall photos section
  photoThumbWrapper: {
    marginRight: 10,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: 8,
  },
  deleteButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "transparent",
    borderWidth: 1,
    paddingHorizontal: 14,
    marginTop: 10,
  },
  deleteButtonDisabled: {
    opacity: 0.7,
  },
  deleteButtonText: {
    color: COLORS.primaryAction,
    fontSize: 14,
    fontWeight: "800",
  },
});
