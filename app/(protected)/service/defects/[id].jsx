import { AppButton, AppModal, AppText as Text, AppPressable as TouchableOpacity, TextArea } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
import { useLocalSearchParams,
  useRouter } from "expo-router";
import {
  arrayUnion,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  } from "firebase/firestore";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { useServiceCollectionReader } from "../../../../hooks/useServiceData";
import {
  findVehicleRecord,
  getVehicleDisplayName,
  getVehicleRegistration,
} from "../../../../lib/fleetSchema";
import { useTheme } from "../../../../providers/ThemeProvider";
import { staticColors } from "../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../lib/design/tokens";
import PageShell from "../../../../components/layout/PageShell";

function parseRouteId(value) {
  try {
    const decoded = decodeURIComponent(String(value || ""));
    const [source, docId, itemIndexRaw] = decoded.split("|");
    return {
      source,
      docId,
      itemIndex:
        itemIndexRaw !== undefined && itemIndexRaw !== ""
          ? Number(itemIndexRaw)
          : null,
    };
  } catch {
    return { source: "", docId: "", itemIndex: null };
  }
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

function formatDate(value) {
  if (!value) return "";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStatus(value) {
  const status = String(value || "open").trim();
  if (!status) return "Open";
  return status
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getVehicleLabel(record) {
  return (
    record?.vehicle ||
    record?.vehicleName ||
    record?.name ||
    record?.registration ||
    record?.reg ||
    "Unknown vehicle"
  );
}

function getIssueAssetLabel(issue) {
  if (issue?.assetType !== "equipment") return getVehicleLabel(issue);
  return issue?.equipmentName || issue?.assetName || "Unknown equipment";
}

function findVehicleForRecord(record, vehicles) {
  const sharedMatch =
    findVehicleRecord(record, vehicles) ||
    findVehicleRecord(record?.vehicle, vehicles);
  if (sharedMatch) return sharedMatch;

  const recordVehicleId = record?.vehicleId || record?.vehicleDocId;
  if (recordVehicleId) {
    const byId = vehicles.find((v) => v.id === recordVehicleId);
    if (byId) return byId;
  }

  const recordVehicle = normaliseKey(getVehicleLabel(record));
  const recordReg = normaliseKey(record?.registration || record?.reg);

  return vehicles.find((v) => {
    const labels = [
      v.name,
      v.vehicleName,
      v.vehicle,
      v.registration,
      v.reg,
    ].map(normaliseKey);
    return labels.includes(recordVehicle) || (!!recordReg && labels.includes(recordReg));
  });
}

function buildDefectHistoryItem({ source, route, record, defect, completionNote }) {
  return {
    source,
    sourceDocId: route.docId,
    itemIndex: route.itemIndex,
    category: defect.category,
    title: defect.title,
    description: defect.description || "",
    sourceLabel: defect.sourceLabel,
    reporter: defect.reporter || "",
    jobNumber: defect.jobNumber || "",
    completionNote,
    reportedAt:
      record?.createdAt ||
      record?.dateISO ||
      record?.date ||
      null,
    completedAt: new Date(),
    status: "resolved",
  };
}

function getRecordVehicleId(record, matchedVehicle) {
  return matchedVehicle?.id || record?.vehicleId || record?.vehicleDocId || null;
}

function buildCheckDefect(check, item, itemIndex) {
  const label = item?.label || item?.title || item?.category || "Vehicle check";
  const note = item?.note || item?.description || "";

  return {
    sourceLabel: "Vehicle check",
    title: label,
    description: note,
    category: normaliseKey(item?.review?.category),
    status: item?.review?.status || "",
    maintenanceStatus: item?.maintenance?.status || "open",
    vehicleName: getVehicleLabel(check),
    registration: check.registration || check.reg || "",
    reporter: check.driverName || check.reporterName || "",
    jobNumber: check.jobNumber || "",
    dateText: formatDate(check.dateISO || check.createdAt || check.date),
    itemIndex,
  };
}

function buildIssueDefect(issue) {
  const isEquipment = issue?.assetType === "equipment";
  return {
    sourceLabel: isEquipment ? "Equipment issue" : "Vehicle issue",
    title: issue.category || issue.title || "Issue",
    description: issue.description || issue.note || issue.summary || "",
    category: normaliseKey(issue?.review?.category),
    status: issue?.review?.status || "",
    maintenanceStatus: issue?.maintenance?.status || "open",
    vehicleName: getIssueAssetLabel(issue),
    registration: isEquipment
      ? issue.serialNumber || issue.equipmentId || issue.asset || ""
      : issue.registration || issue.reg || "",
    reporter: issue.reporterName || issue.driverName || "",
    jobNumber: issue.jobNumber || "",
    dateText: formatDate(issue.createdAt || issue.dateISO || issue.date),
    itemIndex: null,
  };
}

function buildManualDefect(report) {
  const severity = report.severity || report.priority || "Defect report";
  return {
    sourceLabel: "Defect report",
    title: report.category || report.title || severity,
    description: report.description || report.note || report.summary || report.notes || "",
    category: normaliseKey(severity) === "immediate" || report.offRoad ? "immediate" : "general",
    status: report.status || "open",
    maintenanceStatus: report.status || "open",
    vehicleName: getVehicleLabel(report),
    registration: report.registration || report.reg || "",
    reporter: report.reportedBy || report.reporterName || report.driverName || "",
    jobNumber: report.jobNumber || "",
    dateText: formatDate(report.createdAt || report.dateISO || report.date),
    itemIndex: null,
  };
}

function getDefectCollectionName(source) {
  if (source === "vehicleChecks") return "vehicleChecks";
  if (source === "defectReports") return "defectReports";
  return "vehicleIssues";
}

export default function DefectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const readServiceCollection = useServiceCollectionReader();
  const route = useMemo(() => parseRouteId(Array.isArray(id) ? id[0] : id), [id]);

  const [record, setRecord] = useState(null);
  const [defect, setDefect] = useState(null);
  const [matchedVehicle, setMatchedVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completeModalVisible, setCompleteModalVisible] = useState(false);
  const [completionNote, setCompletionNote] = useState("");

  useEffect(() => {
    const loadDefect = async () => {
      if (!route.source || !route.docId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const collectionName = getDefectCollectionName(route.source);
        const ref = doc(db, collectionName, route.docId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setRecord(null);
          setDefect(null);
          return;
        }

        const data = { id: snap.id, ...snap.data() };
        setRecord(data);
        const vehicles = await readServiceCollection("vehicles", {
          orderByField: "name",
        });
        const matched = findVehicleForRecord(data, vehicles) || null;
        setMatchedVehicle(matched);
        const attachVehicleName = (nextDefect) => ({
          ...nextDefect,
          vehicleName: matched
            ? getVehicleDisplayName(matched, vehicles)
            : nextDefect.vehicleName || "Unknown vehicle",
          registration:
            getVehicleRegistration(matched || nextDefect) ||
            nextDefect.registration ||
            "",
        });

        if (route.source === "vehicleChecks") {
          const items = Array.isArray(data.items) ? data.items : [];
          const item = items[route.itemIndex];
          if (!item || !isApprovedDefect(item.review)) {
            setDefect(null);
            return;
          }
          setDefect(attachVehicleName(buildCheckDefect(data, item, route.itemIndex)));
        } else if (route.source === "defectReports") {
          if (!isOpenMaintenance(data.status)) {
            setDefect(null);
            return;
          }
          setDefect(attachVehicleName(buildManualDefect(data)));
        } else {
          if (!isApprovedDefect(data.review)) {
            setDefect(null);
            return;
          }
          setDefect(attachVehicleName(buildIssueDefect(data)));
        }
      } catch (err) {
        console.error("Failed to load defect detail:", err);
        setRecord(null);
        setDefect(null);
      } finally {
        setLoading(false);
      }
    };

    loadDefect();
  }, [readServiceCollection, route.docId, route.itemIndex, route.source]);

  const submitComplete = async () => {
    if (!record || !defect) return;
    const trimmedCompletionNote = completionNote.trim();
    if (!trimmedCompletionNote) {
      Alert.alert("Completion note required", "Add a short note explaining what was done.");
      return;
    }

    setSubmitting(true);
    try {
      const targetVehicleId = getRecordVehicleId(record, matchedVehicle);
      if (!targetVehicleId && route.source !== "defectReports") {
        Alert.alert(
          "Vehicle not linked",
          "This defect cannot be completed until it is linked to a vehicle."
        );
        setSubmitting(false);
        return;
      }

      const historyItem = buildDefectHistoryItem({
        source: route.source,
        route,
        record,
        defect,
        completionNote: trimmedCompletionNote,
      });

      const batch = writeBatch(db);

      if (route.source === "vehicleChecks") {
        const items = Array.isArray(record.items) ? [...record.items] : [];
        if (!items[route.itemIndex]) {
          throw new Error("Check item no longer exists.");
        }

        items[route.itemIndex] = {
          ...items[route.itemIndex],
          maintenance: {
            ...(items[route.itemIndex].maintenance || {}),
            status: "resolved",
            completedAt: new Date(),
            completionNote: trimmedCompletionNote,
          },
        };

        batch.update(doc(db, "vehicleChecks", route.docId), {
          items,
          updatedAt: serverTimestamp(),
        });
      } else if (route.source === "defectReports") {
        batch.update(doc(db, "defectReports", route.docId), {
          status: "resolved",
          completionNote: trimmedCompletionNote,
          completedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(doc(db, "vehicleIssues", route.docId), {
          "maintenance.status": "resolved",
          "maintenance.completionNote": trimmedCompletionNote,
          "maintenance.completedAt": serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (targetVehicleId) {
        batch.update(doc(db, "vehicles", targetVehicleId), {
          defectHistory: arrayUnion(historyItem),
        });
      }
      await batch.commit();

      setCompleteModalVisible(false);
      Alert.alert("Defect completed", "The defect has been resolved.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      console.error("Failed to complete defect:", err);
      Alert.alert("Error", "Could not complete this defect.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = () => {
    if (!record || !defect) return;
    setCompletionNote("");
    setCompleteModalVisible(true);
  };

  const categoryColor =
    defect?.category === "immediate" ? COLORS.primaryAction : COLORS.warning;
  const isResolved = normaliseKey(defect?.maintenanceStatus) === "resolved";

  return (
    <PageShell header={{
      variant: "compact",
      title: "Defect Detail",
      subtitle: "Review and complete workshop defect.",
      onBack: router.back,
    }}>
      

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primaryAction} />
        </View>
      ) : !defect ? (
        <View style={styles.center}>
          <Icon name="alert-circle" size={28} color={COLORS.textMid} />
          <Text style={[styles.emptyTitle, { color: colors.text || COLORS.textHigh }]}>
            Defect not available
          </Text>
          <Text
            style={[
              styles.emptyText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            It may have been completed, rejected or removed.
          </Text>
        </View>
      ) : (
        <>
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: colors.text || COLORS.textHigh }]}>
                  {defect.title}
                </Text>
                <Text
                  style={[
                    styles.vehicleText,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  {defect.vehicleName}
                  {defect.registration ? ` · ${defect.registration}` : ""}
                </Text>
              </View>
              <View style={[styles.badge, { borderColor: categoryColor }]}>
                <Text style={[styles.badgeText, { color: categoryColor }]}>
                  {defect.category === "immediate" ? "Immediate" : "General"}
                </Text>
              </View>
            </View>

            {!!defect.description && (
              <NoteField label="Defect" value={defect.description} />
            )}

            <View style={[styles.divider, { backgroundColor: colors.border || COLORS.border }]} />

            <Field label="Source" value={defect.sourceLabel} />
            <Field label="Status" value={formatStatus(defect.maintenanceStatus)} />
            <Field label="Reporter" value={defect.reporter || "-"} />
            {!!defect.jobNumber && (
              <Field label="Job number" value={defect.jobNumber} />
            )}
            <Field label="Reported" value={defect.dateText || "-"} />
          </View>

          <TouchableOpacity
            style={[
              styles.completeButton,
              (submitting || isResolved) && { opacity: 0.6 },
            ]}
            onPress={handleComplete}
            disabled={submitting || isResolved}
            activeOpacity={0.9}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={COLORS.textHigh} />
            ) : (
              <>
                <Icon
                  name="check-circle"
                  size={18}
                  color={COLORS.textHigh}
                  style={{ marginRight: t.spacing.xs }}
                />
                <Text style={styles.completeText}>
                  {isResolved ? "Already completed" : "Mark defect complete"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <AppModal
            visible={completeModalVisible}
            title="Complete defect"
            busy={submitting}
            onRequestClose={() => {
              if (!submitting) setCompleteModalVisible(false);
            }}
            actions={
              <>
                <AppButton label="Cancel" variant="secondary" onPress={() => setCompleteModalVisible(false)} disabled={submitting} />
                <AppButton label="Complete" onPress={submitComplete} loading={submitting} />
              </>
            }
          >
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  Add a short note on what was done to fix it.
                </Text>
                <TextArea
                  label="Completion note"
                  value={completionNote}
                  onChangeText={setCompletionNote}
                  placeholder="Example: Greased rear suspension joints and road tested."
                />
          </AppModal>
        </>
      )}
    </PageShell>
  );
}

function Field({ label, value }) {
  const { colors } = useTheme();

  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: colors.textMuted || COLORS.textLow }]}>
        {label}
      </Text>
      <Text style={[styles.fieldValue, { color: colors.text || COLORS.textMid }]}>
        {value}
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
        {value || "-"}
      </Text>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing["2xl"],
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingBottom: t.spacing.xl,
  },
  card: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: t.spacing.sm,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: t.spacing.xs,
  },
  title: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleText: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  badge: {
    marginLeft: t.spacing.xs,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  badgeText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    opacity: 0.6,
    marginVertical: t.spacing.xs,
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
  completeButton: {
    marginTop: t.spacing.sm,
    minHeight: 50,
    borderRadius: t.radius.md,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  completeText: {
    color: COLORS.textHigh,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: staticColors.rgba_18a7uad,
    alignItems: "center",
    justifyContent: "center",
    padding: t.spacing.lg,
  },
  modalCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.md,
    backgroundColor: COLORS.card,
  },
  modalTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  modalSubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  completionInput: {
    marginTop: t.spacing.sm,
    minHeight: 110,
    borderWidth: 1,
    borderRadius: t.radius.sm,
    padding: t.spacing.sm,
    fontSize: t.typography.body.fontSize,
    lineHeight: t.typography.body.lineHeight,
    color: COLORS.textHigh,
  },
  modalActions: {
    marginTop: t.spacing.sm,
    flexDirection: "row",
    gap: t.spacing.xs,
  },
  modalButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: t.radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelButton: {
    borderWidth: 1,
  },
  modalCompleteButton: {
    backgroundColor: COLORS.primaryAction,
  },
  modalCancelText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  modalCompleteText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  emptyTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  emptyText: {
    marginTop: t.spacing.xxs,
    textAlign: "center",
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
});
