"use client";

import { AppButton, AppModal, AppText as Text, AppPressable as TouchableOpacity, FormField, IconButton, TextArea } from "../../../../components/ui/AppPrimitives";

import {
  useLocalSearchParams,
  useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
import {
  doc,
  serverTimestamp,
  setDoc,
  } from "firebase/firestore";
import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  Alert,
  FlatList,
  LayoutAnimation,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { AsyncContentState } from "../../../../components/AsyncState";
import { db } from "../../../../firebaseConfig";
import {
  useBookings,
  useEmployeeTimesheets,
  useHolidays,
  useVehicles,
} from "../../../../hooks/useOperationalData";
import { isCrewedBooking } from "../../../../lib/bookingVisibility";
import {
  collapseLinkedJobsForDay,
  expandLinkedHandoverJobs,
} from "../../../../lib/linkedBookingDays";
import { formatDateDDMMYYYY } from "../../../../lib/dateFormat";
import {
  getBookingVehicleReferences,
  getVehicleDisplayList,
} from "../../../../lib/fleetSchema";
import { runOrQueueFirestoreMutation } from "../../../../lib/sync/firestoreQueue";
import { computeTimesheetDayBreakdown } from "../../../../lib/timesheetHours";
import { cancelTimesheetReminders } from "../../../../lib/timesheetReminders";
import { useAuth } from "../../../../providers/AuthProvider";
import { useDataCache } from "../../../../providers/DataCacheProvider";
import { useTheme } from "../../../../providers/ThemeProvider";
import { staticColors } from "../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../lib/design/tokens";
import PageShell from "../../../../components/layout/PageShell";

/* ───────────────────────────────
   BANK HOLIDAYS (UK via GOV.UK)
   - Source: https://www.gov.uk/bank-holidays.json
   - Region options: "england-and-wales" | "scotland" | "northern-ireland"
──────────────────────────────── */
const BANK_HOLIDAY_REGION = "england-and-wales";

// Turnaround lookback window (was 2 weeks / 14 days)
const TURNAROUND_LOOKBACK_DAYS = 21; // 3 weeks
const TURNAROUND_MAX_USES_PER_WEEK = 1;
const ON_SET_EARLY_ARRIVAL_CAP_MINUTES = 60;
const ON_SET_STANDARD_DAY_MINUTES = 10 * 60;
const ON_SET_EARLY_CALL_CUTOFF_MINUTES = 7 * 60;
const MAX_REASONABLE_PRECALL_WINDOW_MINUTES = 12 * 60;

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
const DEFAULT_OFFICE_START = "09:00";
const DEFAULT_OFFICE_END = "17:00";

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

function formatTimeWithPeriod(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return String(value || "");

  const hour = Number(match[1]);
  const minute = match[2];
  const hour24 = String(hour).padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour24}:${minute} ${period}`;
}

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

function minutesToHHMM(mins) {
  if (mins == null || Number.isNaN(mins)) return null;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normaliseTimeValue(v) {
  const mins = timeToMinutes(v);
  return minutesToHHMM(mins);
}

function firstValidTime(...values) {
  for (const value of values) {
    const t = normaliseTimeValue(value);
    if (t) return t;
  }
  return null;
}

function normaliseAutofillType(v) {
  const value = String(v || "").trim().toLowerCase();
  if (value === "office" || value === "workshop") return value;
  return "yard";
}

function isLateSupplementWrap(entry) {
  const wrapMinutes = timeToMinutes(entry?.wrapTime);
  if (wrapMinutes == null) return false;
  if (wrapMinutes >= 22 * 60) return true;

  const base = entry?.leaveTime || entry?.arriveTime || entry?.callTime || null;
  const wrapOffset = timeFieldOffset(base, entry?.wrapTime || null);
  return (wrapOffset?.dayOffset ?? 0) === 1;
}

function formatDisplayDate(value) {
  const parsed = toDateSafe(value);
  if (!parsed) return String(value || "");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const yyyy = parsed.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getProductionDisplayName(job) {
  return String(job?.production || "").trim() || "Production not set";
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

    if ((mode === "yard" || mode === "workshop") && Array.isArray(e.yardSegments)) {
      const segs = e.yardSegments.map((seg) => ({ ...seg, ...segmentMeta(seg) }));
      const yardTravelArriveOffset =
        mode === "yard" && boolish(e.yardTravelEnabled) && e.yardTravelLeaveTime && e.yardTravelArriveTime
          ? timeFieldOffset(e.yardTravelLeaveTime, e.yardTravelArriveTime)
          : null;
      next.days[dayName] = {
        ...e,
        yardSegments: segs,
        crossesMidnight: segs.some((s) => s.crossesMidnight) || (yardTravelArriveOffset?.dayOffset ?? 0) === 1,
        timeMeta: {
          yardTravelLeaveTime: e.yardTravelLeaveTime || null,
          yardTravelArriveTime: yardTravelArriveOffset,
        },
      };
      continue;
    }

    if (mode === "travel") {
      const base = e.leaveTime || null;
      const arriveTimeOffset = timeFieldOffset(base, e.arriveTime || null);
      const crossesMidnight = (arriveTimeOffset?.dayOffset ?? 0) === 1;

      next.days[dayName] = {
        ...e,
        overnight: boolish(e.overnight),
        generatorUsed: boolish(e.generatorUsed),
        lateSup: typeof e.lateSup === "boolean" ? e.lateSup : isLateSupplementWrap(e),
        crossesMidnight,
        timeMeta: {
          baseTime: base,
          arriveTime: e.arriveTime ? arriveTimeOffset : null,
        },
      };
      continue;
    }

    if (mode === "onset") {
      const base = e.leaveTime || e.arriveTime || e.callTime || null;

      const arriveBackOffset = timeFieldOffset(base, e.arriveBack || null);
      const wrapOffset = timeFieldOffset(base, e.wrapTime || null);
      const additionalTravelOffset = boolish(e.additionalTravelEnabled)
        ? timeFieldOffset(e.additionalTravelStartTime, e.additionalTravelEndTime)
        : null;
      const crossesMidnight =
        (arriveBackOffset?.dayOffset ?? 0) === 1 ||
        (wrapOffset?.dayOffset ?? 0) === 1 ||
        (additionalTravelOffset?.dayOffset ?? 0) === 1;

      next.days[dayName] = {
        ...e,
        overnight: boolish(e.overnight),
        crossesMidnight,
        timeMeta: {
          baseTime: base,
          arriveBack: e.arriveBack ? arriveBackOffset : null,
          wrapTime: e.wrapTime ? wrapOffset : null,
          additionalTravelEndTime: e.additionalTravelEndTime ? additionalTravelOffset : null,
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
  if (typeof val === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val);
    if (m) {
      const [, y, mo, d] = m;
      return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
    }
  }
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
  const defaultStart = normaliseTimeValue(e.leaveTime) || DEFAULT_YARD_START;
  const defaultEnd = normaliseTimeValue(e.arriveBack) || DEFAULT_YARD_END;
  if (!Array.isArray(e.yardSegments) || e.yardSegments.length === 0) {
    e.yardSegments = [{ start: defaultStart, end: defaultEnd, note: "" }];
  } else {
    e.yardSegments = e.yardSegments.map((seg) => ({
      ...seg,
      start: normaliseTimeValue(seg?.start) || defaultStart,
      end: normaliseTimeValue(seg?.end) || defaultEnd,
      note: typeof seg?.note === "string" ? seg.note : "",
    }));
  }
  return e;
}

function ensureYardLunch(entry) {
  const e = { ...(entry || {}) };
  // Lunch is mandatory, so legacy "No Lunch" selections are normalised away.
  e.lunchSup = false;
  return e;
}

function ensureYardTravel(entry) {
  const e = { ...(entry || {}) };
  const mode = String(e.mode || "yard").toLowerCase();

  if (mode === "yard") {
    e.yardTravelEnabled = typeof e.yardTravelEnabled === "boolean" ? e.yardTravelEnabled : false;
    e.yardTravelLeaveTime = e.yardTravelEnabled ? normaliseTimeValue(e.yardTravelLeaveTime) || null : null;
    e.yardTravelArriveTime = e.yardTravelEnabled ? normaliseTimeValue(e.yardTravelArriveTime) || null : null;
  } else {
    e.yardTravelEnabled = false;
    e.yardTravelLeaveTime = null;
    e.yardTravelArriveTime = null;
  }

  return e;
}

function ensureWorkshopJobs(entry) {
  const e = { ...(entry || {}) };
  const rows = Array.isArray(e.workshopJobs) ? e.workshopJobs : [];
  e.workshopJobs =
    rows.length > 0
      ? rows.map((row) => ({
          jobNumber: String(row?.jobNumber ?? ""),
          hours: String(row?.hours ?? ""),
          note: String(row?.note ?? ""),
        }))
      : [{ jobNumber: "", hours: "", note: "" }];
  return e;
}

function ensureTravelExtras(entry) {
  const e = { ...(entry || {}) };
  const mode = String(e.mode || "yard").toLowerCase();

  if (mode === "travel") {
    e.travelLunchSup = false;
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
  if (typeof e.generatorUsed !== "boolean") e.generatorUsed = false;
  if (typeof e.lateSup !== "boolean") e.lateSup = isLateSupplementWrap(e);

  // on-set meal supplement toggle
  if (typeof e.mealSup !== "boolean") e.mealSup = false;

  e.additionalTravelEnabled = boolish(e.additionalTravelEnabled);
  if (e.additionalTravelEnabled) {
    e.additionalTravelStartTime = normaliseTimeValue(e.additionalTravelStartTime) || null;
    e.additionalTravelEndTime = normaliseTimeValue(e.additionalTravelEndTime) || null;
    e.additionalTravelJob = String(e.additionalTravelJob || "");
  } else {
    e.additionalTravelStartTime = null;
    e.additionalTravelEndTime = null;
    e.additionalTravelJob = "";
  }

  return e;
}

function ensureModeDefaults(entry) {
  let e = { ...(entry || {}) };
  const mode = String(e.mode || "yard").toLowerCase();
  e.mode = mode;
  e.bankHolidayWorked = typeof e.bankHolidayWorked === "boolean" ? e.bankHolidayWorked : boolish(e.bankHolidayWorked);

  // Turnaround schema: only meaningful on yard days
  if (typeof e.isTurnaround !== "boolean") e.isTurnaround = false;
  if (e.isTurnaround && mode !== "yard") e.isTurnaround = false;
  if (e.isTurnaround) {
    if (!e.turnaroundJob || typeof e.turnaroundJob !== "object") e.turnaroundJob = null;
  } else {
    if (e.turnaroundJob) e.turnaroundJob = e.turnaroundJob; // no-op
  }

  if (mode === "yard") {
    e.leaveTime = normaliseTimeValue(e.leaveTime) || DEFAULT_YARD_START;
    e.arriveBack = normaliseTimeValue(e.arriveBack) || DEFAULT_YARD_END;

    // IMPORTANT: when Turnaround Day is ON, do NOT auto-add time blocks
    if (!e.isTurnaround) e = ensureYardSegments(e);
    e = ensureYardLunch(e);
    e = ensureYardTravel(e);
    e.precallDuration = e.precallDuration ?? null;
  } else if (mode === "workshop") {
    e = ensureWorkshopJobs(e);
    e.leaveTime = normaliseTimeValue(e.leaveTime) || DEFAULT_YARD_START;
    e.arriveBack = normaliseTimeValue(e.arriveBack) || DEFAULT_YARD_END;
    e = ensureYardSegments(e);
    e.lunchSup = false;
    e.yardTravelEnabled = false;
    e.yardTravelLeaveTime = null;
    e.yardTravelArriveTime = null;
    e.isTurnaround = false;
    e.turnaroundJob = null;
    e.arriveTime = null;
    e.callTime = null;
    e.wrapTime = null;
    e.precallDuration = null;
    e.overnight = false;
    e.nightShoot = false;
    e.generatorUsed = false;
    e.lateSup = false;
    e.mealSup = false;
  } else {
    e = ensureYardLunch(e);
    e = ensureYardTravel(e);
    e.workshopJobs = Array.isArray(e.workshopJobs) ? e.workshopJobs : [];
  }

  e = ensureTravelExtras(e);
  e = ensureOnsetExtras(e);

  if (mode !== "travel") {
    e.travelLunchSup = typeof e.travelLunchSup === "boolean" ? e.travelLunchSup : false;
    e.travelPD = typeof e.travelPD === "boolean" ? e.travelPD : false;
  }
  if (mode !== "onset") {
    e.nightShoot = typeof e.nightShoot === "boolean" ? e.nightShoot : false;
    e.generatorUsed = typeof e.generatorUsed === "boolean" ? e.generatorUsed : false;
    e.lateSup = typeof e.lateSup === "boolean" ? e.lateSup : false;
    e.mealSup = typeof e.mealSup === "boolean" ? e.mealSup : false;
    e.additionalTravelEnabled = false;
    e.additionalTravelStartTime = null;
    e.additionalTravelEndTime = null;
    e.additionalTravelJob = "";
  }

  return e;
}

function isUnpaidDayEntry(entry) {
  return String(entry?.mode || "").trim().toLowerCase() === "unpaid";
}

function stripUnpaidRestore(entry) {
  if (!entry || typeof entry !== "object") return null;
  const next = { ...entry };
  delete next.unpaidRestore;
  return next;
}

function buildNonWorkingDayEntry(entry, mode, extra = {}) {
  const existing = entry || {};

  return {
    ...existing,
    mode,
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
    additionalTravelEnabled: false,
    additionalTravelStartTime: null,
    additionalTravelEndTime: null,
    additionalTravelJob: "",
    lunchSup: false,
    yardTravelEnabled: false,
    yardTravelLeaveTime: null,
    yardTravelArriveTime: null,
    travelLunchSup: false,
    travelPD: false,
    isTurnaround: false,
    turnaroundJob: null,
    crossesMidnight: false,
    ...extra,
  };
}

function hasMeaningfulYardSegments(entry, defaultStart, defaultEnd) {
  const segs = Array.isArray(entry?.yardSegments) ? entry.yardSegments : [];
  if (segs.length === 0) return false;
  if (segs.length > 1) return true;

  const seg = segs[0] || {};
  const start = normaliseTimeValue(seg.start);
  const end = normaliseTimeValue(seg.end);
  const note = String(seg.note || "").trim();

  return !!note || start !== defaultStart || end !== defaultEnd;
}

function shouldPreserveWorkedBankHoliday(entry, defaultStart, defaultEnd) {
  const current = entry || {};
  const mode = String(current.mode || "").toLowerCase();

  if (boolish(current.bankHolidayWorked)) return true;
  if (current.isTurnaround === true || current.turnaroundJob?.bookingId) return true;
  if (mode === "travel" || mode === "onset") return true;
  if (mode !== "yard") return false;
  if (current.bookingId || current.jobNumber || current.hasJob) return true;

  return hasMeaningfulYardSegments(current, defaultStart, defaultEnd);
}

function getDayName(dateStr) {
  const parsed = toDateSafe(dateStr);
  if (!parsed) return "";
  const i = parsed.getDay();
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i];
}

function sanitiseEntryForCompare(entry) {
  const e = ensureModeDefaults(entry || {});
  const next = {
    ...e,
    dayNotes: String(e.dayNotes || ""),
    unpaidDay: isUnpaidDayEntry(e),
  };

  delete next.unpaidRestore;
  return next;
}

function serialiseTimesheetForCompare(timesheet) {
  if (!timesheet || typeof timesheet !== "object") return "";

  const safeDays = DAYS.reduce((acc, day) => {
    acc[day] = sanitiseEntryForCompare(
      timesheet?.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard" }
    );
    return acc;
  }, {});

  return JSON.stringify({
    employeeCode: String(timesheet.employeeCode || ""),
    weekStart: String(timesheet.weekStart || ""),
    notes: String(timesheet.notes || ""),
    submitted: !!timesheet.submitted,
    status: timesheet.status ?? null,
    days: safeDays,
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDaysISO(isoStr, deltaDays) {
  const d = toDateSafe(isoStr);
  if (!d) return "";
  d.setDate(d.getDate() + deltaDays);
  d.setHours(0, 0, 0, 0);
  return iso(d);
}

function mondayISO(value) {
  const d = toDateSafe(value);
  if (!d) return "";
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return iso(d);
}

function buildPreviousNDatesISO(anchorISO, n) {
  const out = [];
  const anchor = toDateSafe(anchorISO) || startOfDay(new Date());
  anchor.setHours(0, 0, 0, 0);
  for (let i = 1; i <= n; i++) {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() - i);
    out.push(iso(d));
  }
  return out;
}

/* -------------------------- Night shoot day-notes detection -------------------------- */
function hasNightShootInNotes(dayNotes) {
  const dn = String(dayNotes || "").toLowerCase();
  // keep it forgiving (nightshoot / night shoot / night-shoot)
  return dn.includes("nightshoot") || dn.includes("night shoot") || dn.includes("night-shoot");
}

function canonicalEmployeeCode(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits) return digits.padStart(4, "0");
  return raw.toLowerCase();
}

function codesEqual(a, b) {
  const aa = canonicalEmployeeCode(a);
  const bb = canonicalEmployeeCode(b);
  return !!aa && !!bb && aa === bb;
}

function deriveCodesFromAssignmentList(list = [], nameToCode = {}) {
  const codes = [];
  for (const emp of Array.isArray(list) ? list : []) {
    if (typeof emp === "string") {
      const raw = String(emp || "").trim();
      if (!raw) continue;
      const byName = canonicalEmployeeCode(nameToCode[String(raw).toLowerCase()]);
      if (byName) codes.push(byName);
      else {
        const byCode = canonicalEmployeeCode(raw);
        if (byCode) codes.push(byCode);
      }
      continue;
    }

    if (emp && typeof emp === "object") {
      const directCode = canonicalEmployeeCode(emp.userCode || emp.employeeCode || emp.code);
      if (directCode) {
        codes.push(directCode);
        continue;
      }
      const nm = String(emp.name || emp.displayName || "").trim().toLowerCase();
      const mapped = canonicalEmployeeCode(nameToCode[nm]);
      if (mapped) codes.push(mapped);
    }
  }
  return codes.filter(Boolean);
}

function getBookingDates(job) {
  if (Array.isArray(job?.bookingDates)) {
    return job.bookingDates
      .map((d) => {
        if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
        const dt = toDateSafe(d);
        return dt ? iso(dt) : "";
      })
      .filter(Boolean);
  }
  return [];
}

function isEmployeeAssignedToBookingDate(job, dateISO, myCode, nameToCode) {
  if (!job || !dateISO || !myCode) return false;

  const byDate =
    job.employeesByDate ||
    job.employeeAssignmentsByDate ||
    null;
  const byCodeDate =
    job.employeeCodesByDate ||
    job.assignedEmployeeCodesByDate ||
    null;

  const listForDate = Array.isArray(byDate?.[dateISO]) ? byDate[dateISO] : [];
  const codeListForDate = Array.isArray(byCodeDate?.[dateISO]) ? byCodeDate[dateISO] : [];

  if (listForDate.length || codeListForDate.length) {
    const allDateCodes = [
      ...deriveCodesFromAssignmentList(listForDate, nameToCode),
      ...deriveCodesFromAssignmentList(codeListForDate, nameToCode),
    ];
    return allDateCodes.some((c) => codesEqual(c, myCode));
  }

  const globalList = Array.isArray(job.employees) ? job.employees : [];
  const globalCodeList = Array.isArray(job.employeeCodes) ? job.employeeCodes : [];
  const allGlobalCodes = [
    ...deriveCodesFromAssignmentList(globalList, nameToCode),
    ...deriveCodesFromAssignmentList(globalCodeList, nameToCode),
  ];
  return allGlobalCodes.some((c) => codesEqual(c, myCode));
}

function hasNightShootInBookingNotes(job, dateISO) {
  const notesByDate = job?.notesByDate || {};
  const rawStr = getBookingDayNote(job, dateISO);

  if (hasNightShootInNotes(rawStr)) return true;

  if (String(rawStr).trim().toLowerCase() === "other") {
    const otherVal = notesByDate?.[`${dateISO}-other`];
    if (hasNightShootInNotes(otherVal)) return true;
  }

  return false;
}

function getBookingDayNote(job, dateISO) {
  const notesByDate = job?.notesByDate || {};
  const raw = notesByDate?.[dateISO];

  if (!raw) return "";

  const normaliseRawValue = (value) => {
    if (typeof value === "string") return value.trim();
    if (typeof value === "object" && value) {
      const rawStr = String(value.label || value.value || value.note || "").trim();
      return rawStr;
    }
    return "";
  };

  const direct = normaliseRawValue(raw);

  if (String(direct).trim().toLowerCase() === "other") {
    const otherVal = notesByDate?.[`${dateISO}-other`];
    if (otherVal) return normaliseRawValue(otherVal);
    return "";
  }

  return direct;
}

function isTimeAllocationDayNote(value) {
  const note = String(value || "").trim().toLowerCase();
  if (!note) return false;

  const mentionsWorkType = /\b(?:yard|on[\s-]?set|travel|office|workshop)\b/.test(note);
  const mentionsDayAllocation = /\b(?:half|full)\s*day\b/.test(note);
  const containsTimeRange = /\b\d{1,2}(?::?\d{2})?\s*(?:-|–|—|to)\s*\d{1,2}(?::?\d{2})?\b/.test(note);
  return mentionsWorkType && (mentionsDayAllocation || containsTimeRange);
}

function hasTravelKeywordInNote(dayNote) {
  const text = String(dayNote || "").toLowerCase();
  return /\bon\s*set\s*travel\b|\btravel\b|\bjourney\b|\bto\s*and\s*from\b/.test(text);
}

function hasOnsetKeywordInNote(dayNote) {
  const text = String(dayNote || "").toLowerCase();
  return /\bon[\s-]?set\b|\bshoot\s*day\b|\bonsite\b|\bon\s*shoot\b/.test(text);
}

function inferJobDayMode(job, dateISO) {
  const note = getBookingDayNote(job, dateISO);

  if (hasTravelKeywordInNote(note)) return "travel";
  if (hasOnsetKeywordInNote(note)) return "onset";

  return null;
}

function inferDayModeFromAssignedJobs(jobs, dateISO) {
  let hasOnset = false;

  for (const job of Array.isArray(jobs) ? jobs : []) {
    const inferred = inferJobDayMode(job, dateISO);
    if (inferred === "travel") return "travel";
    if (inferred === "onset") hasOnset = true;
  }

  return hasOnset || (Array.isArray(jobs) && jobs.length > 0) ? "onset" : null;
}

function isDefaultYardTemplateForAutoMode(entry, defaultStart, defaultEnd) {
  const leaveTime = normaliseTimeValue(entry.leaveTime);
  const arriveBack = normaliseTimeValue(entry.arriveBack);
  const segs = Array.isArray(entry?.yardSegments) ? entry.yardSegments : [];

  if (leaveTime && leaveTime !== defaultStart) return false;
  if (arriveBack && arriveBack !== defaultEnd) return false;

  if (segs.length > 1) return false;
  if (segs.length === 1) {
    const seg = segs[0] || {};
    const segStart = normaliseTimeValue(seg.start);
    const segEnd = normaliseTimeValue(seg.end);
    const segNote = String(seg.note || "").trim();

    if ((segStart && segStart !== defaultStart) || (segEnd && segEnd !== defaultEnd)) return false;
    if (segNote) return false;
  }

  return true;
}

function shouldAutoApplyJobMode(entry, defaultStart, defaultEnd) {
  const mode = String(entry?.mode || "").toLowerCase();

  if (mode === "holiday" || mode === "bankholiday" || mode === "unpaid") return false;
  if (entry?.isTurnaround === true) return false;
  if (mode === "workshop") return false;

  if (mode === "off") return true;
  if (mode !== "yard") return false;

  return isDefaultYardTemplateForAutoMode(entry, defaultStart, defaultEnd);
}

function coerceEntryModeForAutoOpen(entry, targetMode, defaultStart, defaultEnd) {
  const next = { ...entry, mode: targetMode };

  if (targetMode === "travel") {
    // Assigned jobs must be completed by the user; do not carry yard autofill
    // times into a newly inferred travel day.
    next.leaveTime = null;
    next.arriveTime = null;
    next.arriveBack = null;
    next.callTime = null;
    next.wrapTime = null;
    next.precallDuration = null;
    next.overnight = false;
    next.nightShoot = false;
    next.generatorUsed = false;
    next.lateSup = false;
    next.mealSup = false;
    next.lunchSup = false;
    next.yardSegments = [];
    next.workshopJobs = [];
    next.yardTravelEnabled = false;
    next.yardTravelLeaveTime = null;
    next.yardTravelArriveTime = null;
    next.isTurnaround = false;
    next.turnaroundJob = null;
    next.travelLunchSup = false;
    next.travelPD = typeof next.travelPD === "boolean" ? next.travelPD : false;
    next.additionalTravelEnabled = false;
    next.additionalTravelStartTime = null;
    next.additionalTravelEndTime = null;
    next.additionalTravelJob = "";
  }

  if (targetMode === "onset") {
    // Assigned jobs must start blank so users consciously enter the actual
    // call-day times rather than submitting employee yard/office defaults.
    next.leaveTime = null;
    next.arriveBack = null;
    next.arriveTime = null;
    next.callTime = null;
    next.wrapTime = null;
    next.precallDuration = null;
    next.overnight = false;
    next.nightShoot = false;
    next.generatorUsed = false;
    next.lateSup = false;
    next.mealSup = typeof next.mealSup === "boolean" ? next.mealSup : false;
    next.lunchSup = false;
    next.yardSegments = [];
    next.workshopJobs = [];
    next.yardTravelEnabled = false;
    next.yardTravelLeaveTime = null;
    next.yardTravelArriveTime = null;
    next.isTurnaround = false;
    next.turnaroundJob = null;
    next.travelLunchSup = false;
    next.travelPD = false;
    next.additionalTravelEnabled = false;
    next.additionalTravelStartTime = null;
    next.additionalTravelEndTime = null;
    next.additionalTravelJob = "";
  }

  return ensureModeDefaults(next);
}

function applyAutoJobModesToDays(ts, jobsByDayMap, weekStartISO, defaultStart, defaultEnd) {
  const next = { ...ts, days: { ...ts.days } };
  const start = toDateSafe(weekStartISO);
  if (!start) return annotateTimesheetMidnight(next);

  const isoByDay = {};
  for (let i = 0; i < DAYS.length; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    d.setHours(0, 0, 0, 0);
    isoByDay[DAYS[i]] = iso(d);
  }

  for (const day of DAYS) {
    const jobs = jobsByDayMap?.[day] || [];
    const dateISO = isoByDay[day];

    if (!jobs.length || !dateISO) continue;

    const inferredMode = inferDayModeFromAssignedJobs(jobs, dateISO);
    if (!inferredMode) continue;

    const entry = { ...(next.days[day] || {}) };
    if (!shouldAutoApplyJobMode(entry, defaultStart, defaultEnd)) continue;

    next.days[day] = coerceEntryModeForAutoOpen(entry, inferredMode, defaultStart, defaultEnd);
  }

  return annotateTimesheetMidnight(next);
}

function collapseConsecutiveDatesToCredits(dateList = []) {
  const sortedAsc = Array.from(new Set(dateList.filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b))
  );
  if (sortedAsc.length === 0) return [];

  const creditRoots = [];
  let prev = null;
  for (const d of sortedAsc) {
    if (!prev) {
      creditRoots.push(d);
      prev = d;
      continue;
    }
    const expectedNext = addDaysISO(prev, 1);
    if (d !== expectedNext) creditRoots.push(d);
    prev = d;
  }
  return creditRoots;
}

function getDateISOForDayName(weekStartISO, dayName, fallbackDateISO = "") {
  const idx = DAYS.indexOf(dayName);
  if (idx >= 0 && weekStartISO) return addDaysISO(weekStartISO, idx);
  if (typeof fallbackDateISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDateISO)) {
    return fallbackDateISO;
  }
  return "";
}

function doesOnsetEntryEarnTurnaroundCredit(entry) {
  const e = ensureModeDefaults(entry || {});
  if (String(e.mode || "").toLowerCase() !== "onset") return false;

  const baseTime = firstValidTime(e.leaveTime, e.arriveTime, e.callTime);
  const wrapOffset = timeFieldOffset(baseTime, e.wrapTime || null);

  if ((wrapOffset?.dayOffset ?? 0) === 1) return true;

  // Fallback for older rows where wrap time may be missing but the day was already marked as crossing midnight.
  return !e.wrapTime && boolish(e.crossesMidnight);
}

function collectOnsetTurnaroundCreditDates(timesheetDoc, allowedDates = null, weekStartOverride = "") {
  const days = timesheetDoc?.days || {};
  const weekStartISO = weekStartOverride || timesheetDoc?.weekStart || timesheetDoc?.weekISO || "";
  const out = [];

  for (const dayName of DAYS) {
    const entry = days?.[dayName];
    if (!doesOnsetEntryEarnTurnaroundCredit(entry)) continue;

    const dateISO = getDateISOForDayName(weekStartISO, dayName, entry?.dateISO || "");
    if (!dateISO) continue;
    if (allowedDates && !allowedDates.has(dateISO)) continue;

    out.push(dateISO);
  }

  return out;
}

function countTurnaroundUses(timesheetDoc) {
  const days = timesheetDoc?.days || {};
  let used = 0;

  for (const dayName of DAYS) {
    const entry = days?.[dayName] || {};
    const mode = String(entry.mode || "yard").toLowerCase();
    if (mode === "yard" && boolish(entry.isTurnaround)) {
      used += 1;
    }
  }

  return used;
}

function turnaroundCreditSourceKey(source) {
  const bookingId = String(source?.bookingId || "").trim();
  const dateISO = String(source?.dateISO || "").slice(0, 10);
  return bookingId && dateISO ? `${bookingId}:${dateISO}` : "";
}

function collectUsedTurnaroundCreditSourceKeys(timesheetDoc) {
  const keys = [];
  for (const dayName of DAYS) {
    const entry = timesheetDoc?.days?.[dayName] || {};
    if (!boolish(entry.isTurnaround)) continue;
    const key = turnaroundCreditSourceKey(entry.turnaroundJob);
    if (key) keys.push(key);
  }
  return keys;
}

/* -------------------------- Time dropdown -------------------------- */
const TIME_OPTION_ROW_HEIGHT = 42;

function buildExtendedTimeOptions(options) {
  return [0, 1].flatMap((dayOffset) =>
    options.map((time) => ({ time, dayOffset }))
  );
}

function isTimeOnNextDay(time, anchor) {
  const timeMinutes = timeToMinutes(time);
  const anchorMinutes = timeToMinutes(anchor);
  return timeMinutes != null && anchorMinutes != null && timeMinutes < anchorMinutes;
}

function TimeDropdown({ label, value, onSelect, options, disabled, startFrom = "", compact = false, stacked = false }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const openingTime = value || startFrom;
  const extendedOptions = useMemo(() => buildExtendedTimeOptions(options), [options]);
  const baseOpeningIndex = Math.max(0, options.indexOf(openingTime));
  const selectedDayOffset = value && isTimeOnNextDay(value, startFrom) ? 1 : 0;
  const openingIndex = baseOpeningIndex + (value ? selectedDayOffset * options.length : 0);
  const selectedIndex = value
    ? Math.max(0, options.indexOf(value)) + selectedDayOffset * options.length
    : -1;

  return (
    <View style={[styles.timeDropdownWrap, compact && styles.timelineTimeField, stacked && styles.timelineStackTimeField]}>
      <Text style={[styles.label, { color: colors.textMuted }, compact && styles.timelineInlineLabel]}>{label}</Text>
      <TouchableOpacity
        style={[
          styles.dropdownBox,
          compact && styles.timelineInlineDropdown,
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
          {value ? formatTimeWithPeriod(value) : "Select time"}
        </Text>
      </TouchableOpacity>

      <AppModal
        visible={open}
        title={`Select ${label}`}
        onRequestClose={() => setOpen(false)}
        actions={
          <>
            <AppButton label="Clear time" variant="ghost" onPress={() => { onSelect(""); setOpen(false); }} />
            <AppButton label="Close" variant="secondary" onPress={() => setOpen(false)} />
          </>
        }
      >
            <View style={styles.timePickerHeading}>
              <Icon name="clock" size={15} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: t.typography.caption.fontSize }}>Continues past midnight into the next day</Text>
            </View>
            <FlatList
              key={`time-options-${openingTime}-${open}`}
              data={extendedOptions}
              initialScrollIndex={openingIndex}
              getItemLayout={(_, index) => ({
                length: TIME_OPTION_ROW_HEIGHT,
                offset: TIME_OPTION_ROW_HEIGHT * index,
                index,
              })}
              keyExtractor={(item) => `${item.time}-${item.dayOffset}`}
              renderItem={({ item, index }) => {
                const isSelected = index === selectedIndex;
                return (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    { borderBottomColor: colors.border },
                    isSelected && { backgroundColor: colors.accentSoft, borderBottomColor: colors.accent },
                  ]}
                  onPress={() => {
                    onSelect(item.time);
                    setOpen(false);
                  }}
                >
                  <Text style={{ color: isSelected ? colors.accent : colors.text, fontWeight: isSelected ? "800" : "400" }}>
                    {formatTimeWithPeriod(item.time)}{item.dayOffset ? " · next day" : ""}
                  </Text>
                  {isSelected ? (
                    <View style={styles.modalSelectedIcon}>
                      <Icon name="check" size={15} color={colors.accent} />
                    </View>
                  ) : null}
                </TouchableOpacity>
                );
              }}
            />

      </AppModal>
    </View>
  );
}

function formatTimelineDuration(totalMins) {
  const mins = Math.max(0, Math.round(totalMins || 0));
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  const hourText = hours > 0 ? `${hours}hr${hours === 1 ? "" : "s"}` : "";
  const minuteText = minutes > 0 || hours === 0 ? `${minutes}min${minutes === 1 ? "" : "s"}` : "";
  return [hourText, minuteText].filter(Boolean).join(" ");
}

function formatTimelineDurationShort(totalMins) {
  const mins = Math.max(0, Math.round(totalMins || 0));
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return [hours > 0 ? `${hours}h` : "", minutes > 0 || hours === 0 ? `${minutes}m` : ""]
    .filter(Boolean)
    .join(" ");
}

function TimeGapLabel({
  start,
  end,
  label,
  invalid = false,
  maxElapsedMinutes = null,
  paidCapMinutes = null,
  overtimeAfterMinutes = null,
  minimumOvertimeMinutes = 0,
  includedWithinStandardMinutes = null,
  shortDuration = true,
  fillSpace = false,
  splitSpace = false,
}) {
  const { colors, colorScheme } = useTheme();
  const hasTimes = timeToMinutes(start) != null && timeToMinutes(end) != null;
  const elapsedMinutes = hasTimes ? durationMinutes(start, end) : 0;
  const isInvalid = invalid || (hasTimes && maxElapsedMinutes != null && elapsedMinutes > maxElapsedMinutes);
  const formatDuration = shortDuration ? formatTimelineDurationShort : formatTimelineDuration;
  const duration = hasTimes ? formatDuration(elapsedMinutes) : "";
  const paidMinutes = paidCapMinutes == null ? null : Math.min(elapsedMinutes, paidCapMinutes);
  const thresholdOvertimeMinutes = (
    overtimeAfterMinutes == null
      ? 0
      : Math.max(0, elapsedMinutes - overtimeAfterMinutes)
  );
  const overtimeMinutes = Math.max(thresholdOvertimeMinutes, minimumOvertimeMinutes);
  const standardMinutes = Math.max(0, elapsedMinutes - overtimeMinutes);
  const includedMinutes = includedWithinStandardMinutes == null
    ? null
    : Math.min(elapsedMinutes, Math.max(0, includedWithinStandardMinutes));
  const excessMinutes = includedMinutes == null ? 0 : Math.max(0, elapsedMinutes - includedMinutes);
  let displayText = `${duration} ${label}`;
  let accessibilityDetail = "";

  if (isInvalid) {
    displayText = "Check time order";
    accessibilityDetail = ", times are out of sequence";
  } else if (paidMinutes != null) {
    displayText = elapsedMinutes > paidMinutes
      ? `${formatTimelineDurationShort(paidMinutes)} Paid · ${formatTimelineDurationShort(elapsedMinutes)} early`
      : `${formatTimelineDurationShort(paidMinutes)} Paid early`;
    accessibilityDetail = `, ${formatTimelineDuration(paidMinutes)} paid`;
  } else if (overtimeMinutes > 0) {
    displayText = `${duration} ${label} · ${formatDuration(overtimeMinutes)} OT`;
    accessibilityDetail = `, ${formatTimelineDuration(overtimeMinutes)} overtime`;
  } else if (includedMinutes != null) {
    if (includedMinutes > 0 && excessMinutes > 0) {
      displayText = `${formatTimelineDurationShort(includedMinutes)} In 10h\n${formatTimelineDurationShort(excessMinutes)} ${label}`;
      accessibilityDetail = `, ${formatTimelineDuration(includedMinutes)} within the standard 10 hour day, ${formatTimelineDuration(excessMinutes)} ${label}`;
    } else if (includedMinutes > 0) {
      displayText = `${formatTimelineDurationShort(includedMinutes)}\nWithin 10h`;
      accessibilityDetail = ", all within the standard 10 hour day";
    }
  }

  if (fillSpace && paidMinutes == null) {
    displayText = overtimeMinutes > 0
      ? `${formatTimelineDurationShort(standardMinutes)} ${label}\n${formatTimelineDurationShort(overtimeMinutes)} OT`
      : `${formatTimelineDurationShort(standardMinutes)} ${label}`;
  }
  const accessibilityDuration = fillSpace
    ? formatTimelineDuration(standardMinutes)
    : duration;
  const isPaidTone = !isInvalid && paidMinutes != null;
  const isOvertimeTone = !isInvalid && overtimeMinutes > 0;
  const paidColor = colorScheme === "dark" ? staticColors.hex_7ed8a7_7b4jpa : staticColors.hex_188a52_aeth0x;
  const paidBackground = colorScheme === "dark" ? staticColors.hex_163126_a54xzb : staticColors.hex_e9f6ee_5qezd6;
  const pillBackground = isInvalid
    ? colors.accentSoft
    : isOvertimeTone
    ? colors.accentSoft
    : isPaidTone
      ? paidBackground
      : colors.surfaceAlt;
  const pillBorder = isInvalid
    ? colors.accent
    : isOvertimeTone
    ? colors.accent
    : isPaidTone
      ? paidColor
      : colors.border;
  const iconColor = isInvalid
    ? colors.accent
    : isOvertimeTone
    ? colors.accent
    : isPaidTone
      ? paidColor
      : colors.textMuted;

  // Do not reserve an empty calculation column before both times exist.
  // The selector then uses the full row and contracts only when there is a
  // useful duration to display beside it.
  if (!hasTimes) return null;

  return (
    <View
      style={[styles.timeGapRow, (fillSpace || splitSpace) && styles.timeGapFill]}
      accessibilityLabel={`${accessibilityDuration} ${label}${accessibilityDetail}`}
    >
      <View
        style={[
          styles.timeGapPill,
          fillSpace && styles.timeGapPillFill,
          splitSpace && styles.timeGapPillSplit,
          { backgroundColor: pillBackground, borderColor: pillBorder },
        ]}
      >
        <Icon name={isInvalid ? "alert-triangle" : "clock"} size={fillSpace ? 16 : 11} color={iconColor} />
        <Text
          numberOfLines={fillSpace || splitSpace ? 2 : 1}
          adjustsFontSizeToFit
          style={[
            styles.timeGapText,
            fillSpace && styles.timeGapTextFill,
            splitSpace && styles.timeGapTextSplit,
            { color: isInvalid ? colors.accent : colors.text },
          ]}
        >
          {displayText}
        </Text>
      </View>
    </View>
  );
}

function PrecallDropdown({ value, onSelect, disabled, startFrom = "", compact = false, invalidSequence = false }) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const openingTime = value || startFrom;
  const extendedOptions = useMemo(() => buildExtendedTimeOptions(TIME_OPTIONS), []);
  const selectedDayOffset = value && !invalidSequence && isTimeOnNextDay(value, startFrom) ? 1 : 0;
  const baseOpeningIndex = Math.max(0, TIME_OPTIONS.indexOf(openingTime));
  const openingIndex = baseOpeningIndex + (value ? selectedDayOffset * TIME_OPTIONS.length : 0);
  const selectedIndex = value
    ? Math.max(0, TIME_OPTIONS.indexOf(value)) + selectedDayOffset * TIME_OPTIONS.length
    : -1;

  return (
    <View style={[styles.precallDropdownWrap, compact && styles.timelineTimeField]}>
      <Text style={[styles.label, { color: colors.textMuted }, compact && styles.timelineInlineLabel]}>
        {compact ? "Pre-Call" : "Pre-Call Time (optional)"}
      </Text>

      <TouchableOpacity
        style={[
          styles.dropdownBox,
          compact && styles.timelineInlineDropdown,
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
          {value ? formatTimeWithPeriod(value) : "Add pre-call time"}
        </Text>
      </TouchableOpacity>

      <AppModal
        visible={open}
        title="Select Pre-Call Time"
        onRequestClose={() => setOpen(false)}
        actions={
          <>
            <AppButton label="Clear pre-call" variant="ghost" onPress={() => { onSelect(null); setOpen(false); }} />
            <AppButton label="Close" variant="secondary" onPress={() => setOpen(false)} />
          </>
        }
      >
            <View style={styles.timePickerHeading}>
              <Icon name="clock" size={15} color={colors.textMuted} />
              <Text style={{ color: invalidSequence ? colors.accent : colors.textMuted, fontSize: t.typography.caption.fontSize }}>
                {invalidSequence ? "Selected time is out of sequence" : "Continues past midnight into the next day"}
              </Text>
            </View>
            <FlatList
              key={`precall-time-options-${openingTime}-${open}`}
              data={extendedOptions}
              initialScrollIndex={openingIndex}
              getItemLayout={(_, index) => ({
                length: TIME_OPTION_ROW_HEIGHT,
                offset: TIME_OPTION_ROW_HEIGHT * index,
                index,
              })}
              keyExtractor={(item) => `${item.time}-${item.dayOffset}`}
              renderItem={({ item, index }) => {
                const isSelected = index === selectedIndex;
                return (
                <TouchableOpacity
                  style={[
                    styles.modalItem,
                    { borderBottomColor: colors.border },
                    isSelected && { backgroundColor: colors.accentSoft, borderBottomColor: colors.accent },
                  ]}
                  onPress={() => {
                    onSelect(item.time);
                    setOpen(false);
                  }}
                >
                  <Text style={{ color: isSelected ? colors.accent : colors.text, fontWeight: isSelected ? "800" : "400" }}>
                    {formatTimeWithPeriod(item.time)}{item.dayOffset ? " · next day" : ""}
                  </Text>
                  {isSelected ? (
                    <View style={styles.modalSelectedIcon}>
                      <Icon name="check" size={15} color={colors.accent} />
                    </View>
                  ) : null}
                </TouchableOpacity>
                );
              }}
            />

      </AppModal>
    </View>
  );
}

/* -------------------------- Toggle row with info -------------------------- */
function InfoToggleRow({
  label,
  value,
  onChange,
  disabled,
  infoTitle,
  infoText,
  statusText,
  statusColor,
  compact = false,
}) {
  const { colors } = useTheme();

  const showInfo = () => {
    Alert.alert(infoTitle || label, infoText || "No info available.");
  };

  return (
    <View style={[styles.toggleRow, compact && styles.toggleRowCompact]}>
      <View style={styles.toggleTextWrap}>
        <View style={[styles.toggleLabelRow, compact && styles.toggleLabelRowCompact]}>
          <Text
            style={[
              styles.label,
              { color: colors.text, marginBottom: t.spacing.none },
              compact && styles.labelCompact,
            ]}
            numberOfLines={compact ? 1 : undefined}
          >
            {label}
          </Text>
          {!!statusText && (
            <Text
              style={[
                styles.toggleStatusText,
                { color: statusColor || colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {statusText}
            </Text>
          )}
          <IconButton
            icon="info"
            size={compact ? 12 : 14}
            variant="ghost"
            compact={compact}
            label={`About ${label}`}
            hint={infoText}
            onPress={showInfo}
            disabled={disabled}
          />
        </View>
      </View>

      <Switch
        value={!!value}
        onValueChange={onChange}
        disabled={disabled}
        style={compact ? styles.switchCompact : undefined}
      />
    </View>
  );
}

/* -------------------------- Turnaround job picker -------------------------- */
function TurnaroundJobPicker({ visible, onClose, jobs, onPick }) {
  const { colors } = useTheme();

  return (
    <AppModal
      visible={visible}
      title="Select unused Turnaround credit"
      onRequestClose={onClose}
      actions={<AppButton label="Close" variant="secondary" onPress={onClose} />}
    >

          {!jobs || jobs.length === 0 ? (
            <View style={{ paddingVertical: t.spacing.xs }}>
              <Text style={{ color: colors.textMuted }}>
                No eligible jobs found in the last 3 weeks.
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
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "800" }}>
                    {item.jobNumber || item.bookingId} — {getProductionDisplayName(item)}
                  </Text>
                  {!!(item.location || item.dateISO) && (
                    <Text style={{ color: colors.textMuted, marginTop: t.spacing.none, fontSize: t.typography.metadata.fontSize }}>
                      {item.location || ""}
                      {item.location && item.dateISO ? " • " : ""}
                      {item.dateISO ? formatDateDDMMYYYY(item.dateISO) || item.dateISO : ""}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
            />
          )}

    </AppModal>
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

function hasValidPrecallSequence(entry) {
  if (!entry?.precallDuration || !entry?.callTime) return false;
  const precallToUnitMinutes = durationMinutes(entry.precallDuration, entry.callTime);
  if (precallToUnitMinutes > MAX_REASONABLE_PRECALL_WINDOW_MINUTES) return false;

  if (entry.arriveTime) {
    const viaPrecallMinutes = durationMinutes(entry.arriveTime, entry.precallDuration) + precallToUnitMinutes;
    const directToUnitMinutes = durationMinutes(entry.arriveTime, entry.callTime);
    if (viaPrecallMinutes !== directToUnitMinutes) return false;
  }

  return true;
}

function formatHoursMins(totalMins) {
  const mins = Math.max(0, Math.round(totalMins || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function computeDayBreakdown(entry, day = null) {
  return computeTimesheetDayBreakdown(ensureModeDefaults(entry || { mode: "off" }), day);
}

function computeDayMinutes(entry, day = null) {
  return computeDayBreakdown(entry, day).total;
}

function computeOnSetEarlyCallOvertimeMinutes(entry) {
  const e = ensureModeDefaults(entry || { mode: "off" });
  if (String(e.mode || "off").toLowerCase() !== "onset") return 0;
  if (!e.callTime || !e.wrapTime) return 0;

  const callMinutes = timeToMinutes(e.callTime);
  if (callMinutes == null || callMinutes >= ON_SET_EARLY_CALL_CUTOFF_MINUTES) return 0;

  const minutesUntilSeven = ON_SET_EARLY_CALL_CUTOFF_MINUTES - callMinutes;
  return Math.min(durationMinutes(e.callTime, e.wrapTime), minutesUntilSeven);
}

function computeReturnTravelWithinStandardMinutes(entry) {
  const e = ensureModeDefaults(entry || { mode: "off" });
  if (!e.callTime || !e.wrapTime || !e.arriveBack) return 0;

  const onSetMinutes = durationMinutes(e.callTime, e.wrapTime);
  const travelMinutes = durationMinutes(e.wrapTime, e.arriveBack);
  const remainingStandardMinutes = Math.max(0, ON_SET_STANDARD_DAY_MINUTES - onSetMinutes);
  return Math.min(travelMinutes, remainingStandardMinutes);
}

/* -------------------------- Summary panel -------------------------- */
function HoursSummary({ timesheet, holidaysByDay, bankHolidaysByDay }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    const byDayMinutes = {};
    const byDayLabels = {};
    let total = 0;

    let yardMins = 0;
    let yardWorkMins = 0;
    let yardTravelMins = 0;
    let breakDeductionMins = 0;
    let travelMins = 0;
    let travelActualMins = 0;
    let travelGuaranteeMins = 0;
    let onsetMins = 0;
    let outboundTravelMins = 0;
    let paidEarlyMins = 0;
    let precallMins = 0;
    let onsetStandardMins = 0;
    let onsetOvertimeMins = 0;
    let returnTravelMins = 0;
    let returnWithinStandardMins = 0;
    let returnAfterStandardMins = 0;
    let additionalJobTravelMins = 0;
    let workshopMins = 0;

    let yardDays = 0;
    let travelDays = 0;
    let onsetDays = 0;
    let workshopDays = 0;

    let offDays = 0;
    let unpaidDays = 0;
    let paidHolidayDays = 0;
    let unpaidHolidayDays = 0;
    let bankHolidayDays = 0;
    let halfHolidayDays = 0;

    let mealSupCount = 0;
    let pdCount = 0;
    let nightShootCount = 0;
    let overnightCount = 0;
    let generatorCount = 0;
    let lateSupCount = 0;
    let turnaroundCount = 0;

    for (const day of DAYS) {
      const hol = holidaysByDay?.[day];
      const bh = bankHolidaysByDay?.[day];

      const isHoliday = !!hol;
      const isHalfHoliday = !!hol?.isHalfDay;
      const isFullHoliday = isHoliday && !isHalfHoliday;
      const isBankHolidayOff = !!bh && bh.notWorking === true;

      if (isFullHoliday) {
        if (hol?.isUnpaid || hol?.leaveType === "Unpaid") unpaidHolidayDays += 1;
        else paidHolidayDays += 1;
      }
      if (isHalfHoliday) halfHolidayDays += 1;
      if (!isHoliday && isBankHolidayOff) bankHolidayDays += 1;

      const raw = timesheet?.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard" };
      const e = ensureModeDefaults(raw);

      const mode = String(e.mode || "off").toLowerCase();
      const bankHolidayWorked = isBankHolidayOff && boolish(e.bankHolidayWorked);
      const nonWorkingLeave = isFullHoliday || (isBankHolidayOff && !bankHolidayWorked);

      // count "off" only when it is actually off (and not a holiday/bank holiday lock)
      if (mode === "off") offDays += 1;
      if (mode === "unpaid") unpaidDays += 1;

      const breakdown = nonWorkingLeave
        ? computeDayBreakdown({ mode: "off" }, day)
        : computeDayBreakdown(e, day);
      const mins = breakdown.total;
      const isTurnaroundDay = breakdown.mode === "turnaround";

      byDayMinutes[day] = mins;
      byDayLabels[day] = isFullHoliday
        ? hol?.isUnpaid || hol?.leaveType === "Unpaid"
          ? "Unpaid holiday"
          : "Paid holiday"
        : isBankHolidayOff && !bankHolidayWorked
        ? "Bank holiday"
        : mode === "unpaid"
        ? "Unpaid"
        : mode === "off"
        ? "Off"
        : isHalfHoliday
        ? `${formatHoursMins(mins)} + half holiday`
        : formatHoursMins(mins);
      total += mins;

      if (mode === "yard" && !nonWorkingLeave && !isTurnaroundDay) {
        if (mins > 0) yardDays += 1;
        yardMins += mins;
        yardWorkMins += breakdown.yardWork;
        yardTravelMins += breakdown.yardTravel;
        breakDeductionMins += breakdown.breakDeduction;
        if (boolish(e.overnight)) overnightCount += 1;
      }
      if (mode === "travel" && !nonWorkingLeave) {
        if (mins > 0) travelDays += 1;
        travelMins += mins;
        travelActualMins += breakdown.travelDay;
        travelGuaranteeMins += breakdown.travelGuarantee;
        if (!!e.travelPD) pdCount += 1;
        if (boolish(e.overnight)) overnightCount += 1;
      }
      if ((mode === "onset" || isTurnaroundDay) && !nonWorkingLeave) {
        if (mins > 0) onsetDays += 1;
        onsetMins += mins;
        outboundTravelMins += breakdown.outboundTravel;
        paidEarlyMins += breakdown.paidEarly;
        precallMins += breakdown.precall;
        onsetStandardMins += breakdown.onSetStandard;
        onsetOvertimeMins += breakdown.onSetOvertime;
        returnTravelMins += breakdown.returnTravel;
        returnWithinStandardMins += breakdown.returnWithinStandard;
        returnAfterStandardMins += breakdown.returnAfterStandard;
        additionalJobTravelMins += breakdown.additionalJobTravel;
        if (isTurnaroundDay) {
          turnaroundCount += 1;
        } else {
          if (!!e.mealSup) mealSupCount += 1;
          if (!!e.nightShoot) nightShootCount += 1;
          if (!!e.generatorUsed) generatorCount += 1;
          if (!!e.lateSup) lateSupCount += 1;
          if (boolish(e.overnight)) overnightCount += 1;
        }
      }
      if (mode === "workshop" && !nonWorkingLeave) {
        if (mins > 0) workshopDays += 1;
        workshopMins += mins;
      }
    }

    return {
      byDayMinutes,
      byDayLabels,
      total,
      yardMins,
      yardWorkMins,
      yardTravelMins,
      breakDeductionMins,
      travelMins,
      travelActualMins,
      travelGuaranteeMins,
      onsetMins,
      outboundTravelMins,
      paidEarlyMins,
      precallMins,
      onsetStandardMins,
      onsetOvertimeMins,
      returnTravelMins,
      returnWithinStandardMins,
      returnAfterStandardMins,
      additionalJobTravelMins,
      workshopMins,
      yardDays,
      travelDays,
      onsetDays,
      workshopDays,
      offDays,
      unpaidDays,
      paidHolidayDays,
      unpaidHolidayDays,
      bankHolidayDays,
      halfHolidayDays,
      mealSupCount,
      pdCount,
      nightShootCount,
      overnightCount,
      generatorCount,
      lateSupCount,
      turnaroundCount,
    };
  }, [timesheet, holidaysByDay, bankHolidaysByDay]);

  return (
    <View style={[styles.summaryBox, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.summaryHeader}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((v) => !v);
        }}
        accessibilityRole="button"
        accessibilityLabel="Toggle week summary details"
      >
        <View>
          <Text style={{ color: colors.text, fontWeight: "900", marginBottom: t.spacing.none }}>Week Summary</Text>
          <Text style={{ color: colors.textMuted, fontSize: t.typography.metadata.fontSize }}>
            Paid total {formatHoursMins(summary.total)}
            {summary.onsetOvertimeMins > 0 ? ` · ${formatHoursMins(summary.onsetOvertimeMins)} OT` : ""}
          </Text>
        </View>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
      </TouchableOpacity>

      {open && (
        <>
          <View style={styles.summaryDivider} />

          {summary.yardDays > 0 && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Yard paid total</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {formatHoursMins(summary.yardMins)} ({summary.yardDays} day{summary.yardDays === 1 ? "" : "s"})
              </Text>
            </View>
          )}

          {summary.travelDays > 0 && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Travel days</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {formatHoursMins(summary.travelMins)} ({summary.travelDays} day{summary.travelDays === 1 ? "" : "s"})
              </Text>
            </View>
          )}

          {summary.onsetDays > 0 && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>On-set days</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {formatHoursMins(summary.onsetMins)} paid ({summary.onsetDays} day{summary.onsetDays === 1 ? "" : "s"})
              </Text>
            </View>
          )}

          {summary.workshopDays > 0 && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Workshop</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                {formatHoursMins(summary.workshopMins)} ({summary.workshopDays} day{summary.workshopDays === 1 ? "" : "s"})
              </Text>
            </View>
          )}

          {summary.travelDays > 0 && (
            <>
              <View style={styles.summaryDivider} />
              <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none, marginBottom: t.spacing.xxs }}>
                Travel-day pay breakdown
              </Text>

              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Actual travel</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.travelActualMins)}</Text>
              </View>
              {summary.travelGuaranteeMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>10h minimum adjustment</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>
                    +{formatHoursMins(summary.travelGuaranteeMins)}
                  </Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.text }]}>Travel paid total</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.travelMins)}</Text>
              </View>
            </>
          )}

          {summary.onsetDays > 0 && (
            <>
              <View style={styles.summaryDivider} />
              <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none, marginBottom: t.spacing.xxs }}>
                On-set pay breakdown
              </Text>

              {summary.outboundTravelMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Travel to set</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.outboundTravelMins)}</Text>
                </View>
              )}
              {summary.paidEarlyMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Paid early</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.paidEarlyMins)}</Text>
                </View>
              )}
              {summary.precallMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Pre-call</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.precallMins)}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>On set (standard)</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.onsetStandardMins)}</Text>
              </View>
              {summary.onsetOvertimeMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>On set OT</Text>
                  <Text style={[styles.summaryValue, { color: colors.accent }]}>{formatHoursMins(summary.onsetOvertimeMins)}</Text>
                </View>
              )}
              {summary.returnTravelMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Travel back</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.returnTravelMins)}</Text>
                </View>
              )}
              {summary.returnWithinStandardMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summarySubLabel, { color: colors.textMuted }]}>Within 10h</Text>
                  <Text style={[styles.summaryValue, { color: colors.textMuted }]}>{formatHoursMins(summary.returnWithinStandardMins)}</Text>
                </View>
              )}
              {summary.returnAfterStandardMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summarySubLabel, { color: colors.textMuted }]}>Travel after 10h</Text>
                  <Text style={[styles.summaryValue, { color: colors.textMuted }]}>{formatHoursMins(summary.returnAfterStandardMins)}</Text>
                </View>
              )}
              {summary.additionalJobTravelMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Travel to another job</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.additionalJobTravelMins)}</Text>
                </View>
              )}
            </>
          )}

          {summary.yardDays > 0 && (
            <>
              <View style={styles.summaryDivider} />
              <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none, marginBottom: t.spacing.xxs }}>
                Yard pay breakdown
              </Text>

              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Yard hours</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.yardWorkMins)}</Text>
              </View>
              {summary.yardTravelMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Paid travel</Text>
                  <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.yardTravelMins)}</Text>
                </View>
              )}
              {summary.breakDeductionMins > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Break deducted</Text>
                  <Text style={[styles.summaryValue, { color: colors.textMuted }]}>−{formatHoursMins(summary.breakDeductionMins)}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: colors.text }]}>Full Yard paid total</Text>
                <Text style={[styles.summaryValue, { color: colors.text }]}>{formatHoursMins(summary.yardMins)}</Text>
              </View>
            </>
          )}

          <View style={styles.summaryDivider} />

          <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none, marginBottom: t.spacing.xxs }}>
            Per-day hours
          </Text>

          {DAYS.map((d) => (
            <View key={d} style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>{d}</Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.byDayLabels[d]}</Text>
            </View>
          ))}

          {[
            ["Meal supplements", summary.mealSupCount],
            ["Travel meals", summary.pdCount],
            ["Night shoots", summary.nightShootCount],
            ["Overnights", summary.overnightCount],
            ["Generators used", summary.generatorCount],
            ["Late supplements", summary.lateSupCount],
            ["Turnarounds", summary.turnaroundCount],
          ].some(([, count]) => count > 0) && (
            <>
              <View style={styles.summaryDivider} />

              <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none, marginBottom: t.spacing.xxs }}>
                Supplements and flags
              </Text>

              {[
                ["Meal supplements", summary.mealSupCount],
                ["Travel meals", summary.pdCount],
                ["Night shoots", summary.nightShootCount],
                ["Overnights", summary.overnightCount],
                ["Generators used", summary.generatorCount],
                ["Late supplements", summary.lateSupCount],
                ["Turnarounds", summary.turnaroundCount],
              ]
                .filter(([, count]) => count > 0)
                .map(([label, count]) => (
                  <View key={label} style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>{label}</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{count}</Text>
                  </View>
                ))}
            </>
          )}

          {[
            ["Paid holidays", summary.paidHolidayDays],
            ["Unpaid holidays", summary.unpaidHolidayDays],
            ["Unpaid days", summary.unpaidDays],
            ["Half-holiday days", summary.halfHolidayDays],
            ["Bank holidays", summary.bankHolidayDays],
          ].some(([, count]) => count > 0) && (
            <>
              <View style={styles.summaryDivider} />

              <Text style={{ color: colors.textMuted, fontWeight: "800", fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none, marginBottom: t.spacing.xxs }}>
                Leave and holidays
              </Text>

              {[
                ["Paid holidays", summary.paidHolidayDays],
                ["Unpaid holidays", summary.unpaidHolidayDays],
                ["Unpaid days", summary.unpaidDays],
                ["Half-holiday days", summary.halfHolidayDays],
                ["Bank holidays", summary.bankHolidayDays],
              ]
                .filter(([, count]) => count > 0)
                .map(([label, count]) => (
                  <View key={label} style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>{label}</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{count}</Text>
                  </View>
                ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

export default function WeekTimesheet() {
  const { id } = useLocalSearchParams(); // weekStart ISO (YYYY-MM-DD)
  const router = useRouter();
  const navigation = useNavigation();
  const { employee, isAuthed, loading } = useAuth();
  const { invalidate } = useDataCache();
  const bookingsResource = useBookings();
  const holidaysResource = useHolidays();
  const vehiclesResource = useVehicles();
  const timesheetsResource = useEmployeeTimesheets();
  const { colors, colorScheme } = useTheme();
  const allowNavigationRef = useRef(false);
  const pendingNavigationActionRef = useRef(null);
  const softSuccess = colorScheme === "dark" ? staticColors.hex_7ed8a7_7b4jpa : staticColors.hex_188a52_aeth0x;
  const softSuccessBg = colorScheme === "dark" ? staticColors.hex_163126_a54xzb : staticColors.hex_e9f6ee_5qezd6;
  const softAmber = colorScheme === "dark" ? staticColors.hex_e0b15b_5ldxx3 : staticColors.hex_b87716_7l4p17;
  const softAmberBg = colorScheme === "dark" ? staticColors.hex_2d2414_6m7043 : staticColors.hex_fbf1de_59hr1w;
  const subtleChipBg = colorScheme === "dark" ? staticColors.hex_17181d_a32e58 : colors.surface;
  const addBlockButtonColors =
    colorScheme === "dark"
      ? { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textMuted }
      : { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textMuted };

  const officePresetStart = firstValidTime(
    employee?.officeStartTime,
    employee?.officeStart,
    employee?.timesheetDefaults?.officeStart,
    DEFAULT_OFFICE_START
  );
  const officePresetEnd = firstValidTime(
    employee?.officeEndTime,
    employee?.officeEnd,
    employee?.timesheetDefaults?.officeEnd,
    DEFAULT_OFFICE_END
  );
  const yardPresetStart = firstValidTime(
    employee?.yardStartTime,
    employee?.yardStart,
    employee?.timesheetDefaults?.yardStart,
    DEFAULT_YARD_START
  );
  const yardPresetEnd = firstValidTime(
    employee?.yardEndTime,
    employee?.yardEnd,
    employee?.timesheetDefaults?.yardEnd,
    DEFAULT_YARD_END
  );
  const autofillType = normaliseAutofillType(
    employee?.timesheetDefaults?.defaultType || employee?.timesheetDefaultType || "yard"
  );
  const yardDefaultStart =
    autofillType === "office"
      ? officePresetStart || DEFAULT_OFFICE_START
      : yardPresetStart || DEFAULT_YARD_START;
  const yardDefaultEnd =
    autofillType === "office"
      ? officePresetEnd || DEFAULT_OFFICE_END
      : yardPresetEnd || DEFAULT_YARD_END;

  const [timesheet, setTimesheet] = useState(() => ({
    employeeCode: "",
    weekStart: id,
    days: DAYS.reduce((acc, d) => {
      const isWeekend = WEEKEND_SET.has(d);
      acc[d] = isWeekend
        ? { mode: "off", dayNotes: "", isTurnaround: false, turnaroundJob: null }
        : autofillType === "workshop"
        ? {
            mode: "workshop",
            dayWorkType: "workshop",
            leaveTime: yardDefaultStart,
            arriveBack: yardDefaultEnd,
            dayNotes: "",
            yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd, note: "" }],
            workshopJobs: [{ jobNumber: "", hours: "", note: "" }],
            isTurnaround: false,
            turnaroundJob: null,
          }
        : {
            mode: "yard",
            dayWorkType: autofillType === "office" ? "office" : "yard",
            leaveTime: yardDefaultStart,
            arriveBack: yardDefaultEnd,
            dayNotes: "",
            precallDuration: null,
            yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd }],
            lunchSup: false,
            yardTravelEnabled: false,
            yardTravelLeaveTime: null,
            yardTravelArriveTime: null,
            isTurnaround: false,
            turnaroundJob: null,
          };
      return acc;
    }, {}),
    notes: "",
    submitted: false,
    status: null,
  }));

  const [jobsByDay, setJobsByDay] = useState(() => Object.fromEntries(DAYS.map((d) => [d, []])));
  const [holidaysByDay, setHolidaysByDay] = useState(() => Object.fromEntries(DAYS.map((d) => [d, null])));
  const [bankHolidayMap, setBankHolidayMap] = useState({});
  const [bankHolidaysByDay, setBankHolidaysByDay] = useState(() => Object.fromEntries(DAYS.map((d) => [d, null])));

  // Turnaround: eligibility + lookback job list
  const [, setTurnaroundEligible] = useState(false);
  const [turnaroundJobs, setTurnaroundJobs] = useState([]);
  const [turnaroundPickerOpen, setTurnaroundPickerOpen] = useState(false);
  const [turnaroundPickerDay, setTurnaroundPickerDay] = useState(null);
  const [turnaroundInfoOpen, setTurnaroundInfoOpen] = useState(false);
  const [dayTypePickerDay, setDayTypePickerDay] = useState(null);
  const [jobOverview, setJobOverview] = useState(null);
  const [togglePanelByDay, setTogglePanelByDay] = useState(() =>
    Object.fromEntries(DAYS.map((d) => [d, false]))
  );

  // Turnaround credits come from Night Shoot booking notes and on-set days that wrap past midnight.
  const [turnaroundCreditsTotal, setTurnaroundCreditsTotal] = useState(0);
  const [turnaroundCreditDates, setTurnaroundCreditDates] = useState([]); // ISO dates list for audit / display if you want
  const [turnaroundBookingCreditDates, setTurnaroundBookingCreditDates] = useState([]);
  const [turnaroundOnsetCreditDates, setTurnaroundOnsetCreditDates] = useState([]);
  const turnaroundCreditsConsumed = useMemo(() => {
    const recentWeekStarts = new Set(
      buildPreviousNDatesISO(id, TURNAROUND_LOOKBACK_DAYS)
        .map((dateISO) => mondayISO(dateISO))
        .filter(Boolean)
    );

    return timesheetsResource.data.reduce((total, savedTimesheet) => {
      const weekStart = savedTimesheet?.weekStart || savedTimesheet?.weekISO || "";
      if (!weekStart || weekStart === id || !recentWeekStarts.has(weekStart)) return total;
      return total + countTurnaroundUses(savedTimesheet);
    }, 0);
  }, [id, timesheetsResource.data]);
  const usedTurnaroundCreditSourceKeys = useMemo(() => {
    const recentWeekStarts = new Set(
      buildPreviousNDatesISO(id, TURNAROUND_LOOKBACK_DAYS)
        .map((dateISO) => mondayISO(dateISO))
        .filter(Boolean)
    );
    const keys = timesheetsResource.data.flatMap((savedTimesheet) => {
      const weekStart = savedTimesheet?.weekStart || savedTimesheet?.weekISO || "";
      if (!weekStart || weekStart === id || !recentWeekStarts.has(weekStart)) return [];
      return collectUsedTurnaroundCreditSourceKeys(savedTimesheet);
    });
    return new Set(keys);
  }, [id, timesheetsResource.data]);
  const [baselineSignature, setBaselineSignature] = useState(null);

  const weekDates = useMemo(() => {
    if (!id) return [];
    const start = toDateSafe(id);
    if (!start) return [];
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);
      arr.push(iso(d));
    }
    return arr;
  }, [id]);

  const currentSignature = useMemo(() => serialiseTimesheetForCompare(timesheet), [timesheet]);
  const hasUnsavedChanges = baselineSignature !== null && currentSignature !== baselineSignature;
  const currentWeekTimesheet = useMemo(
    () =>
      timesheetsResource.data.find((row) => {
        const weekKey = row.weekStart || row.weekISO || "";
        return weekKey === id || row.id === `${employee?.userCode || ""}_${id}`;
      }) || null,
    [employee?.userCode, id, timesheetsResource.data]
  );
  const refreshTimesheets = timesheetsResource.refresh;
  const upsertTimesheet = timesheetsResource.upsertTimesheet;
  const refreshBookings = bookingsResource.refresh;
  const refreshHolidays = holidaysResource.refresh;
  const refreshVehicles = vehiclesResource.refresh;
  const refreshWeekData = useCallback(
    () => Promise.all([refreshTimesheets(), refreshBookings(), refreshHolidays(), refreshVehicles()]),
    [refreshBookings, refreshHolidays, refreshTimesheets, refreshVehicles]
  );
  const formattedWeekStart = useMemo(() => formatDisplayDate(id), [id]);
  const dayTypeOptions = useMemo(
    () => [
      { value: "yard", label: "Yard Day" },
      { value: "office", label: "Office Day" },
      { value: "workshop", label: "Workshop Day" },
    ],
    []
  );

  const confirmDiscardChanges = useCallback(
    (onLeave, onSave) => {
      if (!hasUnsavedChanges) {
        onLeave?.();
        return;
      }

      Alert.alert(
        "Save changes?",
        "You have unsaved changes on this timesheet.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Save",
            onPress: () => {
              onSave?.();
            },
          },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              allowNavigationRef.current = true;
              onLeave?.();
            },
          },
        ]
      );
    },
    [hasUnsavedChanges]
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (allowNavigationRef.current || !hasUnsavedChanges) return;

      event.preventDefault();
      pendingNavigationActionRef.current = event.data.action;

      confirmDiscardChanges(
        () => {
          const pendingAction = pendingNavigationActionRef.current;
          pendingNavigationActionRef.current = null;
          if (pendingAction) navigation.dispatch(pendingAction);
        },
        () => {
          void saveTimesheet({
            exitAfterSave: false,
            onAfterSave: () => {
              const pendingAction = pendingNavigationActionRef.current;
              pendingNavigationActionRef.current = null;
              allowNavigationRef.current = true;
              if (pendingAction) navigation.dispatch(pendingAction);
            },
          });
        }
      );
    });

    return unsubscribe;
  }, [confirmDiscardChanges, hasUnsavedChanges, navigation, saveTimesheet]);

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
    if (timesheetsResource.isInitialLoading && !timesheetsResource.data.length) return;
    if (hasUnsavedChanges) return;

    (async () => {
      try {
        if (currentWeekTimesheet) {
          const data = currentWeekTimesheet;
          const patched = { ...data, days: { ...(data.days || {}) } };

          for (const d of DAYS) {
            const fallbackEntry = WEEKEND_SET.has(d)
              ? { mode: "off" }
              : {
                  mode: "yard",
                  dayWorkType: autofillType === "office" ? "office" : "yard",
                  leaveTime: yardDefaultStart,
                  arriveBack: yardDefaultEnd,
                  yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd }],
                };
            const ensured = ensureModeDefaults(patched.days[d] || fallbackEntry);
            if (!ensured.dayWorkType && String(ensured.mode || "").toLowerCase() === "workshop") {
              ensured.dayWorkType = "workshop";
            } else if (!ensured.dayWorkType && String(ensured.mode || "").toLowerCase() === "yard") {
              ensured.dayWorkType = autofillType === "office" ? "office" : "yard";
            }
            if (String(ensured.mode || "yard").toLowerCase() === "yard") {
              if (!ensured.leaveTime) ensured.leaveTime = yardDefaultStart;
              if (!ensured.arriveBack && !ensured.arriveTime) ensured.arriveBack = yardDefaultEnd;
              if (
                !ensured.isTurnaround &&
                (!Array.isArray(ensured.yardSegments) || ensured.yardSegments.length === 0)
              ) {
                ensured.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
              }
            }
            ensured.precallDuration = ensured.precallDuration ?? null;
            patched.days[d] = ensured;
          }

          setBaselineSignature(serialiseTimesheetForCompare(patched));
          setTimesheet(patched);
        } else {
          setTimesheet((prev) => {
            if (prev.employeeCode) {
              return { ...prev, employeeCode: employee.userCode || prev.employeeCode };
            }

            const defaults = DAYS.reduce((acc, d) => {
              const isWeekend = WEEKEND_SET.has(d);
              acc[d] = isWeekend
                ? { mode: "off", dayNotes: "", isTurnaround: false, turnaroundJob: null }
                : autofillType === "workshop"
                ? {
                    mode: "workshop",
                    dayWorkType: "workshop",
                    leaveTime: yardDefaultStart,
                    arriveBack: yardDefaultEnd,
                    dayNotes: "",
                    yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd, note: "" }],
                    workshopJobs: [{ jobNumber: "", hours: "", note: "" }],
                    isTurnaround: false,
                    turnaroundJob: null,
                  }
                : {
                    mode: "yard",
                    dayWorkType: autofillType === "office" ? "office" : "yard",
                    leaveTime: yardDefaultStart,
                    arriveBack: yardDefaultEnd,
                    dayNotes: "",
                    precallDuration: null,
                    yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd }],
                    lunchSup: false,
                    isTurnaround: false,
                    turnaroundJob: null,
                  };
              return acc;
            }, {});

            const next = {
              ...prev,
              employeeCode: employee.userCode || "",
              weekStart: id,
              days: defaults,
            };
            setBaselineSignature(serialiseTimesheetForCompare(next));
            return next;
          });
        }
      } catch (err) {
        console.error("Firestore load error:", err);
      }
    })();
  }, [
    autofillType,
    currentWeekTimesheet,
    employee,
    hasUnsavedChanges,
    id,
    isAuthed,
    loading,
    timesheetsResource.data.length,
    timesheetsResource.isInitialLoading,
    yardDefaultEnd,
    yardDefaultStart,
  ]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (allowNavigationRef.current || !hasUnsavedChanges) {
        allowNavigationRef.current = false;
        return;
      }

      event.preventDefault();
      confirmDiscardChanges(() => navigation.dispatch(event.data.action));
    });

    return unsubscribe;
  }, [confirmDiscardChanges, hasUnsavedChanges, navigation]);

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
        next.days[dayName] = buildNonWorkingDayEntry(existing, "holiday", {
          bankHolidayWorked: false,
        });
        return;
      }

      if (!isHoliday && isBankHolidayOff) {
        const existing = next.days[dayName] || {};
        if (shouldPreserveWorkedBankHoliday(existing, yardDefaultStart, yardDefaultEnd)) {
          const currentMode = String(existing.mode || "yard").toLowerCase();
          const preservedMode =
            currentMode === "holiday" || currentMode === "bankholiday" || currentMode === "off"
              ? "yard"
              : currentMode || "yard";

          const ensured = ensureModeDefaults({
            ...existing,
            mode: preservedMode,
            bankHolidayWorked: true,
            leaveTime: preservedMode === "yard" ? existing.leaveTime || yardDefaultStart : existing.leaveTime,
            arriveBack:
              preservedMode === "yard"
                ? existing.arriveBack || existing.arriveTime || yardDefaultEnd
                : existing.arriveBack,
          });

          if (String(ensured.mode || "yard").toLowerCase() === "yard") {
            if (!ensured.leaveTime) ensured.leaveTime = yardDefaultStart;
            if (!ensured.arriveBack && !ensured.arriveTime) ensured.arriveBack = yardDefaultEnd;
            if (
              !ensured.isTurnaround &&
              (!Array.isArray(ensured.yardSegments) || ensured.yardSegments.length === 0)
            ) {
              ensured.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
            }
          }

          next.days[dayName] = ensured;
          return;
        }

        next.days[dayName] = buildNonWorkingDayEntry(existing, "bankholiday", {
          bankHolidayWorked: false,
        });
        return;
      }

      if (isHoliday && isHalfHoliday) {
        const existing = next.days[dayName] || {};
        const currentMode = String(existing.mode || "yard").toLowerCase();
        const base = currentMode === "holiday" || currentMode === "bankholiday" ? { ...existing, mode: "yard" } : { ...existing };

        const ensured = ensureModeDefaults({
          ...base,
          mode: "yard",
          leaveTime: base.leaveTime || yardDefaultStart,
          arriveBack: base.arriveBack || yardDefaultEnd,
          lunchSup: false,
        });
        if (!ensured.leaveTime) ensured.leaveTime = yardDefaultStart;
        if (!ensured.arriveBack && !ensured.arriveTime) ensured.arriveBack = yardDefaultEnd;
        if (!ensured.isTurnaround && (!Array.isArray(ensured.yardSegments) || ensured.yardSegments.length === 0)) {
          ensured.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
        }

        next.days[dayName] = {
          ...ensured,
          halfHoliday: true,
          halfHolidayLabel: hol?.halfLabel || "Half day",
        };
        return;
      }

      const fallback = WEEKEND_SET.has(dayName)
        ? { mode: "off" }
        : {
            mode: "yard",
            leaveTime: yardDefaultStart,
            arriveBack: yardDefaultEnd,
            yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd }],
          };
      const ensured = ensureModeDefaults(next.days[dayName] || fallback);
      if (String(ensured.mode || "yard").toLowerCase() === "yard") {
        if (!ensured.leaveTime) ensured.leaveTime = yardDefaultStart;
        if (!ensured.arriveBack && !ensured.arriveTime) ensured.arriveBack = yardDefaultEnd;
        if (!ensured.isTurnaround && (!Array.isArray(ensured.yardSegments) || ensured.yardSegments.length === 0)) {
          ensured.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
        }
      }
      next.days[dayName] = ensured;
    });

    return next;
  }, [yardDefaultStart, yardDefaultEnd]);

  useEffect(() => {
    if (loading || !isAuthed || !employee?.userCode || !id) return;

    (async () => {
      try {
        const allEmployees = bookingsResource.employees;

        const nameToCode = {};
        allEmployees.forEach((emp) => {
          const nm = String(emp.name || emp.fullName || "").trim().toLowerCase();
          const code = String(emp.userCode || "").trim();
          if (nm && code) nameToCode[nm] = code;
        });

        const allJobs = bookingsResource.data.filter((job) =>
          getBookingDates(job).some((date) => weekDates.includes(date))
        );

        const allHolsRaw = holidaysResource.data;

        const myCodeRaw = String(employee.userCode || "").trim();
        const myName = String(employee.displayName || employee.name || "").trim().toLowerCase();

        const allHols = allHolsRaw
          .filter((h) => {
            const status = String(h.status || h.Status || "").toLowerCase();
            if (h.deleted === true || h.isDeleted === true || status === "deleted") return false;
            if (status && !status.startsWith("approved") && !status.startsWith("accept")) return false;

            const hCode = String(h.employeeCode || h.userCode || "").trim();
            const hName = String(h.employee || h.name || "").trim().toLowerCase();

            return (hCode && myCodeRaw && hCode === myCodeRaw) || (hName && myName && hName === myName);
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

        const myCode = canonicalEmployeeCode(employee.userCode);

        allJobs.forEach((job) => {
          if (!isCrewedBooking(job)) return;
          const bookingDates = getBookingDates(job);

          bookingDates.forEach((date) => {
            if (!weekDates.includes(date)) return;

            const isAssignedForThisDate = isEmployeeAssignedToBookingDate(
              job,
              date,
              myCode,
              nameToCode
            );

            if (!isAssignedForThisDate) return;

            const dayName = getDayName(date);
            jobMap[dayName].push(job);
          });
        });

        DAYS.forEach((dayName, index) => {
          jobMap[dayName] = collapseLinkedJobsForDay(jobMap[dayName], weekDates[index]);
        });

        allHols.forEach((hol) => {
          const start = toDateSafe(hol.startDate || hol.from);
          const end = toDateSafe(hol.endDate || hol.to) || start;
          if (!start) return;

          const paidStatus = hol.paidStatus || hol.leaveType || "Paid";
          const leaveType = hol.leaveType || hol.paidStatus || "Paid";

          const isUnpaid = hol.isUnpaid ?? (String(paidStatus) === "Unpaid" || String(leaveType) === "Unpaid");
          const isAccrued = hol.isAccrued ?? (String(paidStatus) === "Accrued" || String(leaveType) === "Accrued");

          const half = getHalfMeta(hol);

          const s = new Date(start);
          s.setHours(0, 0, 0, 0);

          const e = new Date(end);
          e.setHours(0, 0, 0, 0);

          while (s <= e) {
            const dateStr = iso(s);
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

        setTimesheet((prev) => {
          const locked = applyDayLocks(prev, holMap, bankHolidaysByDay);
          const next = hasUnsavedChanges
            ? locked
            : applyAutoJobModesToDays(
                locked,
                jobMap,
                id,
                yardDefaultStart,
                yardDefaultEnd
              );
          if (!hasUnsavedChanges) setBaselineSignature(serialiseTimesheetForCompare(next));
          return next;
        });
      } catch (err) {
        console.error("Error fetching jobs/holidays:", err);
      }
    })();
  }, [
    bookingsResource.data,
    bookingsResource.employees,
    holidaysResource.data,
    loading,
    isAuthed,
    employee?.userCode,
    employee?.displayName,
    employee?.name,
    id,
    weekDates,
    bankHolidaysByDay,
    hasUnsavedChanges,
    applyDayLocks,
    yardDefaultStart,
    yardDefaultEnd,
  ]);

  // ───────────────────────── Turnaround eligibility + lookback job list ─────────────────────────
  // Credits are earned in the three completed weeks before this timesheet from:
  // 1) booking day-notes that contain "Night Shoot"
  // 2) on-set days that wrap past midnight
  // Consecutive eligible dates collapse into a single credit streak.
  useEffect(() => {
    if (loading || !isAuthed || !employee?.userCode) return;

    (async () => {
      try {
        const myCode = canonicalEmployeeCode(employee.userCode);
        if (!myCode) return;

        const todayISO = iso(startOfDay(new Date()));
        const elapsedCurrentWeekDates = weekDates.filter(
          (dateISO) => dateISO && dateISO <= todayISO
        );
        const lastDates = Array.from(new Set([
          ...buildPreviousNDatesISO(id, TURNAROUND_LOOKBACK_DAYS),
          ...elapsedCurrentWeekDates,
        ]));
        const lastSet = new Set(lastDates);
        const allJobs = bookingsResource.data.filter((job) =>
          getBookingDates(job).some((date) => lastSet.has(date))
        );

        const allEmployees = bookingsResource.employees;

        const nameToCode = {};
        allEmployees.forEach((emp) => {
          const nm = String(emp.name || emp.fullName || "").trim().toLowerCase();
          const code = String(emp.userCode || "").trim();
          if (nm && code) nameToCode[nm] = code;
        });

        const nightShootWorkedDates = new Set();
        const out = [];
        const seen = new Set();

        allJobs.forEach((job) => {
          if (!isCrewedBooking(job)) return;
          const bookingDates = getBookingDates(job);

          let pickedDateISO = null;

          for (const dateISO of bookingDates) {
            if (!lastSet.has(dateISO)) continue;

            const assigned = isEmployeeAssignedToBookingDate(
              job,
              dateISO,
              myCode,
              nameToCode
            );

            if (!assigned) continue;

            if (!pickedDateISO) pickedDateISO = dateISO;

            if (hasNightShootInBookingNotes(job, dateISO)) {
              nightShootWorkedDates.add(dateISO);
            }
          }

          if (!pickedDateISO) return;
          if (seen.has(job.id)) return;
          seen.add(job.id);

          out.push({
            bookingId: job.id,
            jobNumber: job.jobNumber || "",
            production: job.production || "",
            client: job.client || "",
            location: job.location || "",
            dateISO: pickedDateISO,
          });
        });

        const recentWeekStarts = new Set(
          lastDates.map((dateISO) => mondayISO(dateISO)).filter(Boolean)
        );
        const recentTimesheets = timesheetsResource.data.filter((row) => {
          const weekStart = row.weekStart || row.weekISO || "";
          return weekStart && weekStart !== id && recentWeekStarts.has(weekStart);
        });

        const savedOnsetDates = recentTimesheets.flatMap((ts) =>
          ts
            ? collectOnsetTurnaroundCreditDates(
                ts,
                lastSet,
                ts.weekStart || ts.weekISO
              )
            : []
        );
        out.sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")));
        setTurnaroundJobs(out);
        setTurnaroundBookingCreditDates(Array.from(nightShootWorkedDates));
        setTurnaroundOnsetCreditDates(savedOnsetDates);
      } catch (err) {
        console.error("[turnaround] error:", err);
        setTurnaroundEligible(false);
        setTurnaroundJobs([]);
        setTurnaroundBookingCreditDates([]);
        setTurnaroundOnsetCreditDates([]);
      }
    })();
  }, [
    bookingsResource.data,
    bookingsResource.employees,
    loading,
    isAuthed,
    employee?.userCode,
    id,
    timesheetsResource.data,
    weekDates,
  ]);

  useEffect(() => {
    const todayISO = iso(startOfDay(new Date()));
    const elapsedCurrentWeekDates = new Set(
      weekDates.filter((dateISO) => dateISO && dateISO <= todayISO)
    );
    const localOnsetDates = id
      ? collectOnsetTurnaroundCreditDates(timesheet, elapsedCurrentWeekDates, id)
      : [];

    const creditRoots = collapseConsecutiveDatesToCredits([
      ...turnaroundBookingCreditDates,
      ...turnaroundOnsetCreditDates,
      ...localOnsetDates,
    ]);
    const creditDates = creditRoots.sort((a, b) =>
      String(b).localeCompare(String(a))
    );
    const creditsTotal = creditDates.length;

    setTurnaroundCreditDates(creditDates);
    setTurnaroundCreditsTotal(creditsTotal);
    setTurnaroundEligible(creditsTotal > 0);
  }, [id, timesheet, turnaroundBookingCreditDates, turnaroundOnsetCreditDates, weekDates]);

  const availableTurnaroundJobs = useMemo(() => {
    const eligibleDates = new Set(turnaroundCreditDates);
    return turnaroundJobs.filter((job) => {
      const sourceKey = turnaroundCreditSourceKey(job);
      return eligibleDates.has(job.dateISO) && sourceKey && !usedTurnaroundCreditSourceKeys.has(sourceKey);
    });
  }, [turnaroundCreditDates, turnaroundJobs, usedTurnaroundCreditSourceKeys]);

  const withDefaultYardTimes = useCallback((ts) => {
    const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const next = { ...ts, days: { ...ts.days } };

    weekdays.forEach((d) => {
      const e = { ...(next.days?.[d] || {}) };
      if (String(e.mode || "yard").toLowerCase() === "yard") {
        if (!e.leaveTime) e.leaveTime = yardDefaultStart;
        if (!e.arriveBack && !e.arriveTime) e.arriveBack = yardDefaultEnd;
        if (!e.isTurnaround && (!Array.isArray(e.yardSegments) || e.yardSegments.length === 0)) {
          e.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
        }
        next.days[d] = ensureModeDefaults(e);
      } else if (String(e.mode || "").toLowerCase() === "workshop") {
        if (!e.leaveTime) e.leaveTime = yardDefaultStart;
        if (!e.arriveBack && !e.arriveTime) e.arriveBack = yardDefaultEnd;
        if (!Array.isArray(e.yardSegments) || e.yardSegments.length === 0) {
          e.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd, note: "" }];
        }
        next.days[d] = ensureModeDefaults(e);
      } else {
        next.days[d] = ensureModeDefaults(e);
      }
    });

    return annotateTimesheetMidnight(next);
  }, [yardDefaultEnd, yardDefaultStart]);

  function buildJobSnapshot(jobsByDayMap) {
    const byDay = Object.fromEntries(
      DAYS.map((d) => [
        d,
        expandLinkedHandoverJobs(jobsByDayMap[d] || []).map((j) => ({
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
    const start = toDateSafe(weekStartISO);
    if (!start) return annotateTimesheetMidnight(copy);

    const isoByDay = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);
      isoByDay[DAYS[i]] = iso(d);
    }

    for (const day of DAYS) {
      const dayEntry = { ...(copy.days[day] || {}) };
      const jobs = expandLinkedHandoverJobs(jobsByDayMap[day] || []).map((j) => ({
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

      if (jobs.length > 0 && String(dayEntry.mode || "").toLowerCase() === "workshop") {
        dayEntry.mode = "yard";
        dayEntry.workshopJobs = [];
      }

      copy.days[day] = ensureModeDefaults(dayEntry);
    }

    return annotateTimesheetMidnight(copy);
  }

  // ---- STATUS / LOCK ----
  const statusStr = String(timesheet.status || "").trim().toLowerCase();
  const isApproved = statusStr === "approved";
  const isLocked = isApproved;

  // current-week turnaround usage + single-use cap
  const usedTurnarounds = useMemo(() => {
    let used = 0;
    for (const d of DAYS) {
      const e = ensureModeDefaults(timesheet?.days?.[d] || {});
      if (String(e.mode || "yard").toLowerCase() === "yard" && e.isTurnaround === true) used += 1;
    }
    return used;
  }, [timesheet]);

  const turnaroundUnusedCredits = Math.max(
    0,
    Number(turnaroundCreditsTotal || 0) - Number(turnaroundCreditsConsumed || 0)
  );
  const turnaroundUsesAllowed = turnaroundUnusedCredits > 0 ? Math.min(TURNAROUND_MAX_USES_PER_WEEK, turnaroundUnusedCredits) : 0;
  const turnaroundCreditsRemaining = Math.max(0, turnaroundUsesAllowed - (usedTurnarounds || 0));
  const turnaroundCreditDisplayTotal = Math.max(
    Number(turnaroundCreditsTotal || 0),
    Number(turnaroundCreditsConsumed || 0) + Number(usedTurnarounds || 0)
  );
  const turnaroundCreditPoolRemaining = Math.max(
    0,
    Number(turnaroundCreditsTotal || 0)
      - Number(turnaroundCreditsConsumed || 0)
      - Number(usedTurnarounds || 0)
  );
  const showTurnaroundSummary = turnaroundCreditDisplayTotal > 0;
  const showTurnaroundControls = turnaroundUsesAllowed > 0 || usedTurnarounds > 0;

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
              generatorUsed: false,
              lateSup: false,
              mealSup: false,
              yardTravelEnabled: false,
              yardTravelLeaveTime: null,
              yardTravelArriveTime: null,
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

  const clearBankHolidayBlocks = useCallback(
    (day) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const existing = prev.days?.[day] || {};
        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: buildNonWorkingDayEntry(existing, "bankholiday", {
              bankHolidayWorked: false,
            }),
          },
        };
      });
    },
    [isLocked]
  );

  const toggleUnpaidDay = useCallback(
    (day, enabled) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const existing = ensureModeDefaults(
          prev.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" }
        );
        const hol = holidaysByDay?.[day];
        const isFullHoliday = !!hol && !hol?.isHalfDay;
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;

        if (isFullHoliday || isBankHolidayDay) return prev;

        if (enabled) {
          const unpaidRestore = stripUnpaidRestore(existing);
          return {
            ...prev,
            days: {
              ...prev.days,
              [day]: buildNonWorkingDayEntry(existing, "unpaid", {
                unpaidDay: true,
                bankHolidayWorked: false,
                unpaidRestore,
              }),
            },
          };
        }

        const restoreMode = WEEKEND_SET.has(day) ? "off" : "yard";
        const restoredBase = stripUnpaidRestore(existing.unpaidRestore);
        const restored =
          restoredBase
            ? ensureModeDefaults({
                ...restoredBase,
                unpaidDay: false,
                unpaidRestore: null,
              })
            : restoreMode === "yard"
            ? ensureModeDefaults({
                ...existing,
                mode: "yard",
                unpaidDay: false,
                unpaidRestore: null,
                leaveTime: yardDefaultStart,
                arriveBack: yardDefaultEnd,
                yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd, note: "" }],
                lunchSup: false,
                bankHolidayWorked: false,
              })
            : ensureModeDefaults({
                ...existing,
                mode: "off",
                unpaidDay: false,
                unpaidRestore: null,
                bankHolidayWorked: false,
              });

        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: restored,
          },
        };
      });
    },
    [isLocked, holidaysByDay, bankHolidaysByDay, yardDefaultStart, yardDefaultEnd]
  );

  const addYardSegment = useCallback(
    (day) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const existing = prev.days?.[day] || { mode: "yard" };
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;
        const switchedToYard = String(existing.mode || "").toLowerCase() !== "yard";

        let base = { ...existing };
        if (switchedToYard) {
          base.mode = "yard";
          base.leaveTime = base.leaveTime || yardDefaultStart;
          base.arriveBack = base.arriveBack || yardDefaultEnd;
          base.lunchSup = false;
          base.yardSegments = [];

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
        if (isBankHolidayDay) base.bankHolidayWorked = true;

        const e = ensureModeDefaults(base);
        const segs = Array.isArray(e.yardSegments) ? e.yardSegments : [];

        if (switchedToYard) {
          const firstSeg = segs[0] || { start: yardDefaultStart, end: yardDefaultEnd, note: "" };
          return {
            ...prev,
            days: {
              ...prev.days,
              [day]: {
                ...e,
                lunchSup: false,
                ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
                yardSegments: [firstSeg],
              },
            },
          };
        }

        if (segs.length === 0) {
          const firstSeg = { start: yardDefaultStart, end: yardDefaultEnd, note: "" };
          return {
            ...prev,
            days: {
              ...prev.days,
              [day]: {
                ...e,
                lunchSup: false,
                ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
                yardSegments: [firstSeg],
              },
            },
          };
        }

        const last = segs[segs.length - 1] || { start: yardDefaultStart, end: yardDefaultEnd };
        const nextSeg = { start: last.end || yardDefaultStart, end: yardDefaultEnd, note: "" };

        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: {
              ...e,
              ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
              yardSegments: [...segs, nextSeg],
            },
          },
        };
      });
    },
    [isLocked, bankHolidaysByDay, yardDefaultStart, yardDefaultEnd]
  );

  // allow deleting the FIRST / LAST remaining segment (can go to 0)
  const removeYardSegment = useCallback(
    (day, index) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const current = prev.days?.[day] || { mode: "yard" };
        const mode = String(current.mode || "yard").toLowerCase();
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;
        if (mode !== "yard") return prev;

        const e = ensureModeDefaults(current);
        const segs = Array.isArray(e.yardSegments) ? e.yardSegments.slice() : [];

        if (!segs[index]) return prev;

        segs.splice(index, 1);

        const nextEntry = ensureModeDefaults({
          ...e,
          yardSegments: segs, // can be empty
          lunchSup: segs.length === 0 ? false : e.lunchSup,
          ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
        });

        return { ...prev, days: { ...prev.days, [day]: nextEntry } };
      });
    },
    [isLocked, bankHolidaysByDay]
  );

  const updateYardSegment = useCallback(
    (day, index, field, value) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;
        const e = ensureModeDefaults(prev.days?.[day] || { mode: "yard" });
        const segs = (Array.isArray(e.yardSegments) ? e.yardSegments : []).map((s, i) => (i === index ? { ...s, [field]: value } : s));
        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: {
              ...e,
              ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
              yardSegments: segs,
            },
          },
        };
      });
    },
    [isLocked, bankHolidaysByDay]
  );

  const addWorkshopSegment = useCallback(
    (day) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;
        const current = ensureModeDefaults(prev.days?.[day] || { mode: "workshop" });
        const segs = Array.isArray(current.yardSegments) ? current.yardSegments : [];
        const baseSegs = segs.length > 0 ? segs : [{ start: yardDefaultStart, end: yardDefaultEnd, note: "" }];
        const last = baseSegs[baseSegs.length - 1] || { start: yardDefaultStart, end: yardDefaultEnd };
        const nextSeg = { start: last.end || yardDefaultStart, end: yardDefaultEnd, note: "" };

        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: ensureModeDefaults({
              ...current,
              mode: "workshop",
              ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
              yardSegments: [...baseSegs, nextSeg],
            }),
          },
        };
      });
    },
    [isLocked, bankHolidaysByDay, yardDefaultStart, yardDefaultEnd]
  );

  const addWorkshopJob = useCallback(
    (day) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;
        const current = ensureModeDefaults(prev.days?.[day] || { mode: "workshop" });
        const existingRows = Array.isArray(current.workshopJobs) ? current.workshopJobs : [];
        const nextRows = existingRows.length > 0 ? existingRows : [{ jobNumber: "", hours: "", note: "" }];

        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: ensureModeDefaults({
              ...current,
              mode: "workshop",
              ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
              workshopJobs: [...nextRows, { jobNumber: "", hours: "", note: "" }],
            }),
          },
        };
      });
    },
    [isLocked, bankHolidaysByDay]
  );

  const removeWorkshopJob = useCallback(
    (day, index) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const current = ensureModeDefaults(prev.days?.[day] || { mode: "workshop" });
        const rows = Array.isArray(current.workshopJobs) ? current.workshopJobs.slice() : [];
        if (!rows[index]) return prev;
        rows.splice(index, 1);

        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: ensureModeDefaults({
              ...current,
              workshopJobs: rows.length > 0 ? rows : [{ jobNumber: "", hours: "", note: "" }],
            }),
          },
        };
      });
    },
    [isLocked]
  );

  const updateWorkshopJob = useCallback(
    (day, index, field, value) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;
        const current = ensureModeDefaults(prev.days?.[day] || { mode: "workshop" });
        const rows = Array.isArray(current.workshopJobs) ? current.workshopJobs.slice() : [{ jobNumber: "", hours: "", note: "" }];
        rows[index] = {
          ...(rows[index] || { jobNumber: "", hours: "", note: "" }),
          [field]: value,
        };

        return {
          ...prev,
          days: {
            ...prev.days,
            [day]: ensureModeDefaults({
              ...current,
              mode: "workshop",
              ...(isBankHolidayDay ? { bankHolidayWorked: true } : {}),
              workshopJobs: rows,
            }),
          },
        };
      });
    },
    [isLocked, bankHolidaysByDay]
  );

  const toggleDayTogglePanel = useCallback((day) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTogglePanelByDay((prev) => ({ ...prev, [day]: !prev?.[day] }));
  }, []);

  const validateTurnaroundSelectionsOrAlert = useCallback((ts) => {
    const turnaroundDays = [];
    for (const dayName of DAYS) {
      const e = ts?.days?.[dayName];
      if (!e) continue;
      const mode = String(e.mode || "yard").toLowerCase();
      if (mode === "yard" && boolish(e.isTurnaround)) {
        turnaroundDays.push(dayName);
        const ok = !!e.turnaroundJob?.bookingId;
        if (!ok) {
          Alert.alert(
            "Turnaround Day needs a job",
            `Please select the job for Turnaround Day on ${dayName} (from the last 3 weeks).`
          );
          return false;
        }
        const sourceKey = turnaroundCreditSourceKey(e.turnaroundJob);
        const isUnusedSource = availableTurnaroundJobs.some(
          (job) => turnaroundCreditSourceKey(job) === sourceKey
        );
        if (!sourceKey || usedTurnaroundCreditSourceKeys.has(sourceKey) || !isUnusedSource) {
          Alert.alert(
            "Turnaround credit already used",
            `The credit selected on ${dayName} is no longer available. Choose an unused credit source.`
          );
          return false;
        }
      }
    }

    if (turnaroundDays.length > TURNAROUND_MAX_USES_PER_WEEK) {
      Alert.alert(
        "Turnaround already used",
        `Turnaround can only be used once per week. Remove it from ${turnaroundDays.slice(1).join(", ")} before submitting.`
      );
      return false;
    }

    if (turnaroundDays.length > Number(turnaroundUnusedCredits || 0)) {
      Alert.alert(
        "No Turnaround credits",
        "The available Turnaround credit was already used on an earlier timesheet. Remove this Turnaround before submitting."
      );
      return false;
    }

    return true;
  }, [availableTurnaroundJobs, turnaroundUnusedCredits, usedTurnaroundCreditSourceKeys]);

  const saveTimesheet = useCallback(
    async ({ exitAfterSave = true, onAfterSave } = {}) => {
      if (isLocked) {
        Alert.alert("Locked", "This timesheet has been approved and can no longer be edited.");
        return;
      }
      try {
        const timesheetDocId = `${employee.userCode}_${id}`;
        const ref = doc(db, "timesheets", timesheetDocId);
        const docPath = `timesheets/${timesheetDocId}`;

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

          // Audit fields for turnaround credit system (kept same field name to avoid breaking existing readers)
          turnaroundCredits: {
            total: turnaroundCreditsTotal || 0,
            sourcesLast14Days: turnaroundCreditDates || [],
            sourcesLast21Days: turnaroundCreditDates || [],
          },

          updatedAt: serverTimestamp(),
          submitted: timesheet.submitted ? true : false,
        };

        const queuePayload = {
          ...payload,
          updatedAt: new Date().toISOString(),
        };

        const { queued } = await runOrQueueFirestoreMutation({
          run: () => setDoc(ref, payload, { merge: true }),
          mutation: {
            operation: "set",
            docPath,
            data: queuePayload,
            options: { merge: true },
            entityType: "timesheet",
            entityId: timesheetDocId,
            meta: { weekStart: id, submitted: !!timesheet.submitted },
          },
        });
        await upsertTimesheet({ id: timesheetDocId, ...queuePayload });
        await invalidate("me-dashboard:");

        if (queued) {
          Alert.alert("Saved offline", "No network right now. Your timesheet changes will sync automatically.");
        } else {
          Alert.alert(
            timesheet.submitted ? "Updated" : "Saved",
            timesheet.submitted
              ? "Your submitted timesheet has been updated."
              : "Your timesheet has been saved as a draft."
          );
        }
        setBaselineSignature(serialiseTimesheetForCompare(prepared));
        if (exitAfterSave) {
          allowNavigationRef.current = true;
          router.back();
        }
        onAfterSave?.();
      } catch (err) {
        console.error(err);
        Alert.alert("Error", "Could not save timesheet");
      }
    },
    [
      employee,
      id,
      invalidate,
      isLocked,
      jobsByDay,
      router,
      timesheet,
      turnaroundCreditDates,
      turnaroundCreditsTotal,
      upsertTimesheet,
      validateTurnaroundSelectionsOrAlert,
      withDefaultYardTimes,
    ]
  );

  const submitTimesheet = async () => {
    if (isLocked) {
      Alert.alert("Locked", "This timesheet has already been approved and cannot be resubmitted.");
      return;
    }
    try {
      const timesheetDocId = `${employee.userCode}_${id}`;
      const ref = doc(db, "timesheets", timesheetDocId);
      const docPath = `timesheets/${timesheetDocId}`;

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

        // Audit fields for turnaround credit system (kept same field name to avoid breaking existing readers)
        turnaroundCredits: {
          total: turnaroundCreditsTotal || 0,
          sourcesLast14Days: turnaroundCreditDates || [],
          sourcesLast21Days: turnaroundCreditDates || [],
        },

        updatedAt: serverTimestamp(),
        submitted: true,
        submittedAt: serverTimestamp(),
      };

      const nowISO = new Date().toISOString();
      const queuePayload = {
        ...payload,
        updatedAt: nowISO,
        submittedAt: nowISO,
      };

      const { queued } = await runOrQueueFirestoreMutation({
        run: () => setDoc(ref, payload, { merge: true }),
        mutation: {
          operation: "set",
          docPath,
          data: queuePayload,
          options: { merge: true },
          entityType: "timesheet",
          entityId: timesheetDocId,
          meta: { weekStart: id, submitted: true },
        },
      });
      await upsertTimesheet({ id: timesheetDocId, ...queuePayload });
      await invalidate("me-dashboard:");

      if (queued) {
        Alert.alert("Submission queued", "You appear to be offline. We queued this timesheet and it will auto-submit when back online.");
      } else {
        Alert.alert("Submitted", "Your timesheet has been submitted.");
      }
      await cancelTimesheetReminders(employee.userCode, id);
      allowNavigationRef.current = true;
      router.back();
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Could not submit timesheet");
    }
  };

  const updateDay = useCallback(
    (day, field, value, bookingId = null) => {
      if (isLocked) return;

      setTimesheet((prev) => {
        const existing = prev.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" };

        const hol = holidaysByDay?.[day];
        const isFullHoliday = !!hol && !hol?.isHalfDay;
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;

        if (isFullHoliday) return prev;

        let updated = { ...existing, [field]: value };
        const isHalfHoliday = !!hol && !!hol?.isHalfDay;

        if (field === "mode") {
          const nextMode = String(value || "yard").toLowerCase();
          updated.mode = nextMode;

          if (nextMode === "yard") {
            updated.leaveTime = updated.leaveTime || yardDefaultStart;
            updated.arriveBack = updated.arriveBack || yardDefaultEnd;
            updated.lunchSup = false;
            updated.workshopJobs = [];
            if (!updated.isTurnaround && (!Array.isArray(updated.yardSegments) || updated.yardSegments.length === 0)) {
              updated.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
            }
          } else {
            if (nextMode === "workshop") {
              updated.leaveTime = updated.leaveTime || yardDefaultStart;
              updated.arriveBack = updated.arriveBack || yardDefaultEnd;
              if (!Array.isArray(updated.yardSegments) || updated.yardSegments.length === 0) {
                updated.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd, note: "" }];
              }
            } else {
              updated.yardSegments = [];
              updated.leaveTime = null;
              updated.arriveBack = null;
            }

            updated.lunchSup = false;
            updated.yardTravelEnabled = false;
            updated.yardTravelLeaveTime = null;
            updated.yardTravelArriveTime = null;

            // Turnaround only applies to Yard
            updated.isTurnaround = false;
            updated.turnaroundJob = null;

            // clear travel/onset fields (then we re-apply defaults per-mode)
            updated.arriveTime = null;
            updated.callTime = null;
            updated.wrapTime = null;
            updated.precallDuration = null;
          updated.overnight = false;
          updated.nightShoot = false;
          updated.generatorUsed = false;
          updated.lateSup = false;
          updated.mealSup = false;
          updated.additionalTravelEnabled = false;
          updated.additionalTravelStartTime = null;
          updated.additionalTravelEndTime = null;
          updated.additionalTravelJob = "";
            if (nextMode !== "workshop") updated.workshopJobs = [];
          }

          if (nextMode === "travel") {
            updated.travelLunchSup = false;
            updated.travelPD = typeof updated.travelPD === "boolean" ? updated.travelPD : false;
          }

          if (nextMode === "onset") {
            updated.nightShoot = typeof updated.nightShoot === "boolean" ? updated.nightShoot : false;
            updated.generatorUsed = typeof updated.generatorUsed === "boolean" ? updated.generatorUsed : false;
            updated.lateSup = typeof updated.lateSup === "boolean" ? updated.lateSup : isLateSupplementWrap(updated);
            updated.mealSup = typeof updated.mealSup === "boolean" ? updated.mealSup : false;
          }

          if (nextMode === "workshop") {
            updated.workshopJobs =
              Array.isArray(updated.workshopJobs) && updated.workshopJobs.length > 0
                ? updated.workshopJobs
                : [{ jobNumber: "", hours: "", note: "" }];
          }
        }

        if (field === "wrapTime" && String(updated.mode || "").toLowerCase() === "onset") {
          updated.lateSup = isLateSupplementWrap(updated);
        }

        if (
          (field === "callTime" || field === "wrapTime")
          && String(updated.mode || "").toLowerCase() === "onset"
          && segmentMeta({ start: updated.callTime, end: updated.wrapTime }).crossesMidnight
        ) {
          updated.nightShoot = true;
        }

        if (field === "yardTravelEnabled") {
          updated.yardTravelEnabled = !!value;
          if (updated.yardTravelEnabled) {
            updated.yardTravelLeaveTime = normaliseTimeValue(updated.yardTravelLeaveTime) || yardDefaultStart;
            updated.yardTravelArriveTime = normaliseTimeValue(updated.yardTravelArriveTime) || yardDefaultEnd;
          } else {
            updated.yardTravelLeaveTime = null;
            updated.yardTravelArriveTime = null;
          }
        }

        if (field === "additionalTravelEnabled") {
          updated.additionalTravelEnabled = !!value;
          if (updated.additionalTravelEnabled) {
            updated.additionalTravelStartTime =
              normaliseTimeValue(updated.additionalTravelStartTime) ||
              normaliseTimeValue(updated.arriveBack) ||
              normaliseTimeValue(updated.wrapTime) ||
              null;
            updated.additionalTravelEndTime = normaliseTimeValue(updated.additionalTravelEndTime) || null;
            updated.additionalTravelJob = String(updated.additionalTravelJob || "");
          } else {
            updated.additionalTravelStartTime = null;
            updated.additionalTravelEndTime = null;
            updated.additionalTravelJob = "";
          }
        }

        if (bookingId !== null) updated.bookingId = bookingId;

        if (isHalfHoliday) {
          updated.mode = "yard";
          updated.leaveTime = updated.leaveTime || yardDefaultStart;
          updated.arriveBack = updated.arriveBack || yardDefaultEnd;
          if (field !== "lunchSup") {
            updated.lunchSup = false;
          }
          if (!updated.isTurnaround && (!Array.isArray(updated.yardSegments) || updated.yardSegments.length === 0)) {
            updated.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
          }
          updated.halfHoliday = true;
          updated.halfHolidayLabel = hol?.halfLabel || "Half day";
        }

        if (isBankHolidayDay && String(updated.mode || "bankholiday").toLowerCase() !== "bankholiday") {
          updated.bankHolidayWorked = true;
        }

        updated.unpaidDay = String(updated.mode || "").toLowerCase() === "unpaid";
        if (!updated.unpaidDay) updated.unpaidRestore = null;

        updated = ensureModeDefaults(updated);

        if (updated.mode === "yard") {
          const segs = Array.isArray(updated.yardSegments) ? updated.yardSegments : [];
          const yardTravelOffset = boolish(updated.yardTravelEnabled)
            ? timeFieldOffset(updated.yardTravelLeaveTime, updated.yardTravelArriveTime)
            : null;
          updated.crossesMidnight =
            segs.some((seg) => segmentMeta(seg).crossesMidnight) || (yardTravelOffset?.dayOffset ?? 0) === 1;
        } else if (updated.mode === "travel") {
          const travelOffset = timeFieldOffset(updated.leaveTime, updated.arriveTime);
          updated.crossesMidnight = (travelOffset?.dayOffset ?? 0) === 1;
        } else if (updated.mode === "onset") {
          const base = updated.leaveTime || updated.arriveTime || updated.callTime || null;
          const arriveBackOffset = timeFieldOffset(base, updated.arriveBack);
          const wrapOffset = timeFieldOffset(base, updated.wrapTime);
          const additionalTravelOffset = boolish(updated.additionalTravelEnabled)
            ? timeFieldOffset(updated.additionalTravelStartTime, updated.additionalTravelEndTime)
            : null;
          updated.crossesMidnight =
            (arriveBackOffset?.dayOffset ?? 0) === 1 ||
            (wrapOffset?.dayOffset ?? 0) === 1 ||
            (additionalTravelOffset?.dayOffset ?? 0) === 1;
        } else if (updated.mode === "workshop") {
          const segs = Array.isArray(updated.yardSegments) ? updated.yardSegments : [];
          updated.crossesMidnight = segs.some((seg) => segmentMeta(seg).crossesMidnight);
        } else if (updated.mode !== "yard") {
          updated.crossesMidnight = false;
        }

        return { ...prev, days: { ...prev.days, [day]: updated } };
      });
    },
    [isLocked, holidaysByDay, bankHolidaysByDay, yardDefaultStart, yardDefaultEnd]
  );

  const setDayWorkType = useCallback(
    (day, nextType) => {
      if (isLocked) return;

      const type = normaliseAutofillType(nextType);
      const presetStart =
        type === "office"
          ? officePresetStart || DEFAULT_OFFICE_START
          : yardPresetStart || DEFAULT_YARD_START;
      const presetEnd =
        type === "office"
          ? officePresetEnd || DEFAULT_OFFICE_END
          : yardPresetEnd || DEFAULT_YARD_END;

      setTimesheet((prev) => {
        const existing = ensureModeDefaults(
          prev.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" }
        );
        const hol = holidaysByDay?.[day];
        const isFullHoliday = !!hol && !hol?.isHalfDay;
        const isBankHolidayDay = !!bankHolidaysByDay?.[day]?.notWorking;
        const isWorkedBankHoliday = isBankHolidayDay && boolish(existing.bankHolidayWorked);

        if (isFullHoliday || isUnpaidDayEntry(existing) || (isBankHolidayDay && !isWorkedBankHoliday)) {
          return prev;
        }

        const common = {
          ...existing,
          dayWorkType: type,
          leaveTime: presetStart,
          arriveBack: presetEnd,
          arriveTime: null,
          callTime: null,
          wrapTime: null,
          precallDuration: null,
          overnight: false,
          nightShoot: false,
          generatorUsed: false,
          lateSup: false,
          mealSup: false,
          travelLunchSup: false,
          travelPD: false,
          yardTravelEnabled: false,
          yardTravelLeaveTime: null,
          yardTravelArriveTime: null,
          isTurnaround: false,
          turnaroundJob: null,
          bankHolidayWorked: isBankHolidayDay ? true : boolish(existing.bankHolidayWorked),
          unpaidDay: false,
          unpaidRestore: null,
        };

        const updated =
          type === "workshop"
            ? ensureModeDefaults({
                ...common,
                mode: "workshop",
                lunchSup: false,
                yardSegments: [{ start: presetStart, end: presetEnd, note: "" }],
                workshopJobs:
                  Array.isArray(existing.workshopJobs) && existing.workshopJobs.length > 0
                    ? existing.workshopJobs
                    : [{ jobNumber: "", hours: "", note: "" }],
              })
            : ensureModeDefaults({
                ...common,
                mode: "yard",
                lunchSup: false,
                yardSegments: [{ start: presetStart, end: presetEnd, note: "" }],
                workshopJobs: [],
              });

        return { ...prev, days: { ...prev.days, [day]: updated } };
      });
    },
    [
      isLocked,
      officePresetEnd,
      officePresetStart,
      yardPresetEnd,
      yardPresetStart,
      holidaysByDay,
      bankHolidaysByDay,
    ]
  );

  const toggleTurnaround = useCallback(
    (day) => {
      if (isLocked) return;
      const currentDayEntry = ensureModeDefaults(
        timesheet?.days?.[day] || {
          mode: WEEKEND_SET.has(day) ? "off" : "yard",
          dayNotes: "",
        }
      );
      const turningOn = !currentDayEntry.isTurnaround;
      if (turningOn && availableTurnaroundJobs.length === 0) {
        Alert.alert(
          "No unused Turnaround credits",
          "Every eligible credit source from the last 3 weeks has already been used."
        );
        return;
      }

      let nextOn = false;

      setTimesheet((prev) => {
        const existing = ensureModeDefaults(prev.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" });

        // Only works on Yard
        if (String(existing.mode || "yard").toLowerCase() !== "yard") return prev;

        // Count how many turnarounds are already used (in this current week)
        const alreadyUsed = DAYS.reduce((acc, d) => {
          const e = ensureModeDefaults(prev.days?.[d] || {});
          const isTA = String(e.mode || "yard").toLowerCase() === "yard" && e.isTurnaround === true;
          return acc + (isTA ? 1 : 0);
        }, 0);

        nextOn = !existing.isTurnaround;

        // If turning ON, enforce weekly single-use cap
        if (nextOn) {
          const availableCredits = Number(turnaroundUnusedCredits || 0);
          if (availableCredits <= 0) {
            Alert.alert(
              "No Turnaround credits",
              "All available Turnaround credits have already been used in recent weeks."
            );
            nextOn = false;
            return prev;
          }
          if (alreadyUsed >= TURNAROUND_MAX_USES_PER_WEEK) {
            Alert.alert(
              "Turnaround already used",
              "Turnaround can only be used once per week. Turn off the existing Turnaround day first if you need to move it."
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
    [availableTurnaroundJobs, isLocked, turnaroundUnusedCredits, timesheet]
  );

  const setTurnaroundJobForDay = useCallback(
    (day, job) => {
      if (!day) return;
      setTimesheet((prev) => {
        const existing = ensureModeDefaults(prev.days?.[day] || { mode: "yard" });
        if (String(existing.mode || "yard").toLowerCase() !== "yard") return prev;

        // If somehow job picker opened without remaining allowance, guard
        const alreadyUsed = DAYS.reduce((acc, d) => {
          const e = ensureModeDefaults(prev.days?.[d] || {});
          const isTA = String(e.mode || "yard").toLowerCase() === "yard" && e.isTurnaround === true;
          return acc + (isTA ? 1 : 0);
        }, 0);

        const allowance =
          Number(turnaroundUnusedCredits || 0) > 0
            ? Math.min(TURNAROUND_MAX_USES_PER_WEEK, Number(turnaroundUnusedCredits || 0))
            : 0;
        if (existing.isTurnaround !== true && alreadyUsed >= allowance) {
          Alert.alert(
            "Turnaround already used",
            "Turnaround can only be used once per week. Turn off the existing Turnaround day first if you need to move it."
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
    },
    [turnaroundUnusedCredits]
  );

  const closeTurnaroundPicker = useCallback(() => {
    const day = turnaroundPickerDay;
    const entry = day
      ? ensureModeDefaults(timesheet?.days?.[day] || { mode: "yard" })
      : null;
    const shouldRevert =
      !!day &&
      String(entry?.mode || "yard").toLowerCase() === "yard" &&
      entry?.isTurnaround === true &&
      !entry?.turnaroundJob?.bookingId;

    if (shouldRevert) {
      setTimesheet((prev) => {
        const existing = ensureModeDefaults(prev.days?.[day] || { mode: "yard" });
        const hasSegments =
          Array.isArray(existing.yardSegments) && existing.yardSegments.length > 0;
        const next = ensureModeDefaults({
          ...existing,
          isTurnaround: false,
          turnaroundJob: null,
          yardSegments: hasSegments
            ? existing.yardSegments
            : [{ start: yardDefaultStart, end: yardDefaultEnd }],
        });
        return { ...prev, days: { ...prev.days, [day]: next } };
      });
      Alert.alert(
        "Select a job for Turnaround",
        `Please pick a job for ${day} to keep Turnaround on.`
      );
    }

    setTurnaroundPickerOpen(false);
    setTurnaroundPickerDay(null);
  }, [timesheet, turnaroundPickerDay, yardDefaultStart, yardDefaultEnd]);

  if (loading || !isAuthed) return null;

  const statusLabel = isApproved ? "Approved" : timesheet.submitted ? "Submitted" : "Draft";
  const overviewJob = jobOverview?.job || null;
  const overviewDateISO = jobOverview?.dateISO || "";
  const overviewCallTime = overviewJob
    ? overviewJob?.callTimes?.[overviewDateISO] ||
      overviewJob?.callTimesByDate?.[overviewDateISO] ||
      overviewJob?.callTimeByDate?.[overviewDateISO] ||
      overviewJob?.callTime ||
      overviewJob?.calltime ||
      ""
    : "";
  const overviewNotes = overviewJob
    ? getBookingDayNote(overviewJob, overviewDateISO) ||
      overviewJob?.notes ||
      overviewJob?.note ||
      overviewJob?.description ||
      ""
    : "";
  const overviewVehicles = overviewJob
    ? getVehicleDisplayList(
        getBookingVehicleReferences(overviewJob),
        vehiclesResource.data,
        { includeRegistration: false, fallback: "Vehicle" }
      ).join(", ")
    : "";

  const renderToggleButton = (day, disabled = false, extraStyle = null) => {
    const open = !!togglePanelByDay?.[day];
    return (
      <TouchableOpacity
        style={[
          styles.addBlockBtn,
          extraStyle,
          {
            backgroundColor: addBlockButtonColors.backgroundColor,
            borderColor: addBlockButtonColors.borderColor,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={() => toggleDayTogglePanel(day)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Hide" : "Show"} optional controls for ${day}`}
        accessibilityState={{ expanded: open, disabled }}
      >
        <Icon name={open ? "minus-circle" : "plus-circle"} size={12} color={colors.textMuted} />
        <Text style={[styles.addBlockText, { color: colors.textMuted }]}>{open ? "Hide toggles" : "Add toggles"}</Text>
      </TouchableOpacity>
    );
  };

  const renderYardToggleFields = (day, entry, disabled = false) => {
    if (!togglePanelByDay?.[day]) return null;

    return (
      <>
        <View style={styles.toggleGrid}>
          <InfoToggleRow
            label="Add travel time?"
            value={!!entry.yardTravelEnabled}
            onChange={(v) => updateDay(day, "yardTravelEnabled", v)}
            disabled={disabled}
            infoTitle="Yard Travel Time"
            infoText="Use this when a yard day also included separate travel time that should be added to the total."
            compact
          />

          <InfoToggleRow
            label="Overnight?"
            value={boolish(entry.overnight)}
            onChange={(v) => updateDay(day, "overnight", v)}
            disabled={disabled}
            infoTitle="Overnight"
            infoText="Turn this on if this yard day included an overnight stay."
            compact
          />
        </View>

        {!!entry.yardTravelEnabled && (
          <View style={styles.segmentRow}>
            <TimeDropdown
              label="Travel Leave"
              value={entry.yardTravelLeaveTime}
              onSelect={(t) => updateDay(day, "yardTravelLeaveTime", t)}
              options={TIME_OPTIONS}
              disabled={disabled}
            />
            <View style={{ width: 8 }} />
            <TimeDropdown
              label="Travel Arrive"
              value={entry.yardTravelArriveTime}
              onSelect={(t) => updateDay(day, "yardTravelArriveTime", t)}
              options={TIME_OPTIONS}
              disabled={disabled}
              startFrom={entry.yardTravelLeaveTime}
            />
          </View>
        )}

      </>
    );
  };

  const renderWeekdayYardControls = (
    day,
    entry,
    {
      isWeekend = false,
      isFullHoliday = false,
      isBankHolidayOff = false,
      isHalfHoliday = false,
      isUnpaidDay = false,
      hideUnpaid = false,
      disabled = false,
      showTurnaround = false,
      canAddTurnaround = false,
      turnaroundBlockedTitle = "",
      turnaroundBlockedMessage = "",
    } = {}
  ) => {
    if (isWeekend || isFullHoliday || isBankHolidayOff) return null;
    if (hideUnpaid && !showTurnaround) return null;

    return (
      <View style={styles.unpaidToggleRow}>
        {!hideUnpaid && (
          <TouchableOpacity
            style={[
              styles.turnaroundBtn,
              styles.unpaidDayBtn,
              {
                backgroundColor: isUnpaidDay ? softAmberBg : subtleChipBg,
                borderColor: isUnpaidDay ? softAmber : colors.border,
                opacity: isLocked ? 0.5 : 1,
              },
            ]}
            onPress={() => toggleUnpaidDay(day, !isUnpaidDay)}
            disabled={isLocked}
            accessibilityRole="checkbox"
            accessibilityLabel={`${day} unpaid day`}
            accessibilityState={{ checked: isUnpaidDay, disabled: isLocked }}
          >
            <Icon
              name={isUnpaidDay ? "check-circle" : "slash"}
              size={10}
              color={isUnpaidDay ? softAmber : colors.textMuted}
            />
            <Text style={[styles.turnaroundBtnText, styles.unpaidDayBtnText, { color: isUnpaidDay ? softAmber : colors.textMuted }]}>Unpaid day</Text>
          </TouchableOpacity>
        )}

        {showTurnaround && (
          <View style={styles.turnaroundActionRow}>
            <TouchableOpacity
              style={[
                styles.turnaroundBtn,
                {
                  backgroundColor: entry?.isTurnaround ? softSuccessBg : subtleChipBg,
                  borderColor: entry?.isTurnaround ? softSuccess : colors.border,
                  opacity: disabled ? 0.5 : canAddTurnaround || entry?.isTurnaround ? 1 : 0.5,
                },
              ]}
              onPress={() => {
                if (!canAddTurnaround && !entry?.isTurnaround) {
                  Alert.alert(turnaroundBlockedTitle, turnaroundBlockedMessage);
                  return;
                }
                toggleTurnaround(day);
              }}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityLabel={`${day} turnaround`}
              accessibilityState={{ checked: !!entry?.isTurnaround, disabled }}
            >
              <Icon name={entry?.isTurnaround ? "check-circle" : "refresh-ccw"} size={10} color={entry?.isTurnaround ? softSuccess : colors.textMuted} />
              <Text style={[styles.turnaroundBtnText, { color: entry?.isTurnaround ? softSuccess : colors.textMuted }]}>Turnaround</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderYardSegments = (day, segments, controlsDisabled = false) => {
    if (!Array.isArray(segments) || segments.length === 0) return null;
    const showBlockNotes = segments.length > 1;

    return segments.map((seg, idx) => (
      <View key={`${day}-segment-${idx}`} style={styles.segmentBlock}>
        <View style={styles.segmentRow}>
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

          {idx > 0 && (
            <TouchableOpacity
              onPress={() => removeYardSegment(day, idx)}
              style={[
                styles.segmentDelete,
                styles.compactSegmentDelete,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  opacity: controlsDisabled ? 0.5 : 1,
                },
              ]}
              disabled={controlsDisabled}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${day} time block ${idx + 1}`}
              accessibilityState={{ disabled: controlsDisabled }}
              hitSlop={6}
            >
              <Icon name="trash-2" size={14} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>

        {showBlockNotes && (
          <TextArea
            label={`${day} time block ${idx + 1} notes`}
            placeholder={`Notes for block ${idx + 1}`}
            disabled={controlsDisabled}
            value={String(seg?.note || "")}
            onChangeText={(t) => updateYardSegment(day, idx, "note", t)}
          />
        )}
      </View>
    ));
  };

  const renderWorkshopTimeBlocks = (day, entry, controlsDisabled = false) => {
    const segments = Array.isArray(entry?.yardSegments) && entry.yardSegments.length > 0
      ? entry.yardSegments
      : [{ start: yardDefaultStart, end: yardDefaultEnd, note: "" }];

    return (
      <View style={styles.workshopBlock}>
        <Text style={[styles.sectionCap, { color: colors.textMuted }]}>Workshop time</Text>
        {renderYardSegments(day, segments, controlsDisabled)}
        <TouchableOpacity
          style={[
            styles.addBlockBtn,
            { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
          ]}
          onPress={() => addWorkshopSegment(day)}
          disabled={controlsDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Add ${day} workshop time block`}
          accessibilityState={{ disabled: controlsDisabled }}
        >
          <Icon name="plus" size={14} color={addBlockButtonColors.color} />
          <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderWorkshopJobs = (day, entry, controlsDisabled = false) => {
    const rows = Array.isArray(entry?.workshopJobs) && entry.workshopJobs.length > 0
      ? entry.workshopJobs
      : [{ jobNumber: "", hours: "", note: "" }];

    return (
      <View style={styles.workshopBlock}>
        <Text style={[styles.sectionCap, { color: colors.textMuted }]}>Assign workshop hours to jobs</Text>
        {rows.map((row, idx) => (
          <View key={`${day}-workshop-${idx}`} style={styles.workshopAllocationBlock}>
            <View style={styles.workshopRow}>
              <FormField
                label={`${day} workshop block ${idx + 1} job number`}
                placeholder="Job number"
                style={{ flex: 1 }}
                disabled={controlsDisabled}
                value={String(row?.jobNumber || "")}
                onChangeText={(t) => updateWorkshopJob(day, idx, "jobNumber", t)}
                inputProps={{ autoCapitalize: "characters" }}
              />
              <FormField
                label={`${day} workshop block ${idx + 1} hours`}
                placeholder="Hours"
                style={{ width: 104 }}
                disabled={controlsDisabled}
                value={String(row?.hours || "")}
                onChangeText={(t) => updateWorkshopJob(day, idx, "hours", t.replace(/[^0-9.,]/g, ""))}
                inputProps={{ keyboardType: "decimal-pad" }}
              />
              <TouchableOpacity
                onPress={() => removeWorkshopJob(day, idx)}
                style={[
                  styles.segmentDelete,
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: controlsDisabled || rows.length <= 1 ? 0.5 : 1 },
                ]}
                disabled={controlsDisabled || rows.length <= 1}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${day} workshop block ${idx + 1}`}
                accessibilityState={{ disabled: controlsDisabled || rows.length <= 1 }}
              >
                <Icon name="trash-2" size={16} color={colors.danger} />
              </TouchableOpacity>
            </View>

          </View>
        ))}

        <TouchableOpacity
          style={[
            styles.addBlockBtn,
            { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
          ]}
          onPress={() => addWorkshopJob(day)}
          disabled={controlsDisabled}
          accessibilityRole="button"
          accessibilityLabel={`Add ${day} workshop hour block`}
          accessibilityState={{ disabled: controlsDisabled }}
        >
          <Icon name="plus" size={14} color={addBlockButtonColors.color} />
          <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add hour block</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderWorkshopModeRow = () => null;

  const renderDayNotesField = (day, value, disabled = false) => (
    <TextArea
      label={`${day} notes`}
      placeholder="Notes for this day"
      disabled={disabled}
      value={isTimeAllocationDayNote(value) ? "" : value || ""}
      onChangeText={(t) => updateDay(day, "dayNotes", t)}
      inputStyle={styles.dayNotesInput}
    />
  );

  return (
    <PageShell
      mode="form"
      width="content"
      header={{
        variant: "compact",
        title: `Week of ${formattedWeekStart}`,
        onBack: () => confirmDiscardChanges(
          () => router.back(),
          () => { void saveTimesheet({ exitAfterSave: true }); }
        ),
        metadata: <View style={[styles.pill, { backgroundColor: timesheet.submitted ? softSuccessBg : subtleChipBg, borderColor: timesheet.submitted ? softSuccess : colors.border }]}>
          <Text style={[styles.pillText, { color: timesheet.submitted ? softSuccess : colors.textMuted }]}>{statusLabel}</Text>
        </View>,
      }}
      refresh={{
        refreshing: timesheetsResource.isRefreshing || bookingsResource.isRefreshing || holidaysResource.isRefreshing,
        onRefresh: refreshWeekData,
      }}
    >
      <TurnaroundJobPicker
        visible={turnaroundPickerOpen}
        onClose={closeTurnaroundPicker}
        jobs={availableTurnaroundJobs}
        onPick={(job) => {
          if (!turnaroundPickerDay) return;
          setTurnaroundJobForDay(turnaroundPickerDay, job);
          setTurnaroundPickerOpen(false);
          setTurnaroundPickerDay(null);
        }}
      />

      <AppModal
        visible={!!dayTypePickerDay}
        title="Change day type"
        onRequestClose={() => setDayTypePickerDay(null)}
        actions={<AppButton label="Cancel" variant="secondary" onPress={() => setDayTypePickerDay(null)} />}
      >
            {dayTypeOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.modalItem, { borderBottomColor: colors.border }]}
                onPress={() => {
                  if (dayTypePickerDay) setDayWorkType(dayTypePickerDay, option.value);
                  setDayTypePickerDay(null);
                }}
                accessibilityRole="radio"
                accessibilityLabel={`${dayTypePickerDay || "Day"} ${option.label}`}
              >
                <Text style={{ color: colors.text, fontWeight: "800" }}>{option.label}</Text>
              </TouchableOpacity>
            ))}
      </AppModal>

      <AppModal
        visible={!!jobOverview}
        title={overviewJob ? `${overviewJob.jobNumber || overviewJob.id || "Job"} — ${getProductionDisplayName(overviewJob)}` : "Job overview"}
        onRequestClose={() => setJobOverview(null)}
        scrollable
        actions={<AppButton label="Done" onPress={() => setJobOverview(null)} />}
      >
            <View style={styles.jobOverviewContent}>
              {[
                { icon: "calendar", label: "Date", value: overviewDateISO ? formatDateDDMMYYYY(overviewDateISO) || overviewDateISO : "" },
                { icon: "briefcase", label: "Production", value: overviewJob ? getProductionDisplayName(overviewJob) : "" },
                { icon: "map-pin", label: "Location", value: overviewJob?.location || overviewJob?.address || overviewJob?.site || "" },
                { icon: "tag", label: "Type", value: overviewJob?.bookingType || overviewJob?.type || "" },
                { icon: "clock", label: "Call time", value: overviewCallTime },
                { icon: "truck", label: "Vehicles", value: overviewVehicles },
                { icon: "file-text", label: "Notes", value: overviewNotes },
              ]
                .filter((item) => String(item.value || "").trim())
                .map((item) => (
                  <View key={item.label} style={[styles.jobOverviewRow, { borderBottomColor: colors.border }]}>
                    <Icon name={item.icon} size={14} color={colors.textMuted} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.jobOverviewLabel, { color: colors.textMuted }]}>{item.label}</Text>
                      <Text style={[styles.jobOverviewValue, { color: colors.text }]}>{String(item.value)}</Text>
                    </View>
                  </View>
                ))}
            </View>
      </AppModal>

        <View style={[styles.stickyHeader, { backgroundColor: colors.background }]}>
          {isApproved && (
            <View style={styles.statusRow}>
              <Text style={[styles.statusHint, { color: colors.textMuted }]}>Approved by your manager. This week is locked and can’t be edited.</Text>
            </View>
          )}
        </View>

        <AsyncContentState
          resources={[timesheetsResource, bookingsResource, holidaysResource]}
          hasContent={
            !!currentWeekTimesheet
          }
          onRetry={refreshWeekData}
          loadingLabel="Loading week…"
        >

        {showTurnaroundSummary ? (
          <View style={[styles.creditBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.creditHeader}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setTurnaroundInfoOpen((current) => !current);
              }}
              accessibilityRole="button"
              accessibilityLabel="Turnaround credit information"
              accessibilityState={{ expanded: turnaroundInfoOpen }}
            >
              <View style={styles.creditHeaderTitle}>
                <Icon name="info" size={14} color={colors.textMuted} />
                <Text style={{ color: colors.text, fontWeight: "900" }}>Turnaround credits</Text>
              </View>
              <View style={styles.creditHeaderCount}>
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  {turnaroundCreditPoolRemaining}/{turnaroundCreditDisplayTotal} left
                </Text>
                <Icon name={turnaroundInfoOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
              </View>
            </TouchableOpacity>

            {turnaroundInfoOpen ? (
              <Text style={{ color: colors.textMuted, marginTop: t.spacing.xs, fontSize: t.typography.caption.fontSize }}>
                Credits come from booking notes marked “Night Shoot” or completed on-set days that wrapped past midnight in the last 3 weeks. New credits are available as soon as they are earned, each credit can only be used once, and Turnaround can only be used once per week.
              </Text>
            ) : null}
          </View>
        ) : null}

        {DAYS.map((day) => {
          const entryRaw = timesheet.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" };
          const entry = ensureModeDefaults(entryRaw);

          const jobs = jobsByDay?.[day] || [];
          const dayDateISO = getDateISOForDayName(id, day);
          const jobDayNote = jobs
            .map((job) => getBookingDayNote(job, dayDateISO))
            .filter((note) => note && !isTimeAllocationDayNote(note))
            .join(" • ");
          const holidayInfo = holidaysByDay?.[day];
          const bankHolidayInfo = bankHolidaysByDay?.[day];

          const isHoliday = !!holidayInfo;
          const isHalfHoliday = !!holidayInfo?.isHalfDay;
          const isFullHoliday = isHoliday && !isHalfHoliday;
          const isBankHolidayOff = !!bankHolidayInfo && bankHolidayInfo.notWorking === true;
          const isWorkedBankHoliday = isBankHolidayOff && boolish(entry.bankHolidayWorked);
          const isUnpaidDay = isUnpaidDayEntry(entry);
          const isUnpaidHalfHoliday = isUnpaidDay && isHoliday && isHalfHoliday;
          const hasAssignedJob = jobs.length > 0;

          const effectiveEntry =
            isHalfHoliday || (hasAssignedJob && String(entry.mode || "").toLowerCase() === "workshop")
              ? ensureModeDefaults({ ...entry, mode: "yard", workshopJobs: [] })
              : entry;
          const yardEntry = effectiveEntry.mode === "yard" ? ensureModeDefaults(effectiveEntry) : effectiveEntry;

          const primaryJobId = jobs.length > 0 ? jobs[0].id : null;

          const controlsDisabled =
            isLocked || isFullHoliday || (isUnpaidDay && !isUnpaidHalfHoliday) || (isBankHolidayOff && !isWorkedBankHoliday);
          const isWeekend = WEEKEND_SET.has(day);
          const isWeekendEnabled =
            isWeekend && String(effectiveEntry.mode || "off").toLowerCase() !== "off";

          let holidayLabel = isWeekend ? "Holiday" : "Paid Holiday";
          let holidayTone = softSuccess;
          if (!isWeekend && (holidayInfo?.isUnpaid || holidayInfo?.leaveType === "Unpaid")) {
            holidayLabel = "Unpaid Holiday";
            holidayTone = softAmber;
          } else if (!isWeekend && (holidayInfo?.isAccrued || holidayInfo?.leaveType === "Accrued")) {
            holidayLabel = "Accrued / TOIL Holiday";
            holidayTone = softSuccess;
          }

          const showTurnaroundButton =
            showTurnaroundControls &&
            !controlsDisabled &&
            !isHalfHoliday &&
            String(yardEntry.mode || "yard").toLowerCase() === "yard";

          const segsForUI = Array.isArray(yardEntry.yardSegments) ? yardEntry.yardSegments : [];
          const dayToggleOpen = !!togglePanelByDay?.[day];
          const dayTotalMinutes = computeDayMinutes(effectiveEntry, day);

          const hasTurnaroundCredit = (turnaroundUnusedCredits || 0) > 0;
          const canAddTurnaround = hasTurnaroundCredit && turnaroundCreditsRemaining > 0;
          const turnaroundBlockedTitle = hasTurnaroundCredit ? "Turnaround already used" : "No Turnaround credits";
          const turnaroundBlockedMessage = hasTurnaroundCredit
            ? "Turnaround can only be used once per week. Turn off the existing Turnaround day first if you need to move it."
            : "All available Turnaround credits from the last 3 weeks have already been used.";

          return (
            <View key={day}>
              <View
                style={[
                  styles.dayBlock,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                    opacity: isLocked ? 0.9 : 1,
                  },
                ]}
              >
                <View style={styles.dayHeaderRow}>
                  <View style={styles.dayTitleWrap}>
                    <Text style={[styles.dayTitle, { color: colors.text }]}>{day}</Text>
                    {isWeekend && !isWeekendEnabled && (
                      <Text style={[styles.dayModeTitle, { color: colors.textMuted }]}>Optional</Text>
                    )}
                    {!isFullHoliday && !!jobDayNote && (
                      <Text
                        style={[styles.dayModeTitle, { color: colors.textMuted }]}
                        numberOfLines={1}
                      >
                        {jobDayNote}
                      </Text>
                    )}
                    {dayTotalMinutes > 0 && (
                      <View
                        style={[
                          styles.dayTotalBadge,
                          { backgroundColor: softSuccessBg, borderColor: softSuccess },
                        ]}
                        accessibilityLabel={`${day} paid total ${formatHoursMins(dayTotalMinutes)}`}
                      >
                        <Icon name="clock" size={10} color={softSuccess} />
                        <Text style={[styles.dayTotalText, { color: softSuccess }]}>
                          {formatHoursMins(dayTotalMinutes)} paid
                        </Text>
                      </View>
                    )}
                  </View>

                  {renderWeekdayYardControls(day, yardEntry, {
                    isWeekend: isWeekend && !isWeekendEnabled,
                    isFullHoliday,
                    isBankHolidayOff,
                    isHalfHoliday,
                    isUnpaidDay,
                    hideUnpaid: isWeekend,
                    disabled: controlsDisabled,
                    showTurnaround: showTurnaroundButton,
                    canAddTurnaround,
                    turnaroundBlockedTitle,
                    turnaroundBlockedMessage,
                  })}

                  {isWeekend && !isWeekendEnabled && (
                    <TouchableOpacity
                      style={[
                        styles.addBlockBtn,
                        styles.weekendHeaderAction,
                        {
                          backgroundColor: addBlockButtonColors.backgroundColor,
                          borderColor: addBlockButtonColors.borderColor,
                          opacity: controlsDisabled ? 0.5 : 1,
                        },
                      ]}
                      onPress={() => addYardSegment(day)}
                      disabled={controlsDisabled}
                      accessibilityRole="button"
                      accessibilityLabel={`Add time block for ${day}`}
                    >
                      <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                      <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {isUnpaidDay && !isUnpaidHalfHoliday && (
                  <>
                    <View style={styles.unpaidInlineNote}>
                      <Text style={[styles.unpaidInlineText, { color: colors.textMuted }]}>
                        Hours hidden while enabled.
                      </Text>
                    </View>
                    {renderDayNotesField(day, entry.dayNotes, isLocked)}
                  </>
                )}

                {isBankHolidayOff && (
                  <View style={[styles.bankHolidayBlock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={{ color: colors.text, fontWeight: "900" }}>
                      {bankHolidayInfo?.name || "Bank Holiday"} {isWorkedBankHoliday ? "(Worked)" : "(Not working)"}
                    </Text>
                    <Text style={[styles.holidaySub, { color: colors.textMuted, marginTop: t.spacing.xxs }]}>
                      {isWorkedBankHoliday
                        ? "This bank holiday is being filled in as a worked day."
                        : "Not working by default. Add a time block if you worked this bank holiday."}
                    </Text>

                    {!isLocked && !isFullHoliday && !isWorkedBankHoliday && (
                      <TouchableOpacity
                        style={[
                          styles.addBlockBtn,
                          { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, marginTop: t.spacing.xs },
                        ]}
                        onPress={() => addYardSegment(day)}
                      >
                        <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                        <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                      </TouchableOpacity>
                    )}

                    {!isLocked && !isFullHoliday && isWorkedBankHoliday && (
                      <TouchableOpacity
                        style={[
                          styles.addBlockBtn,
                          { backgroundColor: colors.surface, borderColor: colors.danger, marginTop: t.spacing.xs },
                        ]}
                        onPress={() =>
                          Alert.alert(
                            "Clear bank holiday work?",
                            `This will remove all time blocks for ${day} and set it back to Bank Holiday (not working).`,
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Clear", style: "destructive", onPress: () => clearBankHolidayBlocks(day) },
                            ]
                          )
                        }
                      >
                        <Icon name="x-circle" size={14} color={colors.danger} />
                        <Text style={[styles.addBlockText, { color: colors.danger }]}>Clear bank holiday work</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

              {isHoliday && (
                <View
                  style={[
                    styles.holidayBlock,
                    { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: isHalfHoliday ? 8 : 0 },
                  ]}
                >
                  <View style={styles.holidayHeaderRow}>
                    <Text style={{ color: holidayTone, fontWeight: "bold" }}>
                      {holidayLabel}
                      {isHalfHoliday ? " (Half day)" : ""}
                    </Text>

                    {!!holidayInfo?.holidayReason && (
                      <Text style={[styles.holidaySub, { color: colors.textMuted }]}>{holidayInfo.holidayReason}</Text>
                    )}
                  </View>

                  {!!holidayInfo?.halfLabel && isHalfHoliday && (
                    <Text style={[styles.holidaySub, { color: colors.textMuted }]}>{holidayInfo.halfLabel}</Text>
                  )}

                  {isHalfHoliday && (
                    <Text style={[styles.holidaySub, { color: colors.textMuted }]}>
                      You can still add a Yard time block below for the working half.
                    </Text>
                  )}
                </View>
              )}

              {isFullHoliday || (isUnpaidDay && !isUnpaidHalfHoliday) ? null : jobs.length > 0 ? (
                <>
                  {jobs.map((job) => (
                    <View key={job.id} style={[styles.jobLink, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.jobMain, { color: colors.text }]} numberOfLines={1}>
                        {job.jobNumber || job.id} – {getProductionDisplayName(job)}
                      </Text>
                      {!!job.location && (
                        <Text style={[styles.jobSub, { color: colors.textMuted }]} numberOfLines={1}>
                          {job.location}
                        </Text>
                      )}
                      <IconButton
                        icon="info"
                        size={13}
                        variant="ghost"
                        compact
                        onPress={() =>
                          setJobOverview({
                            job,
                            day,
                            dateISO: weekDates[DAYS.indexOf(day)] || "",
                          })
                        }
                        label={`View overview for job ${job.jobNumber || job.id}`}
                      />
                    </View>
                  ))}

                  <View style={styles.modeRow}>
                    <TouchableOpacity
                      style={[
                        styles.modeBtn,
                        { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: controlsDisabled || isHalfHoliday ? 0.5 : 1 },
                        effectiveEntry.mode === "travel" && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                      ]}
                      onPress={() => !controlsDisabled && !isHalfHoliday && updateDay(day, "mode", "travel", primaryJobId)}
                      disabled={controlsDisabled || isHalfHoliday}
                      accessibilityRole="radio"
                      accessibilityLabel={`${day} travel mode`}
                      accessibilityState={{ checked: effectiveEntry.mode === "travel", disabled: controlsDisabled || isHalfHoliday }}
                    >
                      <Text style={[styles.modeText, { color: colors.text }]}>Travel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modeBtn,
                        { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: controlsDisabled || isHalfHoliday ? 0.5 : 1 },
                        effectiveEntry.mode === "onset" && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                      ]}
                      onPress={() => !controlsDisabled && !isHalfHoliday && updateDay(day, "mode", "onset", primaryJobId)}
                      disabled={controlsDisabled || isHalfHoliday}
                      accessibilityRole="radio"
                      accessibilityLabel={`${day} on set mode`}
                      accessibilityState={{ checked: effectiveEntry.mode === "onset", disabled: controlsDisabled || isHalfHoliday }}
                    >
                      <Text style={[styles.modeText, { color: colors.text }]}>On Set</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.modeBtn,
                        { backgroundColor: colors.surfaceAlt, borderColor: colors.border, opacity: controlsDisabled ? 0.5 : 1 },
                        effectiveEntry.mode === "yard" && { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                      ]}
                      onPress={() => !controlsDisabled && updateDay(day, "mode", "yard", primaryJobId)}
                      disabled={controlsDisabled}
                      accessibilityRole="radio"
                      accessibilityLabel={`${day} yard mode`}
                      accessibilityState={{ checked: effectiveEntry.mode === "yard", disabled: controlsDisabled }}
                    >
                      <Text style={[styles.modeText, { color: colors.text }]}>Yard</Text>
                    </TouchableOpacity>

                  </View>

                  {/* Travel UI */}
                  {!isHalfHoliday && effectiveEntry.mode === "travel" && (
                    <View style={styles.onSetBlock}>
                      <View style={styles.segmentRow}>
                        <TimeDropdown
                          label="Leave Time"
                          value={effectiveEntry.leaveTime}
                          onSelect={(t) => updateDay(day, "leaveTime", t)}
                          options={TIME_OPTIONS}
                          disabled={controlsDisabled}
                        />
                        <View style={{ width: 8 }} />
                        <TimeDropdown
                          label="Arrive Time"
                          value={effectiveEntry.arriveTime}
                          onSelect={(t) => updateDay(day, "arriveTime", t)}
                          options={TIME_OPTIONS}
                          disabled={controlsDisabled}
                          startFrom={effectiveEntry.leaveTime}
                        />
                      </View>

                      <View style={styles.toggleGrid}>
                        <InfoToggleRow
                          label="Travel meal?"
                          value={!!effectiveEntry.travelPD}
                          onChange={(v) => updateDay(day, "travelPD", v)}
                          disabled={controlsDisabled}
                          infoTitle="Travel Meal"
                          infoText="Turn this on if a travel meal is provided/covered for this travel day."
                          compact
                        />

                        <InfoToggleRow
                          label="Overnight?"
                          value={boolish(effectiveEntry.overnight)}
                          onChange={(v) => updateDay(day, "overnight", v)}
                          disabled={controlsDisabled}
                          infoTitle="Overnight"
                          infoText="Turn this on if your travel day required an overnight stay."
                          compact
                        />
                      </View>

                      {renderDayNotesField(day, effectiveEntry.dayNotes, controlsDisabled)}
                    </View>
                  )}

                  {/* On Set UI */}
                  {!isHalfHoliday && effectiveEntry.mode === "onset" && (
                    <View style={styles.onSetBlock}>
                      <View style={styles.timelineRow}>
                        <TimeDropdown
                          label="Leave Time"
                          value={effectiveEntry.leaveTime}
                          onSelect={(t) => updateDay(day, "leaveTime", t)}
                          options={TIME_OPTIONS}
                          disabled={controlsDisabled}
                          compact
                        />
                        <TimeGapLabel
                          start={effectiveEntry.leaveTime}
                          end={effectiveEntry.arriveTime}
                          label="Travel"
                        />
                      </View>

                      <View style={styles.timelineRow}>
                        <TimeDropdown
                          label="Arrive Time"
                          value={effectiveEntry.arriveTime}
                          onSelect={(t) => updateDay(day, "arriveTime", t)}
                          options={TIME_OPTIONS}
                          disabled={controlsDisabled}
                          startFrom={effectiveEntry.leaveTime}
                          compact
                        />
                        <TimeGapLabel
                          start={effectiveEntry.arriveTime}
                          end={hasValidPrecallSequence(effectiveEntry) ? effectiveEntry.precallDuration : effectiveEntry.callTime}
                          label={hasValidPrecallSequence(effectiveEntry) ? "Arrive to Pre-Call" : "Arrive to Unit Call"}
                          paidCapMinutes={ON_SET_EARLY_ARRIVAL_CAP_MINUTES}
                        />
                      </View>

                      <View style={styles.timelineRow}>
                        <PrecallDropdown
                          value={effectiveEntry.precallDuration}
                          onSelect={(v) => updateDay(day, "precallDuration", v)}
                          disabled={controlsDisabled}
                          startFrom={effectiveEntry.arriveTime}
                          invalidSequence={Boolean(
                            effectiveEntry.precallDuration
                            && effectiveEntry.callTime
                            && !hasValidPrecallSequence(effectiveEntry)
                          )}
                          compact
                        />
                        <TimeGapLabel
                          start={effectiveEntry.precallDuration}
                          end={effectiveEntry.callTime}
                          label="Pre-Call"
                          invalid={Boolean(
                            effectiveEntry.precallDuration
                            && effectiveEntry.callTime
                            && !hasValidPrecallSequence(effectiveEntry)
                          )}
                          maxElapsedMinutes={MAX_REASONABLE_PRECALL_WINDOW_MINUTES}
                        />
                      </View>

                      <View style={styles.timelineRangeRow}>
                        <View style={styles.timelineTimeStack}>
                          <TimeDropdown
                            label="Unit Call"
                            value={effectiveEntry.callTime}
                            onSelect={(t) => updateDay(day, "callTime", t)}
                            options={TIME_OPTIONS}
                            disabled={controlsDisabled}
                            startFrom={effectiveEntry.precallDuration || effectiveEntry.arriveTime}
                            compact
                            stacked
                          />
                          <TimeDropdown
                            label="Wrap Time"
                            value={effectiveEntry.wrapTime}
                            onSelect={(t) => updateDay(day, "wrapTime", t)}
                            options={TIME_OPTIONS}
                            disabled={controlsDisabled}
                            startFrom={effectiveEntry.callTime}
                            compact
                            stacked
                          />
                        </View>
                        <TimeGapLabel
                          start={effectiveEntry.callTime}
                          end={effectiveEntry.wrapTime}
                          label="On Set"
                          overtimeAfterMinutes={ON_SET_STANDARD_DAY_MINUTES}
                          minimumOvertimeMinutes={computeOnSetEarlyCallOvertimeMinutes(effectiveEntry)}
                          fillSpace
                        />
                      </View>

                      <View style={styles.timelineRow}>
                        <TimeDropdown
                          label="Arrive Back"
                          value={effectiveEntry.arriveBack}
                          onSelect={(t) => updateDay(day, "arriveBack", t)}
                          options={TIME_OPTIONS}
                          disabled={controlsDisabled}
                          startFrom={effectiveEntry.wrapTime}
                          compact
                        />
                        <TimeGapLabel
                          start={effectiveEntry.wrapTime}
                          end={effectiveEntry.arriveBack}
                          label="Travel"
                          includedWithinStandardMinutes={computeReturnTravelWithinStandardMinutes(effectiveEntry)}
                          shortDuration
                          splitSpace
                        />
                      </View>

                      <InfoToggleRow
                        label="Travel to another job?"
                        value={boolish(effectiveEntry.additionalTravelEnabled)}
                        onChange={(value) => updateDay(day, "additionalTravelEnabled", value)}
                        disabled={controlsDisabled}
                        infoTitle="Travel to another job"
                        infoText="Turn this on when you finish this on-set day and then travel for a different job. The extra travel time is added to this day's paid total."
                        compact
                      />

                      {boolish(effectiveEntry.additionalTravelEnabled) && (
                        <View style={styles.additionalTravelBlock}>
                          <FormField
                            label="Other job"
                            placeholder="Job number or production"
                            value={effectiveEntry.additionalTravelJob || ""}
                            onChangeText={(value) => updateDay(day, "additionalTravelJob", value)}
                            disabled={controlsDisabled}
                            density="compact"
                          />
                          <View style={styles.timelineRangeRow}>
                            <View style={styles.timelineTimeStack}>
                              <TimeDropdown
                                label="Travel from"
                                value={effectiveEntry.additionalTravelStartTime}
                                onSelect={(value) => updateDay(day, "additionalTravelStartTime", value)}
                                options={TIME_OPTIONS}
                                disabled={controlsDisabled}
                                startFrom={effectiveEntry.arriveBack || effectiveEntry.wrapTime}
                                compact
                                stacked
                              />
                              <TimeDropdown
                                label="Travel until"
                                value={effectiveEntry.additionalTravelEndTime}
                                onSelect={(value) => updateDay(day, "additionalTravelEndTime", value)}
                                options={TIME_OPTIONS}
                                disabled={controlsDisabled}
                                startFrom={effectiveEntry.additionalTravelStartTime}
                                compact
                                stacked
                              />
                            </View>
                            <TimeGapLabel
                              start={effectiveEntry.additionalTravelStartTime}
                              end={effectiveEntry.additionalTravelEndTime}
                              label="Extra travel"
                              fillSpace
                            />
                          </View>
                        </View>
                      )}

                      {renderToggleButton(day, controlsDisabled)}

                      {dayToggleOpen && (
                        <View style={styles.toggleGrid}>
                          <InfoToggleRow
                            label="Overnight?"
                            value={boolish(effectiveEntry.overnight)}
                            onChange={(v) => updateDay(day, "overnight", v)}
                            disabled={controlsDisabled}
                            infoTitle="Overnight"
                            infoText="Turn this on if you stayed overnight (hotel or accommodation)."
                            compact
                          />

                          <InfoToggleRow
                            label="Night Shoot?"
                            value={!!effectiveEntry.nightShoot}
                            onChange={(v) => updateDay(day, "nightShoot", v)}
                            disabled={controlsDisabled}
                            infoTitle="Night Shoot"
                            infoText="Turn this on if shoot is a night shoot (or you shoot past 12:00 midnight)."
                            compact
                          />

                          <InfoToggleRow
                            label="Generator used?"
                            value={!!effectiveEntry.generatorUsed}
                            onChange={(v) => updateDay(day, "generatorUsed", v)}
                            disabled={controlsDisabled}
                            infoTitle="Generator Used"
                            infoText="Turn this on if a generator was used on this on-set day."
                            compact
                          />

                          <InfoToggleRow
                            label="Late supp?"
                            value={!!effectiveEntry.lateSup}
                            onChange={(v) => updateDay(day, "lateSup", v)}
                            disabled={controlsDisabled}
                            infoTitle="Late supplement"
                            infoText="Turn this on if you wrapped after 21:59. Setting Wrap Time to 22:00 or later will turn this on automatically."
                            compact
                          />

                          <InfoToggleRow
                            label="Meal supp?"
                            value={!!effectiveEntry.mealSup}
                            onChange={(v) => updateDay(day, "mealSup", v)}
                            disabled={controlsDisabled}
                            infoTitle="Meal supplement"
                            infoText="Turn this on only if there was no meal supplement/food offered on set. If catering was offered but you chose not to eat, do not turn this on."
                            compact
                          />
                        </View>
                      )}

                      {renderDayNotesField(day, effectiveEntry.dayNotes, controlsDisabled)}
                    </View>
                  )}

                  {!isHalfHoliday && jobs.length === 0 && effectiveEntry.mode === "workshop" && (
                    <View style={styles.onSetBlock}>
                      {renderWorkshopTimeBlocks(day, effectiveEntry, controlsDisabled)}
                      {renderWorkshopJobs(day, effectiveEntry, controlsDisabled)}
                      {renderDayNotesField(day, effectiveEntry.dayNotes, controlsDisabled)}
                    </View>
                  )}

                  {/* Yard block */}
                  {yardEntry.mode === "yard" && (
                    <>

                      {yardEntry.isTurnaround === true && (
                        <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                          <Text style={{ color: colors.textMuted, fontSize: t.typography.caption.fontSize, fontWeight: "800" }}>Credit earned from job</Text>

                          <TouchableOpacity
                            style={[styles.turnaroundSelect, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}
                            onPress={() => {
                              setTurnaroundPickerDay(day);
                              setTurnaroundPickerOpen(true);
                            }}
                            disabled={controlsDisabled}
                          >
                            <Text style={{ color: yardEntry.turnaroundJob?.bookingId ? colors.text : colors.textMuted }}>
                              {yardEntry.turnaroundJob?.bookingId
                                ? `${yardEntry.turnaroundJob.jobNumber || yardEntry.turnaroundJob.bookingId} — ${yardEntry.turnaroundJob.client || "Client"}`
                                : "Select job"}
                            </Text>
                            <Icon name="chevron-down" size={16} color={colors.textMuted} />
                          </TouchableOpacity>

                          {yardEntry.turnaroundJob?.location ? (
                            <Text style={{ color: colors.textMuted, marginTop: t.spacing.xxs, fontSize: t.typography.metadata.fontSize }}>{yardEntry.turnaroundJob.location}</Text>
                          ) : null}

                          <Text style={{ color: colors.textMuted, marginTop: t.spacing.xxs, fontSize: t.typography.caption.fontSize }}>
                            Note: Turnaround days don’t auto-create time blocks — add one only if needed.
                          </Text>
                        </View>
                      )}

                      {renderYardSegments(day, segsForUI, controlsDisabled)}

                      <View style={styles.addBlockRow}>
                        <TouchableOpacity
                                                style={[
                                                  styles.addBlockBtn,
                                                  styles.addBlockRowAction,
                                                  { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
                                                ]}
                                                onPress={() => addYardSegment(day)}
                                                disabled={controlsDisabled}
                                              >
                                                <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                                                <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                                              </TouchableOpacity>
                        {renderToggleButton(day, controlsDisabled, styles.addBlockRowAction)}
                      </View>

                      {isWeekend && (segsForUI.length || 0) > 0 && (
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

                      {renderYardToggleFields(day, yardEntry, controlsDisabled)}

                      {renderDayNotesField(day, yardEntry.dayNotes, controlsDisabled)}
                    </>
                  )}
                </>
              ) : isWeekend && !isWeekendEnabled ? (
                <>
                  {String(entry.mode || "").toLowerCase() === "workshop" ? (
                    <>
                      {renderWorkshopModeRow(day, entry, controlsDisabled)}
                      {renderWorkshopTimeBlocks(day, entry, controlsDisabled)}
                      {renderWorkshopJobs(day, entry, controlsDisabled)}
                      {renderDayNotesField(day, entry.dayNotes, controlsDisabled)}
                    </>
                  ) : String(entry.mode || "").toLowerCase() !== "yard" ? (
                    <>
                      {renderWorkshopModeRow(day, entry, controlsDisabled)}
                    </>
                  ) : (
                    <>
                      {renderWorkshopModeRow(day, entry, controlsDisabled)}
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        {showTurnaroundControls && !controlsDisabled && !isHalfHoliday && (
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
                                Alert.alert(turnaroundBlockedTitle, turnaroundBlockedMessage);
                                return;
                              }
                              toggleTurnaround(day);
                            }}
                            disabled={controlsDisabled}
                          >
                            <Icon name={entry.isTurnaround ? "check-circle" : "refresh-ccw"} size={10} color={entry.isTurnaround ? colors.accent : colors.text} />
                            <Text style={[styles.turnaroundBtnText, { color: colors.text }]}>Turnaround</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {entry.isTurnaround === true && (
                        <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                          <Text style={{ color: colors.textMuted, fontSize: t.typography.caption.fontSize, fontWeight: "800" }}>Credit earned from job</Text>

                          <TouchableOpacity
                            style={[styles.turnaroundSelect, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}
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

                      {renderYardSegments(day, entry.yardSegments, controlsDisabled)}

                      <View style={styles.addBlockRow}>
                        <TouchableOpacity
                          style={[
                            styles.addBlockBtn,
                            styles.addBlockRowAction,
                            { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
                          ]}
                          onPress={() => addYardSegment(day)}
                          disabled={controlsDisabled}
                        >
                          <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                          <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                        </TouchableOpacity>
                        {renderToggleButton(day, controlsDisabled, styles.addBlockRowAction)}
                      </View>

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

                      {renderYardToggleFields(day, entry, controlsDisabled)}

                      {renderDayNotesField(day, entry.dayNotes, controlsDisabled)}
                    </>
                  )}
                </>
              ) : isBankHolidayOff && !isWorkedBankHoliday ? (
                <Text style={{ color: colors.textMuted }}>Off (Bank Holiday)</Text>
              ) : (
                <>
                  {String(entry.mode || "").toLowerCase() === "workshop" ? (
                    <>
                      {renderWorkshopModeRow(day, entry, controlsDisabled)}
                      {renderWorkshopTimeBlocks(day, entry, controlsDisabled)}
                      {renderWorkshopJobs(day, entry, controlsDisabled)}
                      {renderDayNotesField(day, entry.dayNotes, controlsDisabled)}
                    </>
                  ) : (
                    <>
                      {renderWorkshopModeRow(day, entry, controlsDisabled)}

                  {entry.isTurnaround === true && (
                    <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ color: colors.textMuted, fontSize: t.typography.caption.fontSize, fontWeight: "800" }}>Credit earned from job</Text>

                      <TouchableOpacity
                        style={[styles.turnaroundSelect, { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder }]}
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

                  {renderYardSegments(day, entry.yardSegments, controlsDisabled)}

                  <View style={styles.addBlockRow}>
                    <TouchableOpacity
                      style={[
                        styles.addBlockBtn,
                        styles.addBlockRowAction,
                        { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
                      ]}
                      onPress={() => addYardSegment(day)}
                      disabled={controlsDisabled}
                    >
                      <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                      <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                    </TouchableOpacity>
                    {renderToggleButton(day, controlsDisabled, styles.addBlockRowAction)}
                  </View>

                  {isWeekend && entry.yardSegments?.length > 0 && (
                    <TouchableOpacity
                      style={[
                        styles.addBlockBtn,
                        { backgroundColor: colors.surface, borderColor: colors.danger, opacity: controlsDisabled ? 0.5 : 1 },
                      ]}
                      onPress={() =>
                        Alert.alert("Turn off weekend day?", `This will remove all time blocks for ${day} and return it to Weekend (optional).`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Turn off", style: "destructive", onPress: () => clearWeekendBlocks(day) },
                        ])
                      }
                      disabled={controlsDisabled}
                      accessibilityRole="button"
                      accessibilityLabel={`Turn off ${day}`}
                    >
                      <Icon name="x-circle" size={14} color={colors.danger} />
                      <Text style={[styles.addBlockText, { color: colors.danger }]}>Turn off weekend day</Text>
                    </TouchableOpacity>
                  )}

                  {renderYardToggleFields(day, entry, controlsDisabled)}

                  {renderDayNotesField(day, entry.dayNotes, controlsDisabled)}
                    </>
                  )}
                </>
              )}
              </View>
            </View>
          );
        })}

        <TextArea
          label="General notes for the week"
          placeholder="General notes for the week"
          disabled={isLocked}
          value={timesheet.notes}
          onChangeText={(t) => setTimesheet((prev) => ({ ...prev, notes: t }))}
        />

        <HoursSummary timesheet={timesheet} holidaysByDay={holidaysByDay} bankHolidaysByDay={bankHolidaysByDay} />

        <View style={styles.actionRow}>
          {isLocked ? (
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={[styles.statusHint, { color: colors.textMuted }]}>
                This timesheet is approved and locked. Contact your manager if a change is needed.
              </Text>
            </View>
          ) : !timesheet.submitted ? (
            <>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1 }]}
                onPress={saveTimesheet}
                accessibilityRole="button"
                accessibilityLabel="Save timesheet draft"
              >
                <Text style={[styles.actionButtonText, { color: colors.text }]}>Save Draft</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: colors.accent }]}
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
                accessibilityRole="button"
                accessibilityLabel="Submit timesheet for approval"
              >
                <Text style={[styles.actionButtonText, { color: colors.textOnAccent }]}>Submit for Approval</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.accent }]} onPress={saveTimesheet} accessibilityRole="button" accessibilityLabel="Update submitted timesheet">
              <Text style={[styles.actionButtonText, { color: colors.textOnAccent }]}>Update Submission</Text>
            </TouchableOpacity>
          )}
        </View>
        </AsyncContentState>
    </PageShell>
  );
}

/* ───────────────────────── styles ───────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, padding: t.spacing.xxs },
  stickyHeader: { paddingTop: t.spacing.none, marginBottom: t.spacing.xs },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: t.spacing.xs, gap: t.spacing.xs },
  backBtn: { flexDirection: "row", alignItems: "center", minWidth: 64, minHeight: 44 },
  backText: { fontSize: t.typography.body.fontSize, marginLeft: t.spacing.xxs },
  title: { flex: 1, fontSize: t.typography.bodyLarge.fontSize, fontWeight: "700", textAlign: "center" },

  statusRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs, marginBottom: t.spacing.xs },
  statusRowCentered: { justifyContent: "center" },
  pill: { paddingVertical: t.spacing.xxs, paddingHorizontal: t.spacing.xs, borderRadius: t.radius.pill, borderWidth: 1, marginRight: t.spacing.xxs },
  pillText: { fontWeight: "800", fontSize: t.typography.caption.fontSize },
  statusHint: { fontSize: t.typography.caption.fontSize },

  creditBox: {
    marginBottom: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: 1,
    padding: t.spacing.xs,
  },
  creditHeader: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  creditHeaderTitle: { flexDirection: "row", alignItems: "center", gap: t.spacing.xxs, flexShrink: 1 },
  creditHeaderCount: { flexDirection: "row", alignItems: "center", gap: t.spacing.xxs, flexShrink: 0 },

  dayHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
    marginBottom: t.spacing.xxs,
  },
  dayTitleWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: t.spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  dayBlock: {
    padding: t.spacing.xs,
    borderRadius: t.radius.sm,
    marginBottom: t.spacing.xs,
    borderWidth: 1,
  },
  dayTitle: { fontSize: t.typography.body.fontSize, fontWeight: "700" },
  dayModeTitle: { fontSize: t.typography.metadata.fontSize, fontWeight: "700", opacity: 0.9, flexShrink: 1 },
  dayTotalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    paddingVertical: t.spacing.none,
    paddingHorizontal: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    flexShrink: 0,
    alignSelf: "center",
  },
  dayTotalText: { fontSize: t.typography.micro.fontSize, fontWeight: "800" },
  dayTypeDropdown: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    flexShrink: 1,
  },
  unpaidToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: t.spacing.xxs,
    marginBottom: t.spacing.none,
    flexShrink: 0,
  },
  turnaroundActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  unpaidInlineNote: { marginBottom: t.spacing.xxs },
  unpaidInlineText: { fontSize: t.typography.bodyLarge.fontSize },

  bankHolidayBlock: { padding: t.spacing.xs, borderRadius: t.radius.sm, borderWidth: 1, marginBottom: t.spacing.xxs },

  holidayBlock: { padding: t.spacing.xs, borderRadius: t.radius.sm, borderWidth: 1 },
  holidayHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: t.spacing.xs },
  holidaySub: { fontSize: t.typography.caption.fontSize, marginTop: t.spacing.xxs },

  modeRow: { flexDirection: "row", marginBottom: t.spacing.xxs, gap: t.spacing.xxs },
  modeBtn: {
    flex: 1,
    width: 0,
    minWidth: 0,
    minHeight: 32,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  modeBtnSingle: { flex: 1, paddingHorizontal: t.spacing.md },
  modeText: { fontSize: t.typography.metadata.fontSize, fontWeight: "700" },

  onSetBlock: { marginTop: t.spacing.none },
  additionalTravelBlock: { marginTop: t.spacing.xxs, marginBottom: t.spacing.xxs },
  timeDropdownWrap: { marginBottom: t.spacing.xxs, flex: 1 },
  precallDropdownWrap: { marginBottom: t.spacing.xs },
  timelineRow: { flexDirection: "row", alignItems: "flex-end", gap: t.spacing.xs },
  timelineRangeRow: { flexDirection: "row", alignItems: "stretch", gap: t.spacing.xs },
  timelineTimeStack: { flex: 1 },
  timelineTimeField: {
    width: "auto",
    alignSelf: "stretch",
    flex: 1,
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  timelineStackTimeField: { width: "100%", flex: 0 },
  timelineInlineLabel: { width: 68, marginBottom: t.spacing.none, flexShrink: 0 },
  timelineInlineDropdown: { flex: 1, alignItems: "center" },
  timeGapRow: {
    width: "42%",
    minHeight: 32,
    alignItems: "stretch",
    justifyContent: "center",
    marginBottom: t.spacing.xxs,
  },
  timeGapPill: {
    minHeight: 32,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  timeGapText: { flexShrink: 1, fontSize: t.typography.micro.fontSize, fontWeight: "800", textAlign: "center" },
  timeGapFill: { alignSelf: "stretch" },
  timeGapPillFill: { flex: 1, borderRadius: t.radius.xl, flexDirection: "row", gap: t.spacing.xxs },
  timeGapTextFill: { fontSize: t.typography.micro.fontSize, lineHeight: t.typography.micro.lineHeight },
  timeGapPillSplit: { flex: 1, borderRadius: t.radius.xl },
  timeGapTextSplit: { fontSize: t.typography.micro.fontSize, lineHeight: t.typography.micro.lineHeight },

  label: { fontSize: t.typography.caption.fontSize, marginBottom: t.spacing.none },
  dropdownBox: {
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  timePickerHeading: { gap: t.spacing.xxs, paddingHorizontal: t.spacing.sm, paddingTop: t.spacing.xs, paddingBottom: t.spacing.xs },

  sectionCap: { marginBottom: t.spacing.xxs, fontWeight: "700", fontSize: t.typography.metadata.fontSize, opacity: 0.9 },
  segmentBlock: { marginBottom: t.spacing.xxs },
  segmentRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.xxs, marginBottom: t.spacing.xxs },
  workshopBlock: { marginTop: t.spacing.none, marginBottom: t.spacing.xxs },
  workshopAllocationBlock: { marginBottom: t.spacing.xs },
  workshopRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.xxs, marginBottom: t.spacing.xxs },
  workshopJobInput: { flex: 1, paddingVertical: t.spacing.xs, paddingHorizontal: t.spacing.xs, borderRadius: t.radius.sm, fontSize: t.typography.metadata.fontSize, borderWidth: 1, minHeight: 36 },
  workshopHoursInput: { width: 82, paddingVertical: t.spacing.xs, paddingHorizontal: t.spacing.xs, borderRadius: t.radius.sm, fontSize: t.typography.metadata.fontSize, borderWidth: 1, minHeight: 36, textAlign: "center" },
  segmentDelete: {
    marginLeft: t.spacing.xxs,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    width: 44,
    height: 44,
  },
  compactSegmentDelete: {
    width: 34,
    height: 34,
    marginLeft: t.spacing.none,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.none,
  },
  segmentNoteInput: { paddingVertical: t.spacing.xxs, paddingHorizontal: t.spacing.xs, borderRadius: t.radius.sm, fontSize: t.typography.metadata.fontSize, borderWidth: 1, minHeight: 32 },

  addBlockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.sm,
    marginTop: t.spacing.none,
    marginBottom: t.spacing.xxs,
  },
  addBlockRowAction: {
    flex: 1,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  weekendHeaderAction: { alignSelf: "center", flexShrink: 0 },
  addBlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    alignSelf: "flex-end",
    paddingVertical: t.spacing.none,
    minHeight: 30,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  addBlockText: { fontWeight: "700", fontSize: t.typography.metadata.fontSize },
  jobLink: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs, paddingVertical: t.spacing.xxs, paddingHorizontal: t.spacing.xs, borderRadius: t.radius.sm, marginBottom: t.spacing.xxs, borderWidth: 1 },
  jobMain: { flex: 1, minWidth: 0, fontWeight: "700", fontSize: t.typography.bodyLarge.fontSize },
  jobSub: { flexShrink: 1, maxWidth: "38%", fontSize: t.typography.metadata.fontSize, textAlign: "right" },
  jobOverviewCard: {
    width: "88%",
    maxWidth: 520,
    maxHeight: "72%",
    borderRadius: t.radius.xl,
    borderWidth: 1,
    padding: t.spacing.sm,
  },
  jobOverviewHeader: { flexDirection: "row", alignItems: "center", gap: t.spacing.xs, marginBottom: t.spacing.xs },
  jobOverviewEyebrow: { fontSize: t.typography.micro.fontSize, fontWeight: "900", letterSpacing: 1.2, marginBottom: t.spacing.none },
  jobOverviewTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "900" },
  jobOverviewClose: {
    width: 32,
    height: 32,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  jobOverviewContent: { paddingBottom: t.spacing.xxs },
  jobOverviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  jobOverviewLabel: { fontSize: t.typography.micro.fontSize, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: t.spacing.none },
  jobOverviewValue: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "700", lineHeight: t.typography.bodyLarge.lineHeight },
  jobOverviewDone: { minHeight: 42, borderRadius: t.radius.md, alignItems: "center", justifyContent: "center", marginTop: t.spacing.xs },
  jobOverviewDoneText: { fontSize: t.typography.bodySmall.fontSize, fontWeight: "900" },

  dayNotesInput: {
    height: t.controls.buttonHeight,
    minHeight: t.controls.buttonHeight,
  },

  dayInput: {
    paddingVertical: t.spacing.none,
    paddingHorizontal: t.spacing.xs,
    minHeight: 32,
    borderRadius: t.radius.sm,
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    borderWidth: 1,
    textAlignVertical: "center",
  },
  input: { padding: t.spacing.xs, borderRadius: t.radius.sm, marginHorizontal: t.spacing.xs, marginTop: t.spacing.xs, marginBottom: t.spacing.xs, fontSize: t.typography.bodySmall.fontSize, height: 55, borderWidth: 1 },

  toggleGrid: { flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 4, marginVertical: t.spacing.xxs },
  toggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: t.spacing.none, gap: t.spacing.xxs },
  toggleRowCompact: {
    flexBasis: "48%",
    maxWidth: "48%",
    flexGrow: 1,
    marginVertical: t.spacing.none,
    minHeight: 34,
    paddingVertical: t.spacing.none,
    paddingHorizontal: t.spacing.xxs,
    borderRadius: t.radius.sm,
  },
  toggleTextWrap: { flex: 1, minWidth: 0 },
  toggleLabelRow: { flexDirection: "row", alignItems: "center", gap: t.spacing.xxs, flexWrap: "wrap" },
  toggleLabelRowCompact: { flexWrap: "nowrap" },
  toggleStatusText: { fontSize: t.typography.micro.fontSize, fontWeight: "800", flexShrink: 1 },
  labelCompact: { fontSize: t.typography.micro.fontSize, flexShrink: 1 },
  switchCompact: { transform: [{ scaleX: 0.78 }, { scaleY: 0.78 }], marginHorizontal: -5 },
  modalOverlay: { flex: 1, backgroundColor: staticColors.rgba_11xlyme, justifyContent: "center", alignItems: "center" },
  modalBox: { width: "70%", maxHeight: "60%", borderRadius: t.radius.md, padding: t.spacing.xs, borderWidth: 1 },
  modalItem: {
    height: TIME_OPTION_ROW_HEIGHT,
    paddingHorizontal: t.spacing.xs,
    borderBottomWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  modalSelectedIcon: {
    position: "absolute",
    right: 12,
  },
  closeBtn: { marginTop: t.spacing.xs, padding: t.spacing.xs, borderRadius: t.radius.sm, alignItems: "center" },

  actionButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingVertical: t.spacing.sm, borderRadius: t.radius.sm, marginHorizontal: t.spacing.none },
  actionButtonText: { fontWeight: "bold", fontSize: t.typography.bodyLarge.fontSize },
  actionRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: t.spacing.xxs,
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },

  turnaroundBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    paddingVertical: t.spacing.none,
    minHeight: 24,
    paddingHorizontal: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  turnaroundBtnText: { fontWeight: "700", fontSize: t.typography.micro.fontSize, letterSpacing: 0.1 },
  unpaidDayBtn: { minHeight: 24, paddingVertical: t.spacing.none, paddingHorizontal: t.spacing.xxs, gap: t.spacing.xxs },
  unpaidDayBtnText: { fontSize: t.typography.micro.fontSize, letterSpacing: 0.1 },
  turnaroundPanel: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.xs,
    marginBottom: t.spacing.xs,
  },
  turnaroundSelect: {
    marginTop: t.spacing.xxs,
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.xs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  summaryBox: {
    width: "100%",
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: 1,
    padding: t.spacing.xs,
  },
  summaryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: t.spacing.xxs,
  },
  summaryLabel: { fontSize: t.typography.metadata.fontSize, fontWeight: "700" },
  summarySubLabel: { fontSize: t.typography.caption.fontSize, fontWeight: "700", paddingLeft: t.spacing.sm },
  summaryValue: { fontSize: t.typography.metadata.fontSize, fontWeight: "900" },
  summaryDivider: { height: 1, opacity: 0.4, marginVertical: t.spacing.xs },
});
