import { navigationMetrics } from "./design/navigation.js";

const exactHiddenTabRoutes = new Set([
  "/edit-profile",
  "/settings",
  "/timesheet",
  "/spec-sheets",
  "/insurance",
  "/document-viewer",
  "/work-diary",
  "/work-diary-board",
  "/holidaypage",
  "/holiday-request",
  "/maintenance",
  "/working-terms",
  "/service/repair-form",
  "/service/service-history",
  "/service/activity-history",
  "/service/settings",
]);

const hiddenTabPrefixes = [
  "/week/",
  "/service/service-form/",
  "/service/defects/",
  "/service/vehicles/",
  "/service/service-history/",
  "/service/service-record/",
  "/service/vehicle-timeline/",
  "/service/inspections/inspection-form/",
];

export function isTabBarHiddenPath(pathname) {
  const path = String(pathname || "");
  if (exactHiddenTabRoutes.has(path)) return true;
  return hiddenTabPrefixes.some((prefix) => path.startsWith(prefix));
}

export function resolveAppChrome(
  pathname,
  { inAuthGroup = false, keyboardVisible = false } = {}
) {
  const path = String(pathname || "");
  const tabsVisible =
    !inAuthGroup && !keyboardVisible && !isTabBarHiddenPath(path);

  return {
    tabsVisible,
    workspace: path.startsWith("/service") ? "service" : "main",
  };
}

export function getPageShellBottomPadding({
  safeAreaBottom = 0,
  tabsVisible = false,
  floatingAccessoryHeight = 0,
} = {}) {
  const safeBottom = Math.max(0, Number(safeAreaBottom) || 0);
  if (!tabsVisible) return safeBottom + navigationMetrics.contentGap;
  return (
    navigationMetrics.tabBarHeight +
    Math.max(
      navigationMetrics.tabBarMinBottomGap,
      safeBottom - navigationMetrics.tabBarBottomOffset
    ) +
    navigationMetrics.contentGap +
    Math.max(0, Number(floatingAccessoryHeight) || 0)
  );
}
