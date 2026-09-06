import { AppText as Text, AppPressable as TouchableOpacity } from "../../components/ui/AppPrimitives";
// app/(protected)/notifications.js
import {
  useRouter } from "expo-router";
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { useVehicles } from "../../hooks/useOperationalData";
import { resolveNotificationVehicleBody } from "../../lib/fleetSchema";
import { syncRemoteNotificationsToInbox } from "../../lib/remoteNotifications";
import {
  collapseInboxDuplicates,
  clearInbox,
  getInbox,
  markAllRead,
  markRead,
  subscribeToInbox,
} from "../../lib/notificationInbox";
import {
  getTimesheetReminderHref,
  isTimesheetReminder,
} from "../../lib/timesheetNotification";
import { useTheme } from "../../providers/ThemeProvider";
import { useAuth } from "../../providers/AuthProvider";
import { withAlpha } from "../../lib/design/color";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

function formatTime(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}

function notificationGroupLabel(ts) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Earlier";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const dayDifference = Math.round((today.getTime() - day.getTime()) / 86400000);

  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  if (dayDifference <= 7) return "Last 7 days";
  return "Earlier";
}

function notificationPresentation(data = {}) {
  if (isTimesheetReminder(data)) return { icon: "clock", label: "Timesheet" };
  if (data?.bookingId) return { icon: "briefcase", label: "Job" };
  if (data?.holidayId) return { icon: "umbrella", label: "Holiday" };
  return { icon: "info", label: "General" };
}

