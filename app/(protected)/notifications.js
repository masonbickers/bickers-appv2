// app/(protected)/notifications.js
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import {
  clearInbox,
  getInbox,
  markAllRead,
  markRead,
} from "../../lib/notificationInbox";
import { useTheme } from "../providers/ThemeProvider";

function formatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationsPage() {
  const router = useRouter();
  const { colors } = useTheme();

  const [items, setItems] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const unreadCount = useMemo(
    () => items.filter((n) => !n.read).length,
    [items]
  );

  const load = useCallback(async () => {
    const list = await getInbox();
    setItems(list);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const onTap = useCallback(
    async (n) => {
      // mark read immediately
      await markRead(n.id);
      await load();

      // ALWAYS go to notification details page
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

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={[
            styles.backBtn,
            { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
          ]}
          activeOpacity={0.85}
        >
          <Icon name="arrow-left" size={18} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.text }]}>
            Notifications
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleMarkAllRead}
            style={[
              styles.actionBtn,
              { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
            ]}
            activeOpacity={0.85}
          >
            <Icon name="check" size={16} color={colors.text} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleClearAll}
            style={[
              styles.actionBtn,
              { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
            ]}
            activeOpacity={0.85}
          >
            <Icon name="trash-2" size={16} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.text}
          />
        }
      >
        {items.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <View
              style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}
            >
              <Icon name="bell" size={22} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No notifications
            </Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>
              When you’re assigned a job or a holiday is approved, it’ll show up
              here.
            </Text>
          </View>
        ) : (
          items.map((n) => {
            const time = formatTime(n.createdAt);
            const unread = !n.read;

            return (
              <TouchableOpacity
                key={n.id}
                onPress={() => onTap(n)}
                activeOpacity={0.9}
                style={[
                  styles.card,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                <View style={styles.rowTop}>
                  <View style={styles.rowLeft}>
                    <View
                      style={[
                        styles.dot,
                        {
                          backgroundColor: unread
                            ? colors.accent
                            : colors.textMuted,
                        },
                      ]}
                    />
                    <Text
                      style={[styles.cardTitle, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {n.title}
                    </Text>
                  </View>

                  <Text style={[styles.time, { color: colors.textMuted }]}>
                    {time}
                  </Text>
                </View>

                {!!n.body && (
                  <Text
                    style={[styles.body, { color: colors.textMuted }]}
                    numberOfLines={3}
                  >
                    {n.body}
                  </Text>
                )}

                <View style={styles.rowBottom}>
                  <View
                    style={[
                      styles.pill,
                      {
                        backgroundColor: colors.surfaceAlt,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Icon
                      name={
                        n.data?.bookingId
                          ? "briefcase"
                          : n.data?.holidayId
                          ? "umbrella"
                          : "info"
                      }
                      size={12}
                      color={colors.text}
                    />
                    <Text style={[styles.pillText, { color: colors.text }]}>
                      {n.data?.bookingId
                        ? "Job"
                        : n.data?.holidayId
                        ? "Holiday"
                        : "General"}
                    </Text>
                  </View>

                  <Icon name="chevron-right" size={18} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  backText: { fontWeight: "800", fontSize: 14 },

  title: { fontSize: 22, fontWeight: "900", letterSpacing: 0.2 },
  subtitle: { marginTop: 2, fontSize: 12, fontWeight: "600" },

  headerActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  content: { paddingHorizontal: 16, paddingTop: 6 },

  emptyCard: {
    marginTop: 20,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    alignItems: "center",
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: "900" },
  emptySub: { marginTop: 4, fontSize: 13, textAlign: "center", lineHeight: 18 },

  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
  },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    paddingRight: 10,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  cardTitle: { fontSize: 15, fontWeight: "900", flex: 1 },

  time: { fontSize: 11, fontWeight: "700" },
  body: { marginTop: 8, fontSize: 13, lineHeight: 18 },

  rowBottom: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontWeight: "800" },
});
