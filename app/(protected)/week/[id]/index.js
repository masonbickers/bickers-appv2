"use client";

import { useLocalSearchParams, useRouter } from "expo-router";
import { useNavigation } from "@react-navigation/native";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  LayoutAnimation,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../../../firebaseConfig";
import { runOrQueueFirestoreMutation } from "../../../../lib/sync/firestoreQueue";
import { useAuth } from "../../../providers/AuthProvider";
import { useTheme } from "../../../providers/ThemeProvider";

/* ───────────────────────────────
   BANK HOLIDAYS (UK via GOV.UK)
   - Source: https://www.gov.uk/bank-holidays.json
   - Region options: "england-and-wales" | "scotland" | "northern-ireland"
──────────────────────────────── */
const BANK_HOLIDAY_REGION = "england-and-wales";

// Turnaround lookback window (was 2 weeks / 14 days)
const TURNAROUND_LOOKBACK_DAYS = 21; // 3 weeks
const TURNAROUND_MAX_USES_PER_WEEK = 1;

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
  return String(v || "").trim().toLowerCase() === "office" ? "office" : "yard";
}

function formatDisplayDate(value) {
  const parsed = toDateSafe(value);
  if (!parsed) return String(value || "");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const yyyy = parsed.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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
      const yardTravelArriveOffset =
        boolish(e.yardTravelEnabled) && e.yardTravelLeaveTime && e.yardTravelArriveTime
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
      const crossesMidnight =
        (arriveBackOffset?.dayOffset ?? 0) === 1 || (wrapOffset?.dayOffset ?? 0) === 1;

      next.days[dayName] = {
        ...e,
        overnight: boolish(e.overnight),
        crossesMidnight,
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
  if (String(e.mode || "yard").toLowerCase() === "yard") {
    if (typeof e.lunchSup !== "boolean") e.lunchSup = true;
  } else {
    if (typeof e.lunchSup !== "boolean") e.lunchSup = false;
  }
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

  // on-set meal supplement toggle
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
    e.leaveTime = normaliseTimeValue(e.leaveTime) || DEFAULT_YARD_START;
    e.arriveBack = normaliseTimeValue(e.arriveBack) || DEFAULT_YARD_END;

    // IMPORTANT: when Turnaround Day is ON, do NOT auto-add time blocks
    if (!e.isTurnaround) e = ensureYardSegments(e);
    e = ensureYardLunch(e);
    e = ensureYardTravel(e);
    e.precallDuration = e.precallDuration ?? null;
  } else {
    e = ensureYardLunch(e);
    e = ensureYardTravel(e);
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

function buildLastNDatesISO(n) {
  const out = [];
  const today = startOfDay(new Date());
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(iso(d));
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
  const raw = notesByDate?.[dateISO];
  const rawStr =
    typeof raw === "string"
      ? raw
      : typeof raw === "object" && raw
      ? String(raw.label || raw.value || raw.note || "")
      : "";

  if (hasNightShootInNotes(rawStr)) return true;

  if (String(rawStr).trim().toLowerCase() === "other") {
    const otherVal = notesByDate?.[`${dateISO}-other`];
    if (hasNightShootInNotes(otherVal)) return true;
  }

  return false;
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
    const entry = ensureModeDefaults(days?.[dayName] || {});
    if (String(entry.mode || "").toLowerCase() === "yard" && entry.isTurnaround === true) {
      used += 1;
    }
  }

  return used;
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
        <Text style={{ color: value ? colors.text : colors.textMuted }}>{value || "Select"}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, { borderBottomColor: colors.border }]}
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
              <Text style={{ color: colors.textOnAccent }}>Clear time</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setOpen(false)}>
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
      <Text style={[styles.label, { color: colors.textMuted }]}>Pre-Call Time</Text>

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
          {value || "Select Pre-Call Time"}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <FlatList
              data={TIME_OPTIONS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, { borderBottomColor: colors.border }]}
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
                onSelect(null);
                setOpen(false);
              }}
            >
              <Text style={{ color: colors.textOnAccent }}>Clear pre-call</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]} onPress={() => setOpen(false)}>
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
        <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>{label}</Text>
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

          <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]} onPress={onClose}>
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

  if (mode === "off" || mode === "holiday" || mode === "bankholiday" || mode === "unpaid") return 0;

  if (mode === "yard") {
    const segs = Array.isArray(e.yardSegments) ? e.yardSegments : [];
    let total = 0;
    for (const seg of segs) total += durationMinutes(seg?.start, seg?.end);
    if (boolish(e.yardTravelEnabled)) total += durationMinutes(e.yardTravelLeaveTime, e.yardTravelArriveTime);
    if (!boolish(e.lunchSup) && total > 0) total = Math.max(0, total - 30);
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

    // Add pre-call window when both pre-call and unit call are set.
    if (e.callTime && e.precallDuration) {
      mins += Math.max(0, durationMinutes(e.precallDuration, e.callTime));
    }

    return mins;
  }

  return 0;
}

