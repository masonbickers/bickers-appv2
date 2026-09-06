// app/(protected)/screens/schedule.js
import {
  useLocalSearchParams } from "expo-router";
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Calendar } from "react-native-calendars";
import Icon from "react-native-vector-icons/Feather";

import PageHeaderCard from "../../../components/PageHeaderCard";
import { AsyncContentState, EmptyState } from "../../../components/AsyncState";
import PageShell from "../../../components/layout/PageShell";
import { AppButton,
  AppText as Text,
} from "../../../components/ui/AppPrimitives";
import { useBookings, useHolidays, useVehicles } from "../../../hooks/useOperationalData";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import { isCrewedBooking } from "../../../lib/bookingVisibility";
import {
  collapseLinkedJobsForDay,
  displayJobNumber,
} from "../../../lib/linkedBookingDays";
import { designTokens as t } from "../../../lib/design/tokens";
import {
  getBookingVehicleReferences,
  getVehicleDisplayList,
} from "../../../lib/fleetSchema";
import { useAuth } from "../../../providers/AuthProvider";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import { withAlpha } from "../../../lib/design/color";

/* ───────────────────────────────
   BANK HOLIDAYS (UK via GOV.UK)
   - Source: https://www.gov.uk/bank-holidays.json
   - Region options: "england-and-wales" | "scotland" | "northern-ireland"
──────────────────────────────── */
const BANK_HOLIDAY_REGION = "england-and-wales";
const BANK_HOLIDAY_COLOR = staticColors.hex_7c3aed_7wptwh; // purple
const BANK_HOLIDAY_BORDER = staticColors.hex_a855f7_u9x9hq;

async function fetchUKBankHolidays(region = BANK_HOLIDAY_REGION) {
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const events = json?.[region]?.events || [];
    // map: date -> title
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

/* -------------------------------------------------------------------------- */
/*                                   HELPERS                                  */
/* -------------------------------------------------------------------------- */

function safeStr(v) {
  return String(v ?? "").trim().toLowerCase();
}

function canonicalEmployeeCode(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits) return digits.padStart(4, "0");
  return safeStr(raw);
}

function codesEqual(a, b) {
  const aa = canonicalEmployeeCode(a);
  const bb = canonicalEmployeeCode(b);
  return !!aa && !!bb && aa === bb;
}

function resolveEmployeeByCode(allEmployees, codeValue) {
  const code = canonicalEmployeeCode(codeValue);
  if (!code) return null;
  return (allEmployees || []).find((x) => codesEqual(x?.userCode, code)) || null;
}

