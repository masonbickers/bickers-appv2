import { AppModal, AppText as Text, AppPressable as TouchableOpacity, FormField } from "../../components/ui/AppPrimitives";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import Icon from "react-native-vector-icons/Feather";
import { EmptyState } from "../../components/AsyncState";
import { useBookings, useEmployees, useVehicles } from "../../hooks/useOperationalData";
import {
  getBookingVehicleReferences,
  getVehicleDisplayList,
} from "../../lib/fleetSchema";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";
import {
  getBookingLifecycle,
  getBookingLifecycleLabel,
  shouldShowDiaryBooking,
} from "../../lib/bookingLifecycle";

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "firstPencil", label: "1st Pencil" },
  { key: "secondPencil", label: "2nd Pencil" },
  { key: "maintenance", label: "Maintenance" },
  { key: "muted", label: "Muted" },
];

function isMaintenanceBooking(job) {
  const type = String(job?.bookingType || job?.type || "").toLowerCase();
  return (
    job?.isMaintenance === true ||
    Boolean(job?.maintenanceType) ||
    type === "maintenance" ||
    String(job?.status || "").toLowerCase() === "maintenance"
  );
}

function JobDetailRow({ icon, label, value, colors, valueColor }) {
  if (!value) return null;
  return (
    <View style={styles.modalDetailRow}>
      <View
        style={[
          styles.modalDetailIcon,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Icon name={icon} size={16} color={colors.textMuted} />
      </View>
      <View style={styles.modalDetailCopy}>
        <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>
          {label}
        </Text>
        <Text style={[styles.modalDetailValue, { color: valueColor || colors.text }]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function JobDetailSection({ title, children, colors }) {
  return (
    <View style={[styles.modalSection, { borderBottomColor: colors.border }]}>
      <Text style={[styles.modalSectionTitle, { color: colors.textMuted }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function WorkDiaryPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const bookingsResource = useBookings();
  const employeesResource = useEmployees();
  const vehiclesResource = useVehicles();

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [selectedJob, setSelectedJob] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [includeInactive, setIncludeInactive] = useState(
    () => String(params.includeInactive || "") === "1"
  );
  const [statusFilter, setStatusFilter] = useState("all");
  const [monthExpanded, setMonthExpanded] = useState(false);
  const allBookings = bookingsResource.data;

  const todayISO = useMemo(() => new Date().toISOString().split("T")[0], []);

  const tomorrowISO = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }, []);

  const refreshBookings = bookingsResource.refresh;
  const refreshEmployees = employeesResource.refresh;
  const refreshVehicles = vehiclesResource.refresh;
  const refreshDiary = useCallback(async () => {
    await Promise.all([refreshBookings(), refreshEmployees(), refreshVehicles()]);
  }, [refreshBookings, refreshEmployees, refreshVehicles]);

  /* ---------- helpers ---------- */

  const toArray = (val) => (Array.isArray(val) ? val : val ? [val] : []);

  const nameOf = (x) => {
    const value = typeof x === "string" ? x : "";
    const identifiers = [
      value,
      x?.id,
      x?.employeeId,
      x?.userCode,
      x?.employeeCode,
      x?.email,
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);
    const directoryMatch = employeesResource.data.find((candidate) =>
      [candidate?.id, candidate?.employeeId, candidate?.userCode, candidate?.email]
        .map((item) => String(item || "").trim().toLowerCase())
        .some((identifier) => identifier && identifiers.includes(identifier))
    );
    return directoryMatch?.name ||
      directoryMatch?.displayName ||
      (x && typeof x === "object"
        ? x.name || x.fullName || x.displayName || x.label || x.email || x.userCode
        : value) ||
      "Unknown";
  };

  const formatPeople = (val) => {
    const arr = toArray(val).map(nameOf).filter(Boolean);
    return arr.length ? arr.join(", ") : "No employees assigned";
  };

  const formatVehicles = (val) => {
    const arr = getVehicleDisplayList(val, vehiclesResource.data);
    return arr.length ? arr.join(", ") : "None";
  };

  const assignmentForDate = (map, dateISO) => {
    if (!map || typeof map !== "object" || Array.isArray(map) || !dateISO) return undefined;
    if (Object.prototype.hasOwnProperty.call(map, dateISO)) return map[dateISO];
    const matchingKey = Object.keys(map).find((key) => String(key).startsWith(dateISO));
    return matchingKey ? map[matchingKey] : undefined;
  };

  const crewForDate = (job, dateISO) => {
    const datedPeople = assignmentForDate(
      job?.employeesByDate || job?.employeeAssignmentsByDate,
      dateISO
    );
    const datedCodes = assignmentForDate(
      job?.employeeCodesByDate || job?.assignedEmployeeCodesByDate,
      dateISO
    );
    const people = datedPeople === undefined ? toArray(job?.employees) : toArray(datedPeople);
    const codes = datedCodes === undefined ? toArray(job?.employeeCodes) : toArray(datedCodes);
    return Array.from(new Set([...people, ...codes].map(nameOf).filter(Boolean)));
  };

  const vehiclesForDate = (job, dateISO) => {
    const datedVehicles = assignmentForDate(
      job?.vehiclesByDate || job?.vehicleAssignmentsByDate,
      dateISO
    );
    const references = datedVehicles === undefined
      ? getBookingVehicleReferences(job)
      : toArray(datedVehicles);
    return getVehicleDisplayList(references, vehiclesResource.data);
  };

  // 🔧 web-style date normaliser → "YYYY-MM-DD" or null
  const getISO = useCallback((val) => {
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
  }, []);

  const lifecycleBookings = useMemo(
    () => allBookings.filter((booking) => shouldShowDiaryBooking(booking, includeInactive)),
    [allBookings, includeInactive]
  );

  const inactiveCount = useMemo(
    () => allBookings.filter((booking) => getBookingLifecycle(booking) !== "active").length,
    [allBookings]
  );

  const matchesStatusFilter = useCallback((booking) => {
    if (statusFilter === "all") return true;
    const status = String(booking?.status || "").trim().toLowerCase();
    if (statusFilter === "maintenance") return isMaintenanceBooking(booking);
    if (statusFilter === "firstPencil") return status.includes("first pencil");
    if (statusFilter === "secondPencil") return status.includes("second pencil");
    if (statusFilter === "muted") return getBookingLifecycle(booking) !== "active";
    return (
      getBookingLifecycle(booking) === "active" &&
      !isMaintenanceBooking(booking) &&
      !status.includes("first pencil") &&
      !status.includes("second pencil")
    );
  }, [statusFilter]);

  const filteredBookings = useMemo(
    () => lifecycleBookings.filter(matchesStatusFilter),
    [lifecycleBookings, matchesStatusFilter]
  );

  const jobsForSelectedDate = useMemo(() => {
    const day = selectedDate;
    return filteredBookings.filter((booking) => {
      if (Array.isArray(booking.bookingDates) && booking.bookingDates.length) {
        const dates = booking.bookingDates.map(getISO).filter(Boolean);
        if (dates.includes(day)) return true;
      }
      const singleDate = getISO(booking.date);
      const start = getISO(booking.startDate);
      const end = getISO(booking.endDate);
      if (singleDate === day) return true;
      if (start && end && day >= start && day <= end) return true;
      return Boolean(start && !end && start === day);
    });
  }, [filteredBookings, getISO, selectedDate]);

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
  const nextDateOnOrAfter = useCallback((b, isoRef) => {
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
  }, [getISO]);

  const upcomingBookings = useMemo(
    () =>
      filteredBookings
        .map((booking) => ({
          booking,
          nextDate: nextDateOnOrAfter(booking, tomorrowISO),
        }))
        .filter(({ nextDate }) => Boolean(nextDate))
        .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
        .map(({ booking, nextDate }) => ({ ...booking, _nextDate: nextDate })),
    [filteredBookings, nextDateOnOrAfter, tomorrowISO]
  );

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

  const firstText = (...values) => {
    for (const value of values) {
      if (value == null || typeof value === "object") continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  };

  const extractBookingDates = (job) => {
    const dates = new Set();
    toArray(job?.bookingDates).map(getISO).filter(Boolean).forEach((date) => dates.add(date));
    const single = getISO(job?.date);
    const start = getISO(job?.startDate);
    const end = getISO(job?.endDate);
    if (single) dates.add(single);

    if (start && end) {
      const cursor = new Date(`${start}T12:00:00`);
      const endDate = new Date(`${end}T12:00:00`);
      let guard = 0;
      while (cursor <= endDate && guard < 180) {
        dates.add(cursor.toISOString().split("T")[0]);
        cursor.setDate(cursor.getDate() + 1);
        guard += 1;
      }
    } else if (start) {
      dates.add(start);
    }

    return [...dates].sort();
  };

  const formatDateRange = (dates) => {
    if (!dates.length) return "";
    if (dates.length === 1) return formatDateNice(dates[0]);
    return `${formatDateNice(dates[0])} – ${formatDateNice(dates[dates.length - 1])}`;
  };

  const formatDatedValues = (value, formatter) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.entries(value)
      .map(([date, raw]) => {
        const formatted = formatter(raw);
        const isoDate = String(date).match(/^\d{4}-\d{2}-\d{2}/)?.[0] || getISO(date);
        return formatted && isoDate ? { date: isoDate, value: formatted } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const formatDatedLines = (entries) =>
    entries.map(({ date, value }) => `${formatDateNice(date)} · ${value}`).join("\n");

  const formatMinutes = (value) => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return String(value || "").trim();
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (!hours) return `${remainder} min`;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  };

  const humanizeField = (value) =>
    String(value || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/^./, (character) => character.toUpperCase());

  const formatOperationalNotes = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const rows = [];

    const appendText = (rawValue, fallbackDate, fallbackField = "") => {
      const lines = String(rawValue || "")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const embeddedRows = lines
        .map((line) => {
          const match = line.match(/^(\d{4}-\d{2}-\d{2})[-_](.+?):\s*(.+)$/);
          if (!match) return null;
          const [, date, field, rawDisplayValue] = match;
          const displayValue = /mins|minutes/i.test(field)
            ? formatMinutes(rawDisplayValue)
            : rawDisplayValue;
          return { date, value: `${humanizeField(field)} · ${displayValue}` };
        })
        .filter(Boolean);

      if (embeddedRows.length) {
        rows.push(...embeddedRows);
        return;
      }

      const displayValue = /mins|minutes/i.test(fallbackField)
        ? formatMinutes(rawValue)
        : lines.join(" · ");
      if (displayValue) {
        rows.push({
          date: fallbackDate,
          value: fallbackField
            ? `${humanizeField(fallbackField)} · ${displayValue}`
            : displayValue,
        });
      }
    };

    Object.entries(value).forEach(([rawKey, raw]) => {
      const date = String(rawKey).match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      if (!date) return;
      const field = String(rawKey).slice(date.length).replace(/^[-_]+/, "");

      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const primary = firstText(raw.label, raw.value, raw.note, raw.notes, raw.text);
        if (primary) appendText(primary, date);
        Object.entries(raw).forEach(([nestedKey, nestedValue]) => {
          if (["label", "value", "note", "notes", "text"].includes(nestedKey)) return;
          if (nestedValue == null || nestedValue === "") return;
          const displayValue = /mins|minutes/i.test(nestedKey)
            ? formatMinutes(nestedValue)
            : String(nestedValue);
          rows.push({ date, value: `${humanizeField(nestedKey)} · ${displayValue}` });
        });
        return;
      }

      appendText(raw, date, field);
    });

    return rows
      .filter((row, index, values) =>
        values.findIndex((candidate) => candidate.date === row.date && candidate.value === row.value) === index
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const productionOf = (b) => b?.production || b?.client || "Production";

  const dayChipLabel = (iso) => {
    if (!iso) return "";
    if (iso === todayISO) return "Today";
    if (iso === tomorrowISO) return "Tomorrow";
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { weekday: "short" });
  };

  const selectedJobDetails = selectedJob
    ? (() => {
        const dates = extractBookingDates(selectedJob);
        const callTimes = formatDatedValues(
          selectedJob.callTimes || selectedJob.callTimesByDate || selectedJob.callTimeByDate,
          (raw) =>
            typeof raw === "string"
              ? raw.trim()
              : firstText(raw?.callTime, raw?.call, raw?.value, raw?.label)
        );
        const generalCallTime = firstText(
          selectedJob.callTime,
          selectedJob.calltime,
          selectedJob.call_time
        );
        const crew = formatPeople(selectedJob.employees);
        const vehicles = formatVehicles(getBookingVehicleReferences(selectedJob));
        const crewByDate = formatDatedValues(
          selectedJob.employeesByDate || selectedJob.employeeAssignmentsByDate,
          (raw) => formatPeople(raw)
        );
        const vehiclesByDate = formatDatedValues(
          selectedJob.vehiclesByDate || selectedJob.vehicleAssignmentsByDate,
          (raw) => formatVehicles(raw)
        );
        const notesByDate = formatOperationalNotes(selectedJob.notesByDate);
        const equipment = toArray(selectedJob.equipment || selectedJob.kit)
          .map((item) =>
            typeof item === "string"
              ? item
              : firstText(item?.name, item?.label, item?.title, item?.description)
          )
          .filter(Boolean);

        return {
          dates,
          crew,
          vehicles,
          generalCallTime,
          callTimes: callTimes.some((entry) => entry.value !== generalCallTime)
            ? callTimes
            : [],
          crewByDate: crewByDate.some((entry) => entry.value !== crew) ? crewByDate : [],
          vehiclesByDate: vehiclesByDate.some((entry) => entry.value !== vehicles)
            ? vehiclesByDate
            : [],
          notesByDate,
          equipment,
        };
      })()
    : null;

  // week helpers for upcoming grouping
  const startOfWeekISO = (iso) => {
    const d = new Date(iso + "T12:00:00");
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
      formatVehicles(getBookingVehicleReferences(job)),
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
    return (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>
          {formatDateNice(selectedDate)}
        </Text>
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
    const muted = getBookingLifecycle(job) !== "active";
    const maintenance = isMaintenanceBooking(job);

    if (maintenance) return styles.leftMaintenance; // orange
    if (status.includes("second pencil")) return styles.leftSecondPencil; // red
    if (status.includes("first pencil")) return styles.leftFirstPencil; // yellow
    if (shootType === "night") return styles.leftNightShoot; // purple
    if (muted) return styles.leftMuted; // grey

    return styles.leftActive; // green / default
  };

  const Card = ({ job, displayDate }) => {
    const dateStr = displayDate || firstDateStr(job);
    const lifecycle = getBookingLifecycle(job);
    const muted = lifecycle !== "active";
    const maintenance = isMaintenanceBooking(job);
    const leftTone = getLeftToneStyle(job);
    const crewNames = crewForDate(job, dateStr);
    const vehicleNames = vehiclesForDate(job, dateStr);

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
        accessibilityRole="button"
        accessibilityLabel={`Open job ${job.jobNumber || "N/A"}, ${productionOf(job)}`}
        accessibilityHint="Shows the full booking details"
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

          {job.location ? (
            <Text
              style={[
                styles.jobMeta,
                { color: colors.textMuted },
                muted && styles.jobMetaMuted,
              ]}
            >
              {job.location}
            </Text>
          ) : null}

          <View style={styles.jobResourceRow}>
            <Icon name="users" size={13} color={colors.textMuted} />
            <Text
              style={[styles.jobResourceText, { color: colors.textMuted }, muted && styles.jobMetaMuted]}
              numberOfLines={1}
            >
              {crewNames.length ? crewNames.join(", ") : "No crew assigned"}
            </Text>
          </View>

          <View style={styles.jobResourceRow}>
            <Icon name="truck" size={13} color={colors.textMuted} />
            <Text
              style={[styles.jobResourceText, { color: colors.textMuted }, muted && styles.jobMetaMuted]}
              numberOfLines={1}
            >
              {vehicleNames.length ? vehicleNames.join(", ") : "No vehicles assigned"}
            </Text>
          </View>

          {job.status || muted || maintenance ? (
            <View style={styles.statusRow}>
              <Text
                style={[
                  styles.jobStatus,
                  { backgroundColor: colors.surface, color: colors.text },
                  muted && styles.jobStatusMuted,
                ]}
              >
                {muted
                  ? getBookingLifecycleLabel(job)
                  : maintenance
                    ? "Maintenance"
                    : job.status}
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

    filteredBookings.forEach((b) => {
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

  const selectedWeekDates = (() => {
    const start = new Date(`${startOfWeekISO(selectedDate)}T12:00:00`);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date.toISOString().split("T")[0];
    });
  })();

  const filterToneStyles = {
    active: styles.leftActive,
    firstPencil: styles.leftFirstPencil,
    secondPencil: styles.leftSecondPencil,
    maintenance: styles.leftMaintenance,
    muted: styles.leftMuted,
  };

  return (
    <PageShell
      header={{
        variant: "compact",
        eyebrow: "Operations",
        title: "Work Diary",
        onBack: router.back,
        action: {
          label: "Open work diary board",
          icon: "columns",
          onPress: () =>
            router.push({
              pathname: "/work-diary-board",
              params: includeInactive ? { includeInactive: "1" } : {},
            }),
        },
      }}
      state={{
        resources: [bookingsResource, employeesResource, vehiclesResource],
        hasContent: bookingsResource.data.length > 0,
        onRetry: refreshDiary,
        loadingLabel: "Loading work diary…",
        errorTitle: "Work diary unavailable",
        errorMessage: "Could not load the work diary. Please try again.",
        refreshErrorMessage: "Could not refresh the work diary. Showing saved jobs.",
      }}
      refresh={{
        refreshing: bookingsResource.isRefreshing || employeesResource.isRefreshing || vehiclesResource.isRefreshing,
        onRefresh: refreshDiary,
      }}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <>
          <View style={styles.searchRow}>
            <FormField
                label="Search work diary"
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search jobs"
                inputProps={{
                  autoCorrect: false,
                  autoCapitalize: "none",
                  accessibilityHint: "Search by job number, production, location, crew, vehicle or status",
                  returnKeyType: "search",
                }}
              />

            <View style={styles.quickDateRow}>
              <TouchableOpacity
                style={[
                  styles.quickDateBtn,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  selectedDate === todayISO && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                ]}
                onPress={() => setSelectedDate(todayISO)}
                accessibilityRole="button"
                accessibilityLabel="Show today in work diary"
                accessibilityState={{ selected: selectedDate === todayISO }}
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
                accessibilityRole="button"
                accessibilityLabel="Show tomorrow in work diary"
                accessibilityState={{ selected: selectedDate === tomorrowISO }}
              >
                <Text style={[styles.quickDateText, { color: selectedDate === tomorrowISO ? colors.accent : colors.textMuted }]}>
                  Tomorrow
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[
                styles.inactiveToggle,
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                includeInactive && {
                  backgroundColor: colors.accentSoft,
                  borderColor: colors.accent,
                },
              ]}
              onPress={() => {
                if (includeInactive && statusFilter === "muted") setStatusFilter("all");
                setIncludeInactive((value) => !value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: includeInactive }}
              accessibilityLabel={includeInactive ? "Hide inactive jobs" : "Show inactive jobs"}
            >
              <Icon
                name={includeInactive ? "eye-off" : "eye"}
                size={16}
                color={includeInactive ? colors.accent : colors.textMuted}
              />
              <Text
                style={[
                  styles.inactiveToggleText,
                  { color: includeInactive ? colors.accent : colors.textMuted },
                ]}
              >
                {includeInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.weekStrip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            {selectedWeekDates.map((date) => {
              const parsed = new Date(`${date}T00:00:00`);
              const selected = date === selectedDate;
              const marked = Boolean(calendarMarkedDates[date]?.marked);
              return (
                <TouchableOpacity
                  key={date}
                  style={[
                    styles.weekDay,
                    selected && { backgroundColor: colors.accent },
                  ]}
                  onPress={() => setSelectedDate(date)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={formatDateNice(date)}
                >
                  <Text style={[styles.weekDayName, { color: selected ? colors.background : colors.textMuted }]}>
                    {parsed.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 1)}
                  </Text>
                  <Text style={[styles.weekDayNumber, { color: selected ? colors.background : colors.text }]}>
                    {parsed.getDate()}
                  </Text>
                  <View
                    style={[
                      styles.weekDayDot,
                      {
                        backgroundColor: marked
                          ? selected
                            ? colors.background
                            : colors.accent
                          : "transparent",
                      },
                    ]}
                  />
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {STATUS_FILTERS.map((filter) => {
              const selected = statusFilter === filter.key;
              return (
                <TouchableOpacity
                  key={filter.key}
                  style={[
                    styles.filterChip,
                    { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                    selected && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                  ]}
                  onPress={() => {
                    if (filter.key === "muted") setIncludeInactive(true);
                    setStatusFilter(filter.key);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  {filterToneStyles[filter.key] ? (
                    <View style={[styles.legendTone, filterToneStyles[filter.key]]} />
                  ) : null}
                  <Text style={[styles.filterChipText, { color: selected ? colors.accent : colors.textMuted }]}>
                    {filter.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={styles.section}>
            <SelectedHeader count={visibleJobsForSelectedDate.length} />

            {visibleJobsForSelectedDate.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="No jobs assigned"
                message={
                  searchActive
                    ? `No jobs matched "${searchQuery.trim()}".`
                    : "Add a booking, change the date, or clear your search."
                }
                compact
              />
            ) : (
              visibleJobsForSelectedDate.map((job) => (
                <Card key={job.id} job={job} displayDate={selectedDate} />
              ))
            )}
          </View>

          <TouchableOpacity
            style={[styles.monthToggle, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            onPress={() => setMonthExpanded((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: monthExpanded }}
          >
            <Icon name="calendar" size={16} color={colors.text} />
            <Text style={[styles.monthToggleText, { color: colors.text }]}>
              {monthExpanded ? "Hide month" : "View month"}
            </Text>
            <Icon name={monthExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
          </TouchableOpacity>

          {monthExpanded ? (
            <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Calendar
                current={selectedDate}
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
          ) : null}

          <View style={[styles.sectionHeader, styles.upcomingHeader]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming</Text>
            <View style={[styles.badge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.badgeText, { color: colors.background }]}>{visibleUpcomingCount}</Text>
            </View>
          </View>
          <UpcomingSection title="Tomorrow" items={groupedUpcoming.tomorrow} />
          <UpcomingSection title="This Week" items={groupedUpcoming.thisWeek} />
          <UpcomingSection title="Later" items={groupedUpcoming.later} />
        </>

        {/* Modal */}
        <AppModal
          visible={selectedJob !== null}
          title={selectedJob ? productionOf(selectedJob) : "Job details"}
          onRequestClose={() => setSelectedJob(null)}
          closeLabel="Close job details"
          scrollable
        >
              {selectedJob && selectedJobDetails ? (
                <>
                  <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}> 
                    <View style={styles.modalHeaderCopy}>
                      <Text style={[styles.modalEyebrow, { color: colors.textMuted }]}>
                        JOB #{selectedJob.jobNumber || "N/A"}
                      </Text>
                      <View style={styles.modalPillRow}>
                        <View style={[styles.modalPill, { backgroundColor: colors.accentSoft, borderColor: colors.border }]}>
                          <Text style={[styles.modalPillText, { color: colors.accent }]}>
                            {getBookingLifecycle(selectedJob) === "active"
                              ? selectedJob.status || "Active"
                              : getBookingLifecycleLabel(selectedJob)}
                          </Text>
                        </View>
                        {firstText(selectedJob.bookingType, selectedJob.type) ? (
                          <View style={[styles.modalPill, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Text style={[styles.modalPillText, { color: colors.textMuted }]}>
                              {firstText(selectedJob.bookingType, selectedJob.type)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>

                  <View style={styles.modalScrollContent}>
                    <JobDetailSection title="Overview" colors={colors}>
                      <JobDetailRow icon="film" label="Production" value={firstText(selectedJob.production)} colors={colors} />
                      <JobDetailRow icon="briefcase" label="Client" value={firstText(selectedJob.client)} colors={colors} />
                      <JobDetailRow icon="camera" label="Shoot type" value={firstText(selectedJob.shootType, selectedJob.shoot)} colors={colors} />
                      <JobDetailRow
                        icon="hash"
                        label="Reference / PO"
                        value={firstText(
                          selectedJob.purchaseOrder,
                          selectedJob.poNumber,
                          selectedJob.bookingReference,
                          selectedJob.reference
                        )}
                        colors={colors}
                      />
                    </JobDetailSection>

                    <JobDetailSection title="Schedule" colors={colors}>
                      <JobDetailRow icon="calendar" label="Dates" value={formatDateRange(selectedJobDetails.dates)} colors={colors} />
                      <JobDetailRow
                        icon="clock"
                        label="Call times"
                        value={[
                          selectedJobDetails.generalCallTime,
                          formatDatedLines(selectedJobDetails.callTimes),
                        ]
                          .filter(Boolean)
                          .join("\n")}
                        colors={colors}
                      />
                      <JobDetailRow
                        icon="map-pin"
                        label="Location"
                        value={[
                          firstText(selectedJob.location, selectedJob.address, selectedJob.site),
                          firstText(selectedJob.postcode),
                        ]
                          .filter(Boolean)
                          .filter((value, index, values) => values.indexOf(value) === index)
                          .join("\n")}
                        colors={colors}
                      />
                    </JobDetailSection>

                    <JobDetailSection title="Resources" colors={colors}>
                      <JobDetailRow icon="users" label="Crew" value={selectedJobDetails.crew} colors={colors} />
                      <JobDetailRow icon="calendar" label="Crew changes" value={formatDatedLines(selectedJobDetails.crewByDate)} colors={colors} />
                      <JobDetailRow icon="truck" label="Vehicles" value={selectedJobDetails.vehicles} colors={colors} />
                      <JobDetailRow icon="calendar" label="Vehicle changes" value={formatDatedLines(selectedJobDetails.vehiclesByDate)} colors={colors} />
                      <JobDetailRow icon="box" label="Equipment" value={selectedJobDetails.equipment.join("\n")} colors={colors} />
                    </JobDetailSection>

                    {firstText(
                      selectedJob.contactName,
                      typeof selectedJob.contact === "string" ? selectedJob.contact : "",
                      selectedJob.contact?.name,
                      selectedJob.booker,
                      selectedJob.contactPhone,
                      selectedJob.contact?.phone,
                      selectedJob.phone,
                      selectedJob.mobile,
                      selectedJob.contactEmail,
                      selectedJob.contact?.email,
                      selectedJob.email
                    ) ? (
                      <JobDetailSection title="Contact" colors={colors}>
                        <JobDetailRow
                          icon="user"
                          label="Booking contact"
                          value={[
                            firstText(
                              selectedJob.contactName,
                              typeof selectedJob.contact === "string" ? selectedJob.contact : "",
                              selectedJob.contact?.name,
                              selectedJob.booker
                            ),
                            firstText(selectedJob.contactPhone, selectedJob.contact?.phone, selectedJob.phone, selectedJob.mobile),
                            firstText(selectedJob.contactEmail, selectedJob.contact?.email, selectedJob.email),
                          ]
                            .filter(Boolean)
                            .join("\n")}
                          colors={colors}
                        />
                      </JobDetailSection>
                    ) : null}

                    <JobDetailSection title="Notes" colors={colors}>
                      <JobDetailRow
                        icon="file-text"
                        label="Operational notes"
                        value={[
                          firstText(selectedJob.notes, selectedJob.note, selectedJob.description),
                          formatDatedLines(selectedJobDetails.notesByDate),
                        ]
                          .filter(Boolean)
                          .join("\n") || "No notes"}
                        colors={colors}
                      />
                    </JobDetailSection>
                  </View>
                </>
              ) : null}
        </AppModal>
      </View>
    </PageShell>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  container: { flex: 1 },
  searchRow: {
    marginBottom: t.spacing.sm,
  },
  searchInputWrap: {
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.body.fontSize,
  },
  clearSearchBtn: {
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    minHeight: 44,
    justifyContent: "center",
  },
  clearSearchText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  quickDateRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    gap: t.spacing.xs,
  },
  quickDateBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  quickDateText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  inactiveToggle: {
    minHeight: 44,
    marginTop: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  inactiveToggleText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  weekStrip: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.spacing.xxs,
    marginBottom: t.spacing.xs,
    flexDirection: "row",
  },
  weekDay: {
    flex: 1,
    minHeight: 64,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  weekDayName: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  weekDayNumber: {
    ...t.typography.body,
    fontWeight: "800",
    marginTop: t.spacing.none,
  },
  weekDayDot: {
    width: 4,
    height: 4,
    borderRadius: t.radius.pill,
    marginTop: t.spacing.none,
  },
  filterRow: {
    gap: t.spacing.xxs,
    paddingBottom: t.spacing.xs,
  },
  filterChip: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  filterChipText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
  },
  monthToggle: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.sm,
    marginBottom: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
  },
  monthToggleText: {
    flex: 1,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  card: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    overflow: "hidden",
    marginBottom: t.spacing.sm,
  },

  /* Sections */
  section: {
    padding: t.spacing.none,
    marginBottom: t.spacing.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xs,
  },
  sectionTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "800" },
  upcomingHeader: { marginBottom: t.spacing.xs, marginTop: t.spacing.none },

  badge: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.none,
    borderRadius: t.radius.md,
  },
  badgeText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  smallChip: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.none,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  smallChipMuted: {},
  smallChipText: { fontSize: t.typography.caption.fontSize, fontWeight: "800" },
  smallChipTextMuted: {},
  legendTone: {
    width: 10,
    height: 10,
    borderRadius: t.radius.pill,
  },
  jobCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.xs,
  },
  leftBar: {
    width: 4,
    borderRadius: t.radius.sm,
    marginRight: t.spacing.xs,
  },
  leftActive: { backgroundColor: staticColors.hex_22c55e_74qlvk }, // default green
  leftMuted: { backgroundColor: staticColors.hex_6b7280_3k0ytb }, // grey
  leftMaintenance: { backgroundColor: staticColors.hex_f97316_oh807u }, // orange
  leftFirstPencil: { backgroundColor: staticColors.hex_facc15_p8audh }, // yellow
  leftSecondPencil: { backgroundColor: staticColors.hex_ef4444_sj3rhh }, // red
  leftNightShoot: { backgroundColor: staticColors.hex_a855f7_u9x9hq }, // purple

  jobHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xxs,
  },
  jobTitle: { fontWeight: "800", flexShrink: 1, paddingRight: t.spacing.xs },
  statusRow: { marginTop: t.spacing.xxs, flexDirection: "row", gap: t.spacing.xs },
  jobStatus: {
    fontSize: t.typography.metadata.fontSize,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.none,
    borderRadius: t.radius.sm,
  },
  jobStatusMuted: {},
  jobMeta: { fontSize: t.typography.bodySmall.fontSize, marginTop: t.spacing.none },
  jobMetaMuted: {},
  jobResourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    marginTop: t.spacing.none,
  },
  jobResourceText: {
    flex: 1,
    minWidth: 0,
    fontSize: t.typography.bodySmall.fontSize,
  },

  /* Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: staticColors.rgba_18a7ub6,
    justifyContent: "center",
    alignItems: "center",
    padding: t.spacing.md,
  },
  modalCard: {
    width: "92%",
    borderWidth: 1,
    borderRadius: t.radius.lg,
    maxHeight: "90%",
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.sm,
    padding: t.spacing.md,
    borderBottomWidth: 1,
  },
  modalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalEyebrow: {
    ...t.typography.label,
  },
  modalTitle: {
    ...t.typography.titleSmall,
    marginTop: t.spacing.none,
  },
  modalPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xxs,
    marginTop: t.spacing.xs,
  },
  modalPill: {
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.none,
  },
  modalPillText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  modalCloseButton: {
    width: 44,
    height: 44,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalScrollContent: {
    paddingHorizontal: t.spacing.md,
    paddingBottom: t.spacing.lg,
  },
  modalSection: {
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
  },
  modalSectionTitle: {
    ...t.typography.label,
    marginBottom: t.spacing.xxs,
  },
  modalDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
  modalDetailIcon: {
    width: 36,
    height: 36,
    borderRadius: t.radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDetailCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalDetailLabel: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  modalDetailValue: {
    fontSize: t.typography.body.fontSize,
    lineHeight: t.typography.body.lineHeight,
    fontWeight: "600",
  },
});
