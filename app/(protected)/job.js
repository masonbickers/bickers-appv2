// app/screens/job-day.js
import {
  useRouter } from "expo-router";
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import PageHeaderCard from "../../components/PageHeaderCard";
import { EmptyState, LoadingState } from "../../components/AsyncState";
import PageShell from "../../components/layout/PageShell";
import { AppButton, IconButton,
  AppText as Text,
  AppPressable as TouchableOpacity,
} from "../../components/ui/AppPrimitives";
import {
  useBookings,
  useCompanyCollection,
  useHolidays,
  useVehicles,
} from "../../hooks/useOperationalData";
import { isCrewedBooking } from "../../lib/bookingVisibility";
import {
  collapseLinkedJobsForDay,
  displayJobNumber,
} from "../../lib/linkedBookingDays";
import { designTokens as t } from "../../lib/design/tokens";
import {
  findVehicleRecord as resolveVehicleRecord,
  getBookingVehicleReferences,
  getVehicleDisplayList as resolveVehicleDisplayList,
  getVehicleDisplayName,
  getVehicleRegistration,
} from "../../lib/fleetSchema";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import { findVehiclePrepRecord } from "../../lib/vehiclePrep";

/* -------------------------------------------------------------------------- */
/*                                  CONSTANTS                                 */
/* -------------------------------------------------------------------------- */

const CALL_BADGE_BG = staticColors.hex_ffd60a_5c6r45; // keeps that punchy yellow for call time
const RECCE_BG = staticColors.hex_ff453a_5bsa1h; // recce button accent

/* ───────────────────────────────
   BANK HOLIDAYS (UK via GOV.UK)
   - Source: https://www.gov.uk/bank-holidays.json
   - Region options: "england-and-wales" | "scotland" | "northern-ireland"
──────────────────────────────── */
const BANK_HOLIDAY_REGION = "england-and-wales";

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

const safeStr = (v) => String(v ?? "").trim().toLowerCase();

const canonicalEmployeeCode = (value) => {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits) return digits.padStart(4, "0");
  return safeStr(raw);
};

const codesEqual = (a, b) => {
  const aa = canonicalEmployeeCode(a);
  const bb = canonicalEmployeeCode(b);
  return !!aa && !!bb && aa === bb;
};

const resolveEmployeeByCode = (allEmployees, codeValue) => {
  const code = canonicalEmployeeCode(codeValue);
  if (!code) return null;
  return (allEmployees || []).find((x) => codesEqual(x?.userCode, code)) || null;
};

const toDateSafe = (val) => {
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
  return isNaN(d) ? null : d;
};

