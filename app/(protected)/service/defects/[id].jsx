import { useLocalSearchParams, useRouter } from "expo-router";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
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
import { designTokens as t } from "../../../../lib/design/tokens";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  warning: "#FFCC00",
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

function findVehicleForRecord(record, vehicles) {
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

function buildDefectHistoryItem({ source, route, record, defect }) {
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
  return {
    sourceLabel: "Vehicle issue",
    title: issue.category || issue.title || "Issue",
    description: issue.description || issue.note || issue.summary || "",
    category: normaliseKey(issue?.review?.category),
    status: issue?.review?.status || "",
    maintenanceStatus: issue?.maintenance?.status || "open",
    vehicleName: getVehicleLabel(issue),
    registration: issue.registration || issue.reg || "",
    reporter: issue.reporterName || issue.driverName || "",
    jobNumber: issue.jobNumber || "",
    dateText: formatDate(issue.createdAt || issue.dateISO || issue.date),
    itemIndex: null,
  };
}

export default function DefectDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { colors } = useTheme();
  const route = useMemo(() => parseRouteId(Array.isArray(id) ? id[0] : id), [id]);

  const [record, setRecord] = useState(null);
  const [defect, setDefect] = useState(null);
  const [matchedVehicle, setMatchedVehicle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadDefect = async () => {
      if (!route.source || !route.docId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const collectionName =
          route.source === "vehicleChecks" ? "vehicleChecks" : "vehicleIssues";
        const ref = doc(db, collectionName, route.docId);
        const snap = await getDoc(ref);

        if (!snap.exists()) {
          setRecord(null);
          setDefect(null);
          return;
        }

        const data = { id: snap.id, ...snap.data() };
        setRecord(data);
        const vehiclesSnap = await getDocs(collection(db, "vehicles"));
        const vehicles = vehiclesSnap.docs.map((vehicleDoc) => ({
          id: vehicleDoc.id,
          ...vehicleDoc.data(),
        }));
        setMatchedVehicle(findVehicleForRecord(data, vehicles) || null);

        if (route.source === "vehicleChecks") {
          const items = Array.isArray(data.items) ? data.items : [];
          const item = items[route.itemIndex];
          if (!item || !isApprovedDefect(item.review)) {
            setDefect(null);
            return;
          }
          setDefect(buildCheckDefect(data, item, route.itemIndex));
        } else {
          if (!isApprovedDefect(data.review)) {
            setDefect(null);
            return;
          }
          setDefect(buildIssueDefect(data));
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
  }, [route.docId, route.itemIndex, route.source]);

  const handleComplete = () => {
    if (!record || !defect) return;

    Alert.alert(
      "Complete defect?",
      "This will mark the defect as resolved and remove it from open defects.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            setSubmitting(true);
            try {
              const targetVehicleId = getRecordVehicleId(record, matchedVehicle);
              if (!targetVehicleId) {
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
                  },
                };

                batch.update(doc(db, "vehicleChecks", route.docId), {
                  items,
                  updatedAt: serverTimestamp(),
                });
              } else {
                batch.update(doc(db, "vehicleIssues", route.docId), {
                  "maintenance.status": "resolved",
                  "maintenance.completedAt": serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }

              batch.update(doc(db, "vehicles", targetVehicleId), {
                defectHistory: arrayUnion(historyItem),
              });
              await batch.commit();

              Alert.alert("Defect completed", "The defect has been resolved.", [
                { text: "OK", onPress: () => router.back() },
              ]);
            } catch (err) {
              console.error("Failed to complete defect:", err);
              Alert.alert("Error", "Could not complete this defect.");
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  const categoryColor =
    defect?.category === "immediate" ? COLORS.primaryAction : COLORS.warning;
  const isResolved = normaliseKey(defect?.maintenanceStatus) === "resolved";

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
        <TouchableOpacity onPress={router.back} style={styles.backButton}>
          <Icon
            name="chevron-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}>
            Defect Detail
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Review and complete workshop defect.
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
            It may have been completed, rejected or removed.
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
              <View
                style={[
                  styles.descriptionBox,
                  { backgroundColor: colors.inputBackground || COLORS.inputBg },
                ]}
              >
                <Text
                  style={[
                    styles.description,
                    { color: colors.text || COLORS.textHigh },
                  ]}
                >
                  {defect.description}
                </Text>
              </View>
            )}

            <Field label="Source" value={defect.sourceLabel} />
            <Field label="Review status" value={defect.status || "approved"} />
            <Field label="Maintenance status" value={defect.maintenanceStatus || "open"} />
            <Field label="Reporter" value={defect.reporter || "-"} />
            <Field label="Job number" value={defect.jobNumber || "-"} />
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
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.completeText}>
                  {isResolved ? "Already completed" : "Mark defect complete"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Field({ label, value }) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.fieldRow,
        { borderTopColor: colors.border || COLORS.border },
      ]}
    >
      <Text
        style={[
          styles.fieldLabel,
          { color: colors.textMuted || COLORS.textLow },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.fieldValue,
          { color: colors.text || COLORS.textHigh },
        ]}
      >
        {value}
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
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: 8,
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: t.controls.cardPadding,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  vehicleText: {
    marginTop: 4,
    fontSize: 13,
    color: COLORS.textMid,
  },
  badge: {
    marginLeft: 10,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  descriptionBox: {
    marginBottom: 12,
    borderRadius: 8,
    backgroundColor: COLORS.inputBg,
    padding: 12,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.textHigh,
  },
  fieldRow: {
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  fieldLabel: {
    fontSize: 12,
    color: COLORS.textLow,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 14,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  completeButton: {
    marginTop: 12,
    minHeight: 50,
    borderRadius: 10,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  completeText: {
    color: COLORS.textHigh,
    fontSize: 15,
    fontWeight: "800",
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
