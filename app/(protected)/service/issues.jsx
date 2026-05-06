import { useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
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

import PageHeaderCard from "../../../components/PageHeaderCard";
import { db } from "../../../firebaseConfig";
import { designTokens as t } from "../../../lib/design/tokens";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#ED1C25",
  amber: "#F59E0B",
};

function normaliseKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isApprovedDefect(review) {
  const status = normaliseKey(review?.status);
  const category = normaliseKey(review?.category);
  return status === "approved" && (category === "general" || category === "immediate");
}

function isOpenMaintenance(status) {
  const value = normaliseKey(status);
  return value !== "resolved" && value !== "complete" && value !== "completed";
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toDateMaybe(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value) {
  const d = toDateMaybe(value);
  if (!d) return "No date";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function getRecordDate(record) {
  return (
    record?.reportedAt ||
    record?.createdAt ||
    record?.inspectionDateISO ||
    record?.serviceDateOnly ||
    record?.completedDate ||
    record?.updatedAt ||
    null
  );
}

function getVehicleText(record) {
  return [record?.vehicleName || record?.vehicle || record?.name, record?.registration || record?.reg]
    .filter(Boolean)
    .join(" · ");
}

function getEquipmentText(record) {
  return [
    record?.equipmentName || record?.name,
    record?.serialNumber || record?.equipmentId,
    record?.asset,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildOpenDefects({ vehicleChecks, vehicleIssues, defectReports }) {
  const checkDefects = vehicleChecks.flatMap((check) => {
    const items = Array.isArray(check.items) ? check.items : [];
    return items
      .filter((item) => isApprovedDefect(item?.review) && isOpenMaintenance(item?.maintenance?.status))
      .map((item, index) => ({
        id: `check-${check.id}-${item?.id || index}`,
        title: item?.label || item?.title || item?.name || "Vehicle check defect",
        details: item?.notes || item?.review?.notes || item?.maintenance?.notes || "Approved check defect.",
        asset: getVehicleText(check) || "Vehicle check",
        date: getRecordDate(check),
        route: null,
      }));
  });

  const issueDefects = vehicleIssues
    .filter((issue) => isApprovedDefect(issue?.review) && isOpenMaintenance(issue?.maintenance?.status))
    .map((issue) => ({
      id: `issue-${issue.id}`,
      title: issue?.title || issue?.category || "Vehicle issue",
      details: issue?.description || issue?.notes || issue?.review?.notes || "Approved vehicle issue.",
      asset: getVehicleText(issue) || "Vehicle issue",
      date: getRecordDate(issue),
      route: null,
    }));

  const reportDefects = defectReports
    .filter((report) => isOpenMaintenance(report?.status))
    .map((report) => ({
      id: `defect-${report.id}`,
      title: report?.category || report?.title || "Defect report",
      details: report?.description || report?.notes || "Open defect report.",
      asset: getEquipmentText(report) || getVehicleText(report) || "Defect report",
      date: getRecordDate(report),
      route: report.id ? `/service/defects/${report.id}` : "/service/defects",
    }));

  return [...checkDefects, ...issueDefects, ...reportDefects].sort(
    (a, b) => (toDateMaybe(b.date)?.getTime() || 0) - (toDateMaybe(a.date)?.getTime() || 0)
  );
}

function buildAdvisories({ serviceRecords, equipmentInspections }) {
  const services = serviceRecords.flatMap((record) => {
    const report = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
    return report.map((item, index) => ({
      id: `service-advisory-${record.id}-${item?.key || index}`,
      title: item?.title || "Service advisory",
      details: item?.details || item?.note || "Amber service item recorded.",
      asset: getVehicleText(record) || "Unknown vehicle",
      date: getRecordDate(record),
      route: record.id ? `/service/service-record/${record.id}` : null,
    }));
  });

  const inspections = equipmentInspections.flatMap((record) => {
    const report = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
    return report.map((item, index) => ({
      id: `inspection-advisory-${record.id}-${item?.key || index}`,
      title: item?.title || "Equipment advisory",
      details: item?.details || item?.note || "Amber inspection item recorded.",
      asset: getEquipmentText(record) || "Unknown equipment",
      date: getRecordDate(record),
      route: record.id ? `/service/inspections/inspection-form/${record.id}` : null,
    }));
  });

  return [...services, ...inspections].sort(
    (a, b) => (toDateMaybe(b.date)?.getTime() || 0) - (toDateMaybe(a.date)?.getTime() || 0)
  );
}

function useCollectionRows(collectionName, label) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, collectionName),
      (snap) => setRows(snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }))),
      (err) => console.error(`Failed to load ${label}:`, err)
    );

    return () => unsub();
  }, [collectionName, label]);

  return rows;
}

