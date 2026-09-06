import { AppText as Text, AppPressable as TouchableOpacity } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
// app/(protected)/service/service-record/[id].jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams,
  useRouter } from "expo-router";
import { deleteDoc,
  deleteField,
  doc,
  getDoc,
  updateDoc } from "firebase/firestore";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";


import { db } from "../../../../firebaseConfig";
import { useServiceCacheActions, useServiceCollection } from "../../../../hooks/useServiceData";
import {
  findVehicleRecord,
  getVehicleDisplayName,
  getVehicleRegistration,
} from "../../../../lib/fleetSchema";
import { useTheme } from "../../../../providers/ThemeProvider";
import { staticColors } from "../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../lib/design/tokens";
import PageShell from "../../../../components/layout/PageShell";

const CHECK_STATUS_META = {
  green: { label: "Green", color: staticColors.hex_22c55e_740if4 },
  amber: { label: "Amber", color: staticColors.hex_f59e0b_4zbh7f },
  red: { label: "Red", color: staticColors.hex_ef4444_4oizhh },
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
  const vehiclesResource = useServiceCollection("vehicles");

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
  const matchedVehicle = findVehicleRecord(record, vehiclesResource.data);
  const vehicleName = getVehicleDisplayName(
    matchedVehicle || record,
    vehiclesResource.data
  );
  const reg = getVehicleRegistration(matchedVehicle || record) || "";
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
    <PageShell header={{
      variant: "compact",
      title,
      subtitle: [reg, vehicleName].filter(Boolean).join(" · "),
      onBack: router.back,
      action: record
        ? {
            label: "Edit service record",
            icon: "edit-3",
            onPress: () =>
              router.push({
                pathname: "/service/service-form/[id]",
                params: {
                  id: `edit-${record.id}`,
                  recordId: record.id,
                },
              }),
          }
        : undefined,
    }}>
      {/* HEADER */}
      

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
        <>
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
                    style={{ marginRight: t.spacing.xxs }}
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
                      style={{ marginTop: t.spacing.xxs }}
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
                style={{ marginTop: t.spacing.xs }}
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
                style={{ marginRight: t.spacing.xs }}
              />
            ) : (
              <Feather
                name="trash-2"
                size={17}
                color={COLORS.primaryAction}
                style={{ marginRight: t.spacing.xs }}
              />
            )}
            <Text style={styles.deleteButtonText}>
              {deleting ? "Deleting..." : "Delete service record"}
            </Text>
          </TouchableOpacity>

          <View style={{ height: 24 }} />
        </>
      )}
    </PageShell>
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
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: t.radius.pill,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    marginLeft: t.spacing.xs,
  },
  editButtonText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
    marginLeft: t.spacing.xxs,
  },
  title: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: t.typography.bodySmall.fontSize,
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
    paddingBottom: t.spacing.xl,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyCard: {
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  mainTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  summaryMeta: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    marginLeft: t.spacing.xs,
  },
  chipText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    opacity: 0.6,
    marginVertical: t.spacing.xs,
  },
  sectionTitle: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: t.spacing.xxs,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: t.spacing.xxs,
  },
  fieldLabel: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
  },
  fieldValue: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    textAlign: "right",
    flex: 1,
    marginLeft: t.spacing.xs,
  },
  noteField: {
    paddingTop: t.spacing.xs,
  },
  noteLabel: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textLow,
    marginBottom: t.spacing.xxs,
  },
  noteValue: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
    lineHeight: t.typography.bodySmall.lineHeight,
    textAlign: "left",
  },
  checkSummaryText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  wheelGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  },
  wheelRecordCard: {
    width: "48%",
    minWidth: 132,
    flexGrow: 1,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    padding: t.spacing.xs,
  },
  wheelRecordHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  wheelRecordBadge: {
    width: 26,
    height: 26,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelRecordBadgeText: {
    color: COLORS.textHigh,
    fontSize: t.typography.micro.fontSize,
    fontWeight: "900",
  },
  wheelRecordTitle: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  wheelRecordMetric: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  wheelRecordMetricLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  wheelRecordMetricLabel: {
    color: COLORS.textLow,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  wheelRecordStatusDot: {
    width: 8,
    height: 8,
    borderRadius: t.radius.pill,
  },
  wheelRecordMetricValue: {
    color: COLORS.textMid,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },
  wheelRecordNote: {
    marginTop: t.spacing.xxs,
    paddingTop: t.spacing.xxs,
    borderTopWidth: 1,
    borderTopColor: staticColors.rgba_5ns92s,
    color: COLORS.textMid,
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
  },
  defectActionRecordRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: staticColors.rgba_5ns91z,
  },
  defectActionRecordTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  defectActionRecordMeta: {
    color: COLORS.textLow,
    fontSize: t.typography.caption.fontSize,
    marginTop: t.spacing.none,
  },
  defectActionRecordBadge: {
    color: COLORS.textMid,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
    textAlign: "right",
  },
  monitorRecordRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: staticColors.rgba_5ns91z,
  },
  monitorRecordBadge: {
    width: 26,
    height: 26,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_f59e0b_4zbh7f,
    alignItems: "center",
    justifyContent: "center",
  },
  monitorRecordBadgeText: {
    color: COLORS.textHigh,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },
  monitorRecordTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  monitorRecordDetails: {
    color: COLORS.textLow,
    fontSize: t.typography.caption.fontSize,
    marginTop: t.spacing.none,
    lineHeight: t.typography.caption.lineHeight,
  },

  /* Checklist details */
  checkRowWrapper: {
    paddingVertical: t.spacing.xxs,
    borderBottomWidth: 1,
    borderBottomColor: staticColors.rgba_5ns94m,
  },
  checkRowTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: t.spacing.xs,
  },
  checkIconWrap: {
    marginRight: t.spacing.xs,
  },
  checkIconEmpty: {
    width: 22,
    height: 22,
    borderRadius: t.radius.pill,
    borderWidth: 2,
    borderColor: COLORS.textLow,
  },
  checkIconFilled: {
    width: 22,
    height: 22,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  naIcon: {
    minWidth: 32,
    height: 22,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: COLORS.textMid,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xxs,
    backgroundColor: staticColors.rgba_y8iv92,
  },
  naIconText: {
    fontSize: t.typography.micro.fontSize,
    color: COLORS.textMid,
    fontWeight: "600",
  },
  checkLabel: {
    flex: 1,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  checkRight: {
    minWidth: 70,
    alignItems: "flex-end",
  },
  checkRightText: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
  },

  checkNoteText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  checkPhotoThumbWrapper: {
    marginRight: t.spacing.xs,
  },
  checkPhotoThumb: {
    width: 70,
    height: 70,
    borderRadius: t.radius.sm,
  },

  // Overall photos section
  photoThumbWrapper: {
    marginRight: t.spacing.xs,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: t.radius.sm,
  },
  deleteButton: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: t.radius.md,
    backgroundColor: "transparent",
    borderWidth: 1,
    paddingHorizontal: t.spacing.sm,
    marginTop: t.spacing.xs,
  },
  deleteButtonDisabled: {
    opacity: 0.7,
  },
  deleteButtonText: {
    color: COLORS.primaryAction,
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
  },
});
