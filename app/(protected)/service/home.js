// app/(protected)/service/home.js
import { useRouter } from "expo-router";
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
import Icon from "react-native-vector-icons/Feather";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import { auth, db } from "../../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

/* ---------- CONSTANTS & HELPERS ---------- */

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#FF3B30", // 🔴 red accent
  recceAction: "#FF3B30",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

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

function pickWorstStatusCode(motCode, serviceCode) {
  const codes = [motCode, serviceCode];
  if (codes.includes("overdue")) return "overdue";
  if (codes.includes("due-soon")) return "due-soon";
  if (codes.includes("ok")) return "ok";
  return "unknown";
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

export default function ServiceHomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeSnapshot = null;

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      // 🔥 1. If user logs OUT → kill listener BEFORE Firestore throws
      if (!user) {
        if (unsubscribeSnapshot) {
          unsubscribeSnapshot();
          unsubscribeSnapshot = null;
        }
        setVehicles([]);
        setLoading(false);
        return;
      }

      // 🔥 2. User logged IN → safe to attach listener now
      const q = query(collection(db, "vehicles"), orderBy("name", "asc"));

      unsubscribeSnapshot = onSnapshot(
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
          // 🔥 3. User logged out MID-LISTEN → ignore permission error
          if (err.code === "permission-denied" && !auth.currentUser) {
            return;
          }

          console.error("Service Home listener error:", err);
          setLoading(false);
        }
      );
    });

    // 🔥 4. Cleanup auth + Firestore listeners when leaving the page
    return () => {
      if (unsubscribeSnapshot) unsubscribeSnapshot();
      unsubscribeAuth();
    };
  }, []);

  const processed = useMemo(() => {
    return vehicles.map((v) => {
      const motDateRaw =
        v.nextMOT || v.nextMot || v.nextMotDate || v.motDueDate || v.motExpiryDate;
      const serviceDateRaw =
        v.nextService || v.nextServiceDate || v.serviceDueDate || v.nextSvc;

      const motStatus = classifyStatus(motDateRaw);
      const serviceStatus = classifyStatus(serviceDateRaw);
      const defects = Array.isArray(v.defects) ? v.defects : [];
      const hasDefects = defects.length > 0;

      return {
        ...v,
        motStatus,
        serviceStatus,
        motDateRaw,
        serviceDateRaw,
        defects,
        hasDefects,
        worstCode: pickWorstStatusCode(motStatus.code, serviceStatus.code),
      };
    });
  }, [vehicles]);

  const summary = useMemo(() => {
    const total = processed.length;
    const overdue = processed.filter(
      (v) =>
        v.motStatus.code === "overdue" || v.serviceStatus.code === "overdue"
    ).length;
    const dueSoon = processed.filter(
      (v) =>
        v.motStatus.code === "due-soon" || v.serviceStatus.code === "due-soon"
    ).length;
    const defects = processed.filter((v) => v.hasDefects).length;

    return { total, overdue, dueSoon, defects };
  }, [processed]);

  const attentionVehicles = useMemo(() => {
    const overdue = processed.filter(
      (v) =>
        v.motStatus.code === "overdue" || v.serviceStatus.code === "overdue"
    );
    const dueSoon = processed.filter(
      (v) =>
        v.motStatus.code === "due-soon" || v.serviceStatus.code === "due-soon"
    );

    return [...overdue, ...dueSoon].slice(0, 5);
  }, [processed]);

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
        <View style={{ flex: 1 }}>
          <Image
            source={require("../../../assets/images/bickers-action-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text
            style={[
              styles.pageTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service & Maintenance
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Overview of MOT, servicing, defects and workshop activity.
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.profileButton,
            { borderColor: colors.border || COLORS.border },
          ]}
          onPress={() => router.push("/(protected)/service/settings")}
          activeOpacity={0.8}
        >
          <Icon
            name="user"
            size={22}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={colors.primary || COLORS.primaryAction}
          />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading fleet data…
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* FLEET SUMMARY CARD */}
          <View
            style={[
              styles.infoCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderLeftColor: colors.primary || COLORS.primaryAction,
              },
            ]}
          >
            <Text
              style={[
                styles.infoTextTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Fleet Overview
            </Text>

            <View style={styles.summaryRow}>
              <SummaryItem
                label="Total vehicles"
                value={summary.total}
                color={colors.text || COLORS.textHigh}
                labelColor={colors.textMuted || COLORS.textMid}
              />
              <SummaryItem
                label="Overdue"
                value={summary.overdue}
                color={
                  summary.overdue > 0
                    ? "#FF3B30"
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
            </View>

            <View style={[styles.summaryRow, { marginTop: 10 }]}>
              <SummaryItem
                label="Due soon (30d)"
                value={summary.dueSoon}
                color={
                  summary.dueSoon > 0
                    ? "#FF9500"
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
              <SummaryItem
                label="With defects"
                value={summary.defects}
                color={
                  summary.defects > 0
                    ? "#FF3B30"
                    : colors.textMuted || COLORS.textMid
                }
                labelColor={colors.textMuted || COLORS.textMid}
              />
            </View>
          </View>

          {/* QUICK ACTIONS */}
          <View style={styles.sectionDivider}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Quick Actions
            </Text>
          </View>

          <View style={styles.quickRow}>
            <QuickActionCard
              icon="clipboard"
              title="All MOT & Service"
              subtitle="See full maintenance list"
              onPress={() => router.push("/(protected)/service/service-list")}
              colors={colors}
            />
            <QuickActionCard
              icon="alert-triangle"
              title="Defects & Issues"
              subtitle="View reported problems"
              onPress={() => router.push("/(protected)/service/defects")}
              colors={colors}
            />
          </View>

          <View style={[styles.quickRow, { marginTop: 10 }]}>
            <QuickActionCard
              icon="tool"
              title="Book Workshop"
              subtitle="Off-road, repairs, tyres, etc."
              onPress={() => router.push("/(protected)/service/book-work")}
              colors={colors}
            />
            <QuickActionCard
              icon="clock"
              title="Service History"
              subtitle="Past MOT & servicing"
              onPress={() => router.push("/(protected)/service-history")}
              colors={colors}
            />
          </View>

          {/* ATTENTION NEEDED */}
          <View style={styles.sectionDivider}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              Attention Needed
            </Text>
          </View>

          {attentionVehicles.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                name="check-circle"
                size={30}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Nothing urgent
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                No MOT or service items are overdue or due soon.
              </Text>
            </View>
          ) : (
            attentionVehicles.map((v) => {
              const name = v.name || v.vehicleName || "Unnamed vehicle";
              const reg = v.reg || v.registration || "";
              const manufacturer = v.manufacturer || "";
              const model = v.model || "";
              const worstCode = v.worstCode;

              const motStatusWithDate = {
                ...v.motStatus,
                label:
                  v.motStatus.label +
                  (v.motDateRaw ? ` · ${formatDateShort(v.motDateRaw)}` : ""),
              };
              const serviceStatusWithDate = {
                ...v.serviceStatus,
                label:
                  v.serviceStatus.label +
                  (v.serviceDateRaw
                    ? ` · ${formatDateShort(v.serviceDateRaw)}`
                    : ""),
              };

              let borderAccent = colors.border || COLORS.border;
              if (worstCode === "overdue") borderAccent = "#FF3B30";
              else if (worstCode === "due-soon") borderAccent = "#FF9500";

              return (
                <TouchableOpacity
                  key={v.id}
                  style={[
                    styles.vehicleCard,
                    {
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderLeftColor: borderAccent,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() => router.push(`service/vehicles/${v.id}`)}
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
                            styles.vehicleReg,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          {manufacturer}
                          {manufacturer && model ? " · " : ""}
                          {model}
                        </Text>
                      )}
                    </View>
                    <Icon
                      name="chevron-right"
                      size={18}
                      color={colors.textMuted || COLORS.textMid}
                    />
                  </View>

                  <View style={styles.statusRow}>
                    <StatusPill label="MOT" status={motStatusWithDate} />
                    <StatusPill label="Service" status={serviceStatusWithDate} />
                    {v.hasDefects && (
                      <View style={styles.defectPill}>
                        <Icon
                          name="alert-triangle"
                          size={14}
                          color={COLORS.textHigh}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.defectText}>
                          {v.defects.length} defect
                          {v.defects.length > 1 ? "s" : ""}
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function SummaryItem({ label, value, color, labelColor }) {
  return (
    <View style={summaryStyles.item}>
      <Text style={[summaryStyles.value, { color }]}>{value}</Text>
      <Text style={[summaryStyles.label, { color: labelColor }]}>{label}</Text>
    </View>
  );
}

function QuickActionCard({ icon, title, subtitle, onPress, colors }) {
  return (
    <TouchableOpacity
      style={[
        quickStyles.card,
        {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={quickStyles.iconWrap}>
        {/* 👇 Force high-contrast icon so it’s always visible */}
        <Icon name={icon} size={18} color={COLORS.textHigh} />
      </View>
      <Text
        style={[
          quickStyles.title,
          { color: colors.text || COLORS.textHigh },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          quickStyles.subtitle,
          { color: colors.textMuted || COLORS.textLow || COLORS.textMid },
        ]}
      >
        {subtitle}
      </Text>
    </TouchableOpacity>
  );
}

function StatusPill({ label, status }) {
  const { colors } = useTheme();
  const code = status.code;
  let bg = "rgba(74, 74, 74, 0.7)";
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
    fg = colors.textMuted || COLORS.textMid;
  }

  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillText, { color: fg }]}>
        {label}: {status.label}
      </Text>
    </View>
  );
}

/* ---------- STYLES ---------- */

const summaryStyles = StyleSheet.create({
  item: {
    flex: 1,
    paddingRight: 12,
  },
  value: {
    fontSize: 20,
    fontWeight: "800",
  },
  label: {
    fontSize: 13,
    marginTop: 2,
  },
});

const quickStyles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 4,
    borderWidth: 1,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#262626",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: "row",
    alignItems: "center",
  },
  logo: {
    width: 140,
    height: 40,
    marginBottom: 6,
  },
  pageTitle: {
    color: COLORS.textHigh,
    fontSize: 22,
    fontWeight: "800",
  },
  pageSubtitle: {
    marginTop: 4,
    color: COLORS.textMid,
    fontSize: 13,
  },
  profileButton: {
    marginLeft: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primaryAction,
  },
  infoTextTitle: {
    color: COLORS.textHigh,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: "row",
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 15,
  },
  sectionTitle: {
    color: COLORS.textHigh,
    fontSize: 16,
    fontWeight: "700",
    paddingRight: 10,
  },
  quickRow: {
    flexDirection: "row",
    marginHorizontal: -4,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
  },
  vehicleCard: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.border,
  },
  vehicleHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  vehicleTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMid,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    alignItems: "center",
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 8,
    marginBottom: 4,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  defectPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: COLORS.recceAction,
    marginBottom: 4,
  },
  defectText: {
    fontSize: 11,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
});
