import { collection, getDocs } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import { db } from "../../firebaseConfig";
import { useTheme } from "../providers/ThemeProvider";

export default function WorkDiaryPage() {
  const { colors } = useTheme();

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [allBookings, setAllBookings] = useState([]);
  const [jobsForSelectedDate, setJobsForSelectedDate] = useState([]);
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ✅ NEW: vehicle id -> display name map
  const [vehicleNameById, setVehicleNameById] = useState({});

  useEffect(() => {
    fetchBookings();
    fetchVehicles(); // ✅ NEW
  }, []);

  useEffect(() => {
    filterJobsForSelectedDate();
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

  const todayISO = useMemo(() => new Date().toISOString().split("T")[0], []);

  const tomorrowISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }, []);

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

  const fetchBookings = async () => {
    try {
      const snapshot = await getDocs(collection(db, "bookings"));
      const raw = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Upcoming: bookings that still have a date from tomorrow onwards
      const upcomingWithNext = raw
        .map((b) => {
          const next = nextDateOnOrAfter(b, tomorrowISO);
          return { booking: b, nextDate: next };
        })
        .filter((x) => !!x.nextDate)
        .sort((a, b) => (a.nextDate < b.nextDate ? -1 : a.nextDate > b.nextDate ? 1 : 0));

      const upcoming = upcomingWithNext.map(({ booking, nextDate }) => ({
        ...booking,
        _nextDate: nextDate,
      }));

      setAllBookings(raw);
      setUpcomingBookings(upcoming);
    } catch (error) {
      console.error("Error fetching bookings:", error);
    }
  };

  // ✅ NEW: fetch vehicles and build id -> "Name (REG)" map
  const fetchVehicles = async () => {
    try {
      const snap = await getDocs(collection(db, "vehicles"));
      const map = {};

      snap.docs.forEach((d) => {
        const v = d.data() || {};
        const name = v.name || v.label || v.title || "Vehicle";
        const reg = v.reg || v.registration || v.numberPlate || "";
        map[d.id] = reg ? `${name} (${reg})` : name;
      });

      setVehicleNameById(map);
    } catch (e) {
      console.error("Error fetching vehicles:", e);
    }
  };

  // ✅ Use SAME inclusion logic as web "todaysJobs", but dynamic for selectedDate
  const filterJobsForSelectedDate = () => {
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

      // Open-ended or start only
      if (start && !end && start === day) return true;

      return false;
    });

    setJobsForSelectedDate(filtered);
  };

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

  const groupedUpcoming = useMemo(() => {
    const groups = { tomorrow: [], thisWeek: [], later: [] };

    for (const b of upcomingBookings) {
      const next = b._nextDate || nextDateOnOrAfter(b, tomorrowISO);
      if (!next) continue;

      if (next === tomorrowISO) groups.tomorrow.push(b);
      else if (isSameWeek(next, todayISO)) groups.thisWeek.push(b);
      else groups.later.push(b);
    }

    return groups;
  }, [upcomingBookings, todayISO, tomorrowISO]);

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
            Jobs for {selectedDate}
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
      <View style={[styles.section, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
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
  const visibleJobsForSelectedDate = useMemo(
    () => jobsForSelectedDate.filter(matchesSearch),
    [jobsForSelectedDate, searchQuery, vehicleNameById]
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={[styles.title, { color: colors.text }]}>Work Diary</Text>
          </View>

          {/* Search */}
          <View style={styles.searchRow}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search jobs (job #, production, location, crew, vehicle, status)…"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.searchInput,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>

          {/* Calendar Card */}
          <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Calendar
              onDayPress={(day) => setSelectedDate(day.dateString)}
              markedDates={{
                [selectedDate]: {
                  selected: true,
                  selectedColor: colors.accent,
                  selectedTextColor: colors.background,
                },
                [todayISO]:
                  selectedDate === todayISO
                    ? {
                        selected: true,
                        selectedColor: colors.accent,
                        selectedTextColor: colors.background,
                      }
                    : { marked: true, dotColor: colors.accent },
              }}
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

          {/* Jobs for Selected Day */}
          <View style={[styles.section, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <SelectedHeader count={visibleJobsForSelectedDate.length} />

            {visibleJobsForSelectedDate.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No jobs assigned</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                  Add a booking, change the date, or clear your search.
                </Text>
              </View>
            ) : (
              visibleJobsForSelectedDate.map((job) => (
                <Card key={job.id} job={job} displayDate={selectedDate} />
              ))
            )}
          </View>

          {/* Upcoming */}
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
                <>
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
                </>
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
  content: { padding: 16 },

  /* Header (left-aligned title) */
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    marginBottom: 10,
  },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: 0.3 },

  /* Search */
  searchRow: {
    marginBottom: 12,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
  },

  /* Cards */
  card: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
    marginBottom: 14,
  },

  /* Sections */
  section: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800" },

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
