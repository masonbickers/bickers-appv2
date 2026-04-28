import { useRouter } from "expo-router";
import { collection, getDocs } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../firebaseConfig";
import { useTheme } from "../providers/ThemeProvider";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COL_WIDTH = 290;
const HEADER_HEIGHT = 42;
const ROW_HEIGHT = 260;

let cachedBoardData = null;
let boardDataRequest = null;

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

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

function formatVehicle(v, vehicleNameById = {}) {
  if (typeof v === "string") return vehicleNameById[v] || v;
  if (!v || typeof v !== "object") return "";
  const id = v.id || v.vehicleId || v.docId;
  if (id && vehicleNameById[id]) return vehicleNameById[id];
  const name = v.name || v.label || v.title || "";
  const reg = v.reg || v.registration || v.numberPlate || "";
  return reg ? `${name} ${reg}`.trim() : name;
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
      bg: "#A7D091",
      border: "#6E9D5E",
      text: "#142214",
    };
  }

  if (status.includes("complete")) {
    return {
      bg: "#A7D091",
      border: "#6E9D5E",
      text: "#142214",
    };
  }

  if (status.includes("confirmed")) {
    return {
      bg: "#F5F57A",
      border: "#A9A944",
      text: "#232323",
    };
  }

  if (status.includes("first pencil")) {
    return {
      bg: "#CFE7FF",
      border: "#7FA9D6",
      text: "#1C2A3A",
    };
  }

  if (status.includes("second pencil")) {
    return {
      bg: "#F6C9CC",
      border: "#D28790",
      text: "#3A1E23",
    };
  }

  return {
    bg: "#E9EDF3",
    border: "#98A6BB",
    text: "#1D2430",
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
  const { colors } = useTheme();
  const scrollRef = useRef(null);
  const verticalScrollRef = useRef(null);
  const mountedRef = useRef(true);
  const { width: screenWidth } = useWindowDimensions();

  const [weekStart, setWeekStart] = useState(() => isoFromDate(mondayFor(new Date())));
  const [bookings, setBookings] = useState(() => cachedBoardData?.bookings || []);
  const [vehicleNameById, setVehicleNameById] = useState(
    () => cachedBoardData?.vehicleNameById || {}
  );
  const [loading, setLoading] = useState(() => !cachedBoardData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);

  const applyBoardData = useCallback((data) => {
    setBookings(data.bookings);
    setVehicleNameById(data.vehicleNameById);
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
      const vehicleMap = {};
      vehiclesSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const name = data.name || data.label || data.title || "Vehicle";
        const reg = data.reg || data.registration || data.numberPlate || "";
        vehicleMap[doc.id] = reg ? `${name} (${reg})` : name;
      });

      const nextData = { bookings: rows, vehicleNameById: vehicleMap };
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
      .filter(shouldShowBoardJob)
      .map((job) => {
        const dates = extractBookingDates(job);
        const span = overlapSpan(dates, weekDates);
        if (!span) return null;
        return { job, dates, span };
      })
      .filter(Boolean);

    return buildRows(matches);
  }, [bookings, weekDates]);

  const boardHeight = HEADER_HEIGHT + boardItems.rowCount * ROW_HEIGHT;
  const boardWidth = COL_WIDTH * 7;
  const initialZoomScale = Math.min(1, Math.max(0.35, (screenWidth - 32) / boardWidth));
  const shiftWeek = (delta) => setWeekStart((prev) => addDaysISO(prev, delta * 7));

  const selectedJobDetails = useMemo(() => {
    if (!selectedJob) return null;

    const dates = extractBookingDates(selectedJob);
    const vehicles = toArray(selectedJob?.vehicles || selectedJob?.vehicle)
      .map((vehicle) => formatVehicle(vehicle, vehicleNameById))
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
  }, [selectedJob, vehicleNameById]);

  useEffect(() => {
    requestAnimationFrame(() => {
      verticalScrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
      scrollRef.current?.scrollTo({ x: 0, y: 0, animated: false });
    });
  }, [weekStart, loading]);

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.toolbar}>
          <View style={styles.toolbarLeft}>
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.85}
              style={[
                styles.backBtn,
                {
                  backgroundColor: withAlpha(colors.surface, 0.9),
                  borderColor: withAlpha(colors.border, 0.85),
                },
              ]}
            >
              <Icon name="arrow-left" size={15} color={colors.text} />
            </TouchableOpacity>

            <Text style={[styles.pageTitle, { color: colors.text }]}>Work Diary</Text>

            <TouchableOpacity
              onPress={() => setWeekStart(isoFromDate(mondayFor(new Date())))}
              activeOpacity={0.85}
              style={[styles.todayBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={[styles.todayText, { color: colors.text }]}>Today</Text>
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
          <ScrollView
            ref={verticalScrollRef}
            style={styles.boardViewport}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  loadBookings({ force: true });
                }}
                tintColor={colors.accent}
              />
            }
            contentOffset={{ x: 0, y: 0 }}
            contentContainerStyle={styles.verticalContent}
            showsVerticalScrollIndicator
            nestedScrollEnabled
            bounces={false}
            alwaysBounceVertical={false}
            overScrollMode="never"
          >
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
                    const notes = dayNotesFor(job, weekDates).slice(0, 3);
                    const employees = formatPeople(job?.employees).slice(0, 3).join(", ");
                    const vehicles = toArray(job?.vehicles || job?.vehicle)
                      .map((vehicle) => formatVehicle(vehicle, vehicleNameById))
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
                              {String(job?.status || "").toLowerCase().includes("confirmed") ? "CONFIRMED" : String(job?.status || "BOOKED").toUpperCase()}
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
          </ScrollView>
        )}

        <Modal
          visible={!!selectedJob}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedJob(null)}
        >
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.detailModalCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {selectedJob && selectedJobDetails ? (
                <>
                  <View style={styles.detailHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.detailJobNumber, { color: colors.textMuted }]}>
                        {selectedJob.jobNumber || "Booking"}
                      </Text>
                      <Text style={[styles.detailTitle, { color: colors.text }]}>
                        {titleForJob(selectedJob)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedJob(null)}
                      activeOpacity={0.85}
                      style={[
                        styles.modalCloseBtn,
                        {
                          backgroundColor: withAlpha(colors.surfaceAlt, 0.9),
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Icon name="x" size={18} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.detailModalContent}>
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
                  </ScrollView>
                </>
              ) : null}
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  toolbar: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    paddingHorizontal: 0,
    paddingVertical: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  toolbarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  toolbarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: "900",
  },
  todayBtn: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  todayText: {
    fontSize: 14,
    fontWeight: "800",
  },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  navText: {
    fontSize: 14,
    fontWeight: "800",
  },
  horizontalContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  verticalContent: {
    paddingBottom: 20,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  boardViewport: {
    flex: 1,
  },
  boardWrap: {
    borderRadius: 18,
    overflow: "hidden",
  },
  boardGrid: {
    position: "relative",
    borderWidth: 1,
    backgroundColor: "#fff",
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
    fontSize: 14,
    fontWeight: "500",
  },
  bookingCard: {
    position: "absolute",
    minHeight: ROW_HEIGHT - 12,
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  bookingTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  initialsWrap: {
    backgroundColor: "#F9F9F9",
    borderWidth: 1,
    borderColor: "#707070",
    borderRadius: 8,
    maxWidth: "42%",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  initialsText: {
    fontSize: 12,
    fontWeight: "800",
    flexWrap: "wrap",
  },
  statusWrap: {
    flex: 1,
    alignItems: "flex-end",
  },
  statusText: {
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 11,
  },
  jobNumberPill: {
    backgroundColor: "#F9F9F9",
    borderWidth: 1,
    borderColor: "#707070",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  jobNumberText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#1F1F1F",
  },
  bookingTitle: {
    marginTop: 6,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 20,
    textTransform: "uppercase",
  },
  bookingLine: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
  },
  notesBlock: {
    marginTop: 8,
    minHeight: 34,
  },
  noteText: {
    fontSize: 11,
    lineHeight: 14,
    fontStyle: "italic",
  },
  tagsRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  tagPill: {
    backgroundColor: "#E56A54",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  stateText: {
    marginTop: 8,
    fontSize: 13,
  },
  errorCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  errorText: {
    fontSize: 14,
    fontWeight: "700",
  },
  retryBtn: {
    alignSelf: "flex-start",
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  retryText: {
    fontSize: 13,
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  detailModalCard: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "86%",
    borderWidth: 1,
    borderRadius: 20,
    overflow: "hidden",
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
  detailJobNumber: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  detailTitle: {
    marginTop: 4,
    fontSize: 24,
    lineHeight: 29,
    fontWeight: "900",
  },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  detailModalContent: {
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  detailPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 8,
  },
  detailPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  detailPillText: {
    fontSize: 11,
    fontWeight: "900",
  },
  detailRow: {
    flexDirection: "row",
    gap: 11,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(130,130,130,0.28)",
  },
  detailIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  detailTextWrap: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  detailValue: {
    marginTop: 3,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
  },
});
