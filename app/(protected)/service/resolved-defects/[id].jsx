import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { useTheme } from "../../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  inputBg: "#2a2a2a",
};

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

function toDateMaybe(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value) {
  const date = toDateMaybe(value);
  if (!date) return "";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getVehicleText(record, fallback = {}) {
  return [
    record?.vehicleName || record?.vehicle || record?.name || fallback.vehicleName,
    record?.registration || record?.reg || fallback.registration,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildManualResolvedDefect(report) {
  return {
    source: "defectReports",
    title: report.category || report.title || "Resolved defect",
    description: report.description || report.note || report.summary || report.notes || "",
    completionNote: report.completionNote || "",
    vehicle: getVehicleText(report),
    sourceLabel: "Defect report",
    category: report.severity || report.priority || "",
    reporter: report.reportedBy || report.reporterName || report.driverName || "",
    jobNumber: report.jobNumber || "",
    reportedAt: report.createdAt || report.dateISO || report.date,
    completedAt: report.completedAt || report.updatedAt,
  };
}

function buildVehicleResolvedDefect(vehicle, item) {
  return {
    source: "vehicles",
    sourceDocId: item?.sourceDocId || "",
    sourceItemIndex: item?.itemIndex,
    sourceCollection: item?.source || "",
    title: item?.title || "Resolved defect",
    description: item?.description || "",
    completionNote: item?.completionNote || "",
    vehicle: getVehicleText(vehicle, item),
    sourceLabel: item?.sourceLabel || "Vehicle defect",
    category: item?.category || "",
    reporter: item?.reporter || "",
    jobNumber: item?.jobNumber || "",
    reportedAt: item?.reportedAt,
    completedAt: item?.completedAt || item?.resolvedAt || item?.recordedAt,
  };
}

export default function ResolvedDefectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const route = useMemo(() => parseRouteId(Array.isArray(id) ? id[0] : id), [id]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [defect, setDefect] = useState(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editCompletionNote, setEditCompletionNote] = useState("");

  useEffect(() => {
    const loadDefect = async () => {
      if (!route.source || !route.docId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        if (route.source === "defectReports") {
          const snap = await getDoc(doc(db, "defectReports", route.docId));
          setDefect(snap.exists() ? buildManualResolvedDefect(snap.data()) : null);
          return;
        }

        if (route.source === "vehicles") {
          const snap = await getDoc(doc(db, "vehicles", route.docId));
          if (!snap.exists()) {
            setDefect(null);
            return;
          }
          const vehicle = { id: snap.id, ...snap.data() };
          const history = Array.isArray(vehicle.defectHistory)
            ? vehicle.defectHistory
            : [];
          const item = history[route.itemIndex];
          setDefect(item ? buildVehicleResolvedDefect(vehicle, item) : null);
          return;
        }

        setDefect(null);
      } catch (err) {
        console.error("Failed to load resolved defect:", err);
        setDefect(null);
      } finally {
        setLoading(false);
      }
    };

    loadDefect();
  }, [route.docId, route.itemIndex, route.source]);

  const openEdit = () => {
    setEditCompletionNote(defect?.completionNote || "");
    setEditModalVisible(true);
  };

  const saveCompletionNote = async () => {
    if (!defect) return;
    const trimmedNote = editCompletionNote.trim();
    if (!trimmedNote) {
      Alert.alert("Completion note required", "Add a short note explaining what was done.");
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);

      if (route.source === "defectReports") {
        batch.update(doc(db, "defectReports", route.docId), {
          completionNote: trimmedNote,
          updatedAt: serverTimestamp(),
        });
      } else if (route.source === "vehicles") {
        const vehicleRef = doc(db, "vehicles", route.docId);
        const snap = await getDoc(vehicleRef);
        if (!snap.exists()) throw new Error("Vehicle no longer exists.");

        const vehicle = snap.data();
        const defectHistory = Array.isArray(vehicle.defectHistory)
          ? [...vehicle.defectHistory]
          : [];
        if (!defectHistory[route.itemIndex]) {
          throw new Error("Resolved defect history item no longer exists.");
        }

        const originalHistoryItem = defectHistory[route.itemIndex];
        defectHistory[route.itemIndex] = {
          ...originalHistoryItem,
          completionNote: trimmedNote,
          updatedAt: new Date().toISOString(),
        };
        batch.update(vehicleRef, { defectHistory });

        if (originalHistoryItem?.source === "vehicleIssues" && originalHistoryItem?.sourceDocId) {
          batch.update(doc(db, "vehicleIssues", originalHistoryItem.sourceDocId), {
            "maintenance.completionNote": trimmedNote,
            updatedAt: serverTimestamp(),
          });
        }

        if (
          originalHistoryItem?.source === "vehicleChecks" &&
          originalHistoryItem?.sourceDocId &&
          Number.isInteger(originalHistoryItem?.itemIndex)
        ) {
          const checkRef = doc(db, "vehicleChecks", originalHistoryItem.sourceDocId);
          const checkSnap = await getDoc(checkRef);
          if (checkSnap.exists()) {
            const check = checkSnap.data();
            const items = Array.isArray(check.items) ? [...check.items] : [];
            if (items[originalHistoryItem.itemIndex]) {
              items[originalHistoryItem.itemIndex] = {
                ...items[originalHistoryItem.itemIndex],
                maintenance: {
                  ...(items[originalHistoryItem.itemIndex].maintenance || {}),
                  completionNote: trimmedNote,
                },
              };
              batch.update(checkRef, {
                items,
                updatedAt: serverTimestamp(),
              });
            }
          }
        }
      }

      await batch.commit();
      setDefect((current) =>
        current ? { ...current, completionNote: trimmedNote } : current
      );
      setEditModalVisible(false);
    } catch (err) {
      console.error("Failed to update resolved defect:", err);
      Alert.alert("Error", "Could not update this resolved defect.");
    } finally {
      setSaving(false);
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
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity
          onPress={router.back}
          style={styles.backButton}
          activeOpacity={0.8}
        >
          <Icon
            name="chevron-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}>
            Resolved Defect
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            View what was reported and what was done.
          </Text>
        </View>
      </View>

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
            The resolved defect could not be found.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
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
                {!!defect.vehicle && (
                  <Text
                    style={[
                      styles.vehicleText,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {defect.vehicle}
                  </Text>
                )}
              </View>
              <View style={styles.resolvedBadge}>
                <Icon name="check-circle" size={14} color={COLORS.primaryAction} />
                <Text style={styles.resolvedBadgeText}>Resolved</Text>
              </View>
            </View>

            {!!defect.completionNote && (
              <NoteField label="Work completed" value={defect.completionNote} />
            )}

            {!!defect.description && (
              <NoteField label="Original defect" value={defect.description} />
            )}

            <View style={[styles.divider, { backgroundColor: colors.border || COLORS.border }]} />

            <Field label="Source" value={defect.sourceLabel || "-"} />
            {!!defect.category && <Field label="Priority" value={defect.category} />}
            {!!defect.reporter && <Field label="Reporter" value={defect.reporter} />}
            {!!defect.jobNumber && <Field label="Job number" value={defect.jobNumber} />}
            <Field label="Reported" value={formatDate(defect.reportedAt) || "-"} />
            <Field label="Completed" value={formatDate(defect.completedAt) || "-"} />
          </View>

          <TouchableOpacity
            style={[
              styles.editButton,
              { borderColor: COLORS.primaryAction },
              saving && { opacity: 0.6 },
            ]}
            onPress={openEdit}
            disabled={saving}
            activeOpacity={0.9}
          >
            <Icon
              name="edit-2"
              size={17}
              color={COLORS.primaryAction}
              style={{ marginRight: 8 }}
            />
            <Text style={styles.editButtonText}>Edit completion note</Text>
          </TouchableOpacity>

          <Modal
            visible={editModalVisible}
            transparent
            animationType="fade"
            onRequestClose={() => {
              if (!saving) setEditModalVisible(false);
            }}
          >
            <View style={styles.modalOverlay}>
              <View
                style={[
                  styles.modalCard,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor: colors.border || COLORS.border,
                  },
                ]}
              >
                <Text style={[styles.modalTitle, { color: colors.text || COLORS.textHigh }]}>
                  Edit completion note
                </Text>
                <Text
                  style={[
                    styles.modalSubtitle,
                    { color: colors.textMuted || COLORS.textMid },
                  ]}
                >
                  Update what was done to resolve this defect.
                </Text>
                <TextInput
                  value={editCompletionNote}
                  onChangeText={setEditCompletionNote}
                  placeholder="What was done?"
                  placeholderTextColor={colors.textMuted || COLORS.textLow}
                  multiline
                  textAlignVertical="top"
                  style={[
                    styles.completionInput,
                    {
                      backgroundColor: colors.inputBackground || COLORS.inputBg,
                      borderColor: colors.border || COLORS.border,
                      color: colors.text || COLORS.textHigh,
                    },
                  ]}
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[
                      styles.modalButton,
                      styles.modalCancelButton,
                      { borderColor: colors.border || COLORS.border },
                    ]}
                    onPress={() => setEditModalVisible(false)}
                    disabled={saving}
                  >
                    <Text style={[styles.modalCancelText, { color: colors.text || COLORS.textHigh }]}>
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalSaveButton]}
                    onPress={saveCompletionNote}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color={COLORS.textHigh} />
                    ) : (
                      <Text style={styles.modalSaveText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </ScrollView>
      )}
    </SafeAreaView>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 28,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 14,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleText: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  resolvedBadge: {
    marginLeft: 10,
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  resolvedBadgeText: {
    color: COLORS.primaryAction,
    fontSize: 12,
    fontWeight: "800",
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    opacity: 0.6,
    marginVertical: 8,
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
  editButton: {
    marginTop: 12,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: "transparent",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  editButtonText: {
    color: COLORS.primaryAction,
    fontSize: 15,
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    backgroundColor: COLORS.card,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: COLORS.textMid,
  },
  completionInput: {
    marginTop: 14,
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textHigh,
  },
  modalActions: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  modalButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelButton: {
    borderWidth: 1,
  },
  modalSaveButton: {
    backgroundColor: COLORS.primaryAction,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  modalSaveText: {
    fontSize: 14,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  emptyText: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 13,
    color: COLORS.textMid,
  },
});
