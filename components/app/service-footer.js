// components/app/service-footer.jsx
import { usePathname, useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { db } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

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

function countOpenCheckDefects(checks) {
  return checks.reduce((sum, check) => {
    const items = Array.isArray(check.items) ? check.items : [];
    const openItems = items.filter(
      (item) =>
        isApprovedDefect(item?.review) &&
        isOpenMaintenance(item?.maintenance?.status)
    );
    return sum + openItems.length;
  }, 0);
}

function countOpenIssueDefects(issues) {
  return issues.filter(
    (issue) =>
      isApprovedDefect(issue?.review) &&
      isOpenMaintenance(issue?.maintenance?.status)
  ).length;
}

function countOpenManualDefects(reports) {
  return reports.filter((report) => isOpenMaintenance(report?.status)).length;
}

function countMonitorItems(records) {
  return records.reduce((sum, record) => {
    const items = Array.isArray(record?.monitorReport) ? record.monitorReport : [];
    return sum + items.length;
  }, 0);
}

export default function ServiceFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();
  const [vehicleChecks, setVehicleChecks] = useState([]);
  const [vehicleIssues, setVehicleIssues] = useState([]);
  const [defectReports, setDefectReports] = useState([]);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [equipmentInspections, setEquipmentInspections] = useState([]);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "vehicleChecks"),
      (snap) => {
        setVehicleChecks(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Failed to load footer defect checks:", err);
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "vehicleIssues"),
      (snap) => {
        setVehicleIssues(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Failed to load footer defect issues:", err);
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "defectReports"),
      (snap) => {
        setDefectReports(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Failed to load footer defect reports:", err);
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "serviceRecords"),
      (snap) => {
        setServiceRecords(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Failed to load footer service advisories:", err);
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "equipmentInspections"),
      (snap) => {
        setEquipmentInspections(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => {
        console.error("Failed to load footer inspection advisories:", err);
      }
    );

    return () => unsub();
  }, []);

  const openDefectCount = useMemo(
    () =>
      countOpenCheckDefects(vehicleChecks) +
      countOpenIssueDefects(vehicleIssues) +
      countOpenManualDefects(defectReports),
    [defectReports, vehicleChecks, vehicleIssues]
  );

  const advisoryCount = useMemo(
    () => countMonitorItems(serviceRecords) + countMonitorItems(equipmentInspections),
    [equipmentInspections, serviceRecords]
  );

  const issueCount = openDefectCount + advisoryCount;

  // 🔧 Tabs dedicated to Service / Workshop area
  // URLs are /service/... (group (protected) is hidden from URL)
  const tabs = [
    {
      route: "/service/home",          // app/(protected)/service/home.jsx
      label: "Home",
      iconActive: "home",
      iconInactive: "home-outline",
    },
    {
      // e.g. app/(protected)/service/work.jsx or index for overview
      route: "/service/work",
      label: "Overview",
      iconActive: "construct",
      iconInactive: "construct-outline",
    },
    {
      // app/(protected)/service/book-work.jsx
      route: "/service/book-work",
      label: "Book Work",
      iconActive: "clipboard",
      iconInactive: "clipboard-outline",
    },
    {
      // app/(protected)/service/service-list.jsx
      route: "/service/service-list",
      label: "Schedule",
      iconActive: "list",
      iconInactive: "list-outline",
    },
    {
      route: "/service/issues",
      label: "Issues",
      iconActive: "alert-circle",
      iconInactive: "alert-circle-outline",
    },
  ];

  const activeColor = colors.accent;
  const inactiveColor = colors.textMuted;
  const bg = colors.surface;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.footer,
          {
            backgroundColor: bg,
            borderTopColor: colors.border,
            shadowColor: "#000",
          },
        ]}
      >
        {tabs.map((t) => {
          // ✅ pathname comes back like "/service/home"
          const isActive =
            pathname === t.route ||
            (t.route !== "/" && pathname?.startsWith(t.route + "/"));

          const handlePress = () => {
            if (isActive) return;
            router.navigate(t.route);
          };

          return (
            <TouchableOpacity
              key={t.route}
              style={styles.tab}
              activeOpacity={isActive ? 1 : 0.6}
              onPress={handlePress}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={
                t.route === "/service/issues" && issueCount > 0
                  ? `${t.label}, ${issueCount} open`
                  : t.label
              }
            >
              <View style={styles.iconWrap}>
                <Ionicons
                  name={isActive ? t.iconActive : t.iconInactive}
                  size={26}
                  color={isActive ? activeColor : inactiveColor}
                />
                {t.route === "/service/issues" && issueCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {issueCount > 99 ? "99+" : issueCount}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 0 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 0,
    borderRadius: 0,
    paddingVertical: 7,
    paddingHorizontal: 4,
    ...Platform.select({
      ios: {
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: -2 },
      },
      android: { elevation: 8 },
    }),
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 0,
  },
  iconWrap: {
    width: 38,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -2,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ED1C25",
    borderWidth: 1,
    borderColor: "#FFFFFF",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "800",
  },
});