function toDateSafe(v) {
  if (!v) return null;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (m) {
      const [, y, mo, d] = m;
      return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
    }
  }
  if (v.toDate && typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function toISODate(d) {
  const date = d instanceof Date ? d : toDateSafe(d);
  if (!date) return null;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function getCallTime(job, dateISO) {
  return (
    job?.callTimes?.[dateISO] ||
    job?.callTimeByDate?.[dateISO] ||
    job?.call_times?.[dateISO] ||
    job?.callTime ||
    job?.calltime ||
    job?.call_time ||
    job?.notesByDate?.[`${dateISO}-callTime`] ||
    null
  );
}


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

    return { code: canonicalEmployeeCode(rawCode), name: safeStr(name), displayName: name };
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

  return "paid"; // default to paid if not specified (keeps current behaviour)
}

function isApprovedHoliday(h) {
  const s = safeStr(h?.status);
  // treat empty status as approved (backwards compatible), but if status exists it must be approved
  if (!s) return true;
  return s === "approved";
}

/* -------------------------------------------------------------------------- */
/*                                  SCREEN                                    */
/* -------------------------------------------------------------------------- */

export default function SchedulePage() {
  const params = useLocalSearchParams();
  const { employee, isAuthed, loading } = useAuth();
  const { colors } = useTheme();
  const responsive = useResponsiveLayout();
  const bookingsResource = useBookings();
  const holidaysResource = useHolidays();
  const vehiclesResource = useVehicles();

  const [markedDates, setMarkedDates] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayInfo, setDayInfo] = useState(null);
  const [viewMode, setViewMode] = useState("month");

  // ✅ control which month the Calendar opens on
  const [calendarCurrent, setCalendarCurrent] = useState(toISODate(new Date()));

  // ✅ Bank holidays: date -> title
  const [bankHolidayMap, setBankHolidayMap] = useState({});

  // ✅ If navigated here with ?date=YYYY-MM-DD, auto-select it and open that month
  useEffect(() => {
    const incoming = String(params?.date || "").trim();
    if (!incoming) return;

    const d = new Date(incoming);
    if (Number.isNaN(d.getTime())) return;

    const iso = toISODate(d);
    setSelectedDay(iso);
    setCalendarCurrent(iso);
  }, [params?.date]);

  // Load bank holidays once
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

  /* -------------------------------------------------------------------------- */
  /*                                LOAD DATA                                  */
  /* -------------------------------------------------------------------------- */

  useEffect(() => {
    const loadData = () => {
      if (loading || !isAuthed) {
        setMarkedDates({});
        setSelectedDay(null);
        setDayInfo(null);
        return;
      }

      const meCode = canonicalEmployeeCode(employee?.userCode);
      const meName = safeStr(employee?.name || employee?.displayName);

      if (!meCode && !meName) {
        setMarkedDates({});
        setSelectedDay(null);
        setDayInfo({ jobs: {}, holidayByDate: {}, bankHolidays: {} });
        return;
      }

      const jobs = bookingsResource.data;
      const holidays = holidaysResource.data;
      const allEmployees = bookingsResource.employees;
      const allVehicles = vehiclesResource.data;


      const marks = {};
      const jobMap = {};
      const holidayByDate = {}; // ✅ date -> { payType: "paid"|"unpaid", title, status }

      /* --------------------------------- JOBS --------------------------------- */
      for (const job of jobs) {
        if (!isCrewedBooking(job)) continue;
        const dates = Array.isArray(job.bookingDates) ? job.bookingDates : [];
        if (!dates.length) continue;

        for (const d of dates) {
          const dateStr = toISODate(d);
          if (!dateStr) continue;

          const todaysEmps = getEmployeesForDate(job, dateStr, allEmployees);

          const isMineToday =
            (!!meCode && todaysEmps.some((r) => codesEqual(r.code, meCode))) ||
            (!!meName && todaysEmps.some((r) => safeStr(r.name) === meName));

          if (!isMineToday) continue;

          marks[dateStr] = {
            ...(marks[dateStr] || {}),
            jobCount: Number(marks[dateStr]?.jobCount || 0) + 1,
            scheduleTone: "job",
            customStyles: {
              container: { backgroundColor: staticColors.hex_1c3c7a_8m76oi, borderRadius: t.radius.md },
              text: { color: staticColors.hex_fff_yhjmu8, fontWeight: "700" },
            },
          };

          if (!jobMap[dateStr]) jobMap[dateStr] = [];

          const vehicleNames = getVehicleDisplayList(
            getBookingVehicleReferences(job),
            allVehicles
          );

          jobMap[dateStr].push({
            ...job,
            employees: todaysEmps.map((r) => r.displayName).filter(Boolean),
            vehicleNames,
          });
        }
      }

      Object.keys(jobMap).forEach((dateStr) => {
        jobMap[dateStr] = collapseLinkedJobsForDay(jobMap[dateStr], dateStr);
        if (marks[dateStr]) marks[dateStr].jobCount = jobMap[dateStr].length;
      });

      /* ------------------------------- HOLIDAYS ------------------------------- */
      for (const h of holidays) {
        const codeMatch =
          !!meCode && [h.employeeCode, h.userCode].some((code) => codesEqual(code, meCode));

        const nameMatch =
          !!meName && [h.employee, h.name].map(safeStr).includes(meName);

        if (!codeMatch && !nameMatch) continue;

        // ✅ only show approved (matches "holiday the same" behaviour from Job Day screen)
        if (!isApprovedHoliday(h)) continue;

        const start = toDateSafe(h.startDate || h.from);
        const end = toDateSafe(h.endDate || h.to || start);
        if (!start) continue;

        const payType = getHolidayPayType(h); // "paid" | "unpaid"
        const isUnpaid = payType === "unpaid";

        const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          const dateStr = toISODate(d);
          if (!dateStr) continue;

          // Save meta so selected-day card can say Paid/Unpaid
          holidayByDate[dateStr] = {
            payType,
            status: "approved",
          };

          // Keep holiday green, but make unpaid obvious (yellow border)
          const baseContainer = { backgroundColor: staticColors.hex_126536_a7xuir, borderRadius: t.radius.md };
          const unpaidBorder = isUnpaid
            ? { borderWidth: 2, borderColor: staticColors.hex_ffd60a_5c6r45 }
            : {};

          marks[dateStr] = {
            ...(marks[dateStr] || {}),
            scheduleTone: isUnpaid ? "unpaid" : "leave",
            customStyles: {
              container: { ...baseContainer, ...unpaidBorder },
              text: { color: staticColors.hex_fff_yhjmu8, fontWeight: "700" },
            },
          };
        }
      }

      /* ------------------------------ BANK HOLIDAYS ---------------------------- */
      // Add bank holiday styling without overriding jobs/holidays.
      // If date already marked, add a purple border so it still “shows”.
      const bh = bankHolidayMap || {};
      Object.keys(bh).forEach((dateStr) => {
        if (!dateStr) return;

        const existing = marks[dateStr];

        if (existing?.customStyles?.container) {
          const prevContainer = existing.customStyles.container || {};
          marks[dateStr] = {
            ...existing,
            bankHoliday: true,
            customStyles: {
              ...existing.customStyles,
              container: {
                ...prevContainer,
                borderWidth: Math.max(Number(prevContainer.borderWidth || 0), 2),
                borderColor: BANK_HOLIDAY_BORDER,
              },
              text: {
                ...(existing.customStyles.text || {}),
              },
            },
          };
        } else {
          marks[dateStr] = {
            ...(marks[dateStr] || {}),
            scheduleTone: "bank",
            bankHoliday: true,
            customStyles: {
              container: { backgroundColor: BANK_HOLIDAY_COLOR, borderRadius: t.radius.md },
              text: { color: staticColors.hex_fff_yhjmu8, fontWeight: "800" },
            },
          };
        }
      });

      setMarkedDates(marks);
      setDayInfo({ jobs: jobMap, holidayByDate, bankHolidays: bh });
    };

    loadData();
  }, [
    bankHolidayMap,
    bookingsResource.data,
    bookingsResource.employees,
    employee?.displayName,
    employee?.name,
    employee?.userCode,
    holidaysResource.data,
    isAuthed,
    loading,
    vehiclesResource.data,
  ]);

  const handleDayPress = (day) => {
    setSelectedDay(day.dateString);
    setCalendarCurrent(day.dateString);
  };

  const clearSelected = () => setSelectedDay(null);
  const jumpToToday = () => {
    const t = toISODate(new Date());
    setSelectedDay(t);
    setCalendarCurrent(t);
  };

  /* ---------------------------- SELECTED MARKING ---------------------------- */
  const computedMarked = useMemo(() => {
    if (!selectedDay) return markedDates;

    return {
      ...markedDates,
      [selectedDay]: {
        ...(markedDates[selectedDay] || {}),
        selected: true,
        customStyles: {
          container: {
            ...(markedDates[selectedDay]?.customStyles?.container || {}),
            borderWidth: 2,
            borderColor: colors.accent,
            borderRadius: t.radius.md,
          },
          text: {
            ...(markedDates[selectedDay]?.customStyles?.text || {}),
            color: markedDates[selectedDay] ? staticColors.hex_fff_yhjmu8 : colors.accent,
            fontWeight: "900",
          },
        },
      },
    };
  }, [colors.accent, markedDates, selectedDay]);

  const monthSummary = useMemo(() => {
    const monthKey = String(calendarCurrent || "").slice(0, 7);
    let jobs = 0;
    let leave = 0;
    Object.entries(markedDates).forEach(([date, mark]) => {
      if (!date.startsWith(monthKey)) return;
      jobs += Number(mark?.jobCount || 0);
      if (mark?.scheduleTone === "leave" || mark?.scheduleTone === "unpaid") leave += 1;
    });
    return { jobs, leave };
  }, [calendarCurrent, markedDates]);

  const agendaItems = useMemo(() => {
    if (!dayInfo) return [];
    const dates = new Set([
      ...Object.keys(dayInfo.jobs || {}),
      ...Object.keys(dayInfo.holidayByDate || {}),
      ...Object.keys(dayInfo.bankHolidays || {}),
    ]);
    const today = toISODate(new Date());
    return Array.from(dates)
      .filter((date) => date >= today)
      .sort()
      .slice(0, 30)
      .map((date) => ({
        date,
        jobs: dayInfo.jobs?.[date] || [],
        holiday: dayInfo.holidayByDate?.[date] || null,
        bankHoliday: dayInfo.bankHolidays?.[date] || null,
      }));
  }, [dayInfo]);

  const refreshBookings = bookingsResource.refresh;
  const refreshHolidays = holidaysResource.refresh;
  const refreshVehicles = vehiclesResource.refresh;

  const onRefresh = useCallback(async () => {
    await Promise.all([
      refreshBookings(),
      refreshHolidays(),
      refreshVehicles(),
    ]);
  }, [refreshBookings, refreshHolidays, refreshVehicles]);

  if (loading || !isAuthed) return null;

  return (
    <PageShell
      contentSpacing="compact"
      customHeader={
        <PageHeaderCard
          eyebrow="Operations"
          title="Schedule"
          subtitle="Jobs, leave and availability in one place."
          action={
            <AppButton
              label="Today"
              icon="crosshair"
              variant="secondary"
              onPress={jumpToToday}
              style={styles.todayBtn}
            />
          }
          style={styles.heroCard}
          contentStyle={styles.heroContent}
        />
      }
      customHeaderPlacement="scroll"
      refresh={{
        refreshing:
          bookingsResource.isRefreshing ||
          holidaysResource.isRefreshing ||
          vehiclesResource.isRefreshing,
        onRefresh,
      }}
      scrollProps={{ keyboardShouldPersistTaps: "handled" }}
    >
          <View style={styles.toolbarRow}>
            <View
              style={[
                styles.segmentedControl,
                { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}
            >
              {[
                { key: "month", label: "Month", icon: "calendar" },
                { key: "agenda", label: "Agenda", icon: "list" },
              ].map((option) => {
                const active = viewMode === option.key;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setViewMode(option.key)}
                    style={[
                      styles.segmentButton,
                      active && { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <Icon
                      name={option.icon}
                      size={14}
                      color={active ? colors.accent : withAlpha(colors.text, 0.72)}
                    />
                    <Text
                      style={[
                        styles.segmentText,
                        { color: active ? colors.text : withAlpha(colors.text, 0.72) },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.monthSummary}>
              <SummaryMetric value={monthSummary.jobs} label="jobs" colors={colors} />
              <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
              <SummaryMetric value={monthSummary.leave} label="leave" colors={colors} />
            </View>
          </View>

          <View
            style={[
              styles.scheduleLayout,
              responsive.isTablet && styles.scheduleLayoutTablet,
            ]}
          >
            <View style={styles.calendarColumn}>
              {viewMode === "month" ? (
                <>
                  <View
                    style={[
                      styles.card,
                      { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                    ]}
                  >
                    <Calendar
                      firstDay={1}
                      hideExtraDays
                      markedDates={computedMarked}
                      onDayPress={handleDayPress}
                      onMonthChange={(month) => setCalendarCurrent(month.dateString)}
                      current={calendarCurrent}
                      dayComponent={({ date, state, marking }) => (
                        <CustomCalendarDay
                          date={date}
                          state={state}
                          marking={marking}
                          colors={colors}
                          onPress={handleDayPress}
                        />
                      )}
                      theme={{
                        backgroundColor: colors.background,
                        calendarBackground: colors.surfaceAlt,
                        monthTextColor: colors.text,
                        arrowColor: colors.accent,
                        textSectionTitleColor: colors.textMuted,
                        textMonthFontWeight: "800",
                        textDayHeaderFontWeight: "700",
                      }}
                    />
                    <View
                      style={[styles.legendRow, { borderTopColor: colors.border }]}
                      accessibilityLabel="Calendar legend"
                    >
                      <LegendPill color={staticColors.hex_1c3c7a_8m76oi} label="Job" colors={colors} />
                      <LegendPill
                        color={staticColors.hex_126536_a7xuir}
                        label="Paid"
                        accessibilityLabel="Paid leave"
                        colors={colors}
                      />
                      <LegendPill
                        color={staticColors.hex_126536_a7xuir}
                        label="Unpaid"
                        accessibilityLabel="Unpaid leave"
                        borderColor={staticColors.hex_ffd60a_5c6r45}
                        colors={colors}
                      />
                      <LegendPill
                        color={BANK_HOLIDAY_COLOR}
                        label="Bank"
                        accessibilityLabel="Bank holiday"
                        colors={colors}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <AgendaList
                  items={agendaItems}
                  colors={colors}
                  selectedDay={selectedDay}
                  onSelect={(date) => {
                    setSelectedDay(date);
                    setCalendarCurrent(date);
                  }}
                />
              )}
            </View>

            <View style={styles.detailsColumn}>
              {selectedDay ? (
                <View
                  style={[
                    styles.dayHeader,
                    responsive.isTablet && styles.dayHeaderTablet,
                    { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.dayText, { color: colors.text }]}>
                    {toDateSafe(selectedDay)?.toLocaleDateString("en-GB", {
                      weekday: "long",
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </Text>
                  <AppButton
                    label="Clear"
                    icon="x"
                    variant="ghost"
                    onPress={clearSelected}
                    style={styles.clearBtn}
                  />
                </View>
              ) : null}

              <AsyncContentState
                resources={[bookingsResource, holidaysResource, vehiclesResource]}
                hasContent={
                  bookingsResource.data.length > 0 ||
                  holidaysResource.data.length > 0
                }
                onRetry={onRefresh}
                loadingLabel="Loading schedule…"
              >
                {renderDetails(selectedDay, dayInfo, colors)}
              </AsyncContentState>
            </View>
          </View>

    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/*                            SUBCOMPONENTS / UI                              */
/* -------------------------------------------------------------------------- */

function renderDetails(selectedDay, dayInfo, colors) {
  if (!selectedDay || !dayInfo) {
    return (
      <View
        accessibilityRole="summary"
        style={[
          styles.dateHint,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <View style={[styles.dateHintIcon, { backgroundColor: colors.surface }]}>
          <Icon name="calendar" size={18} color={colors.textMuted} />
        </View>
        <Text style={[styles.dateHintText, { color: colors.textMuted }]}>
          Tap a date to view jobs or leave details.
        </Text>
      </View>
    );
  }

  const { jobs, holidayByDate, bankHolidays } = dayInfo;

  /* ---------------------------------- JOBS ---------------------------------- */
  if (jobs[selectedDay]?.length) {
    return (
      <View
        style={[
          styles.infoCard,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
        <View style={styles.infoHeader}>
          <Text style={[styles.infoTitle, { color: colors.text }]}>Jobs</Text>
          <View style={[styles.badge, { backgroundColor: colors.accent }]}>
            <Text style={[styles.badgeText, { color: staticColors.hex_fff_yhjmu8 }]}>
              {jobs[selectedDay].length}
            </Text>
          </View>
        </View>

        {jobs[selectedDay].map((job) => {
          const callTime = getCallTime(job, selectedDay);
          const dayNote =
            job?.notesByDate?.[selectedDay] === "Other"
              ? job?.notesByDate?.[`${selectedDay}-other`]
              : job?.notesByDate?.[selectedDay];

          return (
            <View
              key={job.id}
              style={[
                styles.jobCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.jobRow}>
                <Text style={[styles.jobTitle, { color: colors.text }]}>
                  Job #{displayJobNumber(job)}
                </Text>

                {job.status && (
                  <Text
                    style={[
                      styles.jobStatus,
                      { backgroundColor: colors.surfaceAlt, color: colors.text },
                    ]}
                  >
                    {job.status}
                  </Text>
                )}
              </View>

              {callTime ? (
                <View
                  style={[
                    styles.callTimeRow,
                    { backgroundColor: colors.accentSoft || colors.surfaceAlt },
                  ]}
                >
                  <Icon name="clock" size={14} color={colors.accent} />
                  <Text style={[styles.callTimeText, { color: colors.text }]}>
                    Call time {String(callTime)}
                  </Text>
                </View>
              ) : null}

              {job.client && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Client:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.client}
                  </Text>
                </Text>
              )}

              {job.location && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Location:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.location}
                  </Text>
                </Text>
              )}

              {Array.isArray(job.vehicleNames) && job.vehicleNames.length > 0 && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Vehicles:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.vehicleNames.join(", ")}
                  </Text>
                </Text>
              )}

              {Array.isArray(job.equipment) && job.equipment.length > 0 && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Equipment:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.equipment.join(", ")}
                  </Text>
                </Text>
              )}

              {Array.isArray(job.employees) && job.employees.length > 0 && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Crew:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {job.employees.join(", ")}
                  </Text>
                </Text>
              )}

              {dayNote && (
                <Text style={[styles.jobItem, { color: colors.textMuted }]}>
                  Day Note:{" "}
                  <Text style={[styles.jobValue, { color: colors.text }]}>
                    {dayNote}
                  </Text>
                </Text>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  /* ------------------------------ BANK HOLIDAY ------------------------------ */
  if (bankHolidays?.[selectedDay]) {
    return (
      <EmptyState
        icon="flag"
        title="Bank Holiday"
        message={bankHolidays[selectedDay]}
        compact
      />
    );
  }

  /* -------------------------------- HOLIDAY (PAID/UNPAID) ------------------- */
  const hol = holidayByDate?.[selectedDay];
  if (hol) {
    const isUnpaid = hol.payType === "unpaid";
    return (
      <EmptyState
        icon="umbrella"
        title={isUnpaid ? "Unpaid Holiday" : "Holiday"}
        message={
          isUnpaid ? "This day is recorded as unpaid leave." : "Enjoy your time off."
        }
        compact
      />
    );
  }

  /* ------------------------------- WEEKENDS -------------------------------- */
  const dow = new Date(selectedDay).getDay();
  if (dow === 0 || dow === 6) {
    return (
      <EmptyState
        icon="sun"
        title="Weekend"
        message="You are not booked today."
        compact
      />
    );
  }

  /* --------------------------- DEFAULT (YARD) --------------------------- */
  return (
    <EmptyState
      icon="home"
      title="Yard Based"
      message="No offsite bookings today."
      compact
    />
  );
}

function SummaryMetric({ value, label, colors }) {
  return (
    <View style={styles.summaryMetric}>
      <Text style={[styles.summaryValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function CustomCalendarDay({ date, state, marking, colors, onPress }) {
  if (!date || state === "disabled") return <View style={styles.calendarDay} />;

  const hasJob = Number(marking?.jobCount || 0) > 0;
  const hasPaidLeave = marking?.scheduleTone === "leave";
  const hasUnpaidLeave = marking?.scheduleTone === "unpaid";
  const hasBankHoliday = marking?.bankHoliday === true;
  const primaryTone = hasJob
    ? staticColors.hex_3568be_8u10kp
    : hasPaidLeave
    ? staticColors.hex_16834a_a5btzz
    : hasUnpaidLeave
    ? staticColors.hex_d6b400_65zpoi
    : hasBankHoliday
    ? BANK_HOLIDAY_COLOR
    : null;
  const isSelected = marking?.selected === true;
  const isToday = state === "today";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={toDateSafe(date.dateString)?.toLocaleDateString("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })}
      accessibilityState={{ selected: isSelected }}
      onPress={() => onPress(date)}
      style={({ pressed }) => [
        styles.calendarDay,
        primaryTone && {
          backgroundColor: withAlpha(primaryTone, 0.22),
          borderColor: withAlpha(primaryTone, 0.72),
          borderWidth: 1,
        },
        hasUnpaidLeave && !isSelected && {
          borderColor: staticColors.hex_ffd60a_5c6r45,
          borderWidth: 2,
        },
        isToday && !isSelected && {
          borderColor: withAlpha(colors.accent, 0.82),
          borderWidth: 1.5,
        },
        isSelected && {
          backgroundColor: colors.accent,
          borderColor: colors.accent,
          borderWidth: 2,
        },
        pressed && { opacity: 0.65 },
      ]}
    >
      <Text
        style={[
          styles.calendarDayNumber,
          {
            color: isSelected
              ? colors.textOnAccent
              : primaryTone
              ? colors.text
              : isToday
              ? colors.accent
              : colors.text,
          },
        ]}
      >
        {date.day}
      </Text>
      <View style={styles.dayIndicatorRow}>
        {hasJob ? <View style={[styles.dayIndicator, { backgroundColor: staticColors.hex_4e86e6_81th4a }]} /> : null}
        {hasPaidLeave ? (
          <View style={[styles.dayIndicator, { backgroundColor: staticColors.hex_20a35c_6zwr5s }]} />
        ) : null}
        {hasUnpaidLeave ? (
          <View
            style={[
              styles.dayIndicator,
              { backgroundColor: "transparent", borderColor: staticColors.hex_ffd60a_5c6r45, borderWidth: 1.5 },
            ]}
          />
        ) : null}
        {hasBankHoliday ? (
          <View style={[styles.dayIndicator, { backgroundColor: staticColors.hex_9b5cf6_drrrcr }]} />
        ) : null}
      </View>
      {Number(marking?.jobCount || 0) > 1 ? (
        <View style={[styles.dayCountBadge, { backgroundColor: colors.accent }]}>
          <Text style={styles.dayCountText}>{marking.jobCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function AgendaList({ items, colors, selectedDay, onSelect }) {
  if (!items.length) {
    return (
      <EmptyState
        icon="calendar"
        title="Nothing upcoming"
        message="New jobs and approved leave will appear here."
        compact
      />
    );
  }

  return (
    <View style={styles.agendaList}>
      {items.map((item) => {
        const firstJob = item.jobs[0];
        const title = firstJob
          ? firstJob.client || `Job #${displayJobNumber(firstJob)}`
          : item.bankHoliday
          ? item.bankHoliday
          : item.holiday?.payType === "unpaid"
          ? "Unpaid leave"
          : "Paid leave";
        const callTime = firstJob ? getCallTime(firstJob, item.date) : null;
        const dateLabel = toDateSafe(item.date)?.toLocaleDateString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
        });

        return (
          <Pressable
            key={item.date}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedDay === item.date }}
            onPress={() => onSelect(item.date)}
            style={({ pressed }) => [
              styles.agendaCard,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: selectedDay === item.date ? colors.accent : colors.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <View style={styles.agendaDateColumn}>
              <Text style={[styles.agendaDate, { color: colors.text }]}>{dateLabel}</Text>
              {callTime ? (
                <Text style={[styles.agendaTime, { color: colors.accent }]}>{callTime}</Text>
              ) : null}
            </View>
            <View style={styles.agendaContent}>
              <Text style={[styles.agendaTitle, { color: colors.text }]} numberOfLines={2}>
                {title}
              </Text>
              <Text style={[styles.agendaMeta, { color: colors.textMuted }]} numberOfLines={2}>
                {firstJob
                  ? [firstJob.location, item.jobs.length > 1 ? `${item.jobs.length} jobs` : null]
                      .filter(Boolean)
                      .join(" · ") || "View assignment"
                  : "Approved time away"}
              </Text>
            </View>
            <Icon name="chevron-right" size={19} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

function LegendPill({ color, label, accessibilityLabel, borderColor, colors }) {
  return (
    <View
      accessibilityLabel={accessibilityLabel || label}
      style={styles.pill}
    >
      <View
        style={[
          styles.dot,
          {
            backgroundColor: color,
            borderColor: borderColor || "transparent",
            borderWidth: borderColor ? 2 : 0,
          },
        ]}
      />
      <Text style={[styles.pillText, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  STYLES                                    */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: staticColors.hex_000_yhlkvq },
  container: { flex: 1, backgroundColor: staticColors.hex_000_yhlkvq },
  scrollContainer: {
    paddingHorizontal: t.spacing.md,
    paddingTop: t.spacing.xs,
    paddingBottom: 200,
  },

  heroCard: {
    position: "relative",
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
  heroTitle: {
    marginTop: t.spacing.xxs,
    ...t.typography.pageTitle,
    letterSpacing: 0.2,
  },
  heroSubTitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "600",
    lineHeight: t.typography.bodySmall.lineHeight,
  },
  todayBtn: {
    minHeight: t.controls.buttonHeight,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.pill,
  },
  toolbarRow: {
    marginBottom: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
    flexWrap: "wrap",
  },
  segmentedControl: {
    minHeight: 42,
    padding: t.spacing.xxs,
    borderRadius: t.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  segmentButton: {
    minHeight: 34,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  segmentText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  monthSummary: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  summaryMetric: { flexDirection: "row", alignItems: "baseline", gap: t.spacing.xxs },
  summaryValue: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "900" },
  summaryLabel: { fontSize: t.typography.caption.fontSize, fontWeight: "700" },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 22 },
  scheduleLayout: {
    width: "100%",
  },
  scheduleLayoutTablet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.lg,
  },
  calendarColumn: {
    flex: 1.08,
    minWidth: 0,
  },
  detailsColumn: {
    flex: 0.92,
    minWidth: 0,
  },
  card: {
    borderRadius: t.radius.xl,
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
  },
  calendarDay: {
    width: 40,
    height: 42,
    borderRadius: t.radius.md,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  calendarDayNumber: { fontSize: t.typography.body.fontSize, lineHeight: t.typography.body.lineHeight, fontWeight: "700" },
  dayIndicatorRow: {
    minHeight: 4,
    marginTop: t.spacing.none,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  dayIndicator: { width: 10, height: 4, borderRadius: t.radius.sm },
  dayCountBadge: {
    position: "absolute",
    right: 1,
    top: 1,
    minWidth: 14,
    height: 14,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xxs,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCountText: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.micro.fontSize, lineHeight: t.typography.micro.lineHeight, fontWeight: "900" },
  dayHeader: {
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.xs,
    minHeight: 50,
    paddingVertical: t.spacing.xs,
    paddingLeft: t.spacing.sm,
    paddingRight: t.spacing.xs,
    borderRadius: t.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  dayText: { flex: 1, fontSize: t.typography.bodyLarge.fontSize, fontWeight: "800" },
  dayHeaderTablet: { marginTop: t.spacing.none },
  clearBtn: {
    minHeight: 36,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
  },

  dateHint: {
    marginTop: t.spacing.xs,
    minHeight: 52,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  dateHintIcon: {
    width: 34,
    height: 34,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  dateHintText: {
    flex: 1,
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "700",
  },

  infoCard: { marginTop: t.spacing.sm, padding: t.controls.cardPaddingLg, borderRadius: t.radius.xl },
  infoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoTitle: { fontSize: t.typography.sectionTitle.fontSize, fontWeight: "800" },
  infoSubtitle: { marginTop: t.spacing.xxs, fontSize: t.typography.body.fontSize },

  badge: { paddingVertical: t.spacing.none, paddingHorizontal: t.spacing.xs, borderRadius: t.radius.md },
  badgeText: { fontWeight: "800", fontSize: t.typography.metadata.fontSize },

  jobCard: { marginTop: t.spacing.sm, borderRadius: t.radius.lg, padding: t.controls.cardPadding },
  jobRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  jobTitle: { fontWeight: "800", fontSize: t.typography.bodyLarge.fontSize },
  jobStatus: {
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.sm,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  jobItem: { marginTop: t.spacing.xxs, fontSize: t.typography.body.fontSize },
  jobValue: { fontWeight: "700" },

  legendRow: {
    width: "100%",
    marginTop: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    paddingTop: t.spacing.xs,
    paddingBottom: t.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "nowrap",
    gap: t.spacing.xxs,
  },
  callTimeRow: {
    alignSelf: "flex-start",
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.xxs,
    minHeight: 30,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  callTimeText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  pill: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: t.controls.chipMinHeight,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xxs,
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: t.radius.xl,
  },
  dot: { width: 9, height: 9, borderRadius: t.radius.sm, marginRight: t.spacing.xxs, flexShrink: 0 },
  pillText: { fontSize: t.typography.caption.fontSize, fontWeight: "800", color: staticColors.hex_eee_yhivtv },
  agendaList: { gap: t.spacing.xs },
  agendaCard: {
    minHeight: 78,
    borderRadius: t.radius.xl,
    borderWidth: 1,
    padding: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },
  agendaDateColumn: { width: 70, alignSelf: "stretch", justifyContent: "center" },
  agendaDate: { fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight, fontWeight: "800" },
  agendaTime: { marginTop: t.spacing.xxs, fontSize: t.typography.sectionTitle.fontSize, lineHeight: t.typography.sectionTitle.lineHeight, fontWeight: "900" },
  agendaContent: { flex: 1, minWidth: 0 },
  agendaTitle: { fontSize: t.typography.bodyLarge.fontSize, lineHeight: t.typography.bodyLarge.lineHeight, fontWeight: "900" },
  agendaMeta: { marginTop: t.spacing.xxs, fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight, fontWeight: "600" },
});