const toISODate = (d) => {
  const date = d instanceof Date ? d : toDateSafe(d);
  if (!date) return null;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${dd}`;
};


const isWeekend = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  const dow = d.getDay();
  return dow === 0 || dow === 6;
};

async function fetchUKBankHolidays(region = BANK_HOLIDAY_REGION) {
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const events = json?.[region]?.events || [];
    const map = {}; // dateISO -> title
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

/** Normalise call time across schemas */
const getCallTime = (job, dateISO) => {
  const byDate =
    job?.callTimes?.[dateISO] ||
    job?.callTimeByDate?.[dateISO] ||
    job?.call_times?.[dateISO];

  const single = job?.callTime || job?.calltime || job?.call_time;

  const fromNotes =
    job?.notesByDate?.[`${dateISO}-callTime`] ||
    job?.notesByDate?.[dateISO]?.callTime;

  return byDate || single || fromNotes || null;
};

/** Day-specific note (notesByDate) – handles "Other" pattern */
const getDayNote = (job, dateISO) => {
  const nb = job?.notesByDate || {};
  const raw = nb[dateISO];

  if (!raw) return null;

  if (raw === "Other") {
    return nb[`${dateISO}-other`] || null;
  }

  if (typeof raw === "string" && raw.trim()) return raw.trim();

  return null;
};

/** General job note */
const getJobNote = (job) => {
  if (typeof job?.notes === "string" && job.notes.trim()) {
    return job.notes.trim();
  }
  return null;
};

const isRecceDay = (job, dateISO) => {
  const note = getDayNote(job, dateISO);
  return /\b(recce\s*day)\b/i.test(note || "");
};

/** Resolve employees for a specific date using employeesByDate / legacy employees */
function getEmployeesForDate(job, isoDate, allEmployees) {
  const byDate = job.employeesByDate || job.employeeAssignmentsByDate || null;
  const byCodeDate = job.employeeCodesByDate || job.assignedEmployeeCodesByDate || null;

  const baseList = byDate?.[isoDate]
    ? byDate[isoDate]
    : Array.isArray(job.employees)
    ? job.employees
    : [];
  const codeList = byCodeDate?.[isoDate]
    ? byCodeDate[isoDate]
    : Array.isArray(job.employeeCodes)
    ? job.employeeCodes
    : [];

  const list = [
    ...(Array.isArray(baseList) ? baseList : []),
    ...(Array.isArray(codeList) ? codeList.map((code) => ({ userCode: code })) : []),
  ];

  const mapped = list.map((e) => {
    if (typeof e === "string") {
      const value = String(e || "").trim();
      const matchByName = allEmployees.find((x) => safeStr(x.name) === safeStr(value));
      if (matchByName) {
        return {
          code: canonicalEmployeeCode(matchByName.userCode),
          name: safeStr(matchByName.name || matchByName.displayName || value),
          displayName: matchByName.name || matchByName.displayName || value,
        };
      }

      const matchByCode = resolveEmployeeByCode(allEmployees, value);
      if (matchByCode) {
        return {
          code: canonicalEmployeeCode(matchByCode.userCode),
          name: safeStr(matchByCode.name || matchByCode.displayName || value),
          displayName: matchByCode.name || matchByCode.displayName || `Code ${value}`,
        };
      }

      return {
        code: canonicalEmployeeCode(value),
        name: safeStr(value),
        displayName: value,
      };
    }

    const name =
      e.name ||
      e.displayName ||
      [e.firstName, e.lastName].filter(Boolean).join(" ");

    const rawCode =
      e.userCode ||
      e.employeeCode ||
      e.code ||
      resolveEmployeeByCode(allEmployees, e.userCode || e.employeeCode || e.code)?.userCode ||
      allEmployees.find((x) => safeStr(x.name) === safeStr(name))?.userCode;

    return {
      code: canonicalEmployeeCode(rawCode),
      name: safeStr(name),
      displayName: name,
    };
  });

  const deduped = [];
  const seen = new Set();
  for (const item of mapped) {
    if (!item) continue;
    const key = `${item.code}::${safeStr(item.displayName || item.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

/**
 * Determine if a holiday is unpaid based on common schema variants.
 * Supports:
 * - unpaid: true
 * - isUnpaid: true
 * - paid: false / isPaid: false
 * - payType: "unpaid" | "paid"
 * - leaveType / type: "unpaid" etc.
 */
function getHolidayPayType(h) {
  const payType = safeStr(h?.payType || h?.pay_type || "");
  const leaveType = safeStr(h?.leaveType || h?.leave_type || h?.type || "");
  const unpaidFlag = !!(h?.unpaid || h?.isUnpaid);
  const paidFlagExists = typeof h?.paid === "boolean" || typeof h?.isPaid === "boolean";
  const paidFlag =
    typeof h?.paid === "boolean" ? h.paid : typeof h?.isPaid === "boolean" ? h.isPaid : null;

  if (payType) {
    if (payType.includes("unpaid")) return "unpaid";
    if (payType.includes("paid")) return "paid";
  }
  if (leaveType) {
    if (leaveType.includes("unpaid")) return "unpaid";
    if (leaveType.includes("paid")) return "paid";
  }

  if (unpaidFlag) return "unpaid";
  if (paidFlagExists) return paidFlag ? "paid" : "unpaid";

  return "paid"; // default to paid
}

/** Find matching APPROVED holiday for employee on date; returns the holiday doc or null */
function getApprovedHolidayForEmployeeOnDate(holidays, employee, targetISO) {
  if (!employee || !targetISO) return null;

  const meCode = canonicalEmployeeCode(employee.userCode);
  const meName = safeStr(employee.name || employee.displayName);

  if (!meCode && !meName) return null;

  for (const h of holidays || []) {
    const statusStr = safeStr(h?.status);
    if (statusStr !== "approved") continue;

    const codeMatch =
      !!meCode && [h.employeeCode, h.userCode].some((code) => codesEqual(code, meCode));

    const nameMatch =
      !!meName && [h.employee, h.name].map(safeStr).includes(meName);

    if (!codeMatch && !nameMatch) continue;

    const start = toDateSafe(h.startDate || h.from);
    const end = toDateSafe(h.endDate || h.to || start);
    if (!start) continue;

    const sISO = toISODate(start);
    const eISO = toISODate(end || start);
    if (!sISO || !eISO) continue;

    if (sISO <= targetISO && eISO >= targetISO) return h;
  }

  return null;
}

/* -------- date helpers for prep window (from Workshop To-Do) -------- */

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// normalise Firestore / string / Date into Date
function toJsDate(value) {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return new Date(y, m - 1, d, 12, 0, 0, 0);
    }
    return new Date(value);
  }

  return new Date(value);
}

function getBookingDepartureDay(booking) {
  if (Array.isArray(booking.bookingDates) && booking.bookingDates.length > 0) {
    const dates = booking.bookingDates
      .map((value) => startOfDay(toJsDate(value)))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a - b);
    return dates[0] || null;
  }

  const startRaw = booking.startDate || booking.date;
  if (!startRaw) return null;
  const start = startOfDay(toJsDate(startRaw));
  return Number.isNaN(start.getTime()) ? null : start;
}

// normalise vehicles on booking to attach full DB record where possible
function normalizeVehicles(list, vehiclesData) {
  if (!Array.isArray(list)) return [];
  return list
    .map((vehicleRef) => {
      const match = resolveVehicleRecord(vehicleRef, vehiclesData);
      if (match && vehicleRef && typeof vehicleRef === "object") {
        return { ...vehicleRef, ...match };
      }
      if (match) return match;
      return vehicleRef && typeof vehicleRef === "object" ? vehicleRef : null;
    })
    .filter(Boolean);
}

function isHgvVehicle(vehicle) {
  if (!vehicle) return false;
  if (vehicle.isHgv === true || vehicle.isHGV === true || vehicle.hgv === true) return true;

  const fields = [
    vehicle.category,
    vehicle.vehicleCategory,
    vehicle.vehicleType,
    vehicle.type,
    vehicle.class,
    vehicle.vehicleClass,
    vehicle.bodyType,
  ];

  return fields.some((field) => {
    const value = safeStr(field);
    if (!value) return false;
    return /\bhgv\b/.test(value) || value.includes("heavy goods");
  });
}

