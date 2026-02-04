"use client";

import { useLocalSearchParams, useRouter } from "expo-router";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { useAuth } from "../../../providers/AuthProvider";
import { useTheme } from "../../../providers/ThemeProvider";

/* ───────────────────────────────
   BANK HOLIDAYS (UK via GOV.UK)
   - Source: https://www.gov.uk/bank-holidays.json
   - Region options: "england-and-wales" | "scotland" | "northern-ireland"
──────────────────────────────── */
const BANK_HOLIDAY_REGION = "england-and-wales";

async function fetchUKBankHolidays(region = BANK_HOLIDAY_REGION) {
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const events = json?.[region]?.events || [];
    const map = {};
    for (const ev of events) {
      if (!ev?.date) continue;
      map[String(ev.date)] = String(ev.title || "Bank holiday");
    }
    return map;
  } catch (e) {
    console.warn("[bank-holidays] failed to fetch:", e?.message || e);
    return {};
  }
}

/* ───────────────────────── Helpers ───────────────────────── */
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const WEEKEND_SET = new Set(["Saturday", "Sunday"]);

const DEFAULT_YARD_START = "08:00";
const DEFAULT_YARD_END = "16:30";

// 15-min increments for time of day
const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 0; h < 24; h++) {
    for (let m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

// Pre-Call durations: 15min → 4hrs (in minutes)
const PRECALL_OPTIONS = Array.from({ length: 240 / 15 }, (_, i) => (i + 1) * 15).map(
  (min) => ({
    value: min,
    label:
      min < 60
        ? `${min} min`
        : min % 60 === 0
        ? `${min / 60} hr`
        : `${Math.floor(min / 60)} hr ${min % 60} min`,
  })
);

/* ───────────────────────── Time helpers (MIDNIGHT SAFE) ───────────────────────── */
function timeToMinutes(t) {
  if (!t) return null;
  const s = String(t).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function segmentMeta(seg) {
  const startMin = timeToMinutes(seg?.start);
  const endMin = timeToMinutes(seg?.end);

  if (startMin == null || endMin == null) {
    return {
      startMin: startMin ?? null,
      endMin: endMin ?? null,
      endDayOffset: 0,
      crossesMidnight: false,
    };
  }

  const crossesMidnight = endMin < startMin;
  return {
    startMin,
    endMin,
    endDayOffset: crossesMidnight ? 1 : 0,
    crossesMidnight,
  };
}

function timeFieldOffset(baseTime, t) {
  const b = timeToMinutes(baseTime);
  const x = timeToMinutes(t);
  if (b == null || x == null) return { minutes: x ?? null, dayOffset: 0 };
  return { minutes: x, dayOffset: x < b ? 1 : 0 };
}

function annotateTimesheetMidnight(ts) {
  if (!ts?.days) return ts;

  const next = { ...ts, days: { ...ts.days } };

  for (const dayName of DAYS) {
    const e = { ...(next.days[dayName] || {}) };
    const mode = String(e.mode || "yard").toLowerCase();

    if (mode === "yard" && Array.isArray(e.yardSegments)) {
      const segs = e.yardSegments.map((seg) => ({ ...seg, ...segmentMeta(seg) }));
      next.days[dayName] = {
        ...e,
        yardSegments: segs,
        crossesMidnight: segs.some((s) => s.crossesMidnight),
      };
      continue;
    }

    if (mode === "travel" || mode === "onset") {
      const base = e.leaveTime || e.arriveTime || e.callTime || null;

      const arriveBackOffset = timeFieldOffset(base, e.arriveBack || null);
      const wrapOffset = timeFieldOffset(base, e.wrapTime || null);

      const impliedOvernight =
        (arriveBackOffset?.dayOffset ?? 0) === 1 || (wrapOffset?.dayOffset ?? 0) === 1;

      next.days[dayName] = {
        ...e,
        overnight: e.overnight === true ? true : impliedOvernight,
        crossesMidnight: e.overnight === true ? true : impliedOvernight,
        timeMeta: {
          baseTime: base,
          arriveBack: e.arriveBack ? arriveBackOffset : null,
          wrapTime: e.wrapTime ? wrapOffset : null,
        },
      };
      continue;
    }

    next.days[dayName] = e;
  }

  return next;
}

function toDateSafe(val) {
  if (!val) return null;
  if (val?.toDate && typeof val.toDate === "function") return val.toDate();
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(d) {
  if (!d) return "";
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normaliseAMPM(v) {
  const s = String(v || "").trim().toUpperCase();
  if (["AM", "A.M.", "MORNING"].includes(s)) return "AM";
  if (["PM", "P.M.", "AFTERNOON"].includes(s)) return "PM";
  return null;
}
function boolish(v) {
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function getHalfMeta(h) {
  const isHalfDay = boolish(h.halfDay) || boolish(h.isHalfDay) || boolish(h.half);

  const startHalfDay = boolish(h.startHalfDay ?? h.startHalf ?? h.startHalfday);
  const endHalfDay = boolish(h.endHalfDay ?? h.endHalf ?? h.endHalfday);

  const startAMPM = normaliseAMPM(h.startAMPM ?? h.startPeriod ?? h.halfDayType ?? h.half);
  const endAMPM = normaliseAMPM(h.endAMPM ?? h.endPeriod);

  const inferredStart = !!startAMPM;
  const inferredEnd = !!endAMPM;

  return {
    isHalfDay: isHalfDay || inferredStart || inferredEnd || startHalfDay || endHalfDay,
    startHalfDay: startHalfDay || inferredStart,
    endHalfDay: endHalfDay || inferredEnd,
    startAMPM,
    endAMPM,
  };
}

function halfLabelForUI(h, isHalfForThisDay, isSingle, isStartDay, isEndDay) {
  if (!isHalfForThisDay) return "";
  const meta = getHalfMeta(h);

  if (isSingle) {
    if (meta.startAMPM) return `Half day (${meta.startAMPM})`;
    return "Half day";
  }

  if (isStartDay && meta.startHalfDay) {
    if (meta.startAMPM) return `Half day (start: ${meta.startAMPM})`;
    return "Half day (start)";
  }
  if (isEndDay && meta.endHalfDay) {
    if (meta.endAMPM) return `Half day (end: ${meta.endAMPM})`;
    return "Half day (end)";
  }
  return "Half day";
}

function ensureYardSegments(entry) {
  const e = { ...(entry || {}) };
  if (!Array.isArray(e.yardSegments) || e.yardSegments.length === 0) {
    e.yardSegments = [{ start: DEFAULT_YARD_START, end: DEFAULT_YARD_END }];
  }
  return e;
}

function ensureYardLunch(entry) {
  const e = { ...(entry || {}) };
  if (String(e.mode || "yard").toLowerCase() === "yard") {
    if (typeof e.lunchSup !== "boolean") e.lunchSup = true;
  } else {
    if (typeof e.lunchSup !== "boolean") e.lunchSup = false;
  }
  return e;
}

function ensureTravelExtras(entry) {
  const e = { ...(entry || {}) };
  const mode = String(e.mode || "yard").toLowerCase();

  if (mode === "travel") {
    if (typeof e.travelLunchSup !== "boolean") e.travelLunchSup = true;
    if (typeof e.travelPD !== "boolean") e.travelPD = false;
  } else {
    if (typeof e.travelLunchSup !== "boolean") e.travelLunchSup = false;
    if (typeof e.travelPD !== "boolean") e.travelPD = false;
  }

  return e;
}

function ensureOnsetExtras(entry) {
  const e = { ...(entry || {}) };
  // existing
  if (typeof e.nightShoot !== "boolean") e.nightShoot = false;

  // ✅ on-set meal supplement toggle
  if (typeof e.mealSup !== "boolean") e.mealSup = true;

  return e;
}

function ensureModeDefaults(entry) {
  let e = { ...(entry || {}) };
  const mode = String(e.mode || "yard").toLowerCase();
  e.mode = mode;

  // Turnaround schema: only meaningful on yard days
  if (typeof e.isTurnaround !== "boolean") e.isTurnaround = false;
  if (e.isTurnaround && mode !== "yard") e.isTurnaround = false;
  if (e.isTurnaround) {
    if (!e.turnaroundJob || typeof e.turnaroundJob !== "object") e.turnaroundJob = null;
  } else {
    if (e.turnaroundJob) e.turnaroundJob = e.turnaroundJob; // no-op
  }

  if (mode === "yard") {
    // IMPORTANT: when Turnaround Day is ON, do NOT auto-add time blocks
    if (!e.isTurnaround) e = ensureYardSegments(e);
    e = ensureYardLunch(e);
    e.leaveTime = e.leaveTime || DEFAULT_YARD_START;
    e.arriveBack = e.arriveBack || DEFAULT_YARD_END;
    e.precallDuration = e.precallDuration ?? null;
  } else {
    e = ensureYardLunch(e);
  }

  e = ensureTravelExtras(e);
  e = ensureOnsetExtras(e);

  if (mode !== "travel") {
    e.travelLunchSup = typeof e.travelLunchSup === "boolean" ? e.travelLunchSup : false;
    e.travelPD = typeof e.travelPD === "boolean" ? e.travelPD : false;
  }
  if (mode !== "onset") {
    e.nightShoot = typeof e.nightShoot === "boolean" ? e.nightShoot : false;
    e.mealSup = typeof e.mealSup === "boolean" ? e.mealSup : false;
  }

  return e;
}

function getDayName(dateStr) {
  const i = new Date(dateStr).getDay();
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i];
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDaysISO(isoStr, deltaDays) {
  const d = new Date(`${isoStr}T00:00:00`);
  d.setDate(d.getDate() + deltaDays);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function buildLastNDatesISO(n) {
  const out = [];
  const today = startOfDay(new Date());
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* -------------------------- Night shoot day-notes detection -------------------------- */
function hasNightShootInNotes(dayNotes) {
  const dn = String(dayNotes || "").toLowerCase();
  // keep it forgiving (nightshoot / night shoot / night-shoot)
  return (
    dn.includes("nightshoot") ||
    dn.includes("night shoot") ||
    dn.includes("night-shoot")
  );
}

/* -------------------------- Time dropdown -------------------------- */
function TimeDropdown({ label, value, onSelect, options, disabled }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();

  return (
    <View style={{ marginBottom: 6, flex: 1 }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TouchableOpacity
        style={[
          styles.dropdownBox,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        <Text style={{ color: value ? colors.text : colors.textMuted }}>
          {value || "Select"}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    onSelect(item);
                    setOpen(false);
                  }}
                >
                  <Text style={{ color: colors.text }}>{item}</Text>
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: colors.accent }]}
              onPress={() => {
                onSelect("");
                setOpen(false);
              }}
            >
              <Text style={{ color: "#fff" }}>Clear time</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]}
              onPress={() => setOpen(false)}
            >
              <Text style={{ color: colors.text }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PrecallDropdown({ value, onSelect, disabled }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>
        Pre-Call Duration
      </Text>

      <TouchableOpacity
        style={[
          styles.dropdownBox,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        <Text style={{ color: value ? colors.text : colors.textMuted }}>
          {value
            ? PRECALL_OPTIONS.find((o) => o.value === value)?.label
            : "Select Pre-Call Duration"}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <FlatList
              data={PRECALL_OPTIONS}
              keyExtractor={(item) => String(item.value)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    { borderBottomColor: colors.border },
                  ]}
                  onPress={() => {
                    onSelect(item.value);
                    setOpen(false);
                  }}
                >
                  <Text style={{ color: colors.text }}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: colors.accent }]}
              onPress={() => {
                onSelect(null);
                setOpen(false);
              }}
            >
              <Text style={{ color: "#fff" }}>Clear pre-call</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]}
              onPress={() => setOpen(false)}
            >
              <Text style={{ color: colors.text }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* -------------------------- Toggle row with info -------------------------- */
function InfoToggleRow({ label, value, onChange, disabled, infoTitle, infoText }) {
  const { colors } = useTheme();

  const showInfo = () => {
    Alert.alert(infoTitle || label, infoText || "No info available.");
  };

  return (
    <View style={styles.toggleRow}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>
          {label}
        </Text>
        <TouchableOpacity
          onPress={showInfo}
          style={[
            styles.infoBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: disabled ? 0.6 : 1,
            },
          ]}
          disabled={disabled}
        >
          <Icon name="info" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <Switch value={!!value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

/* -------------------------- Turnaround job picker -------------------------- */
function TurnaroundJobPicker({ visible, onClose, jobs, onPick }) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalBox,
            { backgroundColor: colors.surface, borderColor: colors.border, width: "86%" },
          ]}
        >
          <Text style={{ color: colors.text, fontWeight: "900", marginBottom: 8 }}>
            Select job for Turnaround Day
          </Text>

          {!jobs || jobs.length === 0 ? (
            <View style={{ paddingVertical: 10 }}>
              <Text style={{ color: colors.textMuted }}>
                No eligible jobs found in the last 2 weeks.
              </Text>
            </View>
          ) : (
            <FlatList
              data={jobs}
              keyExtractor={(item) => item.bookingId}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    onPick(item);
                    onClose();
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "800" }}>
                    {item.jobNumber || item.bookingId} — {item.client || "Client"}
                  </Text>
                  {!!(item.location || item.dateISO) && (
                    <Text style={{ color: colors.textMuted, marginTop: 2, fontSize: 12 }}>
                      {item.location || ""}
                      {item.location && item.dateISO ? " • " : ""}
                      {item.dateISO || ""}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]}
            onPress={onClose}
          >
            <Text style={{ color: colors.text }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ───────────────────────── Hours summary helpers ───────────────────────── */
function durationMinutes(startTime, endTime) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (s == null || e == null) return 0;
  // midnight safe
  return e >= s ? e - s : e + 24 * 60 - s;
}

function formatHoursMins(totalMins) {
  const mins = Math.max(0, Math.round(totalMins || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function computeDayMinutes(entry) {
  const e = ensureModeDefaults(entry || { mode: "off" });
  const mode = String(e.mode || "off").toLowerCase();

  if (mode === "off" || mode === "holiday" || mode === "bankholiday") return 0;

  if (mode === "yard") {
    const segs = Array.isArray(e.yardSegments) ? e.yardSegments : [];
    let total = 0;
    for (const seg of segs) total += durationMinutes(seg?.start, seg?.end);
    return total;
  }

  if (mode === "travel") {
    // Travel day typically: Leave -> Arrive
    return durationMinutes(e.leaveTime, e.arriveTime);
  }

  if (mode === "onset") {
    // Prefer: Leave -> ArriveBack
    // Fallback: Call -> Wrap
    // Fallback: ArriveTime -> Wrap
    // Fallback: Leave -> Wrap
    let baseStart = e.leaveTime || e.arriveTime || e.callTime || null;
    let baseEnd = e.arriveBack || e.wrapTime || null;

    // If we have callTime+wrapTime, that’s a better “work” window than leave/arrive.
    if (e.callTime && e.wrapTime) {
      baseStart = e.callTime;
      baseEnd = e.wrapTime;
    } else if (!baseEnd && e.wrapTime) {
      baseEnd = e.wrapTime;
    }

    let mins = durationMinutes(baseStart, baseEnd);

    // Add precallDuration as extra time before call (only meaningful if callTime exists)
    if (e.callTime && typeof e.precallDuration === "number" && Number.isFinite(e.precallDuration)) {
      mins += Math.max(0, e.precallDuration);
    }

    return mins;
  }

  return 0;
}

/* -------------------------- Summary panel -------------------------- */
function HoursSummary({ timesheet, holidaysByDay, bankHolidaysByDay }) {
  const { colors } = useTheme();

  const summary = useMemo(() => {
    const byDayMinutes = {};
    let total = 0;

    let yardMins = 0;
    let travelMins = 0;
    let onsetMins = 0;

    let yardDays = 0;
    let travelDays = 0;
    let onsetDays = 0;

    let offDays = 0;
    let holidayDays = 0;
    let bankHolidayDays = 0;
    let halfHolidayDays = 0;

    let lunchCount = 0;
    let travelLunchCount = 0;
    let mealSupCount = 0;
    let pdCount = 0;
    let nightShootCount = 0;
    let overnightCount = 0;
    let turnaroundCount = 0;

    for (const day of DAYS) {
      const hol = holidaysByDay?.[day];
      const bh = bankHolidaysByDay?.[day];

      const isHoliday = !!hol;
      const isHalfHoliday = !!hol?.isHalfDay;
      const isFullHoliday = isHoliday && !isHalfHoliday;
      const isBankHolidayOff = !!bh && bh.notWorking === true;

      if (isFullHoliday) holidayDays += 1;
      if (isHalfHoliday) halfHolidayDays += 1;
      if (!isHoliday && isBankHolidayOff) bankHolidayDays += 1;

      const raw =
        timesheet?.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard" };
      const e = ensureModeDefaults(raw);

      const mode = String(e.mode || "off").toLowerCase();

      // count "off" only when it is actually off (and not a holiday/bank holiday lock)
      if (mode === "off") offDays += 1;

      if (mode === "yard") {
        yardDays += 1;
        if (!!e.lunchSup) lunchCount += 1;
        if (e.isTurnaround === true) turnaroundCount += 1;
      }
      if (mode === "travel") {
        travelDays += 1;
        if (!!e.travelLunchSup) travelLunchCount += 1;
        if (!!e.travelPD) pdCount += 1;
      }
      if (mode === "onset") {
        onsetDays += 1;
        if (!!e.mealSup) mealSupCount += 1;
        if (!!e.nightShoot) nightShootCount += 1;
        if (!!e.overnight) overnightCount += 1;
      }

      const mins = computeDayMinutes(e);

      byDayMinutes[day] = mins;
      total += mins;

      if (mode === "yard") yardMins += mins;
      if (mode === "travel") travelMins += mins;
      if (mode === "onset") onsetMins += mins;
    }

    return {
      byDayMinutes,
      total,
      yardMins,
      travelMins,
      onsetMins,
      yardDays,
      travelDays,
      onsetDays,
      offDays,
      holidayDays,
      bankHolidayDays,
      halfHolidayDays,
      lunchCount,
      travelLunchCount,
      mealSupCount,
      pdCount,
      nightShootCount,
      overnightCount,
      turnaroundCount,
    };
  }, [timesheet, holidaysByDay, bankHolidaysByDay]);

  return (
    <View style={[styles.summaryBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <Text style={{ color: colors.text, fontWeight: "900", marginBottom: 6 }}>
        📊 Week Summary
      </Text>

      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Total hours</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.total)}</Text>
      </View>

      <View style={styles.summaryDivider} />

      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Yard</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>
          {formatHoursMins(summary.yardMins)} ({summary.yardDays} day{summary.yardDays === 1 ? "" : "s"})
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Travel</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>
          {formatHoursMins(summary.travelMins)} ({summary.travelDays} day{summary.travelDays === 1 ? "" : "s"})
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>On set</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>
          {formatHoursMins(summary.onsetMins)} ({summary.onsetDays} day{summary.onsetDays === 1 ? "" : "s"})
        </Text>
      </View>

      <View style={styles.summaryDivider} />

      <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: 12, marginTop: 2, marginBottom: 6 }}>
        Per-day hours
      </Text>

      {DAYS.map((d) => (
        <View key={d} style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>{d}</Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.byDayMinutes[d])}</Text>
        </View>
      ))}

      <View style={styles.summaryDivider} />

      <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: 12, marginTop: 2, marginBottom: 6 }}>
        Flags
      </Text>

      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Lunch (yard)</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.lunchCount}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Lunch (travel)</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.travelLunchCount}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Meal supp (on set)</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.mealSupCount}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>PD (travel)</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.pdCount}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Night shoots</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.nightShootCount}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Overnights</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.overnightCount}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Turnarounds</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.turnaroundCount}</Text>
      </View>

      <View style={styles.summaryDivider} />

      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Full holidays</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.holidayDays}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Half-holiday days</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.halfHolidayDays}</Text>
      </View>
      <View style={styles.summaryRow}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Bank holidays</Text>
        <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.bankHolidayDays}</Text>
      </View>
    </View>
  );
}