export default function ServiceIssuesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);

  const vehicleChecks = useCollectionRows("vehicleChecks", "vehicle check issues");
  const vehicleIssues = useCollectionRows("vehicleIssues", "vehicle issues");
  const defectReports = useCollectionRows("defectReports", "defect reports");
  const serviceRecords = useCollectionRows("serviceRecords", "service advisories");
  const equipmentInspections = useCollectionRows("equipmentInspections", "equipment advisories");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const defects = useMemo(
    () => buildOpenDefects({ vehicleChecks, vehicleIssues, defectReports }),
    [defectReports, vehicleChecks, vehicleIssues]
  );

  const advisories = useMemo(
    () => buildAdvisories({ serviceRecords, equipmentInspections }),
    [equipmentInspections, serviceRecords]
  );

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.container, { backgroundColor: colors.background || COLORS.background }]}
    >
      <PageHeaderCard
        eyebrow="Workshop"
        title="Issues"
        subtitle="Open defects and amber advisories needing workshop attention."
        style={styles.headerCard}
        contentStyle={styles.headerContent}
        eyebrowStyle={styles.headerEyebrow}
        titleStyle={styles.headerTitle}
        subtitleStyle={styles.headerSubtitle}
      />

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent || COLORS.primaryAction} />
          <Text style={[styles.loadingText, { color: colors.textMuted || COLORS.textMid }]}>
            Loading issues...
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.summaryRow}>
            <SummaryCard label="Open defects" value={defects.length} tone="red" colors={colors} />
            <SummaryCard label="Advisories" value={advisories.length} tone="amber" colors={colors} />
          </View>

          <IssueSection
            title="Defects & Issues"
            subtitle="Red/open items that need repair or investigation."
            emptyText="No open defects."
            items={defects}
            icon="alert-triangle"
            tone="red"
            colors={colors}
            onOpen={(route) => {
              if (route) router.push(route);
            }}
          />

          <IssueSection
            title="Advisories"
            subtitle="Amber items to monitor before they become defects."
            emptyText="No amber advisories."
            items={advisories}
            icon="eye"
            tone="amber"
            colors={colors}
            onOpen={(route) => {
              if (route) router.push(route);
            }}
          />

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, tone, colors }) {
  const color = tone === "red" ? COLORS.primaryAction : COLORS.amber;
  return (
    <View
      style={[
        styles.summaryCard,
        {
          backgroundColor: colors.surfaceAlt || COLORS.card,
          borderColor: colors.border || COLORS.border,
        },
      ]}
    >
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: colors.textMuted || COLORS.textMid }]}>
        {label}
      </Text>
    </View>
  );
}

function IssueSection({ title, subtitle, emptyText, items, icon, tone, colors, onOpen }) {
  const badgeColor = tone === "red" ? COLORS.primaryAction : COLORS.amber;
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeaderRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
            {title}
          </Text>
          <Text style={[styles.sectionSubtitle, { color: colors.textMuted || COLORS.textMid }]}>
            {subtitle}
          </Text>
        </View>
        <Text style={[styles.sectionCount, { color: colors.textMuted || COLORS.textMid }]}>
          {items.length}
        </Text>
      </View>

      {items.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <Text style={[styles.emptyText, { color: colors.textMuted || COLORS.textMid }]}>
            {emptyText}
          </Text>
        </View>
      ) : (
        items.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[
              styles.issueCard,
              {
                backgroundColor: colors.surfaceAlt || COLORS.card,
                borderColor: colors.border || COLORS.border,
              },
            ]}
            activeOpacity={item.route ? 0.85 : 1}
            onPress={() => onOpen(item.route)}
          >
            <View style={[styles.iconWrap, { backgroundColor: badgeColor }]}>
              <Icon name={icon} size={17} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.issueHeaderRow}>
                <Text style={[styles.issueTitle, { color: colors.text || COLORS.textHigh }]}>
                  {item.title}
                </Text>
                <Text style={[styles.issueDate, { color: colors.textMuted || COLORS.textLow }]}>
                  {formatDate(item.date)}
                </Text>
              </View>
              <Text style={[styles.assetText, { color: colors.textMuted || COLORS.textMid }]}>
                {item.asset}
              </Text>
              <Text style={[styles.detailText, { color: colors.textMuted || COLORS.textMid }]}>
                {item.details}
              </Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
  },
  headerCard: {
    marginHorizontal: t.spacing.md,
    marginTop: 0,
    marginBottom: 0,
  },
  headerContent: {
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerEyebrow: {
    fontSize: 11,
    lineHeight: 14,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 27,
    marginTop: 1,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 6,
    paddingBottom: 104,
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "900",
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 12,
  },
  sectionBlock: {
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
  },
  sectionSubtitle: {
    marginTop: 2,
    fontSize: 12,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: "800",
  },
  emptyCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  emptyText: {
    fontSize: 13,
  },
  issueCard: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 9,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  issueHeaderRow: {
    flexDirection: "row",
    gap: 8,
  },
  issueTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
  },
  issueDate: {
    fontSize: 11,
  },
  assetText: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "700",
  },
  detailText: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 18,
  },
});
