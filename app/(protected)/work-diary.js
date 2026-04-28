import { useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import Icon from "react-native-vector-icons/Feather";
import { db } from "../../firebaseConfig";
import { useTheme } from "../providers/ThemeProvider";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export default function WorkDiaryPage() {
  const router = useRouter();
  const { colors } = useTheme();

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [allBookings, setAllBookings] = useState([]);
  const [jobsForSelectedDate, setJobsForSelectedDate] = useState([]);
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  // ✅ NEW: vehicle id -> display name map
  const [vehicleNameById, setVehicleNameById] = useState({});

  const todayISO = useMemo(() => new Date().toISOString().split("T")[0], []);

  const tomorrowISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }, []);

  useEffect(() => {
    let alive = true;

    const fetchData = async () => {
      setFetchError("");
      setLoading(true);
      const localGetISO = (val) => {
        if (!val) return null;
        if (val?.toDate && typeof val.toDate === "function") {
          return val.toDate().toISOString().split("T")[0];
        }
        if (val instanceof Date) {
          return val.toISOString().split("T")[0];
        }
        const s = String(val).trim();
        if (!s) return null;
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split("T")[0];
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return null;
        return d.toISOString().split("T")[0];
      };

      const localNextDateOnOrAfter = (b, isoRef) => {
        if (Array.isArray(b?.bookingDates) && b.bookingDates.length) {
          const sorted = b.bookingDates.map(localGetISO).filter(Boolean).sort();
          const match = sorted.find((d) => d >= isoRef);
          return match || null;
        }

        const single = localGetISO(b?.date);
        const start = localGetISO(b?.startDate);
        const end = localGetISO(b?.endDate);

        if (single) return single >= isoRef ? single : null;
        if (start && end) {
          if (end < isoRef) return null;
          if (isoRef < start) return start;
          return isoRef;
        }
        if (start) return start >= isoRef ? start : null;
        return null;
      };

      try {
        const [bookingsSnap, vehiclesSnap] = await Promise.all([
          getDocs(collection(db, "bookings")),
          getDocs(collection(db, "vehicles")),
        ]);

        if (!alive) return;

        const rawBookings = bookingsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        // Upcoming: bookings that still have a date from tomorrow onwards
        const upcomingWithNext = rawBookings
          .map((b) => {
            const next = localNextDateOnOrAfter(b, tomorrowISO);
            return { booking: b, nextDate: next };
          })
          .filter((x) => !!x.nextDate)
          .sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0));

        const upcoming = upcomingWithNext.map(({ booking, nextDate }) => ({
          ...booking,
          _nextDate: nextDate,
        }));

        const map = {};
        vehiclesSnap.docs.forEach((d) => {
          const v = d.data() || {};
          const name = v.name || v.label || v.title || "Vehicle";
          const reg = v.reg || v.registration || v.numberPlate || "";
          map[d.id] = reg ? `${name} (${reg})` : name;
        });

        setAllBookings(rawBookings);
        setUpcomingBookings(upcoming);
        setVehicleNameById(map);
      } catch (error) {
        if (!alive) return;
        setFetchError("Could not load work diary data. Pull to refresh and try again.");
        console.error("Error fetching diary data:", error);
      } finally {
        if (!alive) return;
        setLoading(false);
        setRefreshing(false);
      }
    };

    fetchData();
    return () => {
      alive = false;
    };
  }, [tomorrowISO, reloadToken]);

  useEffect(() => {
    const day = selectedDate;

    const filtered = allBookings.filter((b) => {
      // bookingDates array (usually plain "YYYY-MM-DD" strings)
      if (Array.isArray(b.bookingDates) && b.bookingDates.length) {
        const dates = b.bookingDates.map(getISO).filter(Boolean);
        if (dates.includes(day)) return true;
      }

      // single/legacy
      const singleDate = getISO(b.date);
      const start = getISO(b.startDate);
      const end = getISO(b.endDate);

      if (singleDate === day) return true;
      if (start && end && day >= start && day <= end) return true;
      if (start && !end && start === day) return true;

      return false;
    });

    setJobsForSelectedDate(filtered);
  }, [selectedDate, allBookings]);

  /* ---------- helpers ---------- */

  const toArray = (val) => (Array.isArray(val) ? val : val ? [val] : []);

  const nameOf = (x) =>
    typeof x === "string"
      ? x
      : x && typeof x === "object"
      ? x.name || x.fullName || x.label || x.email || x.userCode || "Unknown"
      : "Unknown";

  const formatPeople = (val) => {
    const arr = toArray(val).map(nameOf).filter(Boolean);
    return arr.length ? arr.join(", ") : "No employees assigned";
  };

  // ✅ UPDATED: translate vehicle IDs to names using vehicleNameById
  const formatVehicles = (val) => {
    const arr = toArray(val)
      .map((v) => {
        // If Firestore stored just the vehicle doc id (string)
        if (typeof v === "string") {
          return vehicleNameById[v] || v; // fallback to id if not found
        }

        // If stored as object
        if (v && typeof v === "object") {
          const id = v.id || v.vehicleId || v.docId;
          if (id && vehicleNameById[id]) return vehicleNameById[id];

          // Otherwise build from fields on the object
          const name = v.name || v.label || v.title || "Vehicle";
          const reg = v.reg || v.registration || v.numberPlate || "";
          return reg ? `${name} (${reg})` : name;
        }

        return "Vehicle";
      })
      .filter(Boolean);

    return arr.length ? arr.join(", ") : "None";
  };

  // 🔧 web-style date normaliser → "YYYY-MM-DD" or null
  const getISO = (val) => {
    if (!val) return null;

    // Firestore Timestamp
    if (val?.toDate && typeof val.toDate === "function") {
      return val.toDate().toISOString().split("T")[0];
    }

    // JS Date
    if (val instanceof Date) {
      return val.toISOString().split("T")[0];
    }

    const s = String(val).trim();
    if (!s) return null;

    // If already ISO-ish, strip time
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.split("T")[0];
    }

    // Fallback parse
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split("T")[0];
  };

  // First main date for job (like dashboard "first date")
  const firstDateStr = (b) => {
    // Prefer bookingDates array if present
    if (Array.isArray(b?.bookingDates) && b.bookingDates.length) {
      const isoList = b.bookingDates.map(getISO).filter(Boolean).sort();
      return isoList[0] || null;
    }

    // Else use date / startDate
    const single = getISO(b?.date);
    const start = getISO(b?.startDate);
    return single || start || null;
  };

  // Next date on/after a reference (similar to web’s `nextDateOnOrAfter`)
  const nextDateOnOrAfter = (b, isoRef) => {
    const ref = isoRef;

    // If bookingDates exists, pick first >= ref
    if (Array.isArray(b?.bookingDates) && b.bookingDates.length) {
      const sorted = b.bookingDates.map(getISO).filter(Boolean).sort();
      const match = sorted.find((d) => d >= ref);
      return match || null;
    }

    const single = getISO(b?.date);
    const start = getISO(b?.startDate);
    const end = getISO(b?.endDate);

    // Single date booking
    if (single) {
      return single >= ref ? single : null;
    }

    // Multi-day: if ref inside [start, end] → ref; else null
    if (start && end) {
      if (end < ref) return null;
      if (ref < start) return start;
      return ref;
    }

    // Only startDate
    if (start) {
      return start >= ref ? start : null;
    }

    return null;
  };

  const formatDateNice = (isoDate) => {
    if (!isoDate) return "Not set";
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatShortDay = (isoDate) => {
    if (!isoDate) return "—";
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  };

  const productionOf = (b) => b?.production || b?.client || "Production";

  // grey-out test (same idea as before)
  const isMutedStatus = (status) => {
    const s = String(status || "").toLowerCase();
    return (
      s.includes("postpon") ||
      s.includes("cancel") ||
      s.includes("lost") ||
      s.includes("dnh")
    );
  };

  // 🔶 maintenance flag → for orange bar
  const isMaintenance = (job) => {
    const type = String(job?.bookingType || job?.type || "").toLowerCase();
    const maintFlag =
      job?.isMaintenance === true ||
      !!job?.maintenanceType ||
      type === "maintenance" ||
      String(job?.status || "").toLowerCase() === "maintenance";
    return maintFlag;
  };

  const dayChipLabel = (iso) => {
    if (!iso) return "";
    if (iso === todayISO) return "Today";
    if (iso === tomorrowISO) return "Tomorrow";
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { weekday: "short" });
  };

  // week helpers for upcoming grouping
  const startOfWeekISO = (iso) => {
    const d = new Date(iso + "T00:00:00");
    const day = d.getDay(); // 0 Sun
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff);
    return d.toISOString().split("T")[0];
  };

  const isSameWeek = (isoA, isoB) => startOfWeekISO(isoA) === startOfWeekISO(isoB);

  /* ---------- data ---------- */

  /* ---------- search filter ---------- */

  const matchesSearch = (job) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;

    const parts = [
      job.jobNumber,
      productionOf(job),
      job.location,
      formatPeople(job.employees),
      formatVehicles(job.vehicles || job.vehicle),
      job.status,
      job.notes,
    ]
      .filter(Boolean)
      .map((x) => String(x).toLowerCase());

    const haystack = parts.join(" • ");
    return haystack.includes(q);
  };

  /* ---------- grouped upcoming (from tomorrow onwards) ---------- */

  const groupedUpcoming = (() => {
    const groups = { tomorrow: [], thisWeek: [], later: [] };

    for (const b of upcomingBookings) {
      const next = b._nextDate || nextDateOnOrAfter(b, tomorrowISO);
      if (!next) continue;

      if (next === tomorrowISO) groups.tomorrow.push(b);
      else if (isSameWeek(next, todayISO)) groups.thisWeek.push(b);
      else groups.later.push(b);
    }

    return groups;
  })();

  const searchActive = searchQuery.trim().length > 0;

  /* ---------- UI ---------- */

  const SelectedHeader = ({ count }) => {
    const label =
      selectedDate === todayISO
        ? "Today"
        : selectedDate === tomorrowISO
        ? "Tomorrow"
        : formatShortDay(selectedDate);

    return (
      <View style={styles.sectionHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Jobs for {formatDateNice(selectedDate)}
          </Text>
          <View
            style={[
              styles.dayChip,
              {
                backgroundColor: colors.accentSoft,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.dayChipText, { color: colors.accent }]}>
              {label}
            </Text>
          </View>
        </View>
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.badgeText, { color: colors.background }]}>
            {count}
          </Text>
        </View>
      </View>
    );
  };

  // 🔵 decide left bar colour based on status + shootType
  const getLeftToneStyle = (job) => {
    const status = String(job?.status || "").toLowerCase();
    const shootType = String(job?.shootType || "").toLowerCase();
    const muted = isMutedStatus(job?.status);
    const maintenance = isMaintenance(job);

    if (maintenance) return styles.leftMaintenance; // orange
    if (status.includes("second pencil")) return styles.leftSecondPencil; // red
    if (status.includes("first pencil")) return styles.leftFirstPencil; // yellow
    if (shootType === "night") return styles.leftNightShoot; // purple
    if (muted) return styles.leftMuted; // grey

    return styles.leftActive; // green / default
  };

  const Card = ({ job, displayDate }) => {
    const dateStr = displayDate || firstDateStr(job);
    const muted = isMutedStatus(job.status);
    const maintenance = isMaintenance(job);
    const leftTone = getLeftToneStyle(job);

    return (
      <TouchableOpacity
        key={job.id}
        style={[
          styles.jobCard,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
          },
          muted && {
            backgroundColor: colors.surface,
            opacity: 0.8,
          },
        ]}
        onPress={() => setSelectedJob(job)}
        activeOpacity={0.9}
      >
        {/* left status bar */}
        <View style={[styles.leftBar, leftTone]} />
        <View style={{ flex: 1 }}>
          <View style={styles.jobHeader}>
            <Text
              style={[
                styles.jobTitle,
                { color: colors.text },
                muted && { color: colors.textMuted },
              ]}
              numberOfLines={1}
            >
              #{job.jobNumber || "N/A"} · {productionOf(job)}
            </Text>
            <View
              style={[
                styles.smallChip,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
                muted && styles.smallChipMuted,
              ]}
            >
              <Text
                style={[
                  styles.smallChipText,
                  { color: colors.textMuted },
                  muted && styles.smallChipTextMuted,
                ]}
              >
                {dayChipLabel(dateStr)}
              </Text>
            </View>
          </View>

          <Text
            style={[
              styles.jobMeta,
              { color: colors.textMuted },
              muted && styles.jobMetaMuted,
            ]}
          >
            {formatDateNice(dateStr)}
          </Text>

          {maintenance && (
            <Text style={[styles.jobMeta, { color: "#f97316", fontWeight: "700" }]}>
              Maintenance booking
            </Text>
          )}

          <Text
            style={[
              styles.jobMeta,
              { color: colors.textMuted },
              muted && styles.jobMetaMuted,
            ]}
          >
            Production: {productionOf(job)}
          </Text>

          {job.location ? (
            <Text
              style={[
                styles.jobMeta,
                { color: colors.textMuted },
                muted && styles.jobMetaMuted,
              ]}
            >
              Location: {job.location}
            </Text>
          ) : null}

          <Text
            style={[
              styles.jobMeta,
              { color: colors.textMuted },
              muted && styles.jobMetaMuted,
            ]}
          >
            Employee: {formatPeople(job.employees)}
          </Text>

          <Text
            style={[
              styles.jobMeta,
              { color: colors.textMuted },
              muted && styles.jobMetaMuted,
            ]}
          >
            Vehicles: {formatVehicles(job.vehicles || job.vehicle)}
          </Text>

          {job.status ? (
            <View style={styles.statusRow}>
              <Text
                style={[
                  styles.jobStatus,
                  { backgroundColor: colors.surface, color: colors.text },
                  muted && styles.jobStatusMuted,
                ]}
              >
                {job.status}
              </Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  const UpcomingSection = ({ title, items }) => {
    const visibleItems = items.filter(matchesSearch);
    if (!visibleItems.length) return null;

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.badgeText, { color: colors.background }]}>
              {visibleItems.length}
            </Text>
          </View>
        </View>

        {visibleItems.map((b) => (
          <Card
            key={b.id}
            job={b}
            displayDate={b._nextDate || nextDateOnOrAfter(b, tomorrowISO)}
          />
        ))}
      </View>
    );
  };

  // ✅ UPDATED to re-filter when vehicleNameById changes (so search works immediately)
  const visibleJobsForSelectedDate = jobsForSelectedDate.filter(matchesSearch);
  const visibleUpcomingCount =
    groupedUpcoming.tomorrow.filter(matchesSearch).length +
    groupedUpcoming.thisWeek.filter(matchesSearch).length +
    groupedUpcoming.later.filter(matchesSearch).length;

  const calendarMarkedDates = (() => {
    const marks = {};

    allBookings.forEach((b) => {
      const localDates = new Set();

      if (Array.isArray(b.bookingDates) && b.bookingDates.length) {
        b.bookingDates.map(getISO).filter(Boolean).forEach((d) => localDates.add(d));
      }

      const single = getISO(b.date);
      const start = getISO(b.startDate);
      const end = getISO(b.endDate);
      if (single) localDates.add(single);

      if (start && end) {
        const cursor = new Date(`${start}T00:00:00`);
        const endDate = new Date(`${end}T00:00:00`);
        let guard = 0;

        while (cursor <= endDate && guard < 90) {
          localDates.add(cursor.toISOString().split("T")[0]);
          cursor.setDate(cursor.getDate() + 1);
          guard += 1;
        }
      } else if (start) {
        localDates.add(start);
      }

      localDates.forEach((isoDate) => {
        marks[isoDate] = {
          ...(marks[isoDate] || {}),
          marked: true,
          dotColor: colors.accent,
        };
      });
    });

    if (!marks[todayISO]) {
      marks[todayISO] = { marked: true, dotColor: colors.accent };
    }

    marks[selectedDate] = {
      ...(marks[selectedDate] || {}),
      selected: true,
      selectedColor: colors.accent,
      selectedTextColor: colors.background,
    };

    return marks;
  })();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                setReloadToken((prev) => prev + 1);
              }}
              colors={[colors.accent]}
              tintColor={colors.accent}
            />
          }
        >
          {/* Hero Header */}
          <View style={styles.heroCard}>
            <View style={styles.heroContent}>
              <View style={styles.heroTopRow}>
                <TouchableOpacity
                  onPress={() => router.back()}
                  activeOpacity={0.85}
                  style={[
                    styles.backBtn,
                    {
                      backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                      borderColor: withAlpha(colors.border, 0.75),
                    },
                  ]}
                >
                  <Icon name="arrow-left" size={15} color={colors.text} />
                </TouchableOpacity>

                <View style={styles.heroTitleWrap}>
                  <Text style={[styles.heroEyebrow, { color: colors.textMuted }]}>
                    Operations
                  </Text>
                  <Text style={[styles.heroTitle, { color: colors.text }]}>Work Diary</Text>
                </View>

                <TouchableOpacity
                  onPress={() => router.push("/work-diary-board")}
                  activeOpacity={0.85}
                  style={[
                    styles.boardBtn,
                    {
                      backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                      borderColor: withAlpha(colors.border, 0.75),
                    },
                  ]}
                >
                  <Icon name="columns" size={15} color={colors.text} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <View
              style={[
                styles.searchInputWrap,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search jobs (job #, production, location, crew, vehicle, status)…"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.searchInput,
                  {
                    color: colors.text,
                  },
                ]}
                autoCorrect={false}
                autoCapitalize="none"
              />

              {searchActive ? (
                <TouchableOpacity
                  style={[styles.clearSearchBtn, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}
                  onPress={() => setSearchQuery("")}
                >
                  <Text style={[styles.clearSearchText, { color: colors.accent }]}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.quickDateRow}>
              <TouchableOpacity
                style={[
                  styles.quickDateBtn,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  selectedDate === todayISO && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                ]}
                onPress={() => setSelectedDate(todayISO)}
              >
                <Text style={[styles.quickDateText, { color: selectedDate === todayISO ? colors.accent : colors.textMuted }]}>
                  Today
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.quickDateBtn,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  selectedDate === tomorrowISO && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                ]}
                onPress={() => setSelectedDate(tomorrowISO)}
              >
                <Text style={[styles.quickDateText, { color: selectedDate === tomorrowISO ? colors.accent : colors.textMuted }]}>
                  Tomorrow
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {fetchError ? (
            <View style={[styles.errorCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.danger }]}>
              <Text style={[styles.errorText, { color: colors.danger }]}>{fetchError}</Text>
              <TouchableOpacity
                style={[styles.retryBtn, { backgroundColor: colors.accent }]}
                onPress={() => setReloadToken((prev) => prev + 1)}
              >
                <Text style={[styles.retryText, { color: colors.background }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Calendar Card */}
          <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Calendar
              onDayPress={(day) => setSelectedDate(day.dateString)}
              markedDates={calendarMarkedDates}
              firstDay={1}
              theme={{
                backgroundColor: colors.surfaceAlt,
                calendarBackground: colors.surfaceAlt,
                dayTextColor: colors.text,
                monthTextColor: colors.text,
                textDisabledColor: colors.textMuted,
                arrowColor: colors.accent,
                todayTextColor: colors.success,
                textSectionTitleColor: colors.textMuted,
              }}
            />
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendTone, styles.leftActive]} />
              <Text style={[styles.legendText, { color: colors.textMuted }]}>Active</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendTone, styles.leftFirstPencil]} />
              <Text style={[styles.legendText, { color: colors.textMuted }]}>1st Pencil</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendTone, styles.leftSecondPencil]} />
              <Text style={[styles.legendText, { color: colors.textMuted }]}>2nd Pencil</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendTone, styles.leftMaintenance]} />
              <Text style={[styles.legendText, { color: colors.textMuted }]}>Maintenance</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendTone, styles.leftMuted]} />
              <Text style={[styles.legendText, { color: colors.textMuted }]}>Muted</Text>
            </View>
          </View>

          {/* Jobs for Selected Day */}
          <View style={styles.section}>
            <SelectedHeader count={visibleJobsForSelectedDate.length} />

            {loading ? (
              <View style={[styles.loadingCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading jobs...</Text>
              </View>
            ) : visibleJobsForSelectedDate.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No jobs assigned</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  {searchActive
                    ? `No jobs matched "${searchQuery.trim()}".`
                    : "Add a booking, change the date, or clear your search."}
                </Text>
              </View>
            ) : (
              visibleJobsForSelectedDate.map((job) => (
                <Card key={job.id} job={job} displayDate={selectedDate} />
              ))
            )}
          </View>

          {/* Upcoming */}
          <View style={[styles.sectionHeader, styles.upcomingHeader]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming</Text>
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.badgeText, { color: colors.background }]}>{visibleUpcomingCount}</Text>
            </View>
          </View>
          <UpcomingSection title="Tomorrow" items={groupedUpcoming.tomorrow} />
          <UpcomingSection title="This Week" items={groupedUpcoming.thisWeek} />
          <UpcomingSection title="Later" items={groupedUpcoming.later} />

          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Modal */}
        <Modal
          visible={selectedJob !== null}
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedJob(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              {selectedJob && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>
                    #{selectedJob.jobNumber || "N/A"} · {productionOf(selectedJob)}
                  </Text>

                  <Text style={[styles.modalItem, { color: colors.textMuted }]}>
                    🗓️ Date:{" "}
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {formatDateNice(firstDateStr(selectedJob))}
                    </Text>
                  </Text>

                  {selectedJob.status ? (
                    <Text style={[styles.modalItem, { color: colors.textMuted }]}>
                      ⚡ Status:{" "}
                      <Text
                        style={[
                          styles.modalValue,
                          {
                            color: isMutedStatus(selectedJob.status) ? colors.textMuted : colors.text,
                          },
                        ]}
                      >
                        {selectedJob.status}
                      </Text>
                    </Text>
                  ) : null}

                  {selectedJob.location ? (
                    <Text style={[styles.modalItem, { color: colors.textMuted }]}>
                      📍 Location:{" "}
                      <Text style={[styles.modalValue, { color: colors.text }]}>
                        {selectedJob.location}
                      </Text>
                    </Text>
                  ) : null}

                  <Text style={[styles.modalItem, { color: colors.textMuted }]}>
                    👥 Employees:{" "}
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {formatPeople(selectedJob.employees)}
                    </Text>
                  </Text>

                  <Text style={[styles.modalItem, { color: colors.textMuted }]}>
                    🚗 Vehicles:{" "}
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {formatVehicles(selectedJob.vehicles || selectedJob.vehicle)}
                    </Text>
                  </Text>

                  <Text style={[styles.modalItem, { color: colors.textMuted }]}>
                    📝 Notes:{" "}
                    <Text style={[styles.modalValue, { color: colors.text }]}>
                      {selectedJob.notes || "No notes"}
                    </Text>
                  </Text>

                  <TouchableOpacity
                    style={[styles.modalBtn, { backgroundColor: colors.accent }]}
                    onPress={() => setSelectedJob(null)}
                  >
                    <Text style={[styles.modalBtnText, { color: colors.background }]}>Close</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  /* Layout */
  safeArea: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 16, paddingTop: 10 },

  /* Hero */
  heroCard: {
    position: "relative",
    marginBottom: 14,
  },
  heroContent: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitleWrap: {
    flex: 1,
    paddingTop: 1,
    alignItems: "center",
  },
  heroSpacer: {
    width: 34,
    height: 34,
  },
  boardBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroEyebrow: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "800",
    textAlign: "center",
  },
  heroTitle: {
    marginTop: 3,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },

  /* Search */
  searchRow: {
    marginBottom: 12,
  },
  searchInputWrap: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
  },
  clearSearchBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearSearchText: { fontSize: 12, fontWeight: "800" },
  quickDateRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  quickDateBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  quickDateText: { fontSize: 12, fontWeight: "800" },
  errorCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    gap: 8,
  },
  errorText: { fontSize: 13, fontWeight: "600" },
  retryBtn: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  retryText: { fontSize: 12, fontWeight: "800" },

  /* Cards */
  card: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 14,
  },

  /* Sections */
  section: {
    padding: 0,
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  upcomingHeader: { marginBottom: 10, marginTop: 2 },

  /* Chips */
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: { fontSize: 12, fontWeight: "800" },
  dayChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  dayChipText: { fontSize: 12, fontWeight: "800" },
  smallChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  smallChipMuted: {},
  smallChipText: { fontSize: 11, fontWeight: "800" },
  smallChipTextMuted: {},
  legendRow: {
    marginBottom: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendTone: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  legendText: { fontSize: 12, fontWeight: "600" },

  /* Job cards */
  jobCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  leftBar: {
    width: 4,
    borderRadius: 3,
    marginRight: 10,
  },
  leftActive: { backgroundColor: "#22c55e" }, // default green
  leftMuted: { backgroundColor: "#6b7280" }, // grey
  leftMaintenance: { backgroundColor: "#f97316" }, // orange
  leftFirstPencil: { backgroundColor: "#facc15" }, // yellow
  leftSecondPencil: { backgroundColor: "#ef4444" }, // red
  leftNightShoot: { backgroundColor: "#a855f7" }, // purple

  jobHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  jobTitle: { fontWeight: "800", flexShrink: 1, paddingRight: 8 },
  statusRow: { marginTop: 6, flexDirection: "row", gap: 8 },
  jobStatus: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  jobStatusMuted: {},
  jobMeta: { fontSize: 13, marginTop: 2 },
  jobMetaMuted: {},

  /* Empty state */
  loadingCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  loadingText: { fontSize: 13, fontWeight: "600" },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  emptySubtitle: { fontSize: 13 },

  /* Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "92%",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    maxHeight: "84%",
  },
  modalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 10 },
  modalItem: { fontSize: 14, marginTop: 4 },
  modalValue: { fontWeight: "700" },
  modalBtn: {
    marginTop: 16,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  modalBtnText: { fontWeight: "800" },
});