export default function WeekTimesheet() {
  const { id } = useLocalSearchParams(); // weekStart ISO (YYYY-MM-DD)
  const router = useRouter();
  const { employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();

  const [timesheet, setTimesheet] = useState(() => ({
    employeeCode: "",
    weekStart: id,
    days: DAYS.reduce((acc, d) => {
      const isWeekend = WEEKEND_SET.has(d);
      acc[d] = isWeekend
        ? { mode: "off", dayNotes: "", isTurnaround: false, turnaroundJob: null }
        : {
            mode: "yard",
            leaveTime: DEFAULT_YARD_START,
            arriveBack: DEFAULT_YARD_END,
            dayNotes: "",
            precallDuration: null,
            yardSegments: [{ start: DEFAULT_YARD_START, end: DEFAULT_YARD_END }],
            lunchSup: true,
            isTurnaround: false,
            turnaroundJob: null,
          };
      return acc;
    }, {}),
    notes: "",
    submitted: false,
    status: null,
  }));

  const [jobsByDay, setJobsByDay] = useState(() =>
    Object.fromEntries(DAYS.map((d) => [d, []]))
  );
  const [holidaysByDay, setHolidaysByDay] = useState(() =>
    Object.fromEntries(DAYS.map((d) => [d, null]))
  );
  const [bankHolidayMap, setBankHolidayMap] = useState({});
  const [bankHolidaysByDay, setBankHolidaysByDay] = useState(() =>
    Object.fromEntries(DAYS.map((d) => [d, null]))
  );

  // Turnaround: eligibility + last-2-weeks job list
  const [turnaroundEligible, setTurnaroundEligible] = useState(false);
  const [turnaroundJobs, setTurnaroundJobs] = useState([]);
  const [turnaroundPickerOpen, setTurnaroundPickerOpen] = useState(false);
  const [turnaroundPickerDay, setTurnaroundPickerDay] = useState(null);

  // ✅ NEW: Turnaround credits based ONLY on Night Shoot present in DAY NOTES (past 14 days)
  const [turnaroundCreditsTotal, setTurnaroundCreditsTotal] = useState(0);
  const [turnaroundCreditDates, setTurnaroundCreditDates] = useState([]); // ISO dates list for audit / display if you want

  const weekDates = useMemo(() => {
    if (!id) return [];
    const start = new Date(id);
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);
      arr.push(d.toISOString().slice(0, 10));
    }
    return arr;
  }, [id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const map = await fetchUKBankHolidays(BANK_HOLIDAY_REGION);
      if (!alive) return;
      setBankHolidayMap(map || {});
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const bhByDay = Object.fromEntries(DAYS.map((d) => [d, null]));

    if (weekDates?.length) {
      for (const dateISO of weekDates) {
        const title = bankHolidayMap?.[dateISO];
        if (!title) continue;
        const dayName = getDayName(dateISO);
        bhByDay[dayName] = { dateISO, name: title, notWorking: true };
      }
    }

    setBankHolidaysByDay(bhByDay);
  }, [bankHolidayMap, weekDates]);

  useEffect(() => {
    if (loading || !isAuthed || !employee || !id) return;

    (async () => {
      try {
        const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data();
          const patched = { ...data, days: { ...(data.days || {}) } };

          for (const d of DAYS) {
            patched.days[d] = ensureModeDefaults(
              patched.days[d] || { mode: WEEKEND_SET.has(d) ? "off" : "yard" }
            );
            patched.days[d].precallDuration = patched.days[d].precallDuration ?? null;
          }

          setTimesheet(patched);
        } else {
          setTimesheet((prev) => ({
            ...prev,
            employeeCode: employee.userCode || "",
          }));
        }
      } catch (err) {
        console.error("Firestore load error:", err);
      }
    })();
  }, [loading, isAuthed, employee, id]);

  const applyDayLocks = useCallback((prev, holMap, bhByDay) => {
    if (!prev?.days) return prev;
    const next = { ...prev, days: { ...prev.days } };

    DAYS.forEach((dayName) => {
      const hol = holMap?.[dayName];
      const isHoliday = !!hol;
      const isHalfHoliday = !!hol?.isHalfDay;

      const bh = bhByDay?.[dayName];
      const isBankHolidayOff = !!bh && bh.notWorking === true;

      if (isHoliday && !isHalfHoliday) {
        const existing = next.days[dayName] || {};
        next.days[dayName] = {
          ...existing,
          mode: "holiday",
          dayNotes: existing.dayNotes || "",
          leaveTime: null,
          arriveTime: null,
          callTime: null,
          wrapTime: null,
          arriveBack: null,
          yardSegments: [],
          precallDuration: null,
          overnight: false,
          nightShoot: false,
          mealSup: false,
          lunchSup: false,
          travelLunchSup: false,
          travelPD: false,
          isTurnaround: false,
          turnaroundJob: null,
        };
        return;
      }

      if (!isHoliday && isBankHolidayOff) {
        const existing = next.days[dayName] || {};
        next.days[dayName] = {
          ...existing,
          mode: "bankholiday",
          dayNotes: existing.dayNotes || "",
          leaveTime: null,
          arriveTime: null,
          callTime: null,
          wrapTime: null,
          arriveBack: null,
          yardSegments: [],
          precallDuration: null,
          overnight: false,
          nightShoot: false,
          mealSup: false,
          lunchSup: false,
          travelLunchSup: false,
          travelPD: false,
          isTurnaround: false,
          turnaroundJob: null,
        };
        return;
      }

      if (isHoliday && isHalfHoliday) {
        const existing = next.days[dayName] || {};
        const currentMode = String(existing.mode || "yard").toLowerCase();
        const base =
          currentMode === "holiday" || currentMode === "bankholiday"
            ? { ...existing, mode: "yard" }
            : { ...existing };

        const ensured = ensureModeDefaults({ ...base, mode: "yard" });

        next.days[dayName] = {
          ...ensured,
          halfHoliday: true,
          halfHolidayLabel: hol?.halfLabel || "Half day",
        };
        return;
      }

      next.days[dayName] = ensureModeDefaults(
        next.days[dayName] || { mode: WEEKEND_SET.has(dayName) ? "off" : "yard" }
      );
    });

    return next;
  }, []);

  useEffect(() => {
    if (loading || !isAuthed || !employee?.userCode || !id) return;

    (async () => {
      try {
        const empSnap = await getDocs(collection(db, "employees"));
        const allEmployees = empSnap.docs.map((docu) => ({ id: docu.id, ...docu.data() }));

        const nameToCode = {};
        allEmployees.forEach((emp) => {
          const nm = String(emp.name || emp.fullName || "").trim().toLowerCase();
          const code = String(emp.userCode || "").trim();
          if (nm && code) nameToCode[nm] = code;
        });

        const jobsQ = query(
          collection(db, "bookings"),
          where("bookingDates", "array-contains-any", weekDates)
        );
        const jobsSnap = await getDocs(jobsQ);
        const allJobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const holSnap = await getDocs(collection(db, "holidays"));
        const allHolsRaw = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const myCode = String(employee.userCode || "").trim();
        const myName = String(employee.displayName || employee.name || "").trim().toLowerCase();

        const allHols = allHolsRaw
          .filter((h) => {
            const status = String(h.status || h.Status || "").toLowerCase();
            if (h.deleted === true || h.isDeleted === true || status === "deleted") return false;
            if (status && status !== "approved" && status !== "accept" && status !== "approved ✅") return false;

            const hCode = String(h.employeeCode || h.userCode || "").trim();
            const hName = String(h.employee || h.name || "").trim().toLowerCase();

            return (hCode && myCode && hCode === myCode) || (hName && myName && hName === myName);
          })
          .filter((h) => {
            const s = toDateSafe(h.startDate || h.from);
            const e = toDateSafe(h.endDate || h.to) || s;
            if (!s) return false;
            const sISO = iso(s);
            const eISO = iso(e);
            return weekDates.some((wd) => wd >= sISO && wd <= eISO);
          });

        const jobMap = Object.fromEntries(DAYS.map((d) => [d, []]));
        const holMap = Object.fromEntries(DAYS.map((d) => [d, null]));

        const deriveCodesFromList = (list = []) =>
          list
            .map((emp) => {
              if (emp?.userCode) return emp.userCode;
              const nm = String(emp?.name || "").trim().toLowerCase();
              if (!nm) return null;
              return nameToCode[nm] || null;
            })
            .filter(Boolean);

        allJobs.forEach((job) => {
          const bookingDates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
          const employeesByDate = job.employeesByDate || {};

          const globalCodes = (job.employees || [])
            .map((emp) => {
              if (emp?.userCode) return emp.userCode;
              const nm = String(emp?.name || "").trim().toLowerCase();
              if (!nm) return null;
              return nameToCode[nm] || null;
            })
            .filter(Boolean);

          bookingDates.forEach((date) => {
            if (!weekDates.includes(date)) return;

            let isAssignedForThisDate = false;

            if (employeesByDate && Object.keys(employeesByDate).length > 0) {
              const listForDate = Array.isArray(employeesByDate[date]) ? employeesByDate[date] : [];
              const codesForDate = deriveCodesFromList(listForDate);
              isAssignedForThisDate = codesForDate.includes(employee.userCode);
            } else {
              isAssignedForThisDate = globalCodes.includes(employee.userCode);
            }

            if (!isAssignedForThisDate) return;

            const dayName = getDayName(date);
            jobMap[dayName].push(job);
          });
        });

        allHols.forEach((hol) => {
          const start = toDateSafe(hol.startDate || hol.from);
          const end = toDateSafe(hol.endDate || hol.to) || start;
          if (!start) return;

          const paidStatus = hol.paidStatus || hol.leaveType || "Paid";
          const leaveType = hol.leaveType || hol.paidStatus || "Paid";

          const isUnpaid =
            hol.isUnpaid ?? (String(paidStatus) === "Unpaid" || String(leaveType) === "Unpaid");
          const isAccrued =
            hol.isAccrued ?? (String(paidStatus) === "Accrued" || String(leaveType) === "Accrued");

          const half = getHalfMeta(hol);

          const s = new Date(start);
          s.setHours(0, 0, 0, 0);

          const e = new Date(end);
          e.setHours(0, 0, 0, 0);

          while (s <= e) {
            const dateStr = s.toISOString().slice(0, 10);
            if (weekDates.includes(dateStr)) {
              const dayName = getDayName(dateStr);

              const isSingle = iso(start) === iso(end);
              const isStartDay = iso(s) === iso(start);
              const isEndDay = iso(s) === iso(end);

              const isHalfForThisDay =
                (isSingle && half.isHalfDay) ||
                (!isSingle && isStartDay && half.startHalfDay) ||
                (!isSingle && isEndDay && half.endHalfDay);

              holMap[dayName] = {
                hasHoliday: true,
                paidStatus,
                leaveType,
                isUnpaid,
                isAccrued,
                holidayReason: hol.holidayReason || hol.reason || "",
                isHalfDay: !!isHalfForThisDay,
                halfLabel: halfLabelForUI(hol, isHalfForThisDay, isSingle, isStartDay, isEndDay),
              };
            }
            s.setDate(s.getDate() + 1);
          }
        });

        setJobsByDay(jobMap);
        setHolidaysByDay(holMap);

        setTimesheet((prev) => applyDayLocks(prev, holMap, bankHolidaysByDay));
      } catch (err) {
        console.error("Error fetching jobs/holidays:", err);
      }
    })();
  }, [
    loading,
    isAuthed,
    employee?.userCode,
    employee?.displayName,
    employee?.name,
    id,
    weekDates,
    bankHolidaysByDay,
    applyDayLocks,
  ]);

  // ───────────────────────── Turnaround eligibility + last 2 weeks job list ─────────────────────────
  // ✅ UPDATED:
  // - Turnaround credits ONLY from "night shoot" appearing in DAY NOTES (past 14 days)
  // - Total credits = number of unique dates with night shoot in notes
  // - Can only select Turnaround up to that credit count in the current timesheet
  useEffect(() => {
    if (loading || !isAuthed || !employee?.userCode) return;

    (async () => {
      try {
        const myCode = String(employee.userCode || "").trim();
        if (!myCode) return;

        const last14Dates = buildLastNDatesISO(14); // includes today
        const last14Set = new Set(last14Dates);

        // Eligibility + credits: scan YOUR timesheets in the last ~3 weekStarts (covers 14 days)
        const today = startOfDay(new Date());
        const weekStartToday = (() => {
          // Week start is Monday
          const d = new Date(today);
          const day = d.getDay(); // 0..6 (Sun..Sat)
          const diffToMon = (day === 0 ? -6 : 1) - day; // move to Monday
          d.setDate(d.getDate() + diffToMon);
          d.setHours(0, 0, 0, 0);
          return d.toISOString().slice(0, 10);
        })();

        const weekStartsToCheck = [
          weekStartToday,
          addDaysISO(weekStartToday, -7),
          addDaysISO(weekStartToday, -14),
        ];

        const nightShootDateSet = new Set();

        for (const ws of weekStartsToCheck) {
          const ref = doc(db, "timesheets", `${myCode}_${ws}`);
          const snap = await getDoc(ref);
          if (!snap.exists()) continue;

          const data = snap.data() || {};
          const daysObj = data.days || {};

          for (const dayName of DAYS) {
            const e = daysObj[dayName];
            if (!e) continue;

            // date for this day within that weekStart
            const dayIdx = DAYS.indexOf(dayName);
            const dateISO = addDaysISO(ws, dayIdx);

            // Only within last 14 days
            if (!last14Set.has(dateISO)) continue;

            // ✅ ONLY dayNotes determine night shoot credit
            if (hasNightShootInNotes(e.dayNotes)) {
              nightShootDateSet.add(dateISO);
            }
          }
        }

        const creditDates = Array.from(nightShootDateSet).sort((a, b) => String(b).localeCompare(String(a)));
        const creditsTotal = creditDates.length;

        setTurnaroundCreditDates(creditDates);
        setTurnaroundCreditsTotal(creditsTotal);
        setTurnaroundEligible(creditsTotal > 0);

        // Job list (last 2 weeks jobs you worked on) - unchanged
        const chunks = chunkArray(last14Dates, 10);
        const allJobs = [];

        for (const chunk of chunks) {
          const qJobs = query(
            collection(db, "bookings"),
            where("bookingDates", "array-contains-any", chunk)
          );
          const snap = await getDocs(qJobs);
          snap.docs.forEach((d) => allJobs.push({ id: d.id, ...d.data() }));
        }

        const empSnap = await getDocs(collection(db, "employees"));
        const allEmployees = empSnap.docs.map((docu) => ({ id: docu.id, ...docu.data() }));

        const nameToCode = {};
        allEmployees.forEach((emp) => {
          const nm = String(emp.name || emp.fullName || "").trim().toLowerCase();
          const code = String(emp.userCode || "").trim();
          if (nm && code) nameToCode[nm] = code;
        });

        const deriveCodesFromList = (list = []) =>
          list
            .map((emp) => {
              if (emp?.userCode) return emp.userCode;
              const nm = String(emp?.name || "").trim().toLowerCase();
              if (!nm) return null;
              return nameToCode[nm] || null;
            })
            .filter(Boolean);

        const out = [];
        const seen = new Set();

        allJobs.forEach((job) => {
          const bookingDates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
          const employeesByDate = job.employeesByDate || {};

          const globalCodes = (job.employees || [])
            .map((emp) => {
              if (emp?.userCode) return emp.userCode;
              const nm = String(emp?.name || "").trim().toLowerCase();
              if (!nm) return null;
              return nameToCode[nm] || null;
            })
            .filter(Boolean);

          let pickedDateISO = null;

          for (const dateISO of bookingDates) {
            if (!last14Set.has(dateISO)) continue;

            let assigned = false;

            if (employeesByDate && Object.keys(employeesByDate).length > 0) {
              const listForDate = Array.isArray(employeesByDate[dateISO]) ? employeesByDate[dateISO] : [];
              const codesForDate = deriveCodesFromList(listForDate);
              assigned = codesForDate.includes(myCode);
            } else {
              assigned = globalCodes.includes(myCode);
            }

            if (assigned) {
              pickedDateISO = dateISO;
              break;
            }
          }

          if (!pickedDateISO) return;

          if (seen.has(job.id)) return;
          seen.add(job.id);

          out.push({
            bookingId: job.id,
            jobNumber: job.jobNumber || "",
            client: job.client || "",
            location: job.location || "",
            dateISO: pickedDateISO,
          });
        });

        out.sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")));
        setTurnaroundJobs(out);
      } catch (err) {
        console.error("[turnaround] error:", err);
        setTurnaroundEligible(false);
        setTurnaroundJobs([]);
        setTurnaroundCreditsTotal(0);
        setTurnaroundCreditDates([]);
      }
    })();
  }, [loading, isAuthed, employee?.userCode]);

  function withDefaultYardTimes(ts) {
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const next = { ...ts, days: { ...ts.days } };

    weekdays.forEach((d) => {
      const e = { ...(next.days?.[d] || {}) };
      if (String(e.mode || "yard").toLowerCase() === "yard") {
        if (!e.leaveTime) e.leaveTime = DEFAULT_YARD_START;
        if (!e.arriveBack && !e.arriveTime) e.arriveBack = DEFAULT_YARD_END;
        next.days[d] = ensureModeDefaults(e);
      } else {
        next.days[d] = ensureModeDefaults(e);
      }
    });

    return annotateTimesheetMidnight(next);
  }

  function buildJobSnapshot(jobsByDayMap) {
    const byDay = Object.fromEntries(
      DAYS.map((d) => [
        d,
        (jobsByDayMap[d] || []).map((j) => ({
          bookingId: j.id,
          jobNumber: j.jobNumber || "",
          client: j.client || "",
          location: j.location || "",
        })),
      ])
    );

    const flat = DAYS.flatMap((d) => (byDay[d] || []).map((j) => ({ dayName: d, ...j })));
    const bookingIds = Array.from(new Set(flat.map((x) => x.bookingId)));
    const jobNumbers = Array.from(new Set(flat.map((x) => x.jobNumber).filter(Boolean)));

    const bookingIdsByDay = Object.fromEntries(DAYS.map((d) => [d, (byDay[d] || []).map((x) => x.bookingId)]));
    const jobNumbersByDay = Object.fromEntries(DAYS.map((d) => [d, (byDay[d] || []).map((x) => x.jobNumber).filter(Boolean)]));

    return { byDay, flat, bookingIds, jobNumbers, bookingIdsByDay, jobNumbersByDay };
  }

  function imprintJobsIntoDays(ts, jobsByDayMap, weekStartISO) {
    const copy = { ...ts, days: { ...ts.days } };
    const start = new Date(`${weekStartISO}T00:00:00`);

    const isoByDay = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);
      isoByDay[DAYS[i]] = d.toISOString().slice(0, 10);
    }

    for (const day of DAYS) {
      const dayEntry = { ...(copy.days[day] || {}) };
      const jobs = (jobsByDayMap[day] || []).map((j) => ({
        bookingId: j.id,
        jobNumber: j.jobNumber || "",
        client: j.client || "",
        location: j.location || "",
      }));

      dayEntry.jobs = jobs;
      dayEntry.hasJob = jobs.length > 0;
      dayEntry.bookingId = dayEntry.bookingId || jobs[0]?.bookingId || null;
      dayEntry.jobNumber = jobs[0]?.jobNumber || null;
      dayEntry.dateISO = isoByDay[day];

      copy.days[day] = ensureModeDefaults(dayEntry);
    }

    return annotateTimesheetMidnight(copy);
  }

  // ---- STATUS / LOCK ----
  const statusStr = String(timesheet.status || "").trim().toLowerCase();
  const isApproved = statusStr === "approved";
  const isLocked = isApproved;

  // ✅ NEW: current-week turnaround usage + remaining credits
  const usedTurnarounds = useMemo(() => {
    let used = 0;
    for (const d of DAYS) {
      const e = ensureModeDefaults(timesheet?.days?.[d] || {});
      if (String(e.mode || "yard").toLowerCase() === "yard" && e.isTurnaround === true) used += 1;
    }
    return used;
  }, [timesheet]);

  const turnaroundCreditsRemaining = Math.max(0, (turnaroundCreditsTotal || 0) - (usedTurnarounds || 0));

  const clearWeekendBlocks = useCallback(
    (day) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const existing = prev.days?.[day] || {};
        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: {
              ...existing,
              mode: "off",
              yardSegments: [],
              lunchSup: false,
              leaveTime: null,
              arriveTime: null,
              callTime: null,
              wrapTime: null,
              arriveBack: null,
              precallDuration: null,
              overnight: false,
              nightShoot: false,
              mealSup: false,
              travelLunchSup: false,
              travelPD: false,
              dayNotes: existing.dayNotes || "",
              isTurnaround: false,
              turnaroundJob: null,
            },
          },
        };
      });
    },
    [isLocked]
  );

  const addYardSegment = useCallback(
    (day) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const existing = prev.days?.[day] || { mode: "yard" };

        let base = { ...existing };
        if (String(base.mode || "").toLowerCase() !== "yard") {
          base.mode = "yard";
          base.leaveTime = base.leaveTime || DEFAULT_YARD_START;
          base.arriveBack = base.arriveBack || DEFAULT_YARD_END;

          // clear non-yard time fields
          base.arriveTime = null;
          base.callTime = null;
          base.wrapTime = null;
          base.precallDuration = null;
          base.overnight = false;
          base.nightShoot = false;
          base.mealSup = false;

          // if switching to yard via add block, keep turnaround OFF by default
          base.isTurnaround = base.isTurnaround === true ? true : false;
        }

        const e = ensureModeDefaults(base);
        const segs = Array.isArray(e.yardSegments) ? e.yardSegments : [];

        if (segs.length === 0) {
          const firstSeg = { start: DEFAULT_YARD_START, end: DEFAULT_YARD_END };
          return {
            ...prev,
            days: {
              ...prev.days,
              [day]: {
                ...e,
                yardSegments: [firstSeg],
              },
            },
          };
        }

        const last = segs[segs.length - 1] || { start: DEFAULT_YARD_START, end: DEFAULT_YARD_END };
        const nextSeg = { start: last.end || DEFAULT_YARD_START, end: DEFAULT_YARD_END };

        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: {
              ...e,
              yardSegments: [...segs, nextSeg],
            },
          },
        };
      });
    },
    [isLocked]
  );

  // allow deleting the FIRST / LAST remaining segment (can go to 0)
  const removeYardSegment = useCallback(
    (day, index) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const current = prev.days?.[day] || { mode: "yard" };
        const mode = String(current.mode || "yard").toLowerCase();
        if (mode !== "yard") return prev;

        const e = ensureModeDefaults(current);
        const segs = Array.isArray(e.yardSegments) ? e.yardSegments.slice() : [];

        if (!segs[index]) return prev;

        segs.splice(index, 1);

        const nextEntry = ensureModeDefaults({
          ...e,
          yardSegments: segs, // can be empty
          lunchSup: segs.length === 0 ? false : e.lunchSup,
        });

        return { ...prev, days: { ...prev.days, [day]: nextEntry } };
      });
    },
    [isLocked]
  );

  const updateYardSegment = useCallback(
    (day, index, field, value) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const e = ensureModeDefaults(prev.days?.[day] || { mode: "yard" });
        const segs = (Array.isArray(e.yardSegments) ? e.yardSegments : []).map((s, i) =>
          i === index ? { ...s, [field]: value } : s
        );
        return { ...prev, days: { ...prev.days, [day]: { ...e, yardSegments: segs } } };
      });
    },
    [isLocked]
  );

  const validateTurnaroundSelectionsOrAlert = useCallback((ts) => {
    for (const dayName of DAYS) {
      const e = ts?.days?.[dayName];
      if (!e) continue;
      const mode = String(e.mode || "yard").toLowerCase();
      if (mode === "yard" && e.isTurnaround === true) {
        const ok = !!e.turnaroundJob?.bookingId;
        if (!ok) {
          Alert.alert(
            "Turnaround Day needs a job",
            `Please select the job for Turnaround Day on ${dayName} (from the last 2 weeks).`
          );
          return false;
        }
      }
    }
    return true;
  }, []);

  const saveTimesheet = async () => {
    if (isLocked) {
      Alert.alert("Locked", "This timesheet has been approved and can no longer be edited.");
      return;
    }
    try {
      const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);

      const prepared = imprintJobsIntoDays(withDefaultYardTimes(timesheet), jobsByDay, id);
      if (!validateTurnaroundSelectionsOrAlert(prepared)) return;

      const jobSnapshot = buildJobSnapshot(jobsByDay);

      const singleJobId = jobSnapshot.bookingIds.length === 1 ? jobSnapshot.bookingIds[0] : null;
      const singleJobNumber = jobSnapshot.jobNumbers.length === 1 ? jobSnapshot.jobNumbers[0] : null;

      const payload = {
        ...prepared,
        weekStart: id,
        employeeCode: employee.userCode,
        employeeName: employee.displayName || employee.name || null,
        jobSnapshot,
        jobId: singleJobId,
        jobNumber: singleJobNumber,

        // ✅ audit fields for turnaround credit system
        turnaroundCredits: {
          total: turnaroundCreditsTotal || 0,
          sourcesLast14Days: turnaroundCreditDates || [],
        },

        updatedAt: serverTimestamp(),
        submitted: timesheet.submitted ? true : false,
      };

      await setDoc(ref, payload, { merge: true });

      Alert.alert(
        timesheet.submitted ? "✅ Updated" : "✅ Saved",
        timesheet.submitted ? "Your submitted timesheet has been updated." : "Your timesheet has been saved as a draft."
      );
      router.back();
    } catch (err) {
      console.error(err);
      Alert.alert("❌ Error", "Could not save timesheet");
    }
  };

  const submitTimesheet = async () => {
    if (isLocked) {
      Alert.alert("Locked", "This timesheet has already been approved and cannot be resubmitted.");
      return;
    }
    try {
      const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);

      const prepared = imprintJobsIntoDays(withDefaultYardTimes(timesheet), jobsByDay, id);
      if (!validateTurnaroundSelectionsOrAlert(prepared)) return;

      const jobSnapshot = buildJobSnapshot(jobsByDay);

      const singleJobId = jobSnapshot.bookingIds.length === 1 ? jobSnapshot.bookingIds[0] : null;
      const singleJobNumber = jobSnapshot.jobNumbers.length === 1 ? jobSnapshot.jobNumbers[0] : null;

      const payload = {
        ...prepared,
        weekStart: id,
        employeeCode: employee.userCode,
        employeeName: employee.displayName || employee.name || null,
        jobSnapshot,
        jobId: singleJobId,
        jobNumber: singleJobNumber,

        // ✅ audit fields for turnaround credit system
        turnaroundCredits: {
          total: turnaroundCreditsTotal || 0,
          sourcesLast14Days: turnaroundCreditDates || [],
        },

        updatedAt: serverTimestamp(),
        submitted: true,
        submittedAt: serverTimestamp(),
      };

      await setDoc(ref, payload, { merge: true });
      Alert.alert("📤 Submitted", "Your timesheet has been submitted.");
      router.back();
    } catch (err) {
      console.error(err);
      Alert.alert("❌ Error", "Could not submit timesheet");
    }
  };

  const updateDay = useCallback(
    (day, field, value, bookingId = null) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const existing = prev.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" };

        const hol = holidaysByDay?.[day];
        const isFullHoliday = !!hol && !hol?.isHalfDay;

        if (isFullHoliday) return prev;
        if (bankHolidaysByDay?.[day]?.notWorking) return prev;

        let updated = { ...existing, [field]: value };
        const isHalfHoliday = !!hol && !!hol?.isHalfDay;

        if (field === "mode") {
          const nextMode = String(value || "yard").toLowerCase();
          updated.mode = nextMode;

          if (nextMode === "yard") {
            updated.leaveTime = updated.leaveTime || DEFAULT_YARD_START;
            updated.arriveBack = updated.arriveBack || DEFAULT_YARD_END;
          } else {
            updated.yardSegments = [];
            updated.lunchSup = false;

            // Turnaround only applies to Yard
            updated.isTurnaround = false;
            updated.turnaroundJob = null;

            // clear travel/onset fields (then we re-apply defaults per-mode)
            updated.leaveTime = null;
            updated.arriveTime = null;
            updated.callTime = null;
            updated.wrapTime = null;
            updated.arriveBack = null;
            updated.precallDuration = null;
            updated.overnight = false;
            updated.nightShoot = false;
            updated.mealSup = false;
          }

          if (nextMode === "travel") {
            updated.travelLunchSup = typeof updated.travelLunchSup === "boolean" ? updated.travelLunchSup : true;
            updated.travelPD = typeof updated.travelPD === "boolean" ? updated.travelPD : false;
          }

          if (nextMode === "onset") {
            updated.nightShoot = typeof updated.nightShoot === "boolean" ? updated.nightShoot : false;
            updated.mealSup = typeof updated.mealSup === "boolean" ? updated.mealSup : true; // ✅ default on
          }
        }

        if (bookingId !== null) updated.bookingId = bookingId;

        if (isHalfHoliday) {
          updated.mode = "yard";
          updated.leaveTime = updated.leaveTime || DEFAULT_YARD_START;
          updated.arriveBack = updated.arriveBack || DEFAULT_YARD_END;
          updated.halfHoliday = true;
          updated.halfHolidayLabel = hol?.halfLabel || "Half day";
        }

        updated = ensureModeDefaults(updated);

        // auto overnight if times imply crossing midnight
        if (updated.mode === "onset" || updated.mode === "travel") {
          const base = updated.leaveTime || updated.arriveTime || updated.callTime || null;
          const arriveBackOffset = timeFieldOffset(base, updated.arriveBack);
          const wrapOffset = timeFieldOffset(base, updated.wrapTime);
          const impliedOvernight = (arriveBackOffset?.dayOffset ?? 0) === 1 || (wrapOffset?.dayOffset ?? 0) === 1;

          if (impliedOvernight) {
            updated.overnight = true;
            updated.crossesMidnight = true;
          }
        }

        return { ...prev, days: { ...prev.days, [day]: updated } };
      });
    },
    [isLocked, holidaysByDay, bankHolidaysByDay]
  );

  const toggleTurnaround = useCallback(
    (day) => {
      if (isLocked) return;

      let nextOn = false;

      setTimesheet((prev) => {
        const existing = ensureModeDefaults(
          prev.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" }
        );

        // Only works on Yard
        if (String(existing.mode || "yard").toLowerCase() !== "yard") return prev;

        // Count how many turnarounds are already used (in this current week)
        const alreadyUsed = DAYS.reduce((acc, d) => {
          const e = ensureModeDefaults(prev.days?.[d] || {});
          const isTA = String(e.mode || "yard").toLowerCase() === "yard" && e.isTurnaround === true;
          return acc + (isTA ? 1 : 0);
        }, 0);

        nextOn = !existing.isTurnaround;

        // ✅ If turning ON, enforce credit cap
        if (nextOn) {
          const totalCredits = Number(turnaroundCreditsTotal || 0);
          if (totalCredits <= 0) {
            Alert.alert("No Turnaround credits", "Turnaround is only available if you had a Night Shoot in your day notes within the past 2 weeks.");
            nextOn = false;
            return prev;
          }
          if (alreadyUsed >= totalCredits) {
            Alert.alert(
              "No Turnaround credits left",
              `You have used ${alreadyUsed}/${totalCredits} Turnaround credit(s). You can’t add another unless you have more Night Shoot day-notes in the past 2 weeks.`
            );
            nextOn = false;
            return prev;
          }
        }

        const next = {
          ...existing,
          isTurnaround: nextOn,
        };

        if (nextOn) {
          // When turning ON: do not auto-show time blocks (clear them), require job selection
          next.yardSegments = [];
          next.turnaroundJob = existing.turnaroundJob?.bookingId ? existing.turnaroundJob : null;

          // if no blocks, lunch should be off
          next.lunchSup = false;
        } else {
          next.turnaroundJob = null;
        }

        return { ...prev, days: { ...prev.days, [day]: ensureModeDefaults(next) } };
      });

      // Only open picker when turning ON
      if (!nextOn) return;
      setTurnaroundPickerDay(day);
      setTurnaroundPickerOpen(true);
    },
    [isLocked, turnaroundCreditsTotal]
  );

  const setTurnaroundJobForDay = useCallback((day, job) => {
    if (!day) return;
    setTimesheet((prev) => {
      const existing = ensureModeDefaults(prev.days?.[day] || { mode: "yard" });
      if (String(existing.mode || "yard").toLowerCase() !== "yard") return prev;

      // If somehow job picker opened without credit remaining, guard
      const alreadyUsed = DAYS.reduce((acc, d) => {
        const e = ensureModeDefaults(prev.days?.[d] || {});
        const isTA = String(e.mode || "yard").toLowerCase() === "yard" && e.isTurnaround === true;
        return acc + (isTA ? 1 : 0);
      }, 0);

      const totalCredits = Number(turnaroundCreditsTotal || 0);
      if (existing.isTurnaround !== true && alreadyUsed >= totalCredits) {
        Alert.alert(
          "No Turnaround credits left",
          `You’ve used ${alreadyUsed}/${totalCredits} Turnaround credit(s).`
        );
        return prev;
      }

      const next = ensureModeDefaults({
        ...existing,
        isTurnaround: true,
        turnaroundJob: job ? { ...job } : null,
      });
      return { ...prev, days: { ...prev.days, [day]: next } };
    });
  }, [turnaroundCreditsTotal]);

  if (loading || !isAuthed) return null;

  const statusLabel = isApproved
    ? "Approved (locked)"
    : timesheet.submitted
    ? "Submitted"
    : "Draft (not submitted)";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <TurnaroundJobPicker
        visible={turnaroundPickerOpen}
        onClose={() => setTurnaroundPickerOpen(false)}
        jobs={turnaroundJobs}
        onPick={(job) => {
          if (!turnaroundPickerDay) return;
          setTurnaroundJobForDay(turnaroundPickerDay, job);
        }}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 80 }}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Icon name="arrow-left" size={18} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { color: colors.text }]}>
          📝 Timesheet: Week of {id}
        </Text>

        <View style={styles.statusRow}>
          <View style={[styles.pill, timesheet.submitted ? styles.pillOk : styles.pillDraft]}>
            <Text
              style={[
                styles.pillText,
                timesheet.submitted ? styles.pillTextOk : styles.pillTextDraft,
              ]}
            >
              {statusLabel}
            </Text>
          </View>

          {!isApproved && !timesheet.submitted && (
            <Text style={[styles.statusHint, { color: colors.textMuted }]}>
              Save keeps a draft. Submit sends it for approval.
            </Text>
          )}

          {isApproved && (
            <Text style={[styles.statusHint, { color: colors.textMuted }]}>
              Approved by your manager. This week is locked and can’t be edited.
            </Text>
          )}
        </View>

        {/* ✅ NEW: Turnaround credits banner (only if available) */}
        {turnaroundCreditsTotal > 0 && (
          <View
            style={[
              styles.creditBox,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                ♻️ Turnaround credits
              </Text>
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                {turnaroundCreditsRemaining}/{turnaroundCreditsTotal} left
              </Text>
            </View>

            <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 11 }}>
              Credits are earned only when “Night Shoot” is written in your day notes within the last 2 weeks.
              You can use 1 Turnaround per Night Shoot day-note.
            </Text>
          </View>
        )}

        {DAYS.map((day) => {
          const entryRaw =
            timesheet.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" };
          const entry = ensureModeDefaults(entryRaw);

          const jobs = jobsByDay?.[day] || [];
          const holidayInfo = holidaysByDay?.[day];
          const bankHolidayInfo = bankHolidaysByDay?.[day];

          const isHoliday = !!holidayInfo;
          const isHalfHoliday = !!holidayInfo?.isHalfDay;
          const isFullHoliday = isHoliday && !isHalfHoliday;
          const isBankHolidayOff = !!bankHolidayInfo && bankHolidayInfo.notWorking === true;

          const effectiveEntry = isHalfHoliday ? ensureModeDefaults({ ...entry, mode: "yard" }) : entry;
          const yardEntry =
            effectiveEntry.mode === "yard" ? ensureModeDefaults(effectiveEntry) : effectiveEntry;

          const primaryJobId = jobs.length > 0 ? jobs[0].id : null;

          const controlsDisabled = isLocked || isFullHoliday || isBankHolidayOff;
          const isWeekend = WEEKEND_SET.has(day);

          let holidayLabel = "Paid Holiday";
          if (holidayInfo?.isUnpaid || holidayInfo?.leaveType === "Unpaid") holidayLabel = "Unpaid Holiday";
          else if (holidayInfo?.isAccrued || holidayInfo?.leaveType === "Accrued") holidayLabel = "Accrued / TOIL Holiday";

          const showTurnaroundButton =
            turnaroundEligible &&
            !controlsDisabled &&
            !isHalfHoliday &&
            String(yardEntry.mode || "yard").toLowerCase() === "yard";

          const segsForUI = Array.isArray(yardEntry.yardSegments) ? yardEntry.yardSegments : [];
          const hasTimeBlocks = segsForUI.length > 0;

          // If no credits remaining, allow turning OFF but prevent turning ON (button still shown, but press will alert)
          const canAddTurnaround =
            (turnaroundCreditsTotal || 0) > 0 && turnaroundCreditsRemaining > 0;

          return (
            <View
              key={day}
              style={[
                styles.dayBlock,
                {
                  backgroundColor: colors.surfaceAlt,
                  borderColor: colors.border,
                  opacity: isLocked ? 0.9 : 1,
                },
              ]}
            >
              <Text style={[styles.dayTitle, { color: colors.text }]}>{day}</Text>

              {isBankHolidayOff && (
                <View style={[styles.bankHolidayBlock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={{ color: colors.text, fontWeight: "900" }}>
                    🏦 {bankHolidayInfo?.name || "Bank Holiday"} (Not working)
                  </Text>
                </View>
              )}

              {isHoliday && (
                <View
                  style={[
                    styles.holidayBlock,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                      marginBottom: isHalfHoliday ? 8 : 0,
                    },
                  ]}
                >
                  <Text style={{ color: colors.danger, fontWeight: "bold" }}>
                    {holidayLabel}
                    {isHalfHoliday ? " (Half day)" : ""}
                  </Text>

                  {!!holidayInfo?.halfLabel && isHalfHoliday && (
                    <Text style={[styles.holidaySub, { color: colors.textMuted }]}>{holidayInfo.halfLabel}</Text>
                  )}

                  {!!holidayInfo?.holidayReason && (
                    <Text style={[styles.holidaySub, { color: colors.textMuted }]}>{holidayInfo.holidayReason}</Text>
                  )}

                  {isHalfHoliday && (
                    <Text style={[styles.holidaySub, { color: colors.textMuted }]}>
                      You can still add a Yard time block below for the working half.
                    </Text>
                  )}
                </View>
              )}

              {isFullHoliday ? null : jobs.length > 0 ? (
                <>
                  {jobs.map((job) => (
                    <View key={job.id} style={[styles.jobLink, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.jobMain, { color: colors.success }]}>
                        📌 {job.jobNumber || job.id} – {job.client || "Client"}
                      </Text>
                      <Text style={[styles.jobSub, { color: colors.textMuted }]}>{job.location || ""}</Text>
                    </View>
                  ))}

                  <View style={styles.modeRow}>
                    <TouchableOpacity
                      style={[
                        styles.modeBtn,
                        {
                          backgroundColor: colors.surfaceAlt,
                          borderColor: colors.border,
                          opacity: controlsDisabled || isHalfHoliday ? 0.5 : 1,
                        },
                        effectiveEntry.mode === "travel" && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                      ]}
                      onPress={() => !controlsDisabled && !isHalfHoliday && updateDay(day, "mode", "travel", primaryJobId)}
                      disabled={controlsDisabled || isHalfHoliday}
                    >
                      <Text style={[styles.modeText, { color: colors.text }]}>Travel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modeBtn,
                        {
                          backgroundColor: colors.surfaceAlt,
                          borderColor: colors.text,
                          opacity: controlsDisabled || isHalfHoliday ? 0.5 : 1,
                        },
                        effectiveEntry.mode === "onset" && { backgroundColor: colors.accentSoft, borderColor: colors.text },
                      ]}
                      onPress={() => !controlsDisabled && !isHalfHoliday && updateDay(day, "mode", "onset", primaryJobId)}
                      disabled={controlsDisabled || isHalfHoliday}
                    >
                      <Text style={[styles.modeText, { color: colors.text }]}>On Set</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modeBtn,
                        {
                          backgroundColor: colors.surfaceAlt,
                          borderColor: colors.border,
                          opacity: controlsDisabled ? 0.5 : 1,
                        },
                        effectiveEntry.mode === "yard" && { backgroundColor: colors.accentSoft, borderColor: colors.border },
                      ]}
                      onPress={() => !controlsDisabled && updateDay(day, "mode", "yard", primaryJobId)}
                      disabled={controlsDisabled}
                    >
                      <Text style={[styles.modeText, { color: colors.text }]}>Yard</Text>
                    </TouchableOpacity>
                  </View>

                  {/* ✅ TRAVEL UI */}
                  {!isHalfHoliday && effectiveEntry.mode === "travel" && (
                    <View style={styles.onSetBlock}>
                      <TimeDropdown
                        label="Leave Time"
                        value={effectiveEntry.leaveTime}
                        onSelect={(t) => updateDay(day, "leaveTime", t)}
                        options={TIME_OPTIONS}
                        disabled={controlsDisabled}
                      />
                      <TimeDropdown
                        label="Arrive Time"
                        value={effectiveEntry.arriveTime}
                        onSelect={(t) => updateDay(day, "arriveTime", t)}
                        options={TIME_OPTIONS}
                        disabled={controlsDisabled}
                      />

                      <InfoToggleRow
                        label="Lunch?"
                        value={!!effectiveEntry.travelLunchSup}
                        onChange={(v) => updateDay(day, "travelLunchSup", v)}
                        disabled={controlsDisabled}
                        infoTitle="Travel Lunch"
                        infoText="Turn this on if lunch is provided/covered for your travel day."
                      />

                      <InfoToggleRow
                        label="PD?"
                        value={!!effectiveEntry.travelPD}
                        onChange={(v) => updateDay(day, "travelPD", v)}
                        disabled={controlsDisabled}
                        infoTitle="Travel PD"
                        infoText="Use this if you’re claiming PD/Per Diem for the travel day (if applicable)."
                      />

                      <TextInput
                        placeholder="Notes for this day"
                        placeholderTextColor={colors.textMuted}
                        style={[
                          styles.dayInput,
                          {
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.inputBorder,
                            color: colors.text,
                            opacity: controlsDisabled ? 0.6 : 1,
                          },
                        ]}
                        multiline
                        editable={!controlsDisabled}
                        value={effectiveEntry.dayNotes || ""}
                        onChangeText={(t) => updateDay(day, "dayNotes", t)}
                      />
                    </View>
                  )}

                  {/* ✅ ON SET UI */}
                  {!isHalfHoliday && effectiveEntry.mode === "onset" && (
                    <View style={styles.onSetBlock}>
                      <TimeDropdown
                        label="Leave Time"
                        value={effectiveEntry.leaveTime}
                        onSelect={(t) => updateDay(day, "leaveTime", t)}
                        options={TIME_OPTIONS}
                        disabled={controlsDisabled}
                      />
                      <TimeDropdown
                        label="Arrive Time"
                        value={effectiveEntry.arriveTime}
                        onSelect={(t) => updateDay(day, "arriveTime", t)}
                        options={TIME_OPTIONS}
                        disabled={controlsDisabled}
                      />

                      <PrecallDropdown
                        value={effectiveEntry.precallDuration}
                        onSelect={(v) => updateDay(day, "precallDuration", v)}
                        disabled={controlsDisabled}
                      />

                      <TimeDropdown
                        label="Unit Call"
                        value={effectiveEntry.callTime}
                        onSelect={(t) => updateDay(day, "callTime", t)}
                        options={TIME_OPTIONS}
                        disabled={controlsDisabled}
                      />
                      <TimeDropdown
                        label="Wrap Time"
                        value={effectiveEntry.wrapTime}
                        onSelect={(t) => updateDay(day, "wrapTime", t)}
                        options={TIME_OPTIONS}
                        disabled={controlsDisabled}
                      />
                      <TimeDropdown
                        label="Arrive Back"
                        value={effectiveEntry.arriveBack}
                        onSelect={(t) => updateDay(day, "arriveBack", t)}
                        options={TIME_OPTIONS}
                        disabled={controlsDisabled}
                      />

                      <InfoToggleRow
                        label="Overnight?"
                        value={effectiveEntry.overnight || false}
                        onChange={(v) => updateDay(day, "overnight", v)}
                        disabled={controlsDisabled}
                        infoTitle="Overnight"
                        infoText="Turn this on if you stayed overnight (hotel or accommodation)."
                      />

                      <InfoToggleRow
                        label="Night Shoot?"
                        value={!!effectiveEntry.nightShoot}
                        onChange={(v) => updateDay(day, "nightShoot", v)}
                        disabled={controlsDisabled}
                        infoTitle="Night Shoot"
                        infoText="Turn this on if shoot is a night shoot (or you shoot past 12:00 midnight)."
                      />

                      {/* ✅ Meal supplement toggle for On Set day */}
                      <InfoToggleRow
                        label="Meal supp?"
                        value={!!effectiveEntry.mealSup}
                        onChange={(v) => updateDay(day, "mealSup", v)}
                        disabled={controlsDisabled}
                        infoTitle="Meal supplement"
                        infoText="Turn this on only if there was no meal supplement/food offered on set. If catering was offered but you chose not to eat, do not turn this on."
                      />

                      <TextInput
                        placeholder="Notes for this day"
                        placeholderTextColor={colors.textMuted}
                        style={[
                          styles.dayInput,
                          {
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.inputBorder,
                            color: colors.text,
                            opacity: controlsDisabled ? 0.6 : 1,
                          },
                        ]}
                        multiline
                        editable={!controlsDisabled}
                        value={effectiveEntry.dayNotes || ""}
                        onChangeText={(t) => updateDay(day, "dayNotes", t)}
                      />
                    </View>
                  )}

                  {/* Yard block */}
                  {yardEntry.mode === "yard" && (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={[styles.sectionCap, { color: colors.textMuted }]}>Yard Day</Text>

                        {showTurnaroundButton && (
                          <TouchableOpacity
                            style={[
                              styles.turnaroundBtn,
                              {
                                backgroundColor: yardEntry.isTurnaround ? colors.accentSoft : colors.surface,
                                borderColor: yardEntry.isTurnaround ? colors.accent : colors.border,
                                opacity: controlsDisabled ? 0.5 : canAddTurnaround || yardEntry.isTurnaround ? 1 : 0.5,
                              },
                            ]}
                            onPress={() => {
                              if (!canAddTurnaround && !yardEntry.isTurnaround) {
                                Alert.alert(
                                  "No Turnaround credits left",
                                  `You have ${turnaroundCreditsRemaining}/${turnaroundCreditsTotal} credit(s) left.`
                                );
                                return;
                              }
                              toggleTurnaround(day);
                            }}
                            disabled={controlsDisabled}
                          >
                            <Icon
                              name={yardEntry.isTurnaround ? "check-circle" : "refresh-ccw"}
                              size={14}
                              color={yardEntry.isTurnaround ? colors.accent : colors.text}
                            />
                            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 12 }}>
                              Turnaround
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {yardEntry.isTurnaround === true && (
                        <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "800" }}>
                            Turnaround for job (last 2 weeks)
                          </Text>

                          <TouchableOpacity
                            style={[
                              styles.turnaroundSelect,
                              { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                            ]}
                            onPress={() => {
                              setTurnaroundPickerDay(day);
                              setTurnaroundPickerOpen(true);
                            }}
                            disabled={controlsDisabled}
                          >
                            <Text style={{ color: yardEntry.turnaroundJob?.bookingId ? colors.text : colors.textMuted }}>
                              {yardEntry.turnaroundJob?.bookingId
                                ? `${yardEntry.turnaroundJob.jobNumber || yardEntry.turnaroundJob.bookingId} — ${
                                    yardEntry.turnaroundJob.client || "Client"
                                  }`
                                : "Select job"}
                            </Text>
                            <Icon name="chevron-down" size={16} color={colors.textMuted} />
                          </TouchableOpacity>

                          {yardEntry.turnaroundJob?.location ? (
                            <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 12 }}>
                              {yardEntry.turnaroundJob.location}
                            </Text>
                          ) : null}

                          <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 11 }}>
                            Note: Turnaround days don’t auto-create time blocks — add one only if needed.
                          </Text>
                        </View>
                      )}

                      {segsForUI.length > 0 &&
                        segsForUI.map((seg, idx) => (
                          <View key={idx} style={styles.segmentRow}>
                            <TimeDropdown
                              label={`Start ${idx + 1}`}
                              value={seg.start}
                              onSelect={(t) => updateYardSegment(day, idx, "start", t)}
                              options={TIME_OPTIONS}
                              disabled={controlsDisabled}
                            />
                            <View style={{ width: 8 }} />
                            <TimeDropdown
                              label={`Finish ${idx + 1}`}
                              value={seg.end}
                              onSelect={(t) => updateYardSegment(day, idx, "end", t)}
                              options={TIME_OPTIONS}
                              disabled={controlsDisabled}
                            />

                            <TouchableOpacity
                              onPress={() => removeYardSegment(day, idx)}
                              style={[
                                styles.segmentDelete,
                                {
                                  backgroundColor: colors.surface,
                                  borderColor: colors.border,
                                  opacity: controlsDisabled ? 0.5 : 1,
                                },
                              ]}
                              disabled={controlsDisabled}
                            >
                              <Icon name="trash-2" size={16} color={colors.danger} />
                            </TouchableOpacity>
                          </View>
                        ))}

                      <TouchableOpacity
                        style={[
                          styles.addBlockBtn,
                          {
                            backgroundColor: colors.accentSoft,
                            borderColor: colors.success,
                            opacity: controlsDisabled ? 0.5 : 1,
                          },
                        ]}
                        onPress={() => addYardSegment(day)}
                        disabled={controlsDisabled}
                      >
                        <Icon name="plus" size={14} color={colors.success} />
                        <Text style={[styles.addBlockText, { color: colors.success }]}>
                          Add time block
                        </Text>
                      </TouchableOpacity>

                      {isWeekend && (segsForUI.length || 0) > 0 && (
                        <TouchableOpacity
                          style={[
                            styles.addBlockBtn,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.danger,
                              opacity: controlsDisabled ? 0.5 : 1,
                            },
                          ]}
                          onPress={() =>
                            Alert.alert(
                              "Clear weekend blocks?",
                              `This will remove all time blocks for ${day} and set it back to Off.`,
                              [
                                { text: "Cancel", style: "cancel" },
                                { text: "Clear", style: "destructive", onPress: () => clearWeekendBlocks(day) },
                              ]
                            )
                          }
                          disabled={controlsDisabled}
                        >
                          <Icon name="x-circle" size={14} color={colors.danger} />
                          <Text style={[styles.addBlockText, { color: colors.danger }]}>
                            Clear weekend blocks
                          </Text>
                        </TouchableOpacity>
                      )}

                      {/* Hide Lunch toggle when Turnaround ON and NO time blocks */}
                      {(!yardEntry.isTurnaround || hasTimeBlocks) && (
                        <InfoToggleRow
                          label="Lunch?"
                          value={!!yardEntry.lunchSup}
                          onChange={(v) => updateDay(day, "lunchSup", v)}
                          disabled={controlsDisabled}
                          infoTitle="Lunch Break"
                          infoText="Turn this on if lunch had 30min break."
                        />
                      )}

                      <TextInput
                        placeholder="Notes for this day"
                        placeholderTextColor={colors.textMuted}
                        style={[
                          styles.dayInput,
                          {
                            backgroundColor: colors.inputBackground,
                            borderColor: colors.inputBorder,
                            color: colors.text,
                            opacity: controlsDisabled ? 0.6 : 1,
                          },
                        ]}
                        multiline
                        editable={!controlsDisabled}
                        value={yardEntry.dayNotes || ""}
                        onChangeText={(t) => updateDay(day, "dayNotes", t)}
                      />
                    </>
                  )}
                </>
              ) : isWeekend ? (
                <>
                  <Text style={{ color: colors.textMuted, marginBottom: 6 }}>Weekend (optional)</Text>

                  {String(entry.mode || "").toLowerCase() !== "yard" ? (
                    <TouchableOpacity
                      style={[
                        styles.addBlockBtn,
                        { backgroundColor: colors.accentSoft, borderColor: colors.success, opacity: controlsDisabled ? 0.5 : 1 },
                      ]}
                      onPress={() => addYardSegment(day)}
                      disabled={controlsDisabled}
                    >
                      <Icon name="plus" size={14} color={colors.success} />
                      <Text style={[styles.addBlockText, { color: colors.success }]}>Add time block</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text style={[styles.sectionCap, { color: colors.textMuted }]}>Yard Day</Text>

                        {turnaroundEligible && !controlsDisabled && !isHalfHoliday && (
                          <TouchableOpacity
                            style={[
                              styles.turnaroundBtn,
                              {
                                backgroundColor: entry.isTurnaround ? colors.accentSoft : colors.surface,
                                borderColor: entry.isTurnaround ? colors.accent : colors.border,
                                opacity: controlsDisabled ? 0.5 : canAddTurnaround || entry.isTurnaround ? 1 : 0.5,
                              },
                            ]}
                            onPress={() => {
                              if (!canAddTurnaround && !entry.isTurnaround) {
                                Alert.alert(
                                  "No Turnaround credits left",
                                  `You have ${turnaroundCreditsRemaining}/${turnaroundCreditsTotal} credit(s) left.`
                                );
                                return;
                              }
                              toggleTurnaround(day);
                            }}
                            disabled={controlsDisabled}
                          >
                            <Icon
                              name={entry.isTurnaround ? "check-circle" : "refresh-ccw"}
                              size={14}
                              color={entry.isTurnaround ? colors.accent : colors.text}
                            />
                            <Text style={{ color: colors.text, fontWeight: "800", fontSize: 12 }}>Turnaround</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {entry.isTurnaround === true && (
                        <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "800" }}>Turnaround for job (last 2 weeks)</Text>

                          <TouchableOpacity
                            style={[
                              styles.turnaroundSelect,
                              { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                            ]}
                            onPress={() => {
                              setTurnaroundPickerDay(day);
                              setTurnaroundPickerOpen(true);
                            }}
                            disabled={controlsDisabled}
                          >
                            <Text style={{ color: entry.turnaroundJob?.bookingId ? colors.text : colors.textMuted }}>
                              {entry.turnaroundJob?.bookingId
                                ? `${entry.turnaroundJob.jobNumber || entry.turnaroundJob.bookingId} — ${entry.turnaroundJob.client || "Client"}`
                                : "Select job"}
                            </Text>
                            <Icon name="chevron-down" size={16} color={colors.textMuted} />
                          </TouchableOpacity>
                        </View>
                      )}

                      {Array.isArray(entry.yardSegments) &&
                        entry.yardSegments.length > 0 &&
                        entry.yardSegments.map((seg, idx) => (
                          <View key={idx} style={styles.segmentRow}>
                            <TimeDropdown
                              label={`Start ${idx + 1}`}
                              value={seg.start}
                              onSelect={(t) => updateYardSegment(day, idx, "start", t)}
                              options={TIME_OPTIONS}
                              disabled={controlsDisabled}
                            />
                            <View style={{ width: 8 }} />
                            <TimeDropdown
                              label={`Finish ${idx + 1}`}
                              value={seg.end}
                              onSelect={(t) => updateYardSegment(day, idx, "end", t)}
                              options={TIME_OPTIONS}
                              disabled={controlsDisabled}
                            />

                            <TouchableOpacity
                              onPress={() => removeYardSegment(day, idx)}
                              style={[
                                styles.segmentDelete,
                                { backgroundColor: colors.surface, borderColor: colors.border, opacity: controlsDisabled ? 0.5 : 1 },
                              ]}
                              disabled={controlsDisabled}
                            >
                              <Icon name="trash-2" size={16} color={colors.danger} />
                            </TouchableOpacity>
                          </View>
                        ))}

                      <TouchableOpacity
                        style={[
                          styles.addBlockBtn,
                          { backgroundColor: colors.accentSoft, borderColor: colors.success, opacity: controlsDisabled ? 0.5 : 1 },
                        ]}
                        onPress={() => addYardSegment(day)}
                        disabled={controlsDisabled}
                      >
                        <Icon name="plus" size={14} color={colors.success} />
                        <Text style={[styles.addBlockText, { color: colors.success }]}>Add time block</Text>
                      </TouchableOpacity>

                      {entry.yardSegments?.length > 0 && (
                        <TouchableOpacity
                          style={[
                            styles.addBlockBtn,
                            { backgroundColor: colors.surface, borderColor: colors.danger, opacity: controlsDisabled ? 0.5 : 1 },
                          ]}
                          onPress={() =>
                            Alert.alert("Clear weekend blocks?", `This will remove all time blocks for ${day} and set it back to Off.`, [
                              { text: "Cancel", style: "cancel" },
                              { text: "Clear", style: "destructive", onPress: () => clearWeekendBlocks(day) },
                            ])
                          }
                          disabled={controlsDisabled}
                        >
                          <Icon name="x-circle" size={14} color={colors.danger} />
                          <Text style={[styles.addBlockText, { color: colors.danger }]}>Clear weekend blocks</Text>
                        </TouchableOpacity>
                      )}

                      {(() => {
                        const segs = Array.isArray(entry.yardSegments) ? entry.yardSegments : [];
                        const hasBlocks = segs.length > 0;
                        return !entry.isTurnaround || hasBlocks ? (
                          <InfoToggleRow
                            label="Lunch?"
                            value={!!entry.lunchSup}
                            onChange={(v) => updateDay(day, "lunchSup", v)}
                            disabled={controlsDisabled}
                            infoTitle="Lunch Break"
                            infoText="Turn this on if you had 30min lunch break"
                          />
                        ) : null;
                      })()}

                      <TextInput
                        placeholder="Notes for this day"
                        placeholderTextColor={colors.textMuted}
                        style={[
                          styles.dayInput,
                          { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text, opacity: controlsDisabled ? 0.6 : 1 },
                        ]}
                        multiline
                        editable={!controlsDisabled}
                        value={entry.dayNotes || ""}
                        onChangeText={(t) => updateDay(day, "dayNotes", t)}
                      />
                    </>
                  )}
                </>
              ) : isBankHolidayOff ? (
                <Text style={{ color: colors.textMuted }}>Off (Bank Holiday)</Text>
              ) : (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={[styles.sectionCap, { color: colors.textMuted }]}>Yard Day</Text>

                    {turnaroundEligible && !controlsDisabled && !isHalfHoliday && (
                      <TouchableOpacity
                        style={[
                          styles.turnaroundBtn,
                          { backgroundColor: entry.isTurnaround ? colors.accentSoft : colors.surface, borderColor: entry.isTurnaround ? colors.accent : colors.border, opacity: canAddTurnaround || entry.isTurnaround ? 1 : 0.5 },
                        ]}
                        onPress={() => {
                          if (!canAddTurnaround && !entry.isTurnaround) {
                            Alert.alert(
                              "No Turnaround credits left",
                              `You have ${turnaroundCreditsRemaining}/${turnaroundCreditsTotal} credit(s) left.`
                            );
                            return;
                          }
                          toggleTurnaround(day);
                        }}
                        disabled={controlsDisabled}
                      >
                        <Icon name={entry.isTurnaround ? "check-circle" : "refresh-ccw"} size={14} color={entry.isTurnaround ? colors.accent : colors.text} />
                        <Text style={{ color: colors.text, fontWeight: "800", fontSize: 12 }}>Turnaround</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {entry.isTurnaround === true && (
                    <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "800" }}>Turnaround for job (last 2 weeks)</Text>

                      <TouchableOpacity
                        style={[
                          styles.turnaroundSelect,
                          { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder },
                        ]}
                        onPress={() => {
                          setTurnaroundPickerDay(day);
                          setTurnaroundPickerOpen(true);
                        }}
                        disabled={controlsDisabled}
                      >
                        <Text style={{ color: entry.turnaroundJob?.bookingId ? colors.text : colors.textMuted }}>
                          {entry.turnaroundJob?.bookingId
                            ? `${entry.turnaroundJob.jobNumber || entry.turnaroundJob.bookingId} — ${entry.turnaroundJob.client || "Client"}`
                            : "Select job"}
                        </Text>
                        <Icon name="chevron-down" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {Array.isArray(entry.yardSegments) &&
                    entry.yardSegments.length > 0 &&
                    entry.yardSegments.map((seg, idx) => (
                      <View key={idx} style={styles.segmentRow}>
                        <TimeDropdown label={`Start ${idx + 1}`} value={seg.start} onSelect={(t) => updateYardSegment(day, idx, "start", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />
                        <View style={{ width: 8 }} />
                        <TimeDropdown label={`Finish ${idx + 1}`} value={seg.end} onSelect={(t) => updateYardSegment(day, idx, "end", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />

                        <TouchableOpacity
                          onPress={() => removeYardSegment(day, idx)}
                          style={[
                            styles.segmentDelete,
                            { backgroundColor: colors.surface, borderColor: colors.border, opacity: controlsDisabled ? 0.5 : 1 },
                          ]}
                          disabled={controlsDisabled}
                        >
                          <Icon name="trash-2" size={16} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    ))}

                  <TouchableOpacity
                    style={[
                      styles.addBlockBtn,
                      { backgroundColor: colors.accentSoft, borderColor: colors.success, opacity: controlsDisabled ? 0.5 : 1 },
                    ]}
                    onPress={() => addYardSegment(day)}
                    disabled={controlsDisabled}
                  >
                    <Icon name="plus" size={14} color={colors.success} />
                    <Text style={[styles.addBlockText, { color: colors.success }]}>Add time block</Text>
                  </TouchableOpacity>

                  {(() => {
                    const segs = Array.isArray(entry.yardSegments) ? entry.yardSegments : [];
                    const hasBlocks = segs.length > 0;
                    return !entry.isTurnaround || hasBlocks ? (
                      <InfoToggleRow
                        label="Lunch?"
                        value={!!entry.lunchSup}
                        onChange={(v) => updateDay(day, "lunchSup", v)}
                        disabled={controlsDisabled}
                        infoTitle="Yard Lunch"
                        infoText="Turn this on if lunch had 30min break."
                      />
                    ) : null;
                  })()}

                  <TextInput
                    placeholder="Notes for this day"
                    placeholderTextColor={colors.textMuted}
                    style={[
                      styles.dayInput,
                      { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text, opacity: controlsDisabled ? 0.6 : 1 },
                    ]}
                    multiline
                    editable={!controlsDisabled}
                    value={entry.dayNotes || ""}
                    onChangeText={(t) => updateDay(day, "dayNotes", t)}
                  />
                </>
              )}
            </View>
          );
        })}

        <TextInput
          placeholder="General notes for the week"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
              color: colors.text,
              opacity: isLocked ? 0.6 : 1,
            },
          ]}
          multiline
          editable={!isLocked}
          value={timesheet.notes}
          onChangeText={(t) => setTimesheet((prev) => ({ ...prev, notes: t }))}
        />

        {/* ✅ Summary at the bottom */}
        <HoursSummary timesheet={timesheet} holidaysByDay={holidaysByDay} bankHolidaysByDay={bankHolidaysByDay} />

        <View style={{ flexDirection: "row", justifyContent: "space-between", margin: 10 }}>
          {isLocked ? (
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={[styles.statusHint, { color: colors.textMuted }]}>
                This timesheet is approved and locked. Contact your manager if a change is needed.
              </Text>
            </View>
          ) : !timesheet.submitted ? (
            <>
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1 },
                ]}
                onPress={saveTimesheet}
              >
                <Text style={[styles.actionButtonText, { color: colors.text }]}>💾 Save Draft</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.success }]}
                onPress={() =>
                  Alert.alert(
                    "Submit timesheet?",
                    "After submission your manager will receive it. You can still re-open and update if needed.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Submit", style: "default", onPress: submitTimesheet },
                    ]
                  )
                }
              >
                <Text style={[styles.actionButtonText, { color: "#fff" }]}>📤 Submit for Approval</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.success }]} onPress={saveTimesheet}>
              <Text style={[styles.actionButtonText, { color: "#fff" }]}>🔁 Update Submission</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ───────────────────────── styles ───────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 6 },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  backText: { fontSize: 14, marginLeft: 6 },
  title: { fontSize: 16, fontWeight: "700", marginBottom: 6 },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  pill: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  pillOk: { backgroundColor: "#bbf7d0", borderColor: "#86efac" },
  pillDraft: { backgroundColor: "#fed7aa", borderColor: "#fdba74" },
  pillText: { fontWeight: "800", fontSize: 11 },
  pillTextOk: { color: "#052e16" },
  pillTextDraft: { color: "#7c2d12" },
  statusHint: { fontSize: 11 },

  // ✅ NEW: credits banner
  creditBox: {
    marginHorizontal: 8,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },

  dayBlock: { padding: 10, borderRadius: 10, marginBottom: 10, borderWidth: 1 },
  dayTitle: { fontSize: 14, fontWeight: "700", marginBottom: 6 },

  bankHolidayBlock: { padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 8 },

  holidayBlock: { padding: 10, borderRadius: 8, borderWidth: 1 },
  holidaySub: { fontSize: 11, marginTop: 4 },

  modeRow: { flexDirection: "row", marginBottom: 6, gap: 6 },
  modeBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", borderWidth: 1 },
  modeText: { fontSize: 12, fontWeight: "700" },

  onSetBlock: { marginTop: 4 },

  label: { fontSize: 11, marginBottom: 2 },
  dropdownBox: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
  },

  sectionCap: { marginBottom: 6, fontWeight: "700", fontSize: 12, opacity: 0.9 },
  segmentRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  segmentDelete: {
    marginLeft: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    height: 40,
  },

  addBlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 2,
    marginBottom: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  addBlockText: { fontWeight: "700", fontSize: 12 },

  jobLink: { padding: 8, borderRadius: 8, marginBottom: 6, borderWidth: 1 },
  jobMain: { fontWeight: "700", fontSize: 12.5 },
  jobSub: { fontSize: 12, marginTop: 2 },

  dayInput: { padding: 8, borderRadius: 8, marginTop: 6, fontSize: 12, borderWidth: 1 },
  input: { padding: 10, borderRadius: 8, margin: 8, fontSize: 13, height: 55, borderWidth: 1 },

  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: 6 },

  infoBtn: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center" },
  modalBox: { width: "70%", maxHeight: "60%", borderRadius: 10, padding: 10, borderWidth: 1 },
  modalItem: { padding: 10, borderBottomWidth: 1 },
  closeBtn: { marginTop: 8, padding: 10, borderRadius: 8, alignItems: "center" },

  actionButton: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 8, marginHorizontal: 5 },
  actionButtonText: { fontWeight: "bold", fontSize: 15 },

  // Turnaround UI
  turnaroundBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  turnaroundPanel: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  turnaroundSelect: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  // ✅ Summary UI
  summaryBox: {
    marginHorizontal: 8,
    marginTop: 6,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
  },
  summaryLabel: { fontSize: 12, fontWeight: "700" },
  summaryValue: { fontSize: 12, fontWeight: "900" },
  summaryDivider: { height: 1, opacity: 0.4, marginVertical: 8 },
});
