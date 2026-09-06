import { usePathname, useRouter } from "expo-router";
import { useMemo } from "react";

import { useServiceCollection } from "../../hooks/useServiceData";
import { countOpenMonitorItems } from "../../lib/serviceAdvisories";
import BottomNavigationBar from "./BottomNavigationBar";
import SyncStatusControl from "./SyncStatusControl";

const normaliseKey = (value) => String(value || "").trim().toLowerCase();
const isApprovedDefect = (review) => {
  const status = normaliseKey(review?.status);
  const category = normaliseKey(review?.category);
  return status === "approved" && (category === "general" || category === "immediate");
};
const isOpenMaintenance = (status) => !["resolved", "complete", "completed"].includes(normaliseKey(status));
const countOpenCheckDefects = (checks) =>
  checks.reduce(
    (sum, check) =>
      sum +
      (Array.isArray(check.items) ? check.items : []).filter(
        (item) => isApprovedDefect(item?.review) && isOpenMaintenance(item?.maintenance?.status)
      ).length,
    0
  );
const countOpenIssueDefects = (issues) =>
  issues.filter((issue) => isApprovedDefect(issue?.review) && isOpenMaintenance(issue?.maintenance?.status)).length;
const countOpenManualDefects = (reports) => reports.filter((report) => isOpenMaintenance(report?.status)).length;

export default function ServiceFooter() {
  const router = useRouter();
  const pathname = usePathname();
  const vehicleChecks = useServiceCollection("vehicleChecks").data;
  const vehicleIssues = useServiceCollection("vehicleIssues").data;
  const defectReports = useServiceCollection("defectReports").data;
  const serviceRecords = useServiceCollection("serviceRecords").data;
  const equipmentInspections = useServiceCollection("equipmentInspections").data;
  const issueCount = useMemo(
    () =>
      countOpenCheckDefects(vehicleChecks) +
      countOpenIssueDefects(vehicleIssues) +
      countOpenManualDefects(defectReports) +
      countOpenMonitorItems(serviceRecords) +
      countOpenMonitorItems(equipmentInspections),
    [defectReports, equipmentInspections, serviceRecords, vehicleChecks, vehicleIssues]
  );

  const tabs = [
    { route: "/service/home", label: "Home", iconActive: "home", iconInactive: "home-outline", symbol: { active: "house.fill", inactive: "house" } },
    { route: "/service/work", label: "Forms", iconActive: "construct", iconInactive: "construct-outline", symbol: { active: "wrench.and.screwdriver.fill", inactive: "wrench.and.screwdriver" } },
    { route: "/service/book-work", label: "To-Do", iconActive: "clipboard", iconInactive: "clipboard-outline", symbol: { active: "clipboard.fill", inactive: "clipboard" } },
    { route: "/service/service-list", label: "Fleet", iconActive: "list", iconInactive: "list-outline", symbol: { active: "list.bullet.rectangle.fill", inactive: "list.bullet.rectangle" } },
    {
      route: "/service/issues",
      label: "Issues",
      iconActive: "alert-circle",
      iconInactive: "alert-circle-outline",
      symbol: { active: "exclamationmark.circle.fill", inactive: "exclamationmark.circle" },
      badge: issueCount > 0 ? (issueCount > 99 ? "99+" : String(issueCount)) : null,
      accessibilityLabel: issueCount > 0 ? `Issues, ${issueCount} open` : "Issues",
    },
  ];
  const activeIndex = tabs.findIndex(
    (tab) => pathname === tab.route || pathname?.startsWith(`${tab.route}/`)
  );

  return (
    <BottomNavigationBar
      tabs={tabs}
      activeIndex={activeIndex}
      floatingContent={<SyncStatusControl />}
      onSelect={(tab) => router.navigate(tab.route)}
    />
  );
}
