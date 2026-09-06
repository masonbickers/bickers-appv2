import { AppModal, AppText as Text, AppPressable as TouchableOpacity } from "../../components/ui/AppPrimitives";
import { useLocalSearchParams, useRouter } from "expo-router";
import { collection,
  getDocs } from "firebase/firestore";
import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { db } from "../../firebaseConfig";
import { getVehicleDisplayLabel } from "../../lib/fleetSchema";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";
import {
  getBookingLifecycle,
  getBookingLifecycleLabel,
  shouldShowDiaryBooking,
} from "../../lib/bookingLifecycle";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COL_WIDTH = 290;
const HEADER_HEIGHT = 42;
const ROW_HEIGHT = 260;

let cachedBoardData = null;
let boardDataRequest = null;

function getISO(value) {
  if (!value) return null;
  if (value?.toDate && typeof value.toDate === "function") {
    return value.toDate().toISOString().split("T")[0];
  }
  if (value instanceof Date) return value.toISOString().split("T")[0];
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split("T")[0];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

function mondayFor(value) {
  const d = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysISO(iso, amount) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return isoFromDate(d);
}

function formatDayHeader(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()}`;
}

function formatVehicle(vehicle, vehicleDirectory = []) {
  return getVehicleDisplayLabel(vehicle, vehicleDirectory);
}

function toArray(val) {
  return Array.isArray(val) ? val : val ? [val] : [];
}

function formatPeople(val) {
  return toArray(val)
    .map((x) =>
      typeof x === "string"
        ? x
        : x?.name || x?.fullName || x?.label || x?.userCode || x?.email || "Unknown"
    )
    .filter(Boolean);
}

function extractBookingDates(job) {
  const set = new Set();
  if (Array.isArray(job?.bookingDates)) {
    job.bookingDates.map(getISO).filter(Boolean).forEach((d) => set.add(d));
  }

  const single = getISO(job?.date);
  const start = getISO(job?.startDate);
  const end = getISO(job?.endDate);
  if (single) set.add(single);

  if (start && end) {
    let cursor = start;
    let guard = 0;
    while (cursor <= end && guard < 180) {
      set.add(cursor);
      cursor = addDaysISO(cursor, 1);
      guard += 1;
    }
  } else if (start) {
    set.add(start);
  }

  return Array.from(set).sort();
}

function shouldShowBoardJob(job) {
  const status = String(job?.status || "").trim().toLowerCase();
  if (!status) return false;

  return (
    status.includes("confirmed") ||
    status.includes("complete") ||
    status.includes("first pencil") ||
    status.includes("second pencil")
  );
}

function overlapSpan(jobDates, weekDates) {
  const indexes = jobDates
    .map((date) => weekDates.indexOf(date))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);

  if (!indexes.length) return null;
  return { start: indexes[0], end: indexes[indexes.length - 1] };
}

function cardTone(job) {
  const status = String(job?.status || "").toLowerCase();
  const type = String(job?.bookingType || job?.type || "").toLowerCase();
  const isMaintenance =
    job?.isMaintenance === true ||
    !!job?.maintenanceType ||
    type === "maintenance" ||
    status === "maintenance";

  if (isMaintenance) {
    return {
      bg: staticColors.hex_a7d091_7z1amk,
      border: staticColors.hex_6e9d5e_48qwvs,
      text: staticColors.hex_142214_a6j16u,
    };
  }

  if (status.includes("complete")) {
    return {
      bg: staticColors.hex_a7d091_7z1amk,
      border: staticColors.hex_6e9d5e_48qwvs,
      text: staticColors.hex_142214_a6j16u,
    };
  }

  if (status.includes("confirmed")) {
    return {
      bg: staticColors.hex_f5f57a_4xffkg,
      border: staticColors.hex_a9a944_8bjrly,
      text: staticColors.hex_232323_72yy4n,
    };
  }

  if (status.includes("first pencil")) {
    return {
      bg: staticColors.hex_cfe7ff_8cg5td,
      border: staticColors.hex_7fa9d6_7g0531,
      text: staticColors.hex_1c2a3a_8m3it1,
    };
  }

  if (status.includes("second pencil")) {
    return {
      bg: staticColors.hex_f6c9cc_4y74y4,
      border: staticColors.hex_d28790_63pgd2,
      text: staticColors.hex_3a1e23_9vcdmp,
    };
  }

  return {
    bg: staticColors.hex_e9edf3_5qi9vy,
    border: staticColors.hex_98a6bb_f7qsvk,
    text: staticColors.hex_1d2430_8jyunq,
  };
}

function buildRows(items) {
  const sorted = [...items].sort((a, b) => {
    if (a.span.start !== b.span.start) return a.span.start - b.span.start;
    return b.span.end - a.span.end;
  });

  const rows = [];
  const placed = [];

  for (const item of sorted) {
    let rowIndex = 0;
    while (true) {
      const row = rows[rowIndex] || [];
      const overlaps = row.some(
        (existing) =>
          !(item.span.end < existing.span.start || item.span.start > existing.span.end)
      );
      if (!overlaps) {
        row.push(item);
        rows[rowIndex] = row;
        placed.push({ ...item, row: rowIndex });
        break;
      }
      rowIndex += 1;
    }
  }

  return { placed, rowCount: Math.max(rows.length, 1) };
}

function dayNotesFor(job, weekDates) {
  const notes = job?.notesByDate || {};
  return weekDates
    .map((date) => {
      const raw = notes?.[date];
      if (!raw) return null;
      const label =
        typeof raw === "string"
          ? raw
          : String(raw?.label || raw?.value || raw?.note || "").trim();
      if (!label) return null;
      const d = new Date(`${date}T00:00:00`);
      const short = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit" }).toUpperCase();
      return `${short}: ${label}`;
    })
    .filter(Boolean);
}

function compactTags(job) {
  const tags = [];
  const crew = formatPeople(job?.employees);
  if (crew.length) tags.push(`${crew.length} crew`);
  const vehicles = toArray(job?.vehicles || job?.vehicle).map(formatVehicle).filter(Boolean);
  if (vehicles.length) tags.push(`${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"}`);
  if (job?.location) tags.push("location");
  return tags.slice(0, 3);
}

function firstText(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function titleForJob(job) {
  return firstText(job?.client, job?.production, job?.title, "Untitled Booking");
}

function formatDateLabel(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatDateRange(dates) {
  const clean = toArray(dates).map(getISO).filter(Boolean).sort();
  if (!clean.length) return "";
  if (clean.length === 1) return formatDateLabel(clean[0]);
  return `${formatDateLabel(clean[0])} - ${formatDateLabel(clean[clean.length - 1])}`;
}

function formatObjectMap(value, formatter = (v) => String(v ?? "").trim()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .map(([key, raw]) => {
      const text = formatter(raw);
      return text ? `${formatDateLabel(getISO(key) || key)}: ${text}` : "";
    })
    .filter(Boolean);
}

function formatNoteValue(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) return raw.map(formatNoteValue).filter(Boolean).join(", ");
  return firstText(raw.label, raw.value, raw.note, raw.notes, raw.text);
}

function formatTimeValue(raw) {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  return firstText(raw.callTime, raw.call, raw.value, raw.label);
}

function DetailRow({ icon, label, value, colors }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <View
        style={[
          styles.detailIcon,
          {
            backgroundColor: withAlpha(colors.surfaceAlt, 0.9),
            borderColor: withAlpha(colors.border, 0.8),
          },
        ]}
      >
        <Icon name={icon} size={14} color={colors.textMuted} />
      </View>
      <View style={styles.detailTextWrap}>
        <Text style={[styles.detailLabel, { color: colors.textMuted }]}>{label}</Text>
        <Text style={[styles.detailValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function WorkDiaryBoardPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const scrollRef = useRef(null);
  const verticalScrollRef = useRef(null);
  const mountedRef = useRef(true);
  const { width: screenWidth } = useWindowDimensions();

  const [weekStart, setWeekStart] = useState(() => isoFromDate(mondayFor(new Date())));
  const [bookings, setBookings] = useState(() => cachedBoardData?.bookings || []);
  const [vehicleDirectory, setVehicleDirectory] = useState(
    () => cachedBoardData?.vehicles || []
  );
  const [loading, setLoading] = useState(() => !cachedBoardData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [includeInactive, setIncludeInactive] = useState(
    () => String(params.includeInactive || "") === "1"
  );

  const applyBoardData = useCallback((data) => {
    setBookings(data.bookings);
    setVehicleDirectory(data.vehicles);
  }, []);

  const loadBookings = useCallback(async ({ force = false } = {}) => {
    if (cachedBoardData && !force) {
      applyBoardData(cachedBoardData);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      setError("");
      if (!cachedBoardData) setLoading(true);

      if (!boardDataRequest || force) {
        boardDataRequest = Promise.all([
          getDocs(collection(db, "bookings")),
          getDocs(collection(db, "vehicles")),
        ]);
      }

      const [bookingSnap, vehiclesSnap] = await boardDataRequest;
      const rows = bookingSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const vehicles = vehiclesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

      const nextData = { bookings: rows, vehicles };
      cachedBoardData = nextData;
      if (mountedRef.current) applyBoardData(nextData);
    } catch (e) {
      console.error("work diary board load failed", e);
      if (mountedRef.current) setError("Could not load work diary board.");
    } finally {
      boardDataRequest = null;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [applyBoardData]);

  useEffect(() => {
    mountedRef.current = true;
    loadBookings();
    return () => {
      mountedRef.current = false;
    };
  }, [loadBookings]);

  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysISO(weekStart, index)),
    [weekStart]
  );

  const boardItems = useMemo(() => {
    const matches = bookings
      .filter((job) => shouldShowDiaryBooking(job, includeInactive))
      .filter(
        (job) =>
          shouldShowBoardJob(job) ||
          (includeInactive && getBookingLifecycle(job) !== "active")
      )
      .map((job) => {
        const dates = extractBookingDates(job);
        const span = overlapSpan(dates, weekDates);
        if (!span) return null;
        return { job, dates, span };
      })
      .filter(Boolean);

    return buildRows(matches);
  }, [bookings, includeInactive, weekDates]);

  const inactiveCount = useMemo(
    () => bookings.filter((job) => getBookingLifecycle(job) !== "active").length,
    [bookings]
  );

  const boardHeight = HEADER_HEIGHT + boardItems.rowCount * ROW_HEIGHT;
  const boardWidth = COL_WIDTH * 7;
  const initialZoomScale = Math.min(1, Math.max(0.35, (screenWidth - 32) / boardWidth));
  const shiftWeek = (delta) => setWeekStart((prev) => addDaysISO(prev, delta * 7));

  const selectedJobDetails = useMemo(() => {
    if (!selectedJob) return null;

    const dates = extractBookingDates(selectedJob);
    const vehicles = toArray(selectedJob?.vehicles || selectedJob?.vehicle)
      .map((vehicle) => formatVehicle(vehicle, vehicleDirectory))
      .filter(Boolean);
    const people = formatPeople(selectedJob?.employees);
    const callTimes = formatObjectMap(
      selectedJob?.callTimes || selectedJob?.callTimesByDate || selectedJob?.callTimeByDate,
      formatTimeValue
    );
    const crewByDate = formatObjectMap(
      selectedJob?.employeesByDate || selectedJob?.employeeAssignmentsByDate,
      (raw) => formatPeople(raw).join(", ")
    );
    const notesByDate = formatObjectMap(selectedJob?.notesByDate, formatNoteValue);
    const dayNotes = dayNotesFor(selectedJob, dates);
    const equipment = toArray(selectedJob?.equipment || selectedJob?.kit)
      .map((item) =>
        typeof item === "string"
          ? item
          : firstText(item?.name, item?.label, item?.title, item?.description)
      )
      .filter(Boolean);

    return {
      dates,
      vehicles,
      people,
      callTimes,
      crewByDate,
      equipment,
      notes: [...new Set([...notesByDate, ...dayNotes])],
      generalNotes: firstText(selectedJob?.notes, selectedJob?.note, selectedJob?.description),
    };
  }, [selectedJob, vehicleDirectory]);

  useEffect(() => {
    requestAnimationFrame(() => {
      verticalScrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
      scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    });
  }, [weekStart, loading]);

  return (
    <PageShell
      header={{
        variant: "compact",
        eyebrow: "Operations",
        title: "Work Diary Board",
        onBack: router.back,
      }}
      refresh={{
        refreshing,
        onRefresh: () => {
          setRefreshing(true);
          loadBookings({ force: true });
        },
      }}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.toolbar}>
          <View style={styles.toolbarLeft}>
            <TouchableOpacity
              onPress={() => setWeekStart(isoFromDate(mondayFor(new Date())))}
              activeOpacity={0.85}
              style={[styles.todayBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.todayText, { color: colors.text }]}>Today</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setIncludeInactive((value) => !value)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: includeInactive }}
              style={[
                styles.todayBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
                includeInactive && {
                  backgroundColor: colors.accentSoft,
                  borderColor: colors.accent,
                },
              ]}
            >
              <Icon
                name={includeInactive ? "eye-off" : "eye"}
                size={14}
                color={includeInactive ? colors.accent : colors.textMuted}
              />
              <Text style={[styles.todayText, { color: includeInactive ? colors.accent : colors.textMuted }]}>
                {includeInactive ? "Hide inactive" : `Show inactive (${inactiveCount})`}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.toolbarRight}>
            <TouchableOpacity
              onPress={() => shiftWeek(-1)}
              activeOpacity={0.85}
              style={[styles.navBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Icon name="arrow-left" size={14} color={colors.text} />
              <Text style={[styles.navText, { color: colors.text }]}>Previous Week</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => shiftWeek(1)}
              activeOpacity={0.85}
              style={[styles.navBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.navText, { color: colors.text }]}>Next Week</Text>
              <Icon name="arrow-right" size={14} color={colors.text} />
            </TouchableOpacity>

          </View>
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.stateText, { color: colors.textMuted }]}>Loading weekly board…</Text>
          </View>
        ) : error ? (
          <View style={[styles.errorCard, { backgroundColor: withAlpha(colors.danger, 0.12), borderColor: colors.danger }]}>
            <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
            <TouchableOpacity
              onPress={() => {
                setRefreshing(true);
                loadBookings({ force: true });
              }}
              style={[styles.retryBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.retryText, { color: colors.text }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScrollView
              ref={scrollRef}
              style={styles.boardViewport}
              horizontal
              contentOffset={{ x: 0, y: 0 }}
              contentContainerStyle={styles.horizontalContent}
              showsHorizontalScrollIndicator
              nestedScrollEnabled
              bounces={false}
              alwaysBounceHorizontal={false}
              overScrollMode="never"
              minimumZoomScale={0.2}
              maximumZoomScale={1.5}
              zoomScale={initialZoomScale}
              bouncesZoom={false}
              pinchGestureEnabled
            >
              <View style={[styles.boardWrap, { width: boardWidth, backgroundColor: colors.surface }]}>
                <View style={[styles.boardGrid, { borderColor: colors.border, height: boardHeight }]}>
                  {weekDates.map((date, index) => (
                    <View
                      key={date}
                      style={[
                        styles.dayColumn,
                        {
                          left: index * COL_WIDTH,
                          width: COL_WIDTH,
                          height: boardHeight,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.dayHeader,
                          {
                            backgroundColor: date === isoFromDate(new Date()) ? withAlpha(colors.accent, 0.18) : colors.surface,
                            borderBottomColor: colors.border,
                          },
                        ]}
                      >
                        <Text style={[styles.dayHeaderText, { color: colors.text }]}>{formatDayHeader(date)}</Text>
                      </View>
                    </View>
                  ))}

                  {boardItems.placed.map(({ job, span, row }) => {
                    const tone = cardTone(job);
                    const lifecycle = getBookingLifecycle(job);
                    const inactive = lifecycle !== "active";
                    const notes = dayNotesFor(job, weekDates).slice(0, 3);
                    const employees = formatPeople(job?.employees).slice(0, 3).join(", ");
                    const vehicles = toArray(job?.vehicles || job?.vehicle)
                      .map((vehicle) => formatVehicle(vehicle, vehicleDirectory))
                      .filter(Boolean)
                      .slice(0, 3)
                      .join(" • ");
                    const top = HEADER_HEIGHT + row * ROW_HEIGHT + 6;
                    const left = span.start * COL_WIDTH + 6;
                    const width = (span.end - span.start + 1) * COL_WIDTH - 12;

                    return (
                      <TouchableOpacity
                        key={job.id}
                        activeOpacity={0.9}
                        onPress={() => setSelectedJob(job)}
                        style={[
                          styles.bookingCard,
                          {
                            top,
                            left,
                            width,
                            backgroundColor: tone.bg,
                            borderColor: tone.border,
                            opacity: inactive ? 0.72 : 1,
                          },
                        ]}
                      >
                        <View style={styles.bookingTopRow}>
                          <View style={styles.initialsWrap}>
                            <Text style={[styles.initialsText, { color: tone.text }]}>
                              {formatPeople(job?.employees)
                                .map((name) => String(name).trim().split(" ").map((part) => part[0]).join(""))
                                .filter(Boolean)
                                .join(", ") || "BK"}
                            </Text>
                          </View>

                          <View style={styles.statusWrap}>
                            <Text style={[styles.statusText, { color: tone.text }]}>
                              {inactive
                                ? getBookingLifecycleLabel(job).toUpperCase()
                                : String(job?.status || "").toLowerCase().includes("confirmed")
                                  ? "CONFIRMED"
                                  : String(job?.status || "BOOKED").toUpperCase()}
                            </Text>
                            <Text style={[styles.statusText, { color: tone.text }]}>
                              {String(job?.status || "").toLowerCase().includes("crewed") ? "CREWED" : employees ? "CREWED" : ""}
                            </Text>
                          </View>

                          <View style={styles.jobNumberPill}>
                            <Text style={styles.jobNumberText}>{job.jobNumber || "----"}</Text>
                          </View>
                        </View>

                        <Text style={[styles.bookingTitle, { color: tone.text }]} numberOfLines={2}>
                          {job.client || job.production || "Untitled Booking"}
                        </Text>

                        {job.callTime ? (
                          <Text style={[styles.bookingLine, { color: tone.text }]}>CT {job.callTime}</Text>
                        ) : null}

                        {vehicles ? (
                          <Text style={[styles.bookingLine, { color: tone.text }]} numberOfLines={2}>
                            {vehicles}
                          </Text>
                        ) : null}

                        {job.location ? (
                          <Text style={[styles.bookingLine, { color: tone.text }]} numberOfLines={2}>
                            {job.location}
                          </Text>
                        ) : null}

                        <View style={styles.notesBlock}>
                          {notes.map((note) => (
                            <Text key={note} style={[styles.noteText, { color: withAlpha(tone.text, 0.72) }]} numberOfLines={1}>
                              {note}
                            </Text>
                          ))}
                        </View>

                        <View style={styles.tagsRow}>
                          {compactTags(job).map((tag) => (
                            <View key={tag} style={styles.tagPill}>
                              <Text style={styles.tagText}>{tag}</Text>
                            </View>
                          ))}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
          </>
        )}

        <AppModal
          visible={!!selectedJob}
          title={selectedJob ? titleForJob(selectedJob) : "Booking details"}
          onRequestClose={() => setSelectedJob(null)}
          scrollable
        >
              {selectedJob && selectedJobDetails ? (
                <>
                  <View style={styles.detailHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailJobNumber, { color: colors.textMuted }]}>
                        {selectedJob.jobNumber || "Booking"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.detailModalContent}>
                    <View style={styles.detailPillRow}>
                      {selectedJob.status ? (
                        <View
                          style={[
                            styles.detailPill,
                            {
                              backgroundColor: withAlpha(cardTone(selectedJob).border, 0.16),
                              borderColor: withAlpha(cardTone(selectedJob).border, 0.45),
                            },
                          ]}
                        >
                          <Text style={[styles.detailPillText, { color: colors.text }]}>
                            {String(selectedJob.status).toUpperCase()}
                          </Text>
                        </View>
                      ) : null}
                      {selectedJob.bookingType || selectedJob.type ? (
                        <View
                          style={[
                            styles.detailPill,
                            {
                              backgroundColor: withAlpha(colors.surfaceAlt, 0.9),
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.detailPillText, { color: colors.text }]}>
                            {selectedJob.bookingType || selectedJob.type}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <DetailRow
                      icon="calendar"
                      label="Dates"
                      value={formatDateRange(selectedJobDetails.dates)}
                      colors={colors}
                    />
                    <DetailRow
                      icon="clock"
                      label="Call time"
                      value={firstText(
                        selectedJob.callTime,
                        selectedJob.calltime,
                        selectedJob.call_time,
                        selectedJobDetails.callTimes.join("\n")
                      )}
                      colors={colors}
                    />
                    <DetailRow
                      icon="map-pin"
                      label="Location"
                      value={firstText(selectedJob.location, selectedJob.address, selectedJob.site)}
                      colors={colors}
                    />
                    <DetailRow
                      icon="users"
                      label="Crew"
                      value={selectedJobDetails.people.join(", ")}
                      colors={colors}
                    />
                    <DetailRow
                      icon="truck"
                      label="Vehicles"
                      value={selectedJobDetails.vehicles.join("\n")}
                      colors={colors}
                    />
                    <DetailRow
                      icon="briefcase"
                      label="Production"
                      value={firstText(selectedJob.production, selectedJob.client)}
                      colors={colors}
                    />
                    <DetailRow
                      icon="user"
                      label="Contact"
                      value={[
                        firstText(selectedJob.contactName, selectedJob.contact, selectedJob.booker),
                        firstText(selectedJob.contactPhone, selectedJob.phone, selectedJob.mobile),
                        firstText(selectedJob.contactEmail, selectedJob.email),
                      ]
                        .filter(Boolean)
                        .join("\n")}
                      colors={colors}
                    />
                    <DetailRow
                      icon="calendar"
                      label="Crew by date"
                      value={selectedJobDetails.crewByDate.join("\n")}
                      colors={colors}
                    />
                    <DetailRow
                      icon="box"
                      label="Equipment"
                      value={selectedJobDetails.equipment.join("\n")}
                      colors={colors}
                    />
                    <DetailRow
                      icon="file-text"
                      label="Notes"
                      value={[selectedJobDetails.generalNotes, ...selectedJobDetails.notes]
                        .filter(Boolean)
                        .join("\n")}
                      colors={colors}
                    />
                  </View>
                </>
              ) : null}
        </AppModal>
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  toolbar: {
    marginHorizontal: t.spacing.none,
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.sm,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.none,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: t.spacing.sm,
    flexWrap: "wrap",
  },
  toolbarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    flexWrap: "wrap",
  },
  toolbarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "900",
  },
  todayBtn: {
    borderWidth: 1,
    borderRadius: t.radius.xl,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  todayText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    borderWidth: 1,
    borderRadius: t.radius.xl,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  navText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "800",
  },
  horizontalContent: {
    paddingHorizontal: t.spacing.none,
    paddingBottom: t.spacing.lg,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  verticalContent: {
    paddingBottom: t.spacing.lg,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  boardViewport: {
    flex: 1,
  },
  boardWrap: {
    borderRadius: t.radius.xl,
    overflow: "hidden",
  },
  boardGrid: {
    position: "relative",
    borderWidth: 1,
    backgroundColor: staticColors.hex_fff_yhjmu8,
  },
  dayColumn: {
    position: "absolute",
    top: 0,
    borderRightWidth: 1,
  },
  dayHeader: {
    height: HEADER_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
  },
  dayHeaderText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "500",
  },
  bookingCard: {
    position: "absolute",
    minHeight: ROW_HEIGHT - 12,
    borderWidth: 2,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    shadowColor: staticColors.hex_000_yhlkvq,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  bookingTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  initialsWrap: {
    backgroundColor: staticColors.hex_f9f9f9_50f01l,
    borderWidth: 1,
    borderColor: staticColors.hex_707070_6dnpnl,
    borderRadius: t.radius.sm,
    maxWidth: "42%",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  initialsText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
    flexWrap: "wrap",
  },
  statusWrap: {
    flex: 1,
    alignItems: "flex-end",
  },
  statusText: {
    fontSize: t.typography.micro.fontSize,
    fontWeight: "900",
    lineHeight: t.typography.micro.lineHeight,
  },
  jobNumberPill: {
    backgroundColor: staticColors.hex_f9f9f9_50f01l,
    borderWidth: 1,
    borderColor: staticColors.hex_707070_6dnpnl,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  jobNumberText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "900",
    color: staticColors.hex_1f1f1f_8imrm9,
  },
  bookingTitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "900",
    lineHeight: t.typography.sectionTitle.lineHeight,
    textTransform: "uppercase",
  },
  bookingLine: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
    lineHeight: t.typography.metadata.lineHeight,
  },
  notesBlock: {
    marginTop: t.spacing.xs,
    minHeight: 34,
  },
  noteText: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontStyle: "italic",
  },
  tagsRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xxs,
  },
  tagPill: {
    backgroundColor: staticColors.hex_e56a54_5mfcow,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  tagText: {
    color: staticColors.hex_fff_yhjmu8,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.lg,
  },
  stateText: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
  },
  errorCard: {
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.sm,
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
  },
  errorText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
  },
  retryBtn: {
    alignSelf: "flex-start",
    marginTop: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: 1,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
  },
  retryText: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: staticColors.rgba_18a7thw,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xl,
  },
  detailModalCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "86%",
    borderWidth: 1,
    borderRadius: t.radius.xl,
    overflow: "hidden",
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.sm,
  },
  detailJobNumber: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  detailTitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.pageTitle.fontSize,
    lineHeight: t.typography.pageTitle.lineHeight,
    fontWeight: "900",
  },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  detailModalContent: {
    paddingHorizontal: t.spacing.md,
    paddingBottom: t.spacing.lg,
  },
  detailPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  detailPill: {
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  detailPillText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
  },
  detailRow: {
    flexDirection: "row",
    gap: t.spacing.sm,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: staticColors.rgba_1szoxfc,
  },
  detailIcon: {
    width: 30,
    height: 30,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing.none,
  },
  detailTextWrap: {
    flex: 1,
  },
  detailLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  detailValue: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.body.fontSize,
    lineHeight: t.typography.body.lineHeight,
    fontWeight: "700",
  },
});