/* -------------------------- Summary panel -------------------------- */
function HoursSummary({ timesheet, holidaysByDay, bankHolidaysByDay }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

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
    let unpaidDays = 0;
    let paidHolidayDays = 0;
    let unpaidHolidayDays = 0;
    let bankHolidayDays = 0;
    let halfHolidayDays = 0;

    let lunchCount = 0;
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

      if (isFullHoliday) {
        if (hol?.isUnpaid || hol?.leaveType === "Unpaid") unpaidHolidayDays += 1;
        else paidHolidayDays += 1;
      }
      if (isHalfHoliday) halfHolidayDays += 1;
      if (!isHoliday && isBankHolidayOff) bankHolidayDays += 1;

      const raw = timesheet?.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard" };
      const e = ensureModeDefaults(raw);

      const mode = String(e.mode || "off").toLowerCase();

      // count "off" only when it is actually off (and not a holiday/bank holiday lock)
      if (mode === "off") offDays += 1;
      if (mode === "unpaid") unpaidDays += 1;

      if (mode === "yard") {
        yardDays += 1;
        if (!boolish(e.lunchSup)) lunchCount += 1;
        if (e.isTurnaround === true) turnaroundCount += 1;
      }
      if (mode === "travel") {
        travelDays += 1;
        if (!!e.travelPD) pdCount += 1;
        if (boolish(e.overnight)) overnightCount += 1;
      }
      if (mode === "onset") {
        onsetDays += 1;
        if (!!e.mealSup) mealSupCount += 1;
        if (!!e.nightShoot) nightShootCount += 1;
        if (boolish(e.overnight)) overnightCount += 1;
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
      unpaidDays,
      paidHolidayDays,
      unpaidHolidayDays,
      bankHolidayDays,
      halfHolidayDays,
      lunchCount,
      mealSupCount,
      pdCount,
      nightShootCount,
      overnightCount,
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
          <Text style={{ color: colors.text, fontWeight: "900", marginBottom: 2 }}>Week Summary</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>Total {formatHoursMins(summary.total)}</Text>
        </View>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
      </TouchableOpacity>

      {open && (
        <>
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
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Meal supp (on set)</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.mealSupCount}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Travel meal</Text>
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
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Paid holidays</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.paidHolidayDays}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Unpaid holidays</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.unpaidHolidayDays}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Unpaid days</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.unpaidDays}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Half-holiday days</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.halfHolidayDays}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>Bank holidays</Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>{summary.bankHolidayDays}</Text>
          </View>
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
  const { colors, colorScheme } = useTheme();
  const insets = useSafeAreaInsets();
  const allowNavigationRef = useRef(false);
  const pendingNavigationActionRef = useRef(null);
  const softSuccess = colorScheme === "dark" ? "#7ED8A7" : "#188A52";
  const softSuccessBg = colorScheme === "dark" ? "#163126" : "#E9F6EE";
  const softAmber = colorScheme === "dark" ? "#E0B15B" : "#B87716";
  const softAmberBg = colorScheme === "dark" ? "#2D2414" : "#FBF1DE";
  const subtleChipBg = colorScheme === "dark" ? "#17181D" : colors.surface;
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
        : {
            mode: "yard",
            leaveTime: yardDefaultStart,
            arriveBack: yardDefaultEnd,
            dayNotes: "",
            precallDuration: null,
            yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd }],
            lunchSup: true,
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
  const [togglePanelByDay, setTogglePanelByDay] = useState(() =>
    Object.fromEntries(DAYS.map((d) => [d, false]))
  );

  // Turnaround credits come from Night Shoot booking notes and on-set days that wrap past midnight.
  const [turnaroundCreditsTotal, setTurnaroundCreditsTotal] = useState(0);
  const [turnaroundCreditDates, setTurnaroundCreditDates] = useState([]); // ISO dates list for audit / display if you want
  const [turnaroundCreditsConsumed, setTurnaroundCreditsConsumed] = useState(0);
  const [turnaroundBookingCreditDates, setTurnaroundBookingCreditDates] = useState([]);
  const [turnaroundOnsetCreditDates, setTurnaroundOnsetCreditDates] = useState([]);
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
  const formattedWeekStart = useMemo(() => formatDisplayDate(id), [id]);

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

    (async () => {
      try {
        const ref = doc(db, "timesheets", `${employee.userCode}_${id}`);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data();
          const patched = { ...data, days: { ...(data.days || {}) } };

          for (const d of DAYS) {
            const fallbackEntry = WEEKEND_SET.has(d)
              ? { mode: "off" }
              : {
                  mode: "yard",
                  leaveTime: yardDefaultStart,
                  arriveBack: yardDefaultEnd,
                  yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd }],
                };
            const ensured = ensureModeDefaults(patched.days[d] || fallbackEntry);
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
                : {
                    mode: "yard",
                    leaveTime: yardDefaultStart,
                    arriveBack: yardDefaultEnd,
                    dayNotes: "",
                    precallDuration: null,
                    yardSegments: [{ start: yardDefaultStart, end: yardDefaultEnd }],
                    lunchSup: true,
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
  }, [loading, isAuthed, employee, id, yardDefaultStart, yardDefaultEnd]);

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
          lunchSup: true,
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
        const empSnap = await getDocs(collection(db, "employees"));
        const allEmployees = empSnap.docs.map((docu) => ({ id: docu.id, ...docu.data() }));

        const nameToCode = {};
        allEmployees.forEach((emp) => {
          const nm = String(emp.name || emp.fullName || "").trim().toLowerCase();
          const code = String(emp.userCode || "").trim();
          if (nm && code) nameToCode[nm] = code;
        });

        const jobsQ = query(collection(db, "bookings"), where("bookingDates", "array-contains-any", weekDates));
        const jobsSnap = await getDocs(jobsQ);
        const allJobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        const holSnap = await getDocs(collection(db, "holidays"));
        const allHolsRaw = holSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
          const next = applyDayLocks(prev, holMap, bankHolidaysByDay);
          if (!hasUnsavedChanges) setBaselineSignature(serialiseTimesheetForCompare(next));
          return next;
        });
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
    hasUnsavedChanges,
    applyDayLocks,
  ]);

  // ───────────────────────── Turnaround eligibility + lookback job list ─────────────────────────
  // Credits are earned from:
  // 1) booking day-notes that contain "Night Shoot"
  // 2) on-set days that wrap past midnight
  // Consecutive eligible dates collapse into a single credit streak.
  useEffect(() => {
    if (loading || !isAuthed || !employee?.userCode) return;

    (async () => {
      try {
        const myCode = canonicalEmployeeCode(employee.userCode);
        if (!myCode) return;

        const lastDates = buildLastNDatesISO(TURNAROUND_LOOKBACK_DAYS); // includes today
        const lastSet = new Set(lastDates);
        const chunks = chunkArray(lastDates, 10);
        const allJobs = [];

        for (const chunk of chunks) {
          const qJobs = query(collection(db, "bookings"), where("bookingDates", "array-contains-any", chunk));
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

        const nightShootWorkedDates = new Set();
        const out = [];
        const seen = new Set();

        allJobs.forEach((job) => {
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
            client: job.client || "",
            location: job.location || "",
            dateISO: pickedDateISO,
          });
        });

        const recentWeekStarts = Array.from(new Set(lastDates.map((dateISO) => mondayISO(dateISO)).filter(Boolean)));
        const recentTimesheets = await Promise.all(
          recentWeekStarts
            .filter((weekStartISO) => weekStartISO && weekStartISO !== id)
            .map(async (weekStartISO) => {
              const snap = await getDoc(doc(db, "timesheets", `${employee.userCode}_${weekStartISO}`));
              if (!snap.exists()) return null;
              return { weekStart: weekStartISO, ...snap.data() };
            })
        );

        const savedOnsetDates = recentTimesheets.flatMap((ts) =>
          ts ? collectOnsetTurnaroundCreditDates(ts, lastSet, ts.weekStart) : []
        );
        const savedTurnaroundUses = recentTimesheets.reduce(
          (total, ts) => total + (ts ? countTurnaroundUses(ts) : 0),
          0
        );

        out.sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")));
        setTurnaroundJobs(out);
        setTurnaroundBookingCreditDates(Array.from(nightShootWorkedDates));
        setTurnaroundOnsetCreditDates(savedOnsetDates);
        setTurnaroundCreditsConsumed(savedTurnaroundUses);
      } catch (err) {
        console.error("[turnaround] error:", err);
        setTurnaroundEligible(false);
        setTurnaroundJobs([]);
        setTurnaroundBookingCreditDates([]);
        setTurnaroundOnsetCreditDates([]);
        setTurnaroundCreditsConsumed(0);
      }
    })();
  }, [loading, isAuthed, employee?.userCode, id]);

  useEffect(() => {
    const lastSet = new Set(buildLastNDatesISO(TURNAROUND_LOOKBACK_DAYS));
    const localOnsetDates = id
      ? collectOnsetTurnaroundCreditDates(timesheet, lastSet, id)
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
  }, [id, timesheet, turnaroundBookingCreditDates, turnaroundOnsetCreditDates]);

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
                lunchSup: true,
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
          base.lunchSup = true;
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
                lunchSup: true,
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
                lunchSup: true,
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

  const toggleDayTogglePanel = useCallback((day) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTogglePanelByDay((prev) => ({ ...prev, [day]: !prev?.[day] }));
  }, []);

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
            `Please select the job for Turnaround Day on ${dayName} (from the last 3 weeks).`
          );
          return false;
        }
      }
    }
    return true;
  }, []);

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
      isLocked,
      jobsByDay,
      router,
      timesheet,
      turnaroundCreditDates,
      turnaroundCreditsTotal,
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

      if (queued) {
        Alert.alert("Submission queued", "You appear to be offline. We queued this timesheet and it will auto-submit when back online.");
      } else {
        Alert.alert("Submitted", "Your timesheet has been submitted.");
      }
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
            updated.lunchSup = true;
            if (!updated.isTurnaround && (!Array.isArray(updated.yardSegments) || updated.yardSegments.length === 0)) {
              updated.yardSegments = [{ start: yardDefaultStart, end: yardDefaultEnd }];
            }
          } else {
            updated.yardSegments = [];
            updated.lunchSup = false;
            updated.yardTravelEnabled = false;
            updated.yardTravelLeaveTime = null;
            updated.yardTravelArriveTime = null;

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
            updated.travelLunchSup = false;
            updated.travelPD = typeof updated.travelPD === "boolean" ? updated.travelPD : false;
          }

          if (nextMode === "onset") {
            updated.nightShoot = typeof updated.nightShoot === "boolean" ? updated.nightShoot : false;
            updated.mealSup = typeof updated.mealSup === "boolean" ? updated.mealSup : true; // default on
          }
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

        if (bookingId !== null) updated.bookingId = bookingId;

        if (isHalfHoliday) {
          updated.mode = "yard";
          updated.leaveTime = updated.leaveTime || yardDefaultStart;
          updated.arriveBack = updated.arriveBack || yardDefaultEnd;
          updated.lunchSup = true;
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
          updated.crossesMidnight =
            (arriveBackOffset?.dayOffset ?? 0) === 1 || (wrapOffset?.dayOffset ?? 0) === 1;
        } else if (updated.mode !== "yard") {
          updated.crossesMidnight = false;
        }

        return { ...prev, days: { ...prev.days, [day]: updated } };
      });
    },
    [isLocked, holidaysByDay, bankHolidaysByDay, yardDefaultStart, yardDefaultEnd]
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
      if (turningOn && (!Array.isArray(turnaroundJobs) || turnaroundJobs.length === 0)) {
        Alert.alert(
          "No jobs to choose",
          "You need at least one recent job from the last 3 weeks before marking a Turnaround day."
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
    [isLocked, turnaroundJobs, turnaroundUnusedCredits, timesheet]
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

  const renderToggleButton = (day, disabled = false) => {
    const open = !!togglePanelByDay?.[day];
    return (
      <TouchableOpacity
        style={[
          styles.togglePickerBtn,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
        onPress={() => toggleDayTogglePanel(day)}
        disabled={disabled}
      >
        <Icon name={open ? "minus-circle" : "plus-circle"} size={12} color={colors.textMuted} />
        <Text style={[styles.togglePickerText, { color: colors.textMuted }]}>{open ? "Hide toggles" : "Add toggles"}</Text>
      </TouchableOpacity>
    );
  };

  const renderYardToggleFields = (day, entry, disabled = false) => {
    if (!togglePanelByDay?.[day]) return null;

    return (
      <>
        <InfoToggleRow
          label="Add travel time?"
          value={!!entry.yardTravelEnabled}
          onChange={(v) => updateDay(day, "yardTravelEnabled", v)}
          disabled={disabled}
          infoTitle="Yard Travel Time"
          infoText="Use this when a yard day also included separate travel time that should be added to the total."
        />

        {!!entry.yardTravelEnabled && (
          <View style={styles.onSetBlock}>
            <TimeDropdown
              label="Travel Leave"
              value={entry.yardTravelLeaveTime}
              onSelect={(t) => updateDay(day, "yardTravelLeaveTime", t)}
              options={TIME_OPTIONS}
              disabled={disabled}
            />
            <TimeDropdown
              label="Travel Arrive"
              value={entry.yardTravelArriveTime}
              onSelect={(t) => updateDay(day, "yardTravelArriveTime", t)}
              options={TIME_OPTIONS}
              disabled={disabled}
            />
          </View>
        )}

        <InfoToggleRow
          label="Overnight?"
          value={boolish(entry.overnight)}
          onChange={(v) => updateDay(day, "overnight", v)}
          disabled={disabled}
          infoTitle="Overnight"
          infoText="Turn this on if this yard day included an overnight stay."
        />
      </>
    );
  };

  const renderYardLunchField = (day, entry, disabled = false) => {
    const segs = Array.isArray(entry?.yardSegments) ? entry.yardSegments : [];
    const hasBlocks = segs.length > 0;
    if (entry?.isTurnaround && !hasBlocks) return null;

    return (
      <InfoToggleRow
        label="Lunch?"
        value={!entry?.lunchSup}
        onChange={(v) => updateDay(day, "lunchSup", !v)}
        disabled={disabled}
        infoTitle="Yard Lunch"
        infoText="Turn this on to deduct the 30 minute lunch break from this yard day."
      />
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
      disabled = false,
      showTurnaround = false,
      canAddTurnaround = false,
      turnaroundBlockedTitle = "",
      turnaroundBlockedMessage = "",
    } = {}
  ) => {
    if (isWeekend || isFullHoliday || isBankHolidayOff) return null;

    return (
      <View style={styles.unpaidToggleRow}>
        <TouchableOpacity
          style={[
            styles.turnaroundBtn,
            {
              backgroundColor: isUnpaidDay ? softAmberBg : subtleChipBg,
              borderColor: isUnpaidDay ? softAmber : colors.border,
              opacity: isLocked ? 0.5 : 1,
            },
          ]}
          onPress={() => toggleUnpaidDay(day, !isUnpaidDay)}
          disabled={isLocked}
        >
          <Icon
            name={isUnpaidDay ? "check-circle" : "slash"}
            size={12}
            color={isUnpaidDay ? softAmber : colors.textMuted}
          />
          <Text style={[styles.turnaroundBtnText, { color: isUnpaidDay ? softAmber : colors.textMuted }]}>Unpaid day</Text>
        </TouchableOpacity>

        {showTurnaround && (
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
          >
            <Icon name={entry?.isTurnaround ? "check-circle" : "refresh-ccw"} size={12} color={entry?.isTurnaround ? softSuccess : colors.textMuted} />
            <Text style={[styles.turnaroundBtnText, { color: entry?.isTurnaround ? softSuccess : colors.textMuted }]}>Turnaround</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderYardSegments = (day, segments, controlsDisabled = false) => {
    if (!Array.isArray(segments) || segments.length === 0) return null;

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

        <TextInput
          placeholder={`Notes for block ${idx + 1}`}
          placeholderTextColor={colors.textMuted}
          style={[
            styles.segmentNoteInput,
            { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text, opacity: controlsDisabled ? 0.6 : 1 },
          ]}
          multiline
          editable={!controlsDisabled}
          value={String(seg?.note || "")}
          onChangeText={(t) => updateYardSegment(day, idx, "note", t)}
        />
      </View>
    ));
  };

  const renderDayNotesField = (day, value, disabled = false) => (
    <TextInput
      placeholder="Notes for this day"
      placeholderTextColor={colors.textMuted}
      style={[
        styles.dayInput,
        {
          backgroundColor: colors.inputBackground,
          borderColor: colors.inputBorder,
          color: colors.text,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
      multiline
      editable={!disabled}
      value={value || ""}
      onChangeText={(t) => updateDay(day, "dayNotes", t)}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <TurnaroundJobPicker
        visible={turnaroundPickerOpen}
        onClose={closeTurnaroundPicker}
        jobs={turnaroundJobs}
        onPick={(job) => {
          if (!turnaroundPickerDay) return;
          setTurnaroundJobForDay(turnaroundPickerDay, job);
          setTurnaroundPickerOpen(false);
          setTurnaroundPickerDay(null);
        }}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 0 }} stickyHeaderIndices={[0]}>
        <View style={[styles.stickyHeader, { backgroundColor: colors.background }]}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={() =>
                confirmDiscardChanges(
                  () => router.back(),
                  () => {
                    void saveTimesheet({ exitAfterSave: true });
                  }
                )
              }
            >
              <Icon name="arrow-left" size={18} color={colors.text} />
              <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
            </TouchableOpacity>

            <Text style={[styles.title, { color: colors.text }]}>Week of {formattedWeekStart}</Text>

            <View
              style={[
                styles.pill,
                {
                  backgroundColor: timesheet.submitted ? softSuccessBg : subtleChipBg,
                  borderColor: timesheet.submitted ? softSuccess : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.pillText,
                { color: timesheet.submitted ? softSuccess : colors.textMuted },
              ]}
            >
              {statusLabel}
            </Text>
            </View>
          </View>

          {isApproved && (
            <View style={styles.statusRow}>
              <Text style={[styles.statusHint, { color: colors.textMuted }]}>Approved by your manager. This week is locked and can’t be edited.</Text>
            </View>
          )}
        </View>

        {/* Turnaround credits banner (only if available) */}
        {turnaroundCreditsTotal > 0 && (
          <View style={[styles.creditBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontWeight: "900" }}>Turnaround credits</Text>
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                {turnaroundCreditsRemaining}/{turnaroundUsesAllowed} left
              </Text>
            </View>

            <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 11 }}>
              Credits come from booking notes marked “Night Shoot” or on-set days that wrapped past midnight in the last 3 weeks. Each credit can only be used once, and Turnaround can only be used once per week.
            </Text>
          </View>
        )}

        {DAYS.map((day) => {
          const entryRaw = timesheet.days?.[day] || { mode: WEEKEND_SET.has(day) ? "off" : "yard", dayNotes: "" };
          const entry = ensureModeDefaults(entryRaw);

          const jobs = jobsByDay?.[day] || [];
          const holidayInfo = holidaysByDay?.[day];
          const bankHolidayInfo = bankHolidaysByDay?.[day];

          const isHoliday = !!holidayInfo;
          const isHalfHoliday = !!holidayInfo?.isHalfDay;
          const isFullHoliday = isHoliday && !isHalfHoliday;
          const isBankHolidayOff = !!bankHolidayInfo && bankHolidayInfo.notWorking === true;
          const isWorkedBankHoliday = isBankHolidayOff && boolish(entry.bankHolidayWorked);
          const isUnpaidDay = isUnpaidDayEntry(entry);

          const effectiveEntry = isHalfHoliday ? ensureModeDefaults({ ...entry, mode: "yard" }) : entry;
          const yardEntry = effectiveEntry.mode === "yard" ? ensureModeDefaults(effectiveEntry) : effectiveEntry;

          const primaryJobId = jobs.length > 0 ? jobs[0].id : null;

          const controlsDisabled =
            isLocked || isFullHoliday || isUnpaidDay || (isBankHolidayOff && !isWorkedBankHoliday);
          const isWeekend = WEEKEND_SET.has(day);

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
            !controlsDisabled && !isHalfHoliday && String(yardEntry.mode || "yard").toLowerCase() === "yard";

          const segsForUI = Array.isArray(yardEntry.yardSegments) ? yardEntry.yardSegments : [];
          const dayToggleOpen = !!togglePanelByDay?.[day];

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
                  { backgroundColor: colors.surface, borderColor: colors.border, opacity: isLocked ? 0.9 : 1 },
                ]}
              >
                <View style={styles.dayHeaderRow}>
                  <Text style={[styles.dayTitle, { color: colors.text }]}>{day}</Text>
                  {String(yardEntry.mode || "").toLowerCase() === "yard" && !isFullHoliday && !isUnpaidDay && (
                    <Text style={[styles.dayModeTitle, { color: colors.textMuted }]}>Yard Day</Text>
                  )}
                </View>

                {renderWeekdayYardControls(day, yardEntry, {
                  isWeekend,
                  isFullHoliday,
                  isBankHolidayOff,
                  isHalfHoliday,
                  isUnpaidDay,
                  disabled: controlsDisabled,
                  showTurnaround: showTurnaroundButton,
                  canAddTurnaround,
                  turnaroundBlockedTitle,
                  turnaroundBlockedMessage,
                })}

                {isUnpaidDay && (
                  <>
                    <View style={styles.unpaidInlineNote}>
                      <Text style={[styles.unpaidInlineText, { color: colors.textMuted }]}>
                        Hours hidden while enabled.
                      </Text>
                    </View>
                    {renderDayNotesField(day, entry.dayNotes, controlsDisabled)}
                  </>
                )}

                {isBankHolidayOff && (
                  <View style={[styles.bankHolidayBlock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={{ color: colors.text, fontWeight: "900" }}>
                      {bankHolidayInfo?.name || "Bank Holiday"} {isWorkedBankHoliday ? "(Worked)" : "(Not working)"}
                    </Text>
                    <Text style={[styles.holidaySub, { color: colors.textMuted, marginTop: 4 }]}>
                      {isWorkedBankHoliday
                        ? "This bank holiday is being filled in as a worked day."
                        : "Not working by default. Add a time block if you worked this bank holiday."}
                    </Text>

                    {!isLocked && !isFullHoliday && !isWorkedBankHoliday && (
                      <TouchableOpacity
                        style={[
                          styles.addBlockBtn,
                          { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, marginTop: 8 },
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
                          { backgroundColor: colors.surface, borderColor: colors.danger, marginTop: 8 },
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

              {isFullHoliday || isUnpaidDay ? null : jobs.length > 0 ? (
                <>
                  {jobs.map((job) => (
                    <View key={job.id} style={[styles.jobLink, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.jobMain, { color: colors.text }]}>{job.jobNumber || job.id} – {job.client || "Client"}</Text>
                      <Text style={[styles.jobSub, { color: colors.textMuted }]}>{job.location || ""}</Text>
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
                    >
                      <Text style={[styles.modeText, { color: colors.text }]}>Yard</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Travel UI */}
                  {!isHalfHoliday && effectiveEntry.mode === "travel" && (
                    <View style={styles.onSetBlock}>
                      <TimeDropdown label="Leave Time" value={effectiveEntry.leaveTime} onSelect={(t) => updateDay(day, "leaveTime", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />
                      <TimeDropdown label="Arrive Time" value={effectiveEntry.arriveTime} onSelect={(t) => updateDay(day, "arriveTime", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />

                      {renderToggleButton(day, controlsDisabled)}

                      {dayToggleOpen && (
                        <>
                          <InfoToggleRow
                            label="Travel meal?"
                            value={!!effectiveEntry.travelPD}
                            onChange={(v) => updateDay(day, "travelPD", v)}
                            disabled={controlsDisabled}
                            infoTitle="Travel Meal"
                            infoText="Turn this on if a travel meal is provided/covered for this travel day."
                          />

                          <InfoToggleRow
                            label="Overnight?"
                            value={boolish(effectiveEntry.overnight)}
                            onChange={(v) => updateDay(day, "overnight", v)}
                            disabled={controlsDisabled}
                            infoTitle="Overnight"
                            infoText="Turn this on if your travel day required an overnight stay."
                          />
                        </>
                      )}

                      {renderDayNotesField(day, effectiveEntry.dayNotes, controlsDisabled)}
                    </View>
                  )}

                  {/* On Set UI */}
                  {!isHalfHoliday && effectiveEntry.mode === "onset" && (
                    <View style={styles.onSetBlock}>
                      <TimeDropdown label="Leave Time" value={effectiveEntry.leaveTime} onSelect={(t) => updateDay(day, "leaveTime", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />
                      <TimeDropdown label="Arrive Time" value={effectiveEntry.arriveTime} onSelect={(t) => updateDay(day, "arriveTime", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />

                      <PrecallDropdown value={effectiveEntry.precallDuration} onSelect={(v) => updateDay(day, "precallDuration", v)} disabled={controlsDisabled} />

                      <TimeDropdown label="Unit Call" value={effectiveEntry.callTime} onSelect={(t) => updateDay(day, "callTime", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />
                      <TimeDropdown label="Wrap Time" value={effectiveEntry.wrapTime} onSelect={(t) => updateDay(day, "wrapTime", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />
                      <TimeDropdown label="Arrive Back" value={effectiveEntry.arriveBack} onSelect={(t) => updateDay(day, "arriveBack", t)} options={TIME_OPTIONS} disabled={controlsDisabled} />

                      {renderToggleButton(day, controlsDisabled)}

                      {dayToggleOpen && (
                        <>
                          <InfoToggleRow
                            label="Overnight?"
                            value={boolish(effectiveEntry.overnight)}
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

                          <InfoToggleRow
                            label="Meal supp?"
                            value={!!effectiveEntry.mealSup}
                            onChange={(v) => updateDay(day, "mealSup", v)}
                            disabled={controlsDisabled}
                            infoTitle="Meal supplement"
                            infoText="Turn this on only if there was no meal supplement/food offered on set. If catering was offered but you chose not to eat, do not turn this on."
                          />
                        </>
                      )}

                      {renderDayNotesField(day, effectiveEntry.dayNotes, controlsDisabled)}
                    </View>
                  )}

                  {/* Yard block */}
                  {yardEntry.mode === "yard" && (
                    <>

                      {yardEntry.isTurnaround === true && (
                        <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "800" }}>Turnaround for job (last 3 weeks)</Text>

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
                            <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 12 }}>{yardEntry.turnaroundJob.location}</Text>
                          ) : null}

                          <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 11 }}>
                            Note: Turnaround days don’t auto-create time blocks — add one only if needed.
                          </Text>
                        </View>
                      )}

                      {renderYardSegments(day, segsForUI, controlsDisabled)}

                      <TouchableOpacity
                        style={[
                          styles.addBlockBtn,
                          { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
                        ]}
                        onPress={() => addYardSegment(day)}
                        disabled={controlsDisabled}
                      >
                        <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                        <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                      </TouchableOpacity>

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

                      {renderYardLunchField(day, yardEntry, controlsDisabled)}
                      {renderToggleButton(day, controlsDisabled)}
                      {renderYardToggleFields(day, yardEntry, controlsDisabled)}

                      {renderDayNotesField(day, yardEntry.dayNotes, controlsDisabled)}
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
                        { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
                      ]}
                      onPress={() => addYardSegment(day)}
                      disabled={controlsDisabled}
                    >
                      <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                      <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                    </TouchableOpacity>
                  ) : (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        {!controlsDisabled && !isHalfHoliday && (
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
                            <Icon name={entry.isTurnaround ? "check-circle" : "refresh-ccw"} size={12} color={entry.isTurnaround ? colors.accent : colors.text} />
                            <Text style={[styles.turnaroundBtnText, { color: colors.text }]}>Turnaround</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {entry.isTurnaround === true && (
                        <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                          <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "800" }}>Turnaround for job (last 3 weeks)</Text>

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

                      <TouchableOpacity
                        style={[
                          styles.addBlockBtn,
                          { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
                        ]}
                        onPress={() => addYardSegment(day)}
                        disabled={controlsDisabled}
                      >
                        <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                        <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
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

                      {renderYardLunchField(day, entry, controlsDisabled)}
                      {renderToggleButton(day, controlsDisabled)}
                      {renderYardToggleFields(day, entry, controlsDisabled)}

                      {renderDayNotesField(day, entry.dayNotes, controlsDisabled)}
                    </>
                  )}
                </>
              ) : isBankHolidayOff && !isWorkedBankHoliday ? (
                <Text style={{ color: colors.textMuted }}>Off (Bank Holiday)</Text>
              ) : (
                <>

                  {entry.isTurnaround === true && (
                    <View style={[styles.turnaroundPanel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "800" }}>Turnaround for job (last 3 weeks)</Text>

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

                  <TouchableOpacity
                    style={[
                      styles.addBlockBtn,
                      { backgroundColor: addBlockButtonColors.backgroundColor, borderColor: addBlockButtonColors.borderColor, opacity: controlsDisabled ? 0.5 : 1 },
                    ]}
                    onPress={() => addYardSegment(day)}
                    disabled={controlsDisabled}
                  >
                    <Icon name="plus" size={14} color={addBlockButtonColors.color} />
                    <Text style={[styles.addBlockText, { color: addBlockButtonColors.color }]}>Add time block</Text>
                  </TouchableOpacity>

                  {renderYardLunchField(day, entry, controlsDisabled)}
                  {renderToggleButton(day, controlsDisabled)}
                  {renderYardToggleFields(day, entry, controlsDisabled)}

                  {renderDayNotesField(day, entry.dayNotes, controlsDisabled)}
                </>
              )}
              </View>
            </View>
          );
        })}

        <TextInput
          placeholder="General notes for the week"
          placeholderTextColor={colors.textMuted}
          style={[
            styles.input,
            { backgroundColor: colors.inputBackground, borderColor: colors.inputBorder, color: colors.text, opacity: isLocked ? 0.6 : 1 },
          ]}
          multiline
          editable={!isLocked}
          value={timesheet.notes}
          onChangeText={(t) => setTimesheet((prev) => ({ ...prev, notes: t }))}
        />

        <HoursSummary timesheet={timesheet} holidaysByDay={holidaysByDay} bankHolidaysByDay={bankHolidaysByDay} />

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginHorizontal: 10, marginTop: 10, marginBottom: 10 }}>
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
              >
                <Text style={[styles.actionButtonText, { color: colors.textOnAccent }]}>Submit for Approval</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: colors.accent }]} onPress={saveTimesheet}>
              <Text style={[styles.actionButtonText, { color: colors.textOnAccent }]}>Update Submission</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* ───────────────────────── styles ───────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, padding: 6 },
  stickyHeader: { paddingTop: 2, marginBottom: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 8 },
  backBtn: { flexDirection: "row", alignItems: "center", minWidth: 64 },
  backText: { fontSize: 14, marginLeft: 6 },
  title: { flex: 1, fontSize: 16, fontWeight: "700", textAlign: "center" },

  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  statusRowCentered: { justifyContent: "center" },
  pill: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1, marginRight: 6 },
  pillText: { fontWeight: "800", fontSize: 11 },
  statusHint: { fontSize: 11 },

  creditBox: {
    marginHorizontal: 8,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },

  dayHeaderRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 4 },
  dayBlock: { padding: 8, borderRadius: 6, marginBottom: 8, borderWidth: 1 },
  dayTitle: { fontSize: 14, fontWeight: "700" },
  dayModeTitle: { fontSize: 12, fontWeight: "700", opacity: 0.9 },
  unpaidToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 4,
  },
  unpaidInlineNote: { marginBottom: 4 },
  unpaidInlineText: { fontSize: 10.5 },

  bankHolidayBlock: { padding: 8, borderRadius: 8, borderWidth: 1, marginBottom: 6 },

  holidayBlock: { padding: 8, borderRadius: 8, borderWidth: 1 },
  holidayHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  holidaySub: { fontSize: 11, marginTop: 3 },

  modeRow: { flexDirection: "row", marginBottom: 4, gap: 6 },
  modeBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center", borderWidth: 1 },
  modeText: { fontSize: 12, fontWeight: "700" },

  onSetBlock: { marginTop: 2 },

  label: { fontSize: 11, marginBottom: 2 },
  dropdownBox: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
  },

  sectionCap: { marginBottom: 4, fontWeight: "700", fontSize: 12, opacity: 0.9 },
  segmentBlock: { marginBottom: 6 },
  segmentRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  segmentDelete: {
    marginLeft: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    height: 36,
  },
  segmentNoteInput: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, fontSize: 12, borderWidth: 1, minHeight: 32 },

  addBlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 2,
    marginBottom: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  addBlockText: { fontWeight: "700", fontSize: 12 },
  togglePickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 2,
    marginBottom: 6,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  togglePickerText: { fontSize: 11, fontWeight: "700" },

  jobLink: { padding: 7, borderRadius: 8, marginBottom: 5, borderWidth: 1 },
  jobMain: { fontWeight: "700", fontSize: 12.5 },
  jobSub: { fontSize: 12, marginTop: 2 },

  dayInput: { padding: 8, borderRadius: 8, marginTop: 4, fontSize: 12, borderWidth: 1 },
  input: { padding: 10, borderRadius: 8, marginHorizontal: 10, marginTop: 8, marginBottom: 8, fontSize: 13, height: 55, borderWidth: 1 },

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

  actionButton: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 8, marginHorizontal: 0 },
  actionButtonText: { fontWeight: "bold", fontSize: 15 },

  turnaroundBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  turnaroundBtnText: { fontWeight: "700", fontSize: 10.5, letterSpacing: 0.2 },
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

  summaryBox: {
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  summaryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
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