export default function NotificationsPage() {
  const router = useRouter();
  const { colors } = useTheme();
  const { user, employee } = useAuth();
  const vehiclesResource = useVehicles();

  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");

  const displayItems = useMemo(() => collapseInboxDuplicates(items), [items]);

  const unreadCount = useMemo(
    () => displayItems.filter((n) => !n.read).length,
    [displayItems]
  );
  const visibleItems = useMemo(() => {
    if (filter === "unread") return displayItems.filter((item) => !item.read);
    if (filter === "jobs") return displayItems.filter((item) => item.data?.bookingId);
    if (filter === "timesheets") return displayItems.filter((item) => isTimesheetReminder(item.data));
    if (filter === "holidays") return displayItems.filter((item) => item.data?.holidayId);
    return displayItems;
  }, [displayItems, filter]);
  const groupedItems = useMemo(() => {
    const groups = [];
    visibleItems.forEach((item) => {
      const label = notificationGroupLabel(item.createdAt);
      const current = groups[groups.length - 1];
      if (current?.label === label) current.items.push(item);
      else groups.push({ label, items: [item] });
    });
    return groups;
  }, [visibleItems]);

  const load = useCallback(async () => {
    const list = await getInbox();
    setItems(list);
  }, []);

  useEffect(() => {
    let active = true;
    load();
    const unsubscribe = subscribeToInbox((inbox) => {
      if (active) setItems(inbox);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncRemoteNotificationsToInbox({ user, employee }).catch((error) =>
        console.warn("[web-notifications] manual sync failed:", error)
      );
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [employee, load, user]);

  const onTap = useCallback(
    async (n) => {
      // mark read immediately
      await markRead(n.id);
      await load();

      const timesheetHref = getTimesheetReminderHref(n.data);
      if (timesheetHref) {
        router.push(timesheetHref);
        return;
      }

      router.push(`/(protected)/notification/${n.id}`);
    },
    [router, load]
  );

  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
    await load();
  }, [load]);

  const handleClearAll = useCallback(async () => {
    await clearInbox();
    await load();
  }, [load]);

  const confirmClearAll = useCallback(() => {
    if (items.length === 0) return;
    Alert.alert(
      "Clear notifications?",
      "This removes every notification from your inbox.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear all", style: "destructive", onPress: handleClearAll },
      ]
    );
  }, [handleClearAll, items.length]);

  const openInboxActions = useCallback(() => {
    Alert.alert("Inbox actions", undefined, [
      ...(unreadCount > 0
        ? [{ text: "Mark all as read", onPress: handleMarkAllRead }]
        : []),
      ...(items.length > 0
        ? [{ text: "Clear notifications", style: "destructive", onPress: confirmClearAll }]
        : []),
      { text: "Cancel", style: "cancel" },
    ]);
  }, [confirmClearAll, handleMarkAllRead, items.length, unreadCount]);

  const filters = [
    { key: "all", label: "All" },
    { key: "unread", label: `Unread ${unreadCount}` },
    { key: "jobs", label: "Jobs" },
    { key: "timesheets", label: "Timesheets" },
    { key: "holidays", label: "Holidays" },
  ];

  return (
    <PageShell
      contentSpacing="compact"
      gutter="compact"
      header={{
        variant: "compact",
        title: "Notifications",
        subtitle: unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up",
        onBack: router.back,
        action: { label: "Actions", icon: "more-horizontal", onPress: openInboxActions },
      }}
      refresh={{ refreshing, onRefresh }}
    >

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
        style={styles.filtersScroll}
      >
        {filters.map((option) => {
          const selected = filter === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              onPress={() => setFilter(option.key)}
              activeOpacity={0.84}
              style={[
                styles.filterChip,
                {
                  backgroundColor: selected
                    ? withAlpha(colors.accent, 0.14)
                    : colors.surfaceAlt,
                  borderColor: selected
                    ? withAlpha(colors.accent, 0.42)
                    : withAlpha(colors.border, 0.72),
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text
                style={[
                  styles.filterText,
                  { color: selected ? colors.accent : colors.text },
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.content}>
        {visibleItems.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
              <Icon name="bell" size={24} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {items.length === 0 ? "No notifications" : "Nothing here yet"}
            </Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>
              {items.length === 0
                ? "Job, holiday and timesheet updates will appear here."
                : "Try another filter to see your other notifications."}
            </Text>
          </View>
        ) : (
          groupedItems.map((group) => (
            <View key={group.label} style={styles.group}>
              <View style={styles.groupHeading}>
                <Text style={[styles.groupTitle, { color: colors.text }]}>{group.label}</Text>
                <Text style={[styles.groupCount, { color: colors.textMuted }]}>
                  {group.items.length}
                </Text>
              </View>

              <View
                style={[
                  styles.groupCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: withAlpha(colors.border, 0.78),
                  },
                ]}
              >
                {group.items.map((notification, index) => {
                const unread = !notification.read;
                const presentation = notificationPresentation(notification.data);
                const body = resolveNotificationVehicleBody(
                  notification.body,
                  vehiclesResource.data
                );

                return (
                  <TouchableOpacity
                    key={notification.id}
                    onPress={() => onTap(notification)}
                    activeOpacity={0.78}
                    style={[
                      styles.notificationRow,
                      index < group.items.length - 1 && {
                        borderBottomColor: withAlpha(colors.border, 0.62),
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`${notification.title}, ${formatTime(
                      notification.createdAt
                    )}`}
                  >
                    <View
                      style={[
                        styles.notificationIcon,
                        {
                          backgroundColor: unread
                            ? withAlpha(colors.accent, 0.13)
                            : colors.surfaceAlt,
                          borderColor: unread
                            ? withAlpha(colors.accent, 0.3)
                            : withAlpha(colors.border, 0.72),
                        },
                      ]}
                    >
                      <Icon
                        name={presentation.icon}
                        size={20}
                        color={unread ? colors.accent : colors.textMuted}
                      />
                      {unread && (
                        <View
                          style={[
                            styles.notificationUnreadDot,
                            {
                              backgroundColor: colors.accent,
                              borderColor: colors.background,
                            },
                          ]}
                        />
                      )}
                    </View>

                    <View style={styles.notificationCopy}>
                      <View style={styles.notificationTitleRow}>
                        <Text
                          style={[styles.notificationTitle, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {notification.title}
                        </Text>
                        <Text style={[styles.notificationTime, { color: colors.textMuted }]}>
                          {formatTime(notification.createdAt)}
                        </Text>
                      </View>
                      {!!body && (
                        <Text
                          style={[styles.notificationBody, { color: colors.textMuted }]}
                          numberOfLines={2}
                        >
                          {body}
                        </Text>
                      )}
                      <View style={styles.notificationMetaRow}>
                        <Text style={[styles.notificationType, { color: colors.textMuted }]}>
                          {presentation.label}
                        </Text>
                        {unread && (
                          <Text style={[styles.unreadLabel, { color: colors.accent }]}>New</Text>
                        )}
                      </View>
                    </View>

                    <Icon name="chevron-right" size={21} color={colors.textMuted} />
                  </TouchableOpacity>
                );
                })}
              </View>
            </View>
          ))
        )}
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.xxs,
    paddingBottom: t.spacing.sm,
  },
  backButton: {
    paddingVertical: t.spacing.xs,
    paddingRight: t.spacing.xs,
  },
  headerButton: {
    width: 48,
    height: 48,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: { flex: 1, minWidth: 0 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs },
  headerTitle: { fontSize: t.typography.pageTitle.fontSize, lineHeight: t.typography.pageTitle.lineHeight, fontWeight: "900", letterSpacing: -0.4 },
  headerSubtitle: { marginTop: t.spacing.none, fontSize: t.typography.metadata.fontSize, fontWeight: "700" },
  headerUnreadDot: { width: 8, height: 8, borderRadius: t.radius.pill },

  filtersScroll: { flexGrow: 0 },
  filters: { paddingBottom: t.spacing.xs, gap: t.spacing.xs },
  filterChip: {
    minHeight: 38,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterText: { fontSize: t.typography.bodySmall.fontSize, fontWeight: "800" },

  content: { paddingBottom: t.spacing.xl, gap: t.spacing.md },
  group: { gap: t.spacing.xxs },
  groupHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  groupTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900" },
  groupCount: { fontSize: t.typography.caption.fontSize, fontWeight: "800" },
  groupCard: { borderWidth: 1, borderRadius: t.radius.xl, overflow: "hidden" },
  notificationRow: {
    minHeight: 78,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationUnreadDot: {
    position: "absolute",
    right: -1,
    top: -1,
    width: 11,
    height: 11,
    borderRadius: t.radius.sm,
    borderWidth: 2,
  },
  notificationCopy: { flex: 1, minWidth: 0 },
  notificationTitleRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs },
  notificationTitle: { flex: 1, minWidth: 0, fontSize: t.typography.bodyLarge.fontSize, lineHeight: t.typography.bodyLarge.lineHeight, fontWeight: "800" },
  notificationTime: { fontSize: t.typography.bodySmall.fontSize, fontWeight: "600" },
  notificationBody: { marginTop: t.spacing.none, fontSize: t.typography.bodySmall.fontSize, lineHeight: t.typography.bodySmall.lineHeight, fontWeight: "600" },
  notificationMetaRow: { marginTop: t.spacing.xxs, flexDirection: "row", alignItems: "center", gap: t.spacing.xs },
  notificationType: {
    fontSize: t.typography.micro.fontSize,
    lineHeight: t.typography.micro.lineHeight,
    fontWeight: "800",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  unreadLabel: { fontSize: t.typography.micro.fontSize, fontWeight: "900" },

  emptyState: { alignItems: "center", paddingHorizontal: t.spacing.xl, paddingTop: 72 },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: t.spacing.sm,
  },
  emptyTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900" },
  emptySub: { marginTop: t.spacing.xxs, fontSize: t.typography.bodySmall.fontSize, textAlign: "center", lineHeight: t.typography.bodySmall.lineHeight },
});
