// app/(protected)/service/inspections/index.js
import { useFocusEffect, useRouter } from "expo-router";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { useCallback, useState } from "react";
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

const STATUS_COLORS = {
  pass: { bg: "rgba(34,197,94,0.15)", fg: "#22C55E" },
  fail: { bg: "rgba(239,68,68,0.15)", fg: "#EF4444" },
  incomplete: { bg: "rgba(245,158,11,0.15)", fg: "#F59E0B" },
};

function formatDate(raw) {
  if (!raw) return "—";
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InspectionsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      const q = query(
        collection(db, "equipmentInspections"),
        orderBy("createdAt", "desc")
      );
      const unsub = onSnapshot(
        q,
        (snap) => {
          setInspections(
            snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
          );
          setLoading(false);
        },
        (err) => {
          console.error("Failed to load inspections:", err);
          setLoading(false);
        }
      );
      return () => unsub();
    }, [])
  );

  const handleNew = () => {
    router.push(`/service/inspections/inspection-form/new-${Date.now()}`);
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
        <View style={{ flex: 1 }}>
          <Text
            style={[styles.pageTitle, { color: colors.text || COLORS.textHigh }]}
          >
            Equipment Inspections
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Pre-use and periodic equipment condition checks.
          </Text>
        </View>
        <TouchableOpacity
          style={styles.newButton}
          onPress={handleNew}
          activeOpacity={0.85}
        >
          <Icon name="plus" size={18} color={COLORS.textHigh} />
          <Text style={styles.newButtonText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primaryAction} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {inspections.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon
                name="clipboard"
                size={36}
                color={colors.textMuted || COLORS.textLow}
              />
              <Text
                style={[
                  styles.emptyTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                No inspections yet
              </Text>
              <Text
                style={[
                  styles.emptySubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Tap New to record your first equipment inspection.
              </Text>
            </View>
          ) : (
            inspections.map((insp) => {
              const statusKey =
                insp.overallResult === "pass"
                  ? "pass"
                  : insp.overallResult === "fail"
                  ? "fail"
                  : "incomplete";
              const sc = STATUS_COLORS[statusKey];

              return (
                <TouchableOpacity
                  key={insp.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.surfaceAlt || COLORS.card,
                      borderColor: colors.border || COLORS.border,
                    },
                  ]}
                  activeOpacity={0.85}
                  onPress={() =>
                    router.push(
                      `/service/inspections/inspection-form/${insp.id}`
                    )
                  }
                >
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.cardTitle,
                          { color: colors.text || COLORS.textHigh },
                        ]}
                        numberOfLines={1}
                      >
                        {insp.equipmentName || "Unnamed equipment"}
                      </Text>
                      {!!insp.equipmentId && (
                        <Text
                          style={[
                            styles.cardSub,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          ID: {insp.equipmentId}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusPillText, { color: sc.fg }]}>
                        {statusKey.charAt(0).toUpperCase() + statusKey.slice(1)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.cardMeta}>
                    <View style={styles.metaItem}>
                      <Icon
                        name="calendar"
                        size={12}
                        color={colors.textMuted || COLORS.textLow}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.metaText,
                          { color: colors.textMuted || COLORS.textMid },
                        ]}
                      >
                        {formatDate(insp.createdAt)}
                      </Text>
                    </View>
                    {!!insp.inspectedBy && (
                      <View style={styles.metaItem}>
                        <Icon
                          name="user"
                          size={12}
                          color={colors.textMuted || COLORS.textLow}
                          style={{ marginRight: 4 }}
                        />
                        <Text
                          style={[
                            styles.metaText,
                            { color: colors.textMuted || COLORS.textMid },
                          ]}
                        >
                          {insp.inspectedBy}
                        </Text>
                      </View>
                    )}
                  </View>

                  <Icon
                    name="chevron-right"
                    size={16}
                    color={colors.textMuted || COLORS.textLow}
                    style={styles.cardChevron}
                  />
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  pageTitle: { fontSize: 22, fontWeight: "800" },
  pageSubtitle: { marginTop: 2, fontSize: 13 },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primaryAction,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 12,
  },
  newButtonText: {
    color: COLORS.textHigh,
    fontWeight: "700",
    fontSize: 14,
    marginLeft: 4,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 16, paddingTop: 12 },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: { marginTop: 14, fontSize: 17, fontWeight: "700" },
  emptySubtitle: { marginTop: 6, fontSize: 13, textAlign: "center" },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
    position: "relative",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  cardSub: { fontSize: 12, marginTop: 2 },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 8,
    alignSelf: "flex-start",
  },
  statusPillText: { fontSize: 11, fontWeight: "700" },
  cardMeta: { flexDirection: "row", gap: 14 },
  metaItem: { flexDirection: "row", alignItems: "center" },
  metaText: { fontSize: 12 },
  cardChevron: { position: "absolute", right: 12, top: "50%" },
});
