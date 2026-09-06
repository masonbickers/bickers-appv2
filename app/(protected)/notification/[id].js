import { AppText as Text, AppPressable as TouchableOpacity } from "../../../components/ui/AppPrimitives";
// app/(protected)/notification/[id].js
import {
  useLocalSearchParams,
  useRouter } from "expo-router";
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
    ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { doc, getDoc } from "firebase/firestore";
import { db } from "../../../firebaseConfig";

import { useVehicles } from "../../../hooks/useOperationalData";
import { resolveNotificationVehicleBody } from "../../../lib/fleetSchema";
import { getBookingDayNote } from "../../../lib/bookingDayNotes";
import { getInbox, markRead } from "../../../lib/notificationInbox";
import { formatDateDDMMYYYY } from "../../../lib/dateFormat";
import { isBookingVisibleToEmployee } from "../../../lib/bookingVisibility";
import {
  getTimesheetReminderHref,
  getTimesheetReminderWeekStart,
  isTimesheetReminder,
} from "../../../lib/timesheetNotification";
import { useAuth } from "../../../providers/AuthProvider";
import { useTheme } from "../../../providers/ThemeProvider";
import { withAlpha } from "../../../lib/design/color";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";

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

function notificationBodySegments(body, vehicles) {
  return resolveNotificationVehicleBody(body, vehicles)
    .split("•")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export default function NotificationDetailPage() {
  const router = useRouter();
  const { id } = useLocalSearchParams(); // /notification/[id]
  const { colors } = useTheme();
  const { employee } = useAuth();
  const vehiclesResource = useVehicles();

  const [item, setItem] = useState(null);
  const [linkedBooking, setLinkedBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [navBusy, setNavBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await getInbox();
      const found = list.find((n) => String(n.id) === String(id));
      setItem(found || null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let active = true;
    const bookingId = item?.data?.bookingId;

    if (!bookingId) {
      setLinkedBooking(null);
      return () => {
        active = false;
      };
    }

    (async () => {
      try {
        const snap = await getDoc(doc(db, "bookings", String(bookingId)));
        const booking = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        if (active) {
          setLinkedBooking(
            booking && isBookingVisibleToEmployee(booking, employee) ? booking : null
          );
        }
      } catch (error) {
        console.warn("[notification-detail] booking load failed:", error?.message || error);
        if (active) setLinkedBooking(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [employee, item?.data?.bookingId]);

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
    if (isTimesheetReminder(d)) return "Timesheet";
    if (d.bookingId) return "Job";
    if (d.holidayId) return "Holiday";
    return "General";
  }, [item]);

  const iconName = useMemo(() => {
    const d = item?.data || {};
    if (isTimesheetReminder(d)) return "clock";
    if (d.bookingId) return "briefcase";
    if (d.holidayId) return "umbrella";
    return "info";
  }, [item]);

  const bodySegments = useMemo(
    () => notificationBodySegments(item?.body || "", vehiclesResource.data),
    [item?.body, vehiclesResource.data]
  );

  const jobDateISO = useMemo(
    () => extractISOFromNotificationData(item?.data),
    [item?.data]
  );
  const dayNotes = useMemo(
    () =>
      getBookingDayNote(linkedBooking, jobDateISO) ||
      getBookingDayNote(item?.data, jobDateISO),
    [item?.data, jobDateISO, linkedBooking]
  );

  const goToLinkedItem = useCallback(async () => {
    const d = item?.data || {};
    const timesheetHref = getTimesheetReminderHref(d);
    if (timesheetHref) {
      router.push(timesheetHref);
      return;
    }

    if (d.bookingId) {
      try {
        setNavBusy(true);

        const snap = await getDoc(doc(db, "bookings", String(d.bookingId)));
        const booking = snap.exists() ? { id: snap.id, ...snap.data() } : null;
        if (!booking || !isBookingVisibleToEmployee(booking, employee)) {
          router.replace("/notifications");
          return;
        }

        // 1) If notif already includes a date -> use it
        let iso = extractISOFromNotificationData(d);

        // 2) Otherwise fetch booking and use earliest booking date
        if (!iso) {
          const arr = Array.isArray(booking?.bookingDates) ? booking.bookingDates : [];
          iso = arr.length ? toISODate(arr[0]) : null;
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
  }, [employee, item, router]);

  return (
    <PageShell
      contentSpacing="compact"
      header={{
        variant: "compact",
        eyebrow: item ? typeLabel : "Inbox",
        title: "Notification",
        subtitle: item ? formatTime(item.createdAt) : "Inbox detail",
        onBack: router.back,
      }}
    >
      

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !item ? (
        <View style={styles.centerState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceAlt }]}>
            <Icon name="alert-circle" size={24} color={colors.textMuted} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Notification unavailable</Text>
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            This notification may have been cleared from your inbox.
          </Text>
        </View>
      ) : (
        <>
          <View
            style={[
              styles.summaryCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
          <View style={styles.summary}>
            <View
              style={[
                styles.iconBubble,
                {
                  backgroundColor: withAlpha(colors.accent, 0.13),
                  borderColor: withAlpha(colors.accent, 0.3),
                },
              ]}
            >
              <Icon name={iconName} size={23} color={colors.accent} />
            </View>
            <View style={styles.summaryCopy}>
              <Text style={[styles.notificationTitle, { color: colors.text }]}>
                {item.title}
              </Text>
              <Text style={[styles.typeLabel, { color: colors.accent }]}>{typeLabel}</Text>
            </View>
          </View>

          {bodySegments.length > 0 && (
            <View style={[styles.messageCard, { borderTopColor: colors.border }]}>
              {bodySegments.map((segment, index) => (
                <View key={`${segment}-${index}`} style={styles.messageLine}>
                  <View style={[styles.messageDot, { backgroundColor: colors.accent }]} />
                  <Text style={[styles.body, { color: colors.text }]}>{segment}</Text>
                </View>
              ))}
            </View>
          )}
          </View>

          <View
            style={[
              styles.detailCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <DetailRow label="Received" value={formatTime(item.createdAt)} colors={colors} />

          {item.data?.bookingId ? (
            !!jobDateISO && (
              <DetailRow
                label="Job date"
                value={formatDateDDMMYYYY(jobDateISO)}
                colors={colors}
              />
            )
          ) : null}

            {dayNotes ? <DetailNote value={dayNotes} colors={colors} /> : null}

            {isTimesheetReminder(item.data) ? (
              <DetailRow
                label="Week commencing"
                value={formatDateDDMMYYYY(getTimesheetReminderWeekStart(item.data))}
                colors={colors}
              />
            ) : null}

            {!item.data?.bookingId && !isTimesheetReminder(item.data) ? (
              <DetailRow label="Status" value={item.read ? "Read" : "Unread"} colors={colors} />
            ) : null}
          </View>

          {(item.data?.bookingId ||
            item.data?.holidayId ||
            isTimesheetReminder(item.data)) && (
            <TouchableOpacity
              onPress={goToLinkedItem}
              activeOpacity={0.86}
              disabled={navBusy}
              style={[
                styles.cta,
                { backgroundColor: colors.accent, opacity: navBusy ? 0.7 : 1 },
              ]}
              accessibilityRole="button"
            >
              <View style={styles.ctaContent}>
                {navBusy && <ActivityIndicator size="small" color={colors.surface} />}
                <Text style={[styles.ctaText, { color: colors.surface }]}>
                  {isTimesheetReminder(item.data)
                    ? "Open timesheet"
                    : item.data?.bookingId
                    ? "View job"
                    : "View holiday"}
                </Text>
              </View>
              <Icon name="arrow-up-right" size={19} color={colors.surface} />
            </TouchableOpacity>
          )}
        </>
      )}
    </PageShell>
  );
}

const DetailRow = ({ label, value, colors }) => (
  <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
    <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text>
    <Text style={[styles.detailValue, { color: colors.text }]} selectable>
      {value}
    </Text>
  </View>
);

const DetailNote = ({ value, colors }) => (
  <View style={[styles.detailNote, { borderBottomColor: colors.border }]}> 
    <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Day notes</Text>
    <Text style={[styles.detailNoteValue, { color: colors.text }]} selectable>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  summaryCard: { borderWidth: 1, borderRadius: t.radius.xl, padding: t.spacing.md },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },
  iconBubble: {
    width: 58,
    height: 58,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryCopy: { flex: 1, minWidth: 0 },
  notificationTitle: { fontSize: t.typography.titleSmall.fontSize, lineHeight: t.typography.titleSmall.lineHeight, fontWeight: "900" },
  typeLabel: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  messageCard: { marginTop: t.spacing.md, paddingTop: t.spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: t.spacing.xs },
  messageLine: { flexDirection: "row", alignItems: "flex-start", gap: t.spacing.xs },
  messageDot: { width: 5, height: 5, marginTop: t.spacing.xs, borderRadius: t.radius.pill },
  body: { flex: 1, fontSize: t.typography.bodySmall.fontSize, lineHeight: t.typography.bodySmall.lineHeight, fontWeight: "700" },
  detailCard: { borderWidth: 1, borderRadius: t.radius.xl, paddingHorizontal: t.spacing.md, overflow: "hidden" },
  detailRow: {
    minHeight: 52,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: t.spacing.md,
  },
  detailLabel: { fontSize: t.typography.bodySmall.fontSize, fontWeight: "700" },
  detailValue: { flex: 1, fontSize: t.typography.bodySmall.fontSize, fontWeight: "800", textAlign: "right" },
  detailNote: {
    paddingVertical: t.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: t.spacing.xxs,
  },
  detailNoteValue: {
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: "700",
  },

  cta: {
    marginTop: t.spacing.sm,
    minHeight: 52,
    borderRadius: t.radius.xl,
    paddingHorizontal: t.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ctaContent: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs },
  ctaText: { fontWeight: "900", fontSize: t.typography.bodyLarge.fontSize },

  centerState: { flex: 1, alignItems: "center", justifyContent: "center", padding: t.spacing.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: t.spacing.sm,
  },
  emptyTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900" },
  emptyText: { marginTop: t.spacing.xxs, fontSize: t.typography.bodySmall.fontSize, lineHeight: t.typography.bodySmall.lineHeight, textAlign: "center" },
});
