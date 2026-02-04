// app/(protected)/service/service-record/[id].jsx
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { db } from "../../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

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

export default function ServiceRecordViewScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();

  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      try {
        const ref = doc(db, "serviceRecords", String(id));
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setRecord({ id: snap.id, ...snap.data() });
        } else {
          setRecord(null);
        }
      } catch (err) {
        console.error("Failed to load service record:", err);
        setRecord(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  const title = record?.serviceType || "Service record";
  const vehicleName = record?.vehicleName || "Vehicle";
  const reg = record?.registration || "";
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
    const checkPhotoURIs = record.checkPhotoURIs || {};

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
          rating:
            typeof ratings[label] === "number" ? ratings[label] : null,
          na: !!na[label],
          note: typeof notes[label] === "string" ? notes[label] : "",
          photos: Array.isArray(photosForLabel) ? photosForLabel : [],
        };
      });
  }, [record]);

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
          style={[
            styles.backButton,
            { borderColor: colors.border || COLORS.border },
          ]}
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
                <Text style={styles.mainTitle}>{title}</Text>
                {!!fullDate && (
                  <Text style={styles.summaryMeta}>{fullDate}</Text>
                )}
              </View>
              {typeof record.odometer === "number" && (
                <View style={styles.chip}>
                  <Feather
                    name="activity"
                    size={12}
                    color={COLORS.textMid}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.chipText}>
                    {record.odometer.toLocaleString("en-GB")} mi
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.divider} />

            <Field
              label="Vehicle"
              value={`${vehicleName}${reg ? ` · ${reg}` : ""}`}
            />
            <Field label="Service type" value={record.serviceType} />
            <Field label="Service date" value={fullDate} />
            <Field
              label="Next service due"
              value={record.nextServiceDate || "—"}
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
            <Text style={styles.sectionTitle}>Workshop notes</Text>
            <Field
              label="Work carried out"
              value={record.workSummary || "—"}
            />
            <Field label="Parts used" value={record.partsUsed || "—"} />
            <Field
              label="Extra notes"
              value={record.extraNotes || "No additional notes."}
            />
          </View>

          {/* FULL CHECKLIST DETAILS */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Text style={styles.sectionTitle}>Checklist details</Text>
            {checklistItems.length === 0 ? (
              <Text style={styles.checkSummaryText}>
                No checklist data saved for this service.
              </Text>
            ) : (
              checklistItems.map((item) => (
                <View key={item.label} style={styles.checkRowWrapper}>
                  {/* Row: tick / N/A / label + rating */}
                  <View style={styles.checkRowTop}>
                    {/* Left: icon + label */}
                    <View style={styles.checkLeft}>
                      <View style={styles.checkIconWrap}>
                        {item.na ? (
                          <View style={styles.naIcon}>
                            <Text style={styles.naIconText}>N/A</Text>
                          </View>
                        ) : item.checked ? (
                          <View style={styles.checkIconFilled}>
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
                      <Text style={styles.checkLabel}>{item.label}</Text>
                    </View>

                    {/* Right: rating */}
                    <View style={styles.checkRight}>
                      {item.na ? (
                        <Text style={styles.checkRightText}>N/A</Text>
                      ) : typeof item.rating === "number" ? (
                        <Text style={styles.checkRightText}>
                          Rating: {item.rating}/5
                        </Text>
                      ) : (
                        <Text style={styles.checkRightText}>No rating</Text>
                      )}
                    </View>
                  </View>

                  {/* Note for this check */}
                  {item.note ? (
                    <Text style={styles.checkNoteText}>{item.note}</Text>
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
          {Array.isArray(record.photoURIs) && record.photoURIs.length > 0 && (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.surfaceAlt || COLORS.card,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
            >
              <Text style={styles.sectionTitle}>Photos</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 8 }}
              >
                {record.photoURIs.map((uri) => (
                  <View key={uri} style={styles.photoThumbWrapper}>
                    <Image source={{ uri }} style={styles.photoThumb} />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* SMALL REUSABLE FIELD */

function Field({ label, value }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value || "—"}</Text>
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
  checkSummaryText: {
    fontSize: 12,
    color: COLORS.textMid,
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
});
