// app/(protected)/service-history.jsx
import { useRouter } from "expo-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#FF3B30",
  inputBg: "#2a2a2a",
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

function wasRecently(dateValue, daysWindow = 60) {
  const d = toDateMaybe(dateValue);
  if (!d) return false;
  const today = new Date();
  const diffMs = today.getTime() - d.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= daysWindow;
}

export default function ServiceHistoryScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "vehicles"), orderBy("name", "asc"));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setVehicles(data);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load vehicles for service history:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const processed = useMemo(() => {
    return vehicles.map((v) => {
      const lastMOT = v.lastMOT || v.lastMot || v.lastMotDate;
      const nextMOT = v.nextMOT || v.nextMot || v.nextMotDate;
      const lastService = v.lastService || v.lastServiceDate;
      const nextService = v.nextService || v.nextServiceDate;

      const recentMOT = wasRecently(lastMOT, 365); // within last year
      const recentService = wasRecently(lastService, 365);

      return {
        ...v,
        lastMOT,
        nextMOT,
        lastService,
        nextService,
        recentMOT,
        recentService,
      };
    });
  }, [vehicles]);

  const summary = useMemo(() => {
    const total = processed.length;
    const withMOTHistory = processed.filter((v) => v.lastMOT).length;
    const withServiceHistory = processed.filter((v) => v.lastService).length;
    const recentMOTs = processed.filter((v) => v.recentMOT).length;
    const recentServices = processed.filter((v) => v.recentService).length;
    return {
      total,
      withMOTHistory,
      withServiceHistory,
      recentMOTs,
      recentServices,
    };
  }, [processed]);

  const handleOpenVehicleHistory = (vehicle) => {
    const name = vehicle.name || vehicle.vehicleName || "";
    const reg = vehicle.registration || vehicle.reg || "";

    router.push({
      pathname: "/service/service-history/[vehicleId]",
      params: {
        vehicleId: vehicle.id,
        name,
        registration: reg,
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
        <TouchableOpacity onPress={router.back} style={styles.backButton}>
          <Icon
            name="chevron-left"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.pageTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service History
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Last MOT and service dates for each vehicle in the fleet.
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={colors.accent || COLORS.primaryAction}
          />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading service history…
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* SUMMARY CARD */}
          <View
            style={[
              styles.summaryCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
          >
            <Text
              style={[
                styles.summaryTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Fleet Summary
            </Text>
            <View style={styles.summaryRow}>
              <SummaryItem label="Vehicles" value={summary.total} />
              <SummaryItem
                label="With MOT history"
                value={summary.withMOTHistory}
              />
            </View>
            <View style={styles.summaryRow}>
              <SummaryItem
                label="With service history"
                value={summary.withServiceHistory}
              />
              <SummaryItem
                label="MOT in last 12m"
                value={summary.recentMOTs}
              />
            </View>
            <View style={styles.summaryRow}>
              <SummaryItem
                label="Service in last 12m"
                value={summary.recentServices}
              />
            </View>
          </View>

          {/* VEHICLE CARDS */}
          {processed.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                name="file-text"
                size={26}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                No vehicles found
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Add vehicles in the main system to see service history here.
              </Text>
            </View>
          ) : (
            processed.map((v) => {
              const name = v.name || v.vehicleName || "Unnamed vehicle";
              const reg = v.registration || v.reg || "";
              const manufacturer = v.manufacturer || "";
              const model = v.model || "";

              const lastMOTText = formatDateShort(v.lastMOT);
              const nextMOTText = formatDateShort(v.nextMOT);
              const lastServiceText = formatDateShort(v.lastService);
              const nextServiceText = formatDateShort(v.nextService);

              const hasHistory = v.lastMOT || v.lastService;
              const borderAccent = hasHistory
                ? colors.accent || COLORS.primaryAction
                : colors.border || COLORS.border;

              return (
                <View
                  key={v.id}
                  style={[
                    styles.vehicleCard,
                    {
                      borderLeftColor: borderAccent,
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderColor: colors.border || COLORS.border,
                    },
                  ]}
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
                            styles.vehicleSub,
                            { color: colors.textMuted || COLORS.textLow },
                          ]}
                        >
                          {manufacturer}
                          {manufacturer && model ? " · " : ""}
                          {model}
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.historyBlock}>
                    <Text
                      style={[
                        styles.blockTitle,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      MOT
                    </Text>
                    <HistoryRow label="Last MOT" value={lastMOTText} />
                    <HistoryRow label="Next MOT" value={nextMOTText} />
                  </View>

                  <View style={styles.historyBlock}>
                    <Text
                      style={[
                        styles.blockTitle,
                        { color: colors.textMuted || COLORS.textMid },
                      ]}
                    >
                      Service
                    </Text>
                    <HistoryRow
                      label="Last service"
                      value={lastServiceText}
                    />
                    <HistoryRow
                      label="Next service"
                      value={nextServiceText}
                    />
                  </View>

                  {typeof v.mileage === "number" && (
                    <View style={styles.historyBlock}>
                      <Text
                        style={[
                          styles.blockTitle,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                      >
                        Odometer
                      </Text>
                      <HistoryRow
                        label="Current"
                        value={`${v.mileage.toLocaleString("en-GB")} mi`}
                      />
                    </View>
                  )}

                  {v.notes ? (
                    <View style={styles.notesBlock}>
                      <Text
                        style={[
                          styles.notesLabel,
                          { color: colors.textMuted || COLORS.textLow },
                        ]}
                      >
                        Notes
                      </Text>
                      <Text
                        style={[
                          styles.notesText,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                      >
                        {v.notes}
                      </Text>
                    </View>
                  ) : null}

                  {/* View full history button */}
                  <TouchableOpacity
                    style={[
                      styles.viewHistoryButton,
                      {
                        backgroundColor: colors.surface || "#1F2933",
                      },
                    ]}
                    activeOpacity={0.85}
                    onPress={() => handleOpenVehicleHistory(v)}
                  >
                    <Text
                      style={[
                        styles.viewHistoryText,
                        { color: colors.text || COLORS.textHigh },
                      ]}
                    >
                      View full history
                    </Text>
                    <Icon
                      name="chevron-right"
                      size={14}
                      color={colors.text || COLORS.textHigh}
                    />
                  </TouchableOpacity>
                </View>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SummaryItem({ label, value }) {
  const { colors } = useTheme();
  return (
    <View style={summaryStyles.item}>
      <Text
        style={[
          summaryStyles.value,
          { color: colors.text || COLORS.textHigh },
        ]}
      >
        {value}
      </Text>
      <Text
        style={[
          summaryStyles.label,
          { color: colors.textMuted || COLORS.textMid },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

function HistoryRow({ label, value }) {
  const { colors } = useTheme();
  return (
    <View style={styles.historyRow}>
      <Text
        style={[
          styles.historyLabel,
          { color: colors.textMuted || COLORS.textLow },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.historyValue,
          { color: colors.text || COLORS.textHigh },
        ]}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

/* ---------- STYLES ---------- */

const summaryStyles = StyleSheet.create({
  item: {
    flex: 1,
    paddingRight: 12,
    marginBottom: 4,
  },
  value: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  label: {
    fontSize: 12,
    color: COLORS.textMid,
    marginTop: 2,
  },
});

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
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
  },
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: "row",
    marginTop: 2,
  },
  vehicleCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
  },
  vehicleHeaderRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  vehicleTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: 13,
    color: COLORS.textMid,
    marginTop: 2,
  },
  vehicleSub: {
    fontSize: 12,
    color: COLORS.textLow,
    marginTop: 2,
  },
  historyBlock: {
    marginTop: 8,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textMid,
    marginBottom: 4,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  historyLabel: {
    fontSize: 12,
    color: COLORS.textLow,
  },
  historyValue: {
    fontSize: 12,
    color: COLORS.textHigh,
  },
  notesBlock: {
    marginTop: 10,
  },
  notesLabel: {
    fontSize: 12,
    color: COLORS.textLow,
    marginBottom: 2,
  },
  notesText: {
    fontSize: 12,
    color: COLORS.textMid,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 30,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
    color: COLORS.textMid,
  },
  viewHistoryButton: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-end",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "#1F2933",
  },
  viewHistoryText: {
    fontSize: 12,
    color: COLORS.textHigh,
    fontWeight: "600",
    marginRight: 4,
  },
});