function jobHasHgvVehicle(job, vehiclesData) {
  const list =
    job?.vehicles ||
    job?.vehicleIds ||
    job?.selectedVehicles ||
    job?.vehicleIDs ||
    [];

  return isHgvVehicle(job) || normalizeVehicles(list, vehiclesData).some(isHgvVehicle);
}

/** ✅ Display vehicles by NAME/REG but keep bookings stored by ID */
function getVehicleDisplayList(job, vehiclesData) {
  return resolveVehicleDisplayList(getBookingVehicleReferences(job), vehiclesData);
}

/* -------------------------------------------------------------------------- */
/*                               JOB CARD (UI)                                */
/* -------------------------------------------------------------------------- */

const JobCard = ({ job, dateISO, router, colors, vehiclesData }) => {
  const callTime = useMemo(() => getCallTime(job, dateISO), [job, dateISO]);
  const dayNote = useMemo(() => getDayNote(job, dateISO), [job, dateISO]);
  const jobNote = useMemo(() => getJobNote(job), [job]);
  const recce = useMemo(() => isRecceDay(job, dateISO), [job, dateISO]);

  const vehiclesDisplay = useMemo(() => {
    return getVehicleDisplayList(job, vehiclesData);
  }, [job, vehiclesData]);

  const vehicleChecked = !!job.vehicleChecked;
  const requiresVehicleCheck = useMemo(
    () => jobHasHgvVehicle(job, vehiclesData),
    [job, vehiclesData]
  );
  const showActions = requiresVehicleCheck || recce;

  const handleActionPress = (pathname) => {
    router.push({
      pathname,
      params: {
        jobId: job.id,
        dateISO,
        jobNumber: job.jobNumber || "N/A",
        locationName: job.location || "",
      },
    });
  };

  return (
    <View
      key={job.id}
      style={[
        styles.jobCard,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
      ]}
    >
      {/* Top row: job + call time */}
      <View style={[styles.titleRow, { borderBottomColor: colors.border }]}>
        <View style={styles.jobHeading}>
          <View style={styles.jobTitleLine}>
            <View style={[styles.jobDot, { backgroundColor: staticColors.hex_3568be_8u10kp }]} />
            <Text style={[styles.jobTitle, { color: colors.text }]} numberOfLines={2}>
              {job.client || `Job #${displayJobNumber(job)}`}
            </Text>
          </View>
          {job.client ? (
            <Text style={[styles.jobNumber, { color: colors.textMuted }]}>
              Job #{displayJobNumber(job)}
            </Text>
          ) : null}
        </View>

        {callTime ? (
          <View style={[styles.callBadge, { backgroundColor: CALL_BADGE_BG }]}>
            <Icon name="clock" size={12} color={staticColors.hex_111_yhln9z} style={{ marginRight: t.spacing.xxs }} />
            <Text style={styles.callBadgeText}>CALL {callTime}</Text>
          </View>
        ) : null}
      </View>

      {/* Details */}
      <View style={styles.detailsContainer}>
        {job.location && (
          <JobDetailRow icon="map-pin" value={job.location} colors={colors} />
        )}

        {vehiclesDisplay.length > 0 && (
          <JobDetailRow icon="truck" value={vehiclesDisplay.join(" · ")} colors={colors} />
        )}

        {Array.isArray(job.employees) && job.employees.length > 0 && (
          <JobDetailRow
            icon="users"
            value={job.employees.map((e) => e?.displayName || e?.name || e).join(" · ")}
            colors={colors}
          />
        )}
      </View>

      {/* Notes */}
      {(dayNote || jobNote) && (
        <View
          style={[
            styles.noteBox,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Icon
            name="message-circle"
            size={14}
            color={colors.text}
            style={{ marginRight: t.spacing.xs, marginTop: t.spacing.none }}
          />
          <View style={{ flex: 1 }}>
            {dayNote && (
              <Text style={[styles.noteText, { color: colors.textMuted }]}>
                <Text style={[styles.noteLabel, { color: colors.text }]}>Day Note</Text>{" "}
                <Text style={[styles.noteBody, { color: colors.textMuted }]}>{dayNote}</Text>
              </Text>
            )}
            {jobNote && (
              <Text
                style={[
                  styles.noteText,
                  { color: colors.textMuted, marginTop: dayNote ? 4 : 0 },
                ]}
              >
                <Text style={[styles.noteLabel, { color: colors.text }]}>Job Note</Text>{" "}
                <Text style={[styles.noteBody, { color: colors.textMuted }]}>{jobNote}</Text>
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Actions */}
      {showActions && (
        <View style={styles.actionsRow}>
          {requiresVehicleCheck && (
            <AppButton
              label={vehicleChecked ? "Vehicle Check Complete" : "Vehicle Check"}
              icon={vehicleChecked ? "check-circle" : "truck"}
              variant={vehicleChecked ? "secondary" : "primary"}
              onPress={() => handleActionPress("/vehicle-check")}
              accessibilityHint="Opens the vehicle check for this job"
              style={styles.actionBtn}
            />
          )}

          {recce && (
            <AppButton
              label="Recce Form"
              icon="map-pin"
              onPress={() => handleActionPress("/recce-form")}
              accessibilityHint="Opens the recce form for this job"
              style={[styles.actionBtn, { backgroundColor: RECCE_BG, borderColor: RECCE_BG }]}
            />
          )}
        </View>
      )}
    </View>
  );
};

function JobDetailRow({ icon, value, colors }) {
  if (!value) return null;
  return (
    <View style={styles.jobDetailRow}>
      <Icon name={icon} size={15} color={colors.textMuted} />
      <Text style={[styles.jobDetailText, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                             VEHICLE PREP ROW (UI)                          */
/* -------------------------------------------------------------------------- */

function VehiclePrepRow({ item, colors, prepRecord }) {
  const router = useRouter();
  const prepDone = prepRecord?.completed === true;

  const dateText = toDateSafe(item.date)?.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const showComplianceWarning = item.isSornOrUntaxed || item.isUninsured;

  const onPress = () => {
    const base = `/vehicle-prep/${encodeURIComponent(item.vehicleId || "vehicle")}`;
    const params = new URLSearchParams({
      date: item.date,
      bookingId: item.bookingId || "",
      vehicleName: item.vehicleName || "",
      registration: item.registration || "",
      vehicleId: item.vehicleId || "",
    });
    router.push(`${base}?${params.toString()}`);
  };

  return (
    <TouchableOpacity
      style={styles.prepRow}
      activeOpacity={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Prepare ${item.vehicleName}${item.registration ? ` ${item.registration}` : ""}`}
      accessibilityHint={`Vehicle goes out ${dateText}`}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.prepVehicleMain, { color: colors.text }]}>
          {item.vehicleName}
          {item.registration ? ` · ${item.registration}` : ""}
        </Text>
        <Text style={[styles.prepGoingOutText, { color: colors.textMuted }]}>
          Going out: {dateText}
        </Text>

        <View style={styles.prepBadgeRow}>
          {prepDone ? (
            <View
              style={[
                styles.prepReadyState,
                {
                  backgroundColor: withAlpha(colors.success, 0.14),
                  borderColor: withAlpha(colors.success, 0.38),
                },
              ]}
            >
              <Icon name="check-circle" size={13} color={colors.success} />
              <Text style={[styles.prepReadyText, { color: colors.success }]}>
                {prepRecord?.completedByName
                  ? `Prepped by ${prepRecord.completedByName}`
                  : "Prepped"}
              </Text>
            </View>
          ) : showComplianceWarning ? (
            <View style={styles.prepComplianceBad}>
              <Icon name="alert-triangle" size={12} color={staticColors.hex_fff_yhjmu8} />
              <Text style={styles.prepComplianceText}>CHECK TAX / INS</Text>
            </View>
          ) : (
            <View
              style={[
                styles.prepReadyState,
                {
                  backgroundColor: withAlpha(colors.warning, 0.12),
                  borderColor: withAlpha(colors.warning, 0.34),
                },
              ]}
            >
              <Icon name="clipboard" size={13} color={colors.warning} />
              <Text style={[styles.prepReadyText, { color: colors.warning }]}>Prep required</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.prepAction}>
        <Text
          style={[
            styles.prepActionText,
            { color: prepDone ? colors.success : colors.accent },
          ]}
        >
          {prepDone ? "Review" : "Prep"}
        </Text>
        <Icon name="chevron-right" size={18} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

function VehiclePrepGroups({ title, groups, records, colors, emptyMessage }) {
  return (
    <View style={styles.prepRangeSection}>
      <Text style={[styles.prepRangeLabel, { color: colors.text }]}>{title}</Text>
      {groups.length === 0 ? (
        <Text style={[styles.prepRangeEmpty, { color: colors.textMuted }]}>{emptyMessage}</Text>
      ) : (
        groups.map((group) => {
          const label = toDateSafe(group.date)?.toLocaleDateString("en-GB", {
            weekday: "short",
            day: "2-digit",
            month: "short",
          });

          return (
            <View key={group.date} style={styles.prepGroup}>
              <Text style={[styles.prepDateLabel, { color: colors.textMuted }]}>{label}</Text>
              {group.items.map((item) => (
                <VehiclePrepRow
                  key={item.key}
                  item={item}
                  colors={colors}
                  prepRecord={findVehiclePrepRecord(records, item)}
                />
              ))}
            </View>
          );
        })
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  SCREEN                                    */
/* -------------------------------------------------------------------------- */

export default function JobDayScreen() {
  const router = useRouter();
  const { employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();
  const bookingsResource = useBookings();
  const holidaysResource = useHolidays();
  const vehiclesResource = useVehicles();
  const vehicleChecksResource = useCompanyCollection("vehicleChecks");
  const prepRecordsResource = useCompanyCollection("vehiclePrepRecords");

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState(false);

  // ✅ Holiday info (paid/unpaid)
  const [holidayInfo, setHolidayInfo] = useState({ onHoliday: false, payType: "paid" });

  // ✅ Bank holidays: date -> title
  const [bankHolidayMap, setBankHolidayMap] = useState({});

  // 👇 data for vehicle prep list (next 3 days)
  const [bookings, setBookings] = useState([]);
  const [vehiclesData, setVehiclesData] = useState([]);
  const [prepLoading, setPrepLoading] = useState(true);

  const dateISO = useMemo(() => toISODate(selectedDate), [selectedDate]);

  // Fetch bank holidays once
  useEffect(() => {
    let alive = true;
    (async () => {
      const map = await fetchUKBankHolidays(BANK_HOLIDAY_REGION);
      if (alive) setBankHolidayMap(map || {});
    })();
    return () => {
      alive = false;
    };
  }, []);

  const bankHolidayTitle = useMemo(() => {
    if (!dateISO) return null;
    return bankHolidayMap?.[dateISO] || null;
  }, [bankHolidayMap, dateISO]);

  const loadAllEmployees = useCallback(
    () => bookingsResource.employees,
    [bookingsResource.employees]
  );

  // Load vehicle check status for a list of job IDs (once per job)
  const loadVehicleChecksForJobs = useCallback((jobIds) => {
    const map = {};
    if (!jobIds || jobIds.length === 0) return map;
    const ids = new Set(jobIds);
    vehicleChecksResource.data.forEach((check) => {
      const bookingId = check.bookingId || check.jobId;
      if (bookingId && ids.has(bookingId)) map[bookingId] = true;
    });
    return map;
  }, [vehicleChecksResource.data]);

  const loadJobs = useCallback(() => {
    if (loading || !isAuthed) return;

    const meCode = canonicalEmployeeCode(employee?.userCode);
    const meName = safeStr(employee?.name || employee?.displayName);
    if (!meCode && !meName) {
      setJobs([]);
      setHolidayInfo({ onHoliday: false, payType: "paid" });
      return;
    }
    if (!dateISO) return;

    try {
      const allEmployees = loadAllEmployees();
      const bookings = bookingsResource.data;
      const holidays = holidaysResource.data;

      const todaysJobs = [];

      for (const job of bookings) {
        if (!isCrewedBooking(job)) continue;
        const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
        if (!dates.length) continue;

        const hasThisDate = dates.some((d) => toISODate(d) === dateISO);
        if (!hasThisDate) continue;

        const todaysEmps = getEmployeesForDate(job, dateISO, allEmployees);

        const isMineToday =
          (!!meCode && todaysEmps.some((r) => codesEqual(r.code, meCode))) ||
          (!!meName && todaysEmps.some((r) => safeStr(r.name) === meName));

        if (!isMineToday) continue;

        todaysJobs.push({
          ...job,
          employees: todaysEmps.map((r) => r.displayName).filter(Boolean),
        });
      }

      const visibleJobs = collapseLinkedJobsForDay(todaysJobs, dateISO);

      // vehicle check map
      const jobIds = visibleJobs.map((j) => j.id);
      const vehicleChecksMap = loadVehicleChecksForJobs(jobIds);

      const jobsWithCheckFlag = visibleJobs.map((job) => ({
        ...job,
        vehicleChecked: !!vehicleChecksMap[job.id],
      }));

      setJobs(jobsWithCheckFlag);

      // ✅ Holiday (paid/unpaid) only applies when no jobs that day
      const hol = getApprovedHolidayForEmployeeOnDate(holidays, employee, dateISO);
      const isHolidayNoJobs = !!hol && jobsWithCheckFlag.length === 0;

      setHolidayInfo({
        onHoliday: isHolidayNoJobs,
        payType: hol ? getHolidayPayType(hol) : "paid",
      });
    } catch (err) {
      console.error("Error loading jobs:", err);
      setJobs([]);
      setHolidayInfo({ onHoliday: false, payType: "paid" });
    }
  }, [
    bookingsResource.data,
    employee,
    holidaysResource.data,
    isAuthed,
    loading,
    dateISO,
    loadAllEmployees,
    loadVehicleChecksForJobs,
  ]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // 🔄 Load bookings + vehicles for all upcoming Vehicle prep departures
  useEffect(() => {
    setBookings(bookingsResource.data.filter(isCrewedBooking));
    setVehiclesData(vehiclesResource.data);
    setPrepLoading(
      bookingsResource.isInitialLoading ||
        vehiclesResource.isInitialLoading ||
        prepRecordsResource.isInitialLoading
    );
  }, [
    bookingsResource.data,
    bookingsResource.isInitialLoading,
    prepRecordsResource.isInitialLoading,
    vehiclesResource.data,
    vehiclesResource.isInitialLoading,
  ]);

  const prepItems = useMemo(() => {
    if (!bookings.length) return [];

    const today = startOfDay(new Date());
    const windowStart = startOfDay(addDays(today, 1)); // tomorrow
    const soonWindowEnd = startOfDay(addDays(today, 3));

    const validStatuses = new Set(["Confirmed"]); // confirmed jobs only
    const items = [];

    bookings.forEach((b) => {
      const status = b.status || "Confirmed";
      if (!validStatuses.has(status)) return;

      const departureDay = getBookingDepartureDay(b);
      if (!departureDay || departureDay < windowStart) return;

      const normVehicles = normalizeVehicles(
        getBookingVehicleReferences(b),
        vehiclesData
      );
      if (!normVehicles.length) return;

      const dateKey = toISODate(departureDay);

      normVehicles.forEach((v) => {
        const name = getVehicleDisplayName(v, vehiclesData);
        const reg = getVehicleRegistration(v) || "";

        const taxStatus = v.taxStatus || "";
        const insuranceStatus = v.insuranceStatus || "";

        const tax = String(taxStatus).toLowerCase();
        const ins = String(insuranceStatus).toLowerCase();

        const isSornOrUntaxed = ["sorn", "untaxed", "no tax"].includes(tax);
        const isUninsured = ["not insured", "uninsured", "no insurance"].includes(ins);

        items.push({
          key: `${b.id}-${v.id || name}-${dateKey}`,
          bookingId: b.id,
          date: dateKey,
          dateObj: departureDay,
          vehicleId: v.id || reg || name,
          vehicleName: name,
          registration: reg,
          taxStatus,
          insuranceStatus,
          isSornOrUntaxed,
          isUninsured,
          isLater: departureDay > soonWindowEnd,
        });
      });
    });

    items.sort((a, b) => {
      if (a.dateObj.getTime() !== b.dateObj.getTime()) return a.dateObj - b.dateObj;
      return (a.vehicleName || "").localeCompare(b.vehicleName || "");
    });

    return items;
  }, [bookings, vehiclesData]);

  const prepByDate = useMemo(() => {
    if (!prepItems.length) return [];
    const map = new Map();
    prepItems.forEach((item) => {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date).push(item);
    });

    return Array.from(map.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([date, items]) => ({ date, items, isLater: items[0]?.isLater === true }));
  }, [prepItems]);

  const prepSoonByDate = useMemo(
    () => prepByDate.filter((group) => !group.isLater),
    [prepByDate]
  );
  const prepLaterByDate = useMemo(
    () => prepByDate.filter((group) => group.isLater),
    [prepByDate]
  );

  const goPrevDay = () => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() - 1);
      return nd;
    });
  };

  const goNextDay = () => {
    setSelectedDate((d) => {
      const nd = new Date(d);
      nd.setDate(nd.getDate() + 1);
      return nd;
    });
  };

  const goToday = () => setSelectedDate(new Date());

  const onRefresh = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.all([
        bookingsResource.refresh(),
        holidaysResource.refresh(),
        vehiclesResource.refresh(),
        vehicleChecksResource.refresh(),
        prepRecordsResource.refresh(),
      ]);
    } finally {
      setBusy(false);
    }
  }, [
    bookingsResource,
    holidaysResource,
    prepRecordsResource,
    vehicleChecksResource,
    vehiclesResource,
  ]);

  if (loading || !isAuthed) return null;

  const weekend = isWeekend(selectedDate);
  const isSelectedToday = dateISO === toISODate(new Date());
  const isUnpaidHoliday = holidayInfo.onHoliday && holidayInfo.payType === "unpaid";

  // ✅ include Bank Holiday in status logic (only when no jobs and not on holiday)
  const dayStatus =
    jobs.length > 0
      ? "On Set"
      : holidayInfo.onHoliday
      ? isUnpaidHoliday
        ? "Unpaid Holiday"
        : "Holiday"
      : bankHolidayTitle
      ? "Bank Holiday"
      : weekend
      ? "Off"
      : "Yard";

  const statusColour =
    dayStatus === "On Set"
      ? staticColors.hex_3568be_8u10kp
      : dayStatus === "Holiday" || dayStatus === "Unpaid Holiday"
      ? colors.success
      : dayStatus === "Bank Holiday"
      ? staticColors.hex_a855f7_u9x9hq // purple
      : colors.textMuted;

  return (
    <PageShell
      contentSpacing="compact"
      customHeader={
        <PageHeaderCard
          eyebrow="Operations"
          title="Job Day"
          action={
            <View
              style={[
                styles.statusPill,
                {
                  borderColor: isUnpaidHoliday ? staticColors.hex_ffd60a_5c6r45 : statusColour,
                  backgroundColor: withAlpha(colors.surfaceAlt, 0.82),
                },
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: isUnpaidHoliday ? staticColors.hex_ffd60a_5c6r45 : statusColour },
                ]}
              />
              <Text style={[styles.statusText, { color: colors.text }]}>{dayStatus}</Text>
            </View>
          }
          style={styles.heroCard}
          contentStyle={styles.heroContent}
        >
          {bankHolidayTitle && jobs.length === 0 && !holidayInfo.onHoliday ? (
            <View style={styles.heroMetaRow}>
                <View style={[styles.bankHolidayPill, { borderColor: staticColors.hex_a855f7_u9x9hq }]}>
                  <Icon name="flag" size={12} color={staticColors.hex_a855f7_u9x9hq} />
                  <Text style={styles.bankHolidayPillText} numberOfLines={1}>
                    {bankHolidayTitle}
                  </Text>
                </View>
            </View>
          ) : null}

          <View style={styles.dayNavRow}>
              <IconButton
                icon="chevron-left"
                label="Previous day"
                onPress={goPrevDay}
                disabled={busy}
                style={styles.dayNavButton}
              />
              <View style={styles.dayTitleBlock}>
                <Text style={[styles.dayTitle, { color: colors.text }]}>
                  {selectedDate.toLocaleDateString("en-GB", DAY_FORMAT_LONG)}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={isSelectedToday ? "Today selected" : "Return to today"}
                  disabled={isSelectedToday}
                  onPress={goToday}
                  style={styles.todayLink}
                >
                  <Icon
                    name="crosshair"
                    size={12}
                    color={isSelectedToday ? colors.textMuted : colors.accent}
                  />
                  <Text
                    style={[
                      styles.todayLinkText,
                      { color: isSelectedToday ? colors.textMuted : colors.accent },
                    ]}
                  >
                    {isSelectedToday ? "Today" : "Back to today"}
                  </Text>
                </TouchableOpacity>
              </View>
              <IconButton
                icon="chevron-right"
                label="Next day"
                onPress={goNextDay}
                disabled={busy}
                style={styles.dayNavButton}
              />
          </View>
        </PageHeaderCard>
      }
      customHeaderPlacement="scroll"
      refresh={{ refreshing: busy, onRefresh }}
      state={{
        resources: [bookingsResource, holidaysResource, vehiclesResource],
        hasContent:
          bookingsResource.data.length > 0 || holidaysResource.data.length > 0,
        onRetry: onRefresh,
        loadingLabel: "Loading your jobs…",
        refreshErrorMessage: "Couldn’t update schedule data · Showing saved data.",
      }}
    >
        {jobs.length > 0 ? (
          jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              dateISO={dateISO}
              router={router}
              colors={colors}
              vehiclesData={vehiclesData}
            />
          ))
        ) : holidayInfo.onHoliday ? (
          <EmptyState
            icon="umbrella"
            title={isUnpaidHoliday ? "Unpaid Holiday" : "Holiday"}
            message={
              isUnpaidHoliday
                ? "You’re on approved unpaid leave for this date."
                : "You’re on approved leave for this date."
            }
            style={{ backgroundColor: colors.surface }}
          />
        ) : bankHolidayTitle ? (
          <EmptyState
            icon="flag"
            title="Bank Holiday"
            message={bankHolidayTitle}
            style={{ backgroundColor: colors.surface }}
          />
        ) : weekend ? (
          <EmptyState
            icon="sun"
            title="Weekend"
            message="No bookings assigned. Enjoy the day."
            style={{ backgroundColor: colors.surface }}
          />
        ) : (
          <>
            <View
              style={[
                styles.yardStatusRow,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.yardStatusIcon, { backgroundColor: colors.surfaceAlt }]}>
                <Icon name="home" size={20} color={colors.textMuted} />
              </View>
              <View style={styles.yardStatusCopy}>
                <Text style={[styles.yardStatusTitle, { color: colors.text }]}>Yard based</Text>
                <Text style={[styles.yardStatusText, { color: colors.textMuted }]}>No job assigned for this day.</Text>
              </View>
            </View>

            <View style={styles.prepSectionHeaderRow}>
              <View style={styles.prepSectionTitleRow}>
                <Text style={[styles.prepSectionTitle, { color: colors.text }]}>Vehicle preparation</Text>
                {!prepLoading ? (
                  <View style={[styles.prepCount, { backgroundColor: colors.surfaceAlt }]}>
                    <Text style={[styles.prepCountText, { color: colors.text }]}>{prepItems.length}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.prepSectionSubtitle, { color: colors.textMuted }]}>
                Confirmed upcoming departures.
              </Text>
            </View>

            <View
              style={[
                styles.prepCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              {prepLoading ? (
                <LoadingState label="Loading upcoming vehicles…" compact />
              ) : (
                <>
                  <VehiclePrepGroups
                    title="Next 3 days"
                    groups={prepSoonByDate}
                    records={prepRecordsResource.data}
                    colors={colors}
                    emptyMessage="No vehicles need preparing in the next 3 days."
                  />
                  <View style={[styles.prepRangeDivider, { backgroundColor: colors.border }]} />
                  <VehiclePrepGroups
                    title="Upcoming after 3 days"
                    groups={prepLaterByDate}
                    records={prepRecordsResource.data}
                    colors={colors}
                    emptyMessage="No later confirmed departures."
                  />
                </>
              )}
            </View>
          </>
        )}
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  safeArea: { flex: 1 },

  /* Hero */
  heroCard: {
    borderRadius: t.radius.xl,
    overflow: "hidden",
  },
  heroContent: {
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.sm,
  },
  heroEyebrow: {
    ...t.typography.label,
    letterSpacing: 0.6,
  },
  heroTitle: { ...t.typography.pageTitle, letterSpacing: 0.2, marginTop: t.spacing.none },
  heroDate: { fontSize: t.typography.bodySmall.fontSize, marginTop: t.spacing.xxs, fontWeight: "600" },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: t.spacing.xs,
    gap: t.spacing.xs,
    flexWrap: "wrap",
  },
  datePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
  },
  pillDateText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    gap: t.spacing.xxs,
  },
  statusDot: { width: 8, height: 8, borderRadius: t.radius.pill },
  statusText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  countPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
  },
  countPillText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },

  bankHolidayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_16091f_a55t3z,
    maxWidth: "55%",
  },
  bankHolidayPillText: { color: staticColors.hex_e9d5ff_rltstn, fontSize: t.typography.metadata.fontSize, fontWeight: "800" },

  /* Day navigation */
  dayNavRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: t.spacing.xs,
    gap: t.spacing.xs,
  },
  dayNavButton: {
    width: t.controls.iconButtonSm,
    height: t.controls.iconButtonSm,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dayTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "800", textAlign: "center" },
  dayTitleBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  todayLink: {
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  todayLinkText: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "800",
  },

  /* Scroll content */
  scrollViewContent: { paddingHorizontal: t.spacing.md, paddingTop: t.spacing.sm, paddingBottom: 200 },

  /* Job Card */
  jobCard: {
    borderRadius: t.radius.xl,
    padding: t.controls.cardPaddingLg,
    marginBottom: t.spacing.sm,
    shadowColor: staticColors.hex_000_yhlkvq,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  titleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: t.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: t.spacing.sm,
  },
  jobHeading: { flex: 1, minWidth: 0 },
  jobTitleLine: { flexDirection: "row", alignItems: "center" },
  jobDot: { width: 8, height: 8, borderRadius: t.radius.pill, marginRight: t.spacing.xs },
  jobTitle: { flex: 1, fontSize: t.typography.sectionTitle.fontSize, lineHeight: t.typography.sectionTitle.lineHeight, fontWeight: "900", letterSpacing: 0.2 },
  jobNumber: { marginTop: t.spacing.xxs, marginLeft: t.spacing.md, fontSize: t.typography.caption.fontSize, fontWeight: "700" },
  callBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
  },
  callBadgeText: { color: staticColors.hex_111111_a7aqp2, fontWeight: "800", fontSize: t.typography.bodySmall.fontSize },

  detailsContainer: { paddingTop: t.spacing.sm, marginBottom: t.spacing.xs, gap: t.spacing.xs },
  jobDetailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
  },
  jobDetailText: { flex: 1, fontSize: t.typography.body.fontSize, lineHeight: t.typography.body.lineHeight, fontWeight: "600" },

  noteBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: t.spacing.xs,
    borderRadius: t.radius.md,
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
  },
  noteText: { fontSize: t.typography.body.fontSize, flexShrink: 1 },
  noteLabel: { fontWeight: "700" },
  noteBody: {},

  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginTop: t.spacing.none,
    alignItems: "center",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
    minHeight: t.controls.buttonHeight,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.pill,
    flex: 1,
    minWidth: 150,
  },
  actionText: { fontWeight: "700", fontSize: t.typography.body.fontSize },

  /* Empty / Holiday / Weekend cards */
  emptyCard: {
    marginTop: t.spacing.md,
    borderRadius: t.radius.xl,
    paddingVertical: t.spacing.xl,
    paddingHorizontal: t.spacing.lg,
    alignItems: "center",
    borderWidth: 1,
  },
  bigIconWrap: {
    width: 54,
    height: 54,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: t.spacing.sm,
  },
  emptyTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "800", marginBottom: t.spacing.xxs },
  emptySubtitle: { fontSize: t.typography.body.fontSize, textAlign: "center" },

  /* Loading */
  loadingWrap: { paddingTop: t.spacing["3xl"], alignItems: "center" },
  loadingText: { fontSize: t.typography.bodySmall.fontSize, marginTop: t.spacing.xs },

  /* VEHICLE PREP section on Yard days */
  yardStatusRow: {
    minHeight: 72,
    padding: t.spacing.sm,
    borderRadius: t.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },
  yardStatusIcon: {
    width: 42,
    height: 42,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  yardStatusCopy: { flex: 1, minWidth: 0 },
  yardStatusTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    lineHeight: t.typography.bodyLarge.lineHeight,
    fontWeight: "800",
  },
  yardStatusText: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "600",
  },
  prepSectionHeaderRow: {
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.xs,
    flexDirection: "column",
    alignItems: "flex-start",
  },
  prepSectionTitleRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  prepSectionTitle: { fontSize: t.typography.bodyLarge.fontSize, fontWeight: "800" },
  prepSectionSubtitle: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none },
  prepCount: {
    minWidth: t.controls.chipMinHeight,
    height: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  prepCountText: { fontSize: t.typography.metadata.fontSize, fontWeight: "900" },
  prepCard: { borderRadius: t.radius.lg, padding: t.controls.cardPadding, marginBottom: t.spacing.md, borderWidth: 1 },
  prepGroup: { marginBottom: t.spacing.xs },
  prepRangeSection: { width: "100%" },
  prepRangeLabel: {
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xs,
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  prepRangeEmpty: {
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "600",
  },
  prepRangeDivider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    marginVertical: t.spacing.sm,
  },
  prepDateLabel: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
    marginBottom: t.spacing.xxs,
  },
  prepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: staticColors.hex_333333_8y2gva,
  },
  prepVehicleMain: { fontSize: t.typography.body.fontSize, fontWeight: "700" },
  prepGoingOutText: { fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none },
  prepBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: t.spacing.xxs,
    marginTop: t.spacing.xxs,
  },
  prepAction: {
    alignSelf: "flex-start",
    marginTop: t.spacing.xs,
    marginLeft: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  prepActionText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },

  prepComplianceBad: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_e53935_rjwrqy,
    borderWidth: 1,
    borderColor: staticColors.hex_0b0b0b_9v81ck,
    gap: t.spacing.xxs,
  },
  prepComplianceText: { fontSize: t.typography.micro.fontSize, fontWeight: "800", color: staticColors.hex_fff_yhjmu8 },

  prepReadyState: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    gap: t.spacing.xxs,
  },
  prepReadyText: { fontSize: t.typography.micro.fontSize, fontWeight: "800" },

  serviceLoadingRow: { flexDirection: "row", alignItems: "center" },
  serviceLoadingText: { marginLeft: t.spacing.xs, fontSize: t.typography.bodySmall.fontSize },
  emptyServiceState: { flexDirection: "row", alignItems: "center" },
  emptyServiceText: { marginLeft: t.spacing.xxs, fontSize: t.typography.bodySmall.fontSize },

});
const DAY_FORMAT_LONG = {
  weekday: "long",
  day: "2-digit",
  month: "short",
  year: "numeric",
};
