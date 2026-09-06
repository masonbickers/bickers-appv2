import { AppText as Text } from "../ui/AppPrimitives";
import {
  usePathname,
  useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet,
  Pressable,
  View,
} from "react-native";
import Ionicons from "react-native-vector-icons/Ionicons";

import { useBookings } from "../../hooks/useOperationalData";
import { resolveWorkspaceAccess } from "../../lib/access";
import { designTokens as t } from "../../lib/design/tokens";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import BottomNavigationBar from "./BottomNavigationBar";

const clean = (value) => String(value ?? "").trim().toLowerCase();
const todayISO = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const valueList = (value) => (Array.isArray(value) ? value : value == null ? [] : [value]);
const bookingIncludesDate = (booking, dateISO) =>
  valueList(booking?.bookingDates).some((value) => {
    if (typeof value === "string") return value.slice(0, 10) === dateISO;
    const date = value?.toDate?.() || new Date(value);
    if (Number.isNaN(date?.getTime?.())) return false;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` === dateISO;
  });
const recceNoteForDate = (booking, dateISO) => {
  const notes = booking?.notesByDate || {};
  return String(notes[dateISO] === "Other" ? notes[`${dateISO}-other`] : notes[dateISO] || "");
};
const assignedToEmployeeOnDate = (booking, employee, dateISO) => {
  const assignments =
    booking?.employeesByDate?.[dateISO] ||
    booking?.employeeAssignmentsByDate?.[dateISO] ||
    booking?.employeeCodesByDate?.[dateISO] ||
    booking?.assignedEmployeeCodesByDate?.[dateISO] ||
    booking?.employees ||
    booking?.employeeCodes ||
    [];
  const employeeTokens = new Set(
    [employee?.userCode, employee?.employeeCode, employee?.name, employee?.displayName].map(clean).filter(Boolean)
  );
  return valueList(assignments).some((assigned) => {
    const tokens = assigned && typeof assigned === "object"
      ? [assigned.userCode, assigned.employeeCode, assigned.code, assigned.name, assigned.displayName]
      : [assigned];
    return tokens.map(clean).some((token) => employeeTokens.has(token));
  });
};

export default function Footer() {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();
  const { employee } = useAuth() ?? {};
  const bookingsResource = useBookings();
  const workspaceAccess = resolveWorkspaceAccess(employee);
  const isServiceOnlyUser = workspaceAccess.service && !workspaceAccess.user;
  const recceJobsToday = useMemo(() => {
    const dateISO = todayISO();
    return bookingsResource.data.filter(
      (booking) =>
        booking?.isCrewed === true &&
        bookingIncludesDate(booking, dateISO) &&
        assignedToEmployeeOnDate(booking, employee, dateISO) &&
        /\brecce\s*day\b/i.test(recceNoteForDate(booking, dateISO))
    );
  }, [bookingsResource.data, employee]);

  const tabs = [
    { route: "/screens/homescreen", label: "Home", iconActive: "home", iconInactive: "home-outline", symbol: { active: "house.fill", inactive: "house" } },
    { route: "/screens/schedule", label: "Schedule", iconActive: "calendar", iconInactive: "calendar-outline", symbol: { active: "calendar", inactive: "calendar" } },
    { route: "/job", label: "Jobs", iconActive: "document-text", iconInactive: "document-text-outline", symbol: { active: "doc.text.fill", inactive: "doc.text" } },
    { route: "/contacts", label: "Contacts", iconActive: "people", iconInactive: "people-outline", symbol: { active: "person.2.fill", inactive: "person.2" } },
    { route: "/me", label: "Me", iconActive: "person-circle", iconInactive: "person-circle-outline", symbol: { active: "person.crop.circle.fill", inactive: "person.crop.circle" } },
  ];
  const isActive = (tab) => {
    if (tab.route === "/screens/homescreen" && (pathname === "/notifications" || pathname?.startsWith("/notification/"))) return true;
    if (tab.route === "/job" && isServiceOnlyUser) return pathname?.startsWith("/service");
    return pathname === tab.route || pathname?.startsWith(tab.route);
  };
  const activeIndex = tabs.findIndex(isActive);

  const floatingContent = recceJobsToday.length ? (
    <View style={styles.recceStack} pointerEvents="box-none">
      {recceJobsToday.map((job) => (
        <Pressable
          key={`footer-recce-${job.id}`}
          onPress={() => router.push({
            pathname: "/recce-form",
            params: { jobId: job.id, dateISO: todayISO(), jobNumber: job.jobNumber || "N/A", locationName: job.location || "" },
          })}
          style={({ pressed }) => [styles.recceButton, { backgroundColor: colors.accent, opacity: pressed ? 0.78 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel={`Open today's recce form for job ${job.jobNumber || ""}`.trim()}
        >
          <View style={styles.recceCopy}>
            <Text style={[styles.recceEyebrow, { color: colors.textOnAccent }]}>RECCE TODAY</Text>
            <Text style={[styles.recceTitle, { color: colors.textOnAccent }]} numberOfLines={1}>
              {job.location || `Job #${job.jobNumber || "N/A"}`}
            </Text>
          </View>
          <Ionicons name="location-outline" size={t.iconSize.sm} color={colors.textOnAccent} />
        </Pressable>
      ))}
    </View>
  ) : null;

  return (
    <BottomNavigationBar
      tabs={tabs}
      activeIndex={activeIndex}
      floatingContent={floatingContent}
      onSelect={(tab) => router.navigate(tab.route === "/job" && isServiceOnlyUser ? "/service/home" : tab.route)}
    />
  );
}

const styles = StyleSheet.create({
  recceStack: {
    alignItems: "flex-end",
    gap: t.spacing.xs,
  },
  recceButton: {
    minHeight: t.controls.buttonHeight,
    maxWidth: 190,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    ...t.shadows.lg,
  },
  recceCopy: { flexShrink: 1, minWidth: 0 },
  recceEyebrow: { ...t.typography.caption, fontSize: t.typography.micro.fontSize, lineHeight: t.typography.micro.lineHeight, fontWeight: "900" },
  recceTitle: { ...t.typography.caption, marginTop: t.spacing.none, fontWeight: "900" },
});
