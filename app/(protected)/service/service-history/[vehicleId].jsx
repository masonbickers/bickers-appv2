// app/(protected)/service/service-history/[vehicleId].jsx
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  chipBg: "#262626",
  accent: "#FF3B30",
  accentSoft: "rgba(255,59,48,0.14)",
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

function formatDateShort(value) {
  const d = toDateMaybe(value);
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

export default function ServiceHistoryListScreen() {
  const { vehicleId, name, registration } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();

  const [loading, setLoading] = useState(true);
  const [vehicle, setVehicle] = useState(null);
  const [serviceForms, setServiceForms] = useState([]);

  useEffect(() => {
    if (!vehicleId) return;

    const load = async () => {
      setLoading(true);
      try {
        // 1) Vehicle doc
        const ref = doc(db, "vehicles", String(vehicleId));
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setVehicle({ id: snap.id, ...snap.data() });
        } else {
          setVehicle(null);
        }

        // 2) Service records for this vehicle
        const formsRef = collection(db, "serviceRecords");
        const qRef = query(
          formsRef,
          where("vehicleId", "==", String(vehicleId))
        );

        const formsSnap = await getDocs(qRef);
        const forms = formsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setServiceForms(forms);
      } catch (err) {
        console.error("Failed to load vehicle/service history:", err);
        setVehicle((prev) => prev ?? null);
        setServiceForms([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [vehicleId]);

  const fromForms = useMemo(() => {
    if (!serviceForms || serviceForms.length === 0) return [];

    return serviceForms
      .map((f) => {
        const date =
          f.serviceDateOnly ||
          f.serviceDate ||
          f.completedAt ||
          f.createdAt ||
          f.date ||
          null;
        const odo = f.odometer ?? f.mileage ?? null;
        const summary =
          f.workSummary || f.extraNotes || f.summary || f.notes || "";
        const type = f.serviceType || f.type || "Service";

        return {
          id: f.id,
          date,
          odometer: odo,
          summary,
          type,
        };
      })
      .sort((a, b) => {
        const da = toDateMaybe(a.date)?.getTime() || 0;
        const db = toDateMaybe(b.date)?.getTime() || 0;
        return db - da; // newest first
      });
  }, [serviceForms]);

  const fromEmbedded = useMemo(() => {
    if (!vehicle || !Array.isArray(vehicle.serviceHistory)) return [];
    return [...vehicle.serviceHistory]
      .map((item, idx) => ({
        id: item.id || `embedded-${idx}`,
        date: item.date || null,
        odometer: item.odometer ?? null,
        summary: item.summary || "",
        type: item.type || "Service",
      }))
      .sort((a, b) => {
        const da = toDateMaybe(a.date)?.getTime() || 0;
        const db = toDateMaybe(b.date)?.getTime() || 0;
        return db - da;
      });
  }, [vehicle]);

  // Prefer standalone service records; fallback to embedded array
  const serviceHistory = fromForms.length > 0 ? fromForms : fromEmbedded;

  const headerName =
    vehicle?.name || vehicle?.vehicleName || name || "Vehicle";
  const headerReg = vehicle?.registration || vehicle?.reg || registration || "";

  const latestRecord = serviceHistory[0] || null;
  const totalServices = serviceHistory.length;
  const lastServiceDate = latestRecord?.date
    ? formatDateShort(latestRecord.date)
    : null;
  const lastServiceOdo =
    typeof latestRecord?.odometer === "number"
      ? `${latestRecord.odometer.toLocaleString("en-GB")} mi`
      : latestRecord?.odometer || null;

  const handleOpenRecord = (id) => {
    router.push(`/service/service-record/${id}`);
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
          style={[
            styles.backButton,
            { borderColor: colors.border || COLORS.border },
          ]}
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
            numberOfLines={1}
          >
            Service history
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
            numberOfLines={1}
          >
            {headerReg}
            {headerReg && headerName ? " · " : ""}
            {headerName}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.textMuted || COLORS.textMid} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading services…
          </Text>
        </View>
      ) : !vehicle ? (
        <View style={styles.loadingContainer}>
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Vehicle not found.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* VEHICLE SUMMARY CARD */}
          <View
            style={[
              styles.vehicleCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View style={styles.vehicleRowTop}>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.vehicleNameText,
                    { color: colors.text || COLORS.textHigh },
                  ]}
                  numberOfLines={1}
                >
                  {headerName}
                </Text>
                {!!headerReg && (
                  <Text
                    style={[
                      styles.vehicleRegText,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {headerReg}
                  </Text>
                )}
              </View>
              {typeof vehicle.mileage === "number" && (
                <View style={styles.mileageChip}>
                  <Icon
                    name="activity"
                    size={12}
                    color={COLORS.textMid}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.mileageChipText}>
                    {vehicle.mileage.toLocaleString("en-GB")} mi
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.vehicleMetaRow}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Last service</Text>
                <Text style={styles.metaValue}>
                  {vehicle.lastService
                    ? formatDateShort(vehicle.lastService)
                    : lastServiceDate || "—"}
                </Text>
              </View>
              <View
                style={[
                  styles.metaDivider,
                  { backgroundColor: colors.border || COLORS.border },
                ]}
              />
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Next service</Text>
                <Text style={styles.metaValue}>
                  {vehicle.nextService
                    ? formatDateShort(vehicle.nextService)
                    : "—"}
                </Text>
              </View>
            </View>
          </View>

          {/* STATS STRIP */}
          <View
            style={[
              styles.statsStrip,
              {
                backgroundColor: colors.surfaceAlt || "#111111",
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <View style={styles.statsItem}>
              <Text style={styles.statsLabel}>Total services</Text>
              <Text style={styles.statsValue}>{totalServices || 0}</Text>
            </View>
            <View style={styles.statsItem}>
              <Text style={styles.statsLabel}>Last date</Text>
              <Text style={styles.statsValue}>{lastServiceDate || "—"}</Text>
            </View>
            <View style={styles.statsItem}>
              <Text style={styles.statsLabel}>Last mileage</Text>
              <Text style={styles.statsValue}>{lastServiceOdo || "—"}</Text>
            </View>
          </View>

          {/* HISTORY LIST */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            {serviceHistory.length === 0 ? (
              <Text style={styles.emptyText}>
                No service entries recorded for this vehicle yet.
              </Text>
            ) : (
              serviceHistory.map((item, index) => {
                const dateLabel = item.date
                  ? formatDateShort(item.date)
                  : "No date";
                const odoLabel =
                  typeof item.odometer === "number"
                    ? `${item.odometer.toLocaleString("en-GB")} mi`
                    : item.odometer || null;

                const isMostRecent = index === 0;

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.row,
                      isMostRecent && styles.rowMostRecent,
                    ]}
                    activeOpacity={0.85}
                    onPress={() => handleOpenRecord(item.id)}
                  >
                    <View style={styles.rowHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.rowTitleRow}>
                          <View style={styles.typePill}>
                            <Icon
                              name="tool"
                              size={12}
                              color={COLORS.textHigh}
                              style={{ marginRight: 4 }}
                            />
                            <Text style={styles.typePillText}>
                              {item.type || "Service"}
                            </Text>
                          </View>
                          {isMostRecent && (
                            <View style={styles.recentPill}>
                              <Text style={styles.recentPillText}>
                                Most recent
                              </Text>
                            </View>
                          )}
                        </View>

                        <Text style={styles.rowMeta}>
                          {dateLabel}
                          {odoLabel ? ` · ${odoLabel}` : ""}
                        </Text>
                      </View>
                      <Icon
                        name="chevron-right"
                        size={18}
                        color={COLORS.textLow}
                      />
                    </View>

                    {!!item.summary && (
                      <Text style={styles.rowSummary} numberOfLines={2}>
                        {item.summary}
                      </Text>
                    )}

                    <Text style={styles.tapHint}>
                      Tap to view full checklist
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
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

  /* Vehicle summary */
  vehicleCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
  },
  vehicleRowTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  vehicleNameText: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleRegText: {
    fontSize: 12,
    color: COLORS.textMid,
    marginTop: 2,
  },
  mileageChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.chipBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  mileageChipText: {
    fontSize: 11,
    color: COLORS.textMid,
    fontWeight: "600",
  },
  vehicleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 11,
    color: COLORS.textLow,
  },
  metaValue: {
    fontSize: 12,
    color: COLORS.textMid,
    marginTop: 2,
  },
  metaDivider: {
    width: 1,
    height: 26,
    backgroundColor: COLORS.border,
    marginHorizontal: 10,
    opacity: 0.8,
  },

  /* Stats strip */
  statsStrip: {
    flexDirection: "row",
    backgroundColor: "#111111",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  statsItem: {
    flex: 1,
    paddingHorizontal: 4,
  },
  statsLabel: {
    fontSize: 11,
    color: COLORS.textLow,
  },
  statsValue: {
    fontSize: 13,
    color: COLORS.textHigh,
    fontWeight: "600",
    marginTop: 2,
  },

  /* History list */
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  rowMostRecent: {
    backgroundColor: COLORS.accentSoft,
    borderRadius: 8,
    marginHorizontal: -8,
    paddingHorizontal: 8,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 2,
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  typePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.chipBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  typePillText: {
    fontSize: 11,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  recentPill: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: COLORS.accentSoft,
  },
  recentPillText: {
    fontSize: 10,
    color: COLORS.accent,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  rowMeta: {
    fontSize: 11,
    color: COLORS.textLow,
  },
  rowSummary: {
    fontSize: 12,
    color: COLORS.textMid,
    marginTop: 4,
  },
  tapHint: {
    fontSize: 11,
    color: COLORS.textLow,
    marginTop: 3,
  },
});
