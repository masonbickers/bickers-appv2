// app/(protected)/notification/[id].js
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebaseConfig";

import { getInbox, markRead } from "../../../lib/notificationInbox";
import { useTheme } from "../../providers/ThemeProvider";

function formatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateSafe(v) {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toISODate(v) {
  const d = v instanceof Date ? v : toDateSafe(v);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Try to pull a date from the notification payload (support multiple field names)
function extractISOFromNotificationData(data) {
  const d = data || {};
  const candidates = [
    d.dateISO,
    d.isoDate,
    d.date,
    d.jobDate,
    d.bookingDate,
    d.selectedDay,
    d.day,
  ];

  for (const c of candidates) {
    const iso = toISODate(c);
    if (iso) return iso;
  }
  return null;
}

export default function NotificationDetailPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams(); // /notification/[id]
  const { colors } = useTheme();

  const [item, setItem] = useState(null);
  const [navBusy, setNavBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await getInbox();
    const found = list.find((n) => String(n.id) === String(id));
    setItem(found || null);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // mark read when opened
    (async () => {
      if (!id) return;
      await markRead(String(id));
      setItem((prev) => (prev ? { ...prev, read: true } : prev));
    })();
  }, [id]);

  const typeLabel = useMemo(() => {
    const d = item?.data || {};
    if (d.bookingId) return "Job";
    if (d.holidayId) return "Holiday";
    return "General";
  }, [item]);

  const iconName = useMemo(() => {
    const d = item?.data || {};
    if (d.bookingId) return "briefcase";
    if (d.holidayId) return "umbrella";
    return "info";
  }, [item]);

  const goToLinkedItem = useCallback(async () => {
    const d = item?.data || {};
    if (d.bookingId) {
      try {
        setNavBusy(true);

        // 1) If notif already includes a date -> use it
        let iso = extractISOFromNotificationData(d);

        // 2) Otherwise fetch booking and use earliest booking date
        if (!iso) {
          const snap = await getDoc(doc(db, "bookings", String(d.bookingId)));
          if (snap.exists()) {
            const booking = snap.data();
            const arr = Array.isArray(booking?.bookingDates) ? booking.bookingDates : [];
            iso = arr.length ? toISODate(arr[0]) : null;
          }
        }

        // 3) Final fallback: today
        if (!iso) iso = toISODate(new Date());

        router.push({
          pathname: "/(protected)/screens/schedule",
          params: { date: iso },
        });
      } finally {
        setNavBusy(false);
      }
      return;
    }

    if (d.holidayId) {
      router.push("/holidaypage");
      return;
    }
  }, [item, router]);

  if (!item) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
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
          <Text style={[styles.title, { color: colors.text }]}>Notification</Text>
        </View>

        <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Icon name="alert-circle" size={22} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            This notification no longer exists.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
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
          <Text style={[styles.title, { color: colors.text }]}>Notification</Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.topRow}>
            <View style={[styles.iconBubble, { backgroundColor: colors.surfaceAlt }]}>
              <Icon name={iconName} size={18} color={colors.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text>
              <View style={[styles.pill, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[styles.pillText, { color: colors.text }]}>{typeLabel}</Text>
              </View>
            </View>
          </View>

          {!!item.body && (
            <Text style={[styles.body, { color: colors.textMuted }]}>{item.body}</Text>
          )}

          <View style={[styles.metaBox, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
            <Text style={[styles.metaTitle, { color: colors.text }]}>Details</Text>
            <Text style={[styles.metaText, { color: colors.textMuted }]}>
              Read: {item.read ? "Yes" : "No"}
            </Text>

            {item.data?.bookingId ? (
              <>
                <Text style={[styles.metaText, { color: colors.textMuted }]}>
                  Booking ID: {String(item.data.bookingId)}
                </Text>
                {!!extractISOFromNotificationData(item.data) && (
                  <Text style={[styles.metaText, { color: colors.textMuted }]}>
                    Date: {extractISOFromNotificationData(item.data)}
                  </Text>
                )}
              </>
            ) : null}

            {item.data?.holidayId ? (
              <Text style={[styles.metaText, { color: colors.textMuted }]}>
                Holiday ID: {String(item.data.holidayId)}
              </Text>
            ) : null}
          </View>

          {(item.data?.bookingId || item.data?.holidayId) && (
            <TouchableOpacity
              onPress={goToLinkedItem}
              activeOpacity={0.9}
              disabled={navBusy}
              style={[
                styles.cta,
                { backgroundColor: colors.accent, borderColor: colors.accent, opacity: navBusy ? 0.7 : 1 },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {navBusy ? <ActivityIndicator size="small" color="#fff" /> : null}
                <Text style={styles.ctaText}>
                  {item.data?.bookingId ? "View job" : "View holiday"}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

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

  title: { fontSize: 20, fontWeight: "900" },
  subtitle: { marginTop: 2, fontSize: 12, fontWeight: "600" },

  content: { paddingHorizontal: 16, paddingTop: 6 },

  empty: {
    margin: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 10,
  },
  emptyText: { fontSize: 13, fontWeight: "700" },

  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginTop: 10,
  },
  topRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  iconBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 16, fontWeight: "900" },

  pill: {
    marginTop: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontWeight: "800" },

  body: { marginTop: 12, fontSize: 13, lineHeight: 18 },

  metaBox: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  metaTitle: { fontSize: 13, fontWeight: "900", marginBottom: 6 },
  metaText: { fontSize: 12, fontWeight: "700", marginTop: 2 },

  cta: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ctaText: { color: "#fff", fontWeight: "900", fontSize: 14 },
});
