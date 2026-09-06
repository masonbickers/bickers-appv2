import { AppText as Text, AppPressable as TouchableOpacity, TextArea } from "../../components/ui/AppPrimitives";
import {
  useNavigation } from '@react-navigation/native';
import { addDoc,
  collection } from 'firebase/firestore';
import { useState } from 'react';
import {
  StyleSheet,
  Switch,
  View,
} from "react-native";
import DropDownPicker from 'react-native-dropdown-picker';
import Icon from 'react-native-vector-icons/Feather';
import { db } from '../../firebaseConfig';
import { useDataCache } from '../../providers/DataCacheProvider';
import { useTheme } from '../../providers/ThemeProvider';
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

const LUNCH_DEDUCTION_MINUTES = 30;
const ON_SET_BASIC_DAY_MINUTES = 10 * 60;
const PAID_WAIT_BEFORE_PRECALL_MINUTES = 60;

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const timeOptions = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    const hour = String(h).padStart(2, '0');
    const min = String(m).padStart(2, '0');
    timeOptions.push({ label: `${hour}:${min}`, value: `${hour}:${min}` });
  }
}

function timeToMinutes(value) {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function durationMinutes(startValue, endValue) {
  const start = timeToMinutes(startValue);
  const end = timeToMinutes(endValue);
  if (start == null || end == null) return 0;
  return end >= start ? end - start : end + 24 * 60 - start;
}

function absoluteMinutesFrom(anchorValue, value) {
  const anchor = timeToMinutes(anchorValue);
  const mins = timeToMinutes(value);
  if (anchor == null || mins == null) return null;
  return mins >= anchor ? mins : mins + 24 * 60;
}

function splitAfterBasicDay(anchorValue, startValue, endValue) {
  const start = absoluteMinutesFrom(anchorValue, startValue);
  const end = absoluteMinutesFrom(anchorValue, endValue);
  if (start == null || end == null || end <= start) {
    return { basicMinutes: 0, overtimeMinutes: 0 };
  }

  const anchor = timeToMinutes(anchorValue);
  const basicEnd = anchor + ON_SET_BASIC_DAY_MINUTES;
  const basicMinutes = Math.max(0, Math.min(end, basicEnd) - start);
  const overtimeMinutes = Math.max(0, end - Math.max(start, basicEnd));

  return { basicMinutes, overtimeMinutes };
}

function formatHoursMins(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

function labelForField(field) {
  const labels = {
    startTime: 'Start',
    endTime: 'Finish',
    leaveTime: 'Leave',
    arriveOnSet: 'Arrive On Set',
    preCall: 'Pre-Call',
    callTime: 'Call',
    wrapTime: 'Wrap',
    arriveBack: 'Arrive Back',
  };
  return labels[field] || field;
}

function computeDaySummary(entry) {
  const safeEntry = entry || {};
  const type = String(safeEntry.type || 'Yard');
  const times = safeEntry.times || {};
  const hasOnSetSignals =
    !!times.callTime ||
    !!times.wrapTime ||
    !!times.arriveBack ||
    !!times.leaveTime ||
    !!times.arriveOnSet ||
    !!times.preCall;
  const hasJobAllocation =
    safeEntry.hasJob === true ||
    safeEntry.hasJob === 'true' ||
    Boolean(safeEntry.bookingId) ||
    Boolean(safeEntry.jobId) ||
    Boolean(safeEntry.jobNumber) ||
    Boolean(safeEntry.turnaroundJob) ||
    (Array.isArray(safeEntry.jobs) && safeEntry.jobs.length > 0) ||
    Array.isArray(safeEntry.workshopJobs) && safeEntry.workshopJobs.length > 0;
  const isOnSetDay = type === 'On Set' || (hasJobAllocation && hasOnSetSignals);

  let start = null;
  let end = null;
  const resolvedType = isOnSetDay ? 'On Set' : 'Yard';

  if (!isOnSetDay) {
    start = times.startTime || null;
    end = times.endTime || null;
    const grossMinutes = durationMinutes(start, end);
    const yardMinutes = grossMinutes;

    return {
      start,
      end,
      grossMinutes,
      lunchDeductionMinutes: 0,
      netMinutes: grossMinutes,
      basicMinutes: 0,
      overtimeMinutes: 0,
      travelMinutes: 0,
      unpaidMinutes: 0,
      paidWaitMinutes: 0,
      yardMinutes,
      resolvedType,
      hasHours: grossMinutes > 0,
      breakdownLines: [yardMinutes > 0 ? `Yard ${formatHoursMins(yardMinutes)}` : null].filter(Boolean),
    };
  }

  start = times.callTime || times.preCall || times.leaveTime || times.arriveOnSet || null;
  end = times.arriveBack || times.wrapTime || null;

  const callToWrap = splitAfterBasicDay(times.callTime, times.callTime, times.wrapTime);
  const returnFromWrap = splitAfterBasicDay(times.callTime, times.wrapTime, times.arriveBack);
  const preCallOvertimeMinutes = durationMinutes(times.preCall, times.callTime);
  const outboundTravelMinutes = durationMinutes(times.leaveTime, times.arriveOnSet);
  const leaveToReturnMinutes = durationMinutes(times.leaveTime, times.arriveBack);
  const shouldPayTravel = leaveToReturnMinutes > ON_SET_BASIC_DAY_MINUTES;
  const travelMinutes = shouldPayTravel ? outboundTravelMinutes : 0;
  const gapBeforePreCallMinutes = durationMinutes(times.arriveOnSet, times.preCall);
  const hasGapBeforePreCall = timeToMinutes(times.arriveOnSet) != null && timeToMinutes(times.preCall) != null;
  const paidWaitMinutes = hasGapBeforePreCall
    ? Math.min(gapBeforePreCallMinutes, PAID_WAIT_BEFORE_PRECALL_MINUTES)
    : 0;
  const unpaidMinutes = hasGapBeforePreCall
    ? Math.max(0, gapBeforePreCallMinutes - PAID_WAIT_BEFORE_PRECALL_MINUTES)
    : 0;
  const basicMinutes = callToWrap.basicMinutes + returnFromWrap.basicMinutes + paidWaitMinutes;
  const overtimeMinutes =
    preCallOvertimeMinutes + callToWrap.overtimeMinutes + returnFromWrap.overtimeMinutes;
  const grossMinutes = basicMinutes + overtimeMinutes + travelMinutes;
  const lunchDeductionMinutes =
    resolvedType === 'On Set' && safeEntry.lunch && grossMinutes > 0
      ? LUNCH_DEDUCTION_MINUTES
      : 0;
  const hasSetInputs = Object.values(times).some(Boolean);
  const breakdownLines = hasSetInputs
    ? [
        `Basic ${formatHoursMins(basicMinutes)}`,
        `OT ${formatHoursMins(overtimeMinutes)}`,
        `Travel ${formatHoursMins(travelMinutes)}`,
        unpaidMinutes > 0 ? `Unpaid gap ${formatHoursMins(unpaidMinutes)}` : null,
      ].filter(Boolean)
    : [];

  return {
    start,
    end,
    grossMinutes,
    lunchDeductionMinutes,
    netMinutes: Math.max(0, grossMinutes - lunchDeductionMinutes),
    basicMinutes,
    overtimeMinutes,
    travelMinutes,
    unpaidMinutes,
    paidWaitMinutes,
    yardMinutes: 0,
    resolvedType,
    hasHours: grossMinutes > 0,
    breakdownLines,
  };
}

export default function TimesheetPage() {
  const { invalidate } = useDataCache();
  const { colors } = useTheme();
  const [weekData, setWeekData] = useState(
    daysOfWeek.reduce((acc, day) => {
      acc[day] = {
        type: 'Yard',
        times: {},
        nightSupervisor: false,
        lunch: false,
        overnight: false,
        saturdaySupervisor: false,
        sundaySupervisor: false,
        notes: '',
      };
      return acc;
    }, {})
  );

  const [openDropdowns, setOpenDropdowns] = useState({});

  const handleChange = (day, field, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        times: {
          ...prev[day].times,
          [field]: value,
        },
      },
    }));
  };

  const handleToggle = (day, field, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value,
      },
    }));
  };

  const handleNotesChange = (day, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        notes: value,
      },
    }));
  };

  const handleTypeChange = (day, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        type: value,
        times: {},
        nightSupervisor: false,
      },
    }));
  };
  const navigation = useNavigation();

  const getFilteredTimes = (previousValue, allowFullDay = false) => {
    if (!previousValue || allowFullDay) return timeOptions;
    return timeOptions.filter((t) => t.value > previousValue);
  };

  const [showPreview, setShowPreview] = useState(false);
  const [submittedMessage, setSubmittedMessage] = useState('');

  const weeklySummary = daysOfWeek.reduce(
    (acc, day) => {
      const summary = computeDaySummary(weekData[day]);
      acc.byDay[day] = summary;
      acc.totalMinutes += summary.netMinutes;
      acc.totalGrossMinutes += summary.grossMinutes;
      acc.totalLunchDeductionMinutes += summary.lunchDeductionMinutes;
      acc.totalBasicMinutes += summary.basicMinutes;
      acc.totalOvertimeMinutes += summary.overtimeMinutes;
      acc.totalTravelMinutes += summary.travelMinutes;
      acc.totalUnpaidMinutes += summary.unpaidMinutes;
      acc.totalYardMinutes += summary.yardMinutes;
      if (summary.hasHours) acc.filledDays += 1;
      if (summary.lunchDeductionMinutes > 0) acc.lunchDays += 1;
      return acc;
    },
    {
      byDay: {},
      totalMinutes: 0,
      totalGrossMinutes: 0,
      totalLunchDeductionMinutes: 0,
      totalBasicMinutes: 0,
      totalOvertimeMinutes: 0,
      totalTravelMinutes: 0,
      totalUnpaidMinutes: 0,
      totalYardMinutes: 0,
      filledDays: 0,
      lunchDays: 0,
    }
  );

  const submitTimesheetToFirebase = async () => {
    try {
      await addDoc(collection(db, 'timesheets'), {
        weekData,
        totalHours: Number((weeklySummary.totalMinutes / 60).toFixed(2)),
        totalMinutes: weeklySummary.totalMinutes,
        summary: {
          totalMinutes: weeklySummary.totalMinutes,
          totalGrossMinutes: weeklySummary.totalGrossMinutes,
          totalLunchDeductionMinutes: weeklySummary.totalLunchDeductionMinutes,
          totalBasicMinutes: weeklySummary.totalBasicMinutes,
          totalOvertimeMinutes: weeklySummary.totalOvertimeMinutes,
          totalTravelMinutes: weeklySummary.totalTravelMinutes,
          totalUnpaidMinutes: weeklySummary.totalUnpaidMinutes,
          totalYardMinutes: weeklySummary.totalYardMinutes,
          filledDays: weeklySummary.filledDays,
          lunchDays: weeklySummary.lunchDays,
        },
        submittedAt: new Date().toISOString(),
      });
      await Promise.all([
        invalidate('timesheets:'),
        invalidate('timesheet-overview:'),
        invalidate('me-dashboard:'),
      ]);
      setSubmittedMessage('✅ Timesheet submitted for approval!');
      setShowPreview(false);
      // Optionally reset form:
      // setWeekData(initial empty state)
    } catch (error) {
      console.error('Error submitting timesheet:', error);
      setSubmittedMessage('❌ Error submitting timesheet, please try again.');
      setShowPreview(false);
    }
  };
  
  

  return (
    <PageShell mode="form" width="form" customHeader={<View
          style={[
            styles.heroCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.heroContent}>
            <Text style={[styles.heroEyebrow, { color: colors.textMuted }]}>Payroll</Text>
            <Text style={[styles.heroTitle, { color: colors.text }]}>Weekly Timesheet</Text>
            <Text style={[styles.heroSubTitle, { color: colors.textMuted }]}>
              Fill each day and submit for manager approval.
            </Text>

            <View style={styles.heroMetaRow}>
              <View
                style={[
                  styles.heroMetaChip,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                    borderColor: withAlpha(colors.border, 0.75),
                  },
                ]}
              >
                <Icon name="calendar" size={12} color={colors.textMuted} />
                <Text style={[styles.heroMetaText, { color: colors.text }]}>
                  {weeklySummary.filledDays}/7 filled
                </Text>
              </View>
              <View
                style={[
                  styles.heroMetaChip,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                    borderColor: withAlpha(colors.border, 0.75),
                  },
                ]}
              >
                <Icon name="clock" size={12} color={colors.textMuted} />
                <Text style={[styles.heroMetaText, { color: colors.text }]}>
                  Total {formatHoursMins(weeklySummary.totalMinutes)}
                </Text>
              </View>
            </View>
          </View>
        </View>} customHeaderPlacement="fixed">
      <>
      {submittedMessage ? (
  <View
    style={[
      styles.submittedBanner,
      {
        backgroundColor: withAlpha(colors.success || staticColors.hex_22c55e_74qlvk, 0.16),
        borderColor: withAlpha(colors.success || staticColors.hex_22c55e_74qlvk, 0.42),
      },
    ]}
  >
    <Text style={[styles.submittedBannerText, { color: colors.text }]}>{submittedMessage}</Text>
  </View>
) : null}

        

        <View
          style={[
            styles.summaryCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.summaryHeaderRow}>
            <Text style={[styles.summaryTitle, { color: colors.text }]}>Summary</Text>
            <Text style={[styles.summaryTotal, { color: colors.accent }]}>
              {formatHoursMins(weeklySummary.totalMinutes)}
            </Text>
          </View>
          <Text style={[styles.summaryMetaText, { color: colors.textMuted }]}>
            Gross {formatHoursMins(weeklySummary.totalGrossMinutes)} minus lunch deductions{' '}
            {formatHoursMins(weeklySummary.totalLunchDeductionMinutes)}
          </Text>
          <Text style={[styles.summaryMetaText, { color: colors.textMuted }]}>
            Yard {formatHoursMins(weeklySummary.totalYardMinutes)} · Basic{' '}
            {formatHoursMins(weeklySummary.totalBasicMinutes)} · OT{' '}
            {formatHoursMins(weeklySummary.totalOvertimeMinutes)} · Travel{' '}
            {formatHoursMins(weeklySummary.totalTravelMinutes)}
          </Text>
          <View style={styles.summaryGrid}>
            {daysOfWeek.map((day) => {
              const daySummary = weeklySummary.byDay[day];
              return (
                <View
                  key={day}
                  style={[
                    styles.summaryDayRow,
                    { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.summaryDayLabel, { color: colors.text }]}>{day}</Text>
                    <Text style={[styles.summaryDaySubLabel, { color: colors.textMuted }]}>
                      {daySummary.start && daySummary.end
                        ? `${daySummary.start} - ${daySummary.end}`
                        : 'No hours entered'}
                    </Text>
                    {daySummary.lunchDeductionMinutes > 0 ? (
                      <Text style={[styles.summaryDaySubLabel, { color: colors.textMuted }]}>
                        Includes 30m lunch deduction
                      </Text>
                    ) : null}
                    {daySummary.breakdownLines.length > 0 ? (
                      <Text style={[styles.summaryDaySubLabel, { color: colors.textMuted }]}>
                        {daySummary.breakdownLines.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[styles.summaryDayHours, { color: colors.text }]}>
                    {formatHoursMins(daySummary.netMinutes)}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {daysOfWeek.map((day, dayIndex) => (
          <View
            key={day}
            style={[
              styles.dayCard,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.dayTitle, { color: colors.text }]}>{day}</Text>

            {/* Type */}
            <View style={[styles.fieldBlock, { zIndex: 5000 - dayIndex * 10 }]}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Type:</Text>
              <DropDownPicker
                open={openDropdowns[`${day}_type`] || false}
                value={weekData[day].type}
                items={[
                  { label: 'Yard', value: 'Yard' },
                  { label: 'On Set', value: 'On Set' },
                ]}
                setOpen={(open) =>
                  setOpenDropdowns((prev) => ({ ...prev, [`${day}_type`]: open }))
                }
                setValue={(callback) => handleTypeChange(day, callback())}
                placeholder="Select Type"
                style={[
                  styles.dropdown,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                dropDownContainerStyle={[
                  styles.dropdownContainer,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                textStyle={[styles.dropdownText, { color: colors.text }]}
                placeholderStyle={{ color: colors.textMuted }}
              />
            </View>

            {/* Time Pickers */}
            {weekData[day].type === 'Yard'
              ? ['startTime', 'endTime'].map((field, idx) => {
                  const startTime = weekData[day].times['startTime'];
                  const filteredTimes =
                    field === 'endTime' && startTime
                      ? getFilteredTimes(startTime)
                      : timeOptions;

                  return (
                    <View key={field} style={[styles.fieldBlock, { zIndex: 5000 - dayIndex * 10 - idx - 1 }]}>
                      <Text style={[styles.label, { color: colors.textMuted }]}>
                        {field === 'startTime' ? 'Start Time:' : 'End Time:'}
                      </Text>
                      <DropDownPicker
                        open={openDropdowns[`${day}_${field}`] || false}
                        value={weekData[day].times[field]}
                        items={filteredTimes}
                        setOpen={(open) =>
                          setOpenDropdowns((prev) => ({
                            ...prev,
                            [`${day}_${field}`]: open,
                          }))
                        }
                        setValue={(callback) => handleChange(day, field, callback())}
                        placeholder="Select Time"
                        style={[
                          styles.dropdown,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                        dropDownContainerStyle={[
                          styles.dropdownContainer,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ]}
                        textStyle={[styles.dropdownText, { color: colors.text }]}
                        placeholderStyle={{ color: colors.textMuted }}
                      />
                    </View>
                  );
                })
              : ['leaveTime', 'arriveOnSet', 'preCall', 'callTime', 'wrapTime', 'arriveBack'].map(
                  (field, idx, arr) => {
                    const previousField = arr[idx - 1];
                    const previousValue = previousField ? weekData[day].times[previousField] : null;
                    const allowFullDay = field === 'wrapTime' || field === 'arriveBack';
                    const filteredTimes = getFilteredTimes(previousValue, allowFullDay);
                    

                    const labelMap = {
                      leaveTime: 'Leave Time:',
                      arriveOnSet: 'Arrive On Set:',
                      preCall: 'Pre-Call:',
                      callTime: 'Call Time:',
                      wrapTime: 'Wrap Time:',
                      arriveBack: 'Arrive Back at Yard:',
                    };

                    return (
                      <View key={field} style={[styles.fieldBlock, { zIndex: 5000 - dayIndex * 10 - idx - 1 }]}>
                        <Text style={[styles.label, { color: colors.textMuted }]}>{labelMap[field]}</Text>
                        <DropDownPicker
                          open={openDropdowns[`${day}_${field}`] || false}
                          value={weekData[day].times[field]}
                          items={filteredTimes}
                          setOpen={(open) =>
                            setOpenDropdowns((prev) => ({
                              ...prev,
                              [`${day}_${field}`]: open,
                            }))
                          }
                          setValue={(callback) => handleChange(day, field, callback())}
                          placeholder="Select Time"
                          style={[
                            styles.dropdown,
                            { backgroundColor: colors.surface, borderColor: colors.border },
                          ]}
                          dropDownContainerStyle={[
                            styles.dropdownContainer,
                            { backgroundColor: colors.surface, borderColor: colors.border },
                          ]}
                          textStyle={[styles.dropdownText, { color: colors.text }]}
                          placeholderStyle={{ color: colors.textMuted }}
                        />
                      </View>
                    );
                  }
                )}

            {/* Toggles */}
            {weekData[day].type === 'On Set' && (
              <>
                

                <View style={styles.switchRow}>
                  <View style={styles.lunchToggleRow}>
                    <Text
                      style={[
                        styles.lunchChoiceText,
                        styles.lunchChoiceLeft,
                        {
                          color: weekData[day].lunch
                            ? colors.textMuted
                            : colors.text,
                        },
                        !weekData[day].lunch && styles.lunchChoiceActive,
                      ]}
                    >
                      No Lunch
                    </Text>
                    <Switch
                      value={weekData[day].lunch}
                      onValueChange={(value) => handleToggle(day, 'lunch', value)}
                      trackColor={{
                        false: withAlpha(colors.border, 0.9),
                        true: withAlpha(colors.accent, 0.52),
                      }}
                      thumbColor={weekData[day].lunch ? colors.accent : colors.surface}
                    />
                    <Text
                      style={[
                        styles.lunchChoiceText,
                        styles.lunchChoiceRight,
                        {
                          color: weekData[day].lunch
                            ? colors.text
                            : colors.textMuted,
                        },
                        weekData[day].lunch && styles.lunchChoiceActive,
                      ]}
                    >
                      Lunch Break
                    </Text>
                  </View>
                </View>
                <View style={styles.switchRow}>
                  <Text style={[styles.label, { color: colors.textMuted }]}>Overnight:</Text>
                  <Switch
                    value={weekData[day].overnight}
                    onValueChange={(value) => handleToggle(day, 'overnight', value)}
                    trackColor={{
                      false: withAlpha(colors.border, 0.9),
                      true: withAlpha(colors.accent, 0.52),
                    }}
                    thumbColor={weekData[day].overnight ? colors.accent : colors.surface}
                  />
                </View>
                {day === 'Saturday' && (
                  <View style={styles.switchRow}>
                    <Text style={[styles.label, { color: colors.textMuted }]}>Saturday Supervisor:</Text>
                    <Switch
                      value={weekData[day].saturdaySupervisor}
                      onValueChange={(value) => handleToggle(day, 'saturdaySupervisor', value)}
                      trackColor={{
                        false: withAlpha(colors.border, 0.9),
                        true: withAlpha(colors.accent, 0.52),
                      }}
                      thumbColor={weekData[day].saturdaySupervisor ? colors.accent : colors.surface}
                    />
                  </View>
                )}

                {day === 'Sunday' && (
                  <View style={styles.switchRow}>
                    <Text style={[styles.label, { color: colors.textMuted }]}>Sunday Supervisor:</Text>
                    <Switch
                      value={weekData[day].sundaySupervisor}
                      onValueChange={(value) => handleToggle(day, 'sundaySupervisor', value)}
                      trackColor={{
                        false: withAlpha(colors.border, 0.9),
                        true: withAlpha(colors.accent, 0.52),
                      }}
                      thumbColor={weekData[day].sundaySupervisor ? colors.accent : colors.surface}
                    />
                  </View>
                )}
              </>
            )}
            {/* Separation line */}
                <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Notes */}
            <View style={styles.fieldBlock}>
              <TextArea
                label="Notes:"
                value={weekData[day].notes}
                onChangeText={(text) => handleNotesChange(day, text)}
                placeholder="Enter notes..."
              />
            </View>
          </View>
        ))}

<TouchableOpacity
  style={[styles.confirmButton, { backgroundColor: colors.accent, borderColor: colors.accent }]}
  onPress={() => setShowPreview(true)}
>
  <Text style={[styles.confirmButtonText, { color: colors.surface }]}>Preview & Continue</Text>
</TouchableOpacity>

      {showPreview ? (
      <View
        style={[
          styles.previewContainer,
          { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
        ]}
      >
  <Text style={[styles.previewHeader, { color: colors.text }]}>Preview Timesheet</Text>
  <View
    style={[
      styles.previewSummaryCard,
      { backgroundColor: colors.surface, borderColor: colors.border },
    ]}
  >
    <Text style={[styles.previewSummaryTitle, { color: colors.text }]}>
      Total: {formatHoursMins(weeklySummary.totalMinutes)}
    </Text>
    <Text style={[styles.previewSummaryText, { color: colors.textMuted }]}>
      Gross {formatHoursMins(weeklySummary.totalGrossMinutes)} minus lunch deductions{' '}
      {formatHoursMins(weeklySummary.totalLunchDeductionMinutes)}
    </Text>
    <Text style={[styles.previewSummaryText, { color: colors.textMuted }]}>
      Yard {formatHoursMins(weeklySummary.totalYardMinutes)} · Basic{' '}
      {formatHoursMins(weeklySummary.totalBasicMinutes)} · OT{' '}
      {formatHoursMins(weeklySummary.totalOvertimeMinutes)} · Travel{' '}
      {formatHoursMins(weeklySummary.totalTravelMinutes)}
    </Text>
  </View>
  <View>
    {daysOfWeek.map((day) => (
      <View
        key={day}
        style={[
          styles.previewCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.previewDay, { color: colors.text }]}>{day}</Text>
        <Text style={[styles.previewText, { color: colors.textMuted }]}>
          Type: {weeklySummary.byDay[day].resolvedType}
        </Text>
        {Object.entries(weekData[day].times).map(([field, value]) => (
          <Text key={field} style={[styles.previewText, { color: colors.textMuted }]}>
            {labelForField(field)}: {value || '—'}
          </Text>
        ))}
        <Text style={[styles.previewText, { color: colors.textMuted }]}>
          Worked: {formatHoursMins(weeklySummary.byDay[day].netMinutes)}
        </Text>
        {weeklySummary.byDay[day].breakdownLines.length > 0 ? (
          <Text style={[styles.previewText, { color: colors.textMuted }]}>
            Breakdown: {weeklySummary.byDay[day].breakdownLines.join(' · ')}
          </Text>
        ) : null}
        {weeklySummary.byDay[day].lunchDeductionMinutes > 0 ? (
          <Text style={[styles.previewText, { color: colors.textMuted }]}>
            Lunch deduction: {formatHoursMins(weeklySummary.byDay[day].lunchDeductionMinutes)}
          </Text>
        ) : null}
        <Text style={[styles.previewText, { color: colors.textMuted }]}>Night Supervisor: {weekData[day].nightSupervisor ? 'Yes' : 'No'}</Text>
        <Text style={[styles.previewText, { color: colors.textMuted }]}>Lunch break: {weekData[day].lunch ? 'Taken' : 'Not taken'}</Text>
        <Text style={[styles.previewText, { color: colors.textMuted }]}>Overnight: {weekData[day].overnight ? 'Yes' : 'No'}</Text>
        {day === 'Saturday' && (
          <Text style={[styles.previewText, { color: colors.textMuted }]}>Saturday Supervisor: {weekData[day].saturdaySupervisor ? 'Yes' : 'No'}</Text>
        )}
        {day === 'Sunday' && (
          <Text style={[styles.previewText, { color: colors.textMuted }]}>Sunday Supervisor: {weekData[day].sundaySupervisor ? 'Yes' : 'No'}</Text>
        )}
        <Text style={[styles.previewText, { color: colors.textMuted }]}>Notes: {weekData[day].notes || '—'}</Text>
      </View>
    ))}
  </View>

  <TouchableOpacity
    style={[styles.confirmButton, { backgroundColor: colors.accent, borderColor: colors.accent }]}
    onPress={async () => {
        await submitTimesheetToFirebase();
        navigation.navigate('Timesheet'); // <- use your screen name here
    }}
      
  >
    <Text style={[styles.confirmButtonText, { color: colors.surface }]}>Confirm & Send</Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.backButton,
      { backgroundColor: colors.surface, borderColor: colors.border },
    ]}
    onPress={() => setShowPreview(false)}
  >
    <Text style={[styles.backButtonText, { color: colors.text }]}>Back to Edit</Text>
  </TouchableOpacity>
</View>
      ) : null}

      </>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: staticColors.hex_0b0b0b_9v81ck },
  content: { padding: t.spacing.sm, paddingBottom: t.spacing.xl, overflow: 'visible' },

  heroCard: {
    position: 'relative',
    borderRadius: t.radius.xl,
    borderWidth: 1,
    marginBottom: t.spacing.sm,
    overflow: 'hidden',
  },
  heroContent: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
  },
  heroEyebrow: {
    fontSize: t.typography.metadata.fontSize,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: '800',
  },
  heroTitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.pageTitle.fontSize,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  heroSubTitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: '600',
  },
  heroMetaRow: {
    marginTop: t.spacing.sm,
    flexDirection: 'row',
    gap: t.spacing.xs,
    flexWrap: 'wrap',
  },
  heroMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xxs,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  heroMetaText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: '700',
  },

  dayCard: {
    borderWidth: 1,
    padding: t.spacing.md,
    borderRadius: t.radius.lg,
    marginBottom: t.spacing.sm,
  },
  dayTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: '900',
    marginBottom: t.spacing.sm,
  },
  fieldBlock: {
    marginBottom: t.spacing.sm,
  },
  label: {
    fontSize: t.typography.body.fontSize,
    fontWeight: '700',
    marginBottom: t.spacing.xxs,
  },
  dropdown: {
    borderWidth: 1,
  },
  dropdownContainer: {
    borderWidth: 1,
  },
  dropdownText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: t.spacing.xs,
    paddingTop: t.spacing.xs,
    borderTopWidth: 1,
  },
  lunchToggleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing.xs,
  },
  lunchChoiceText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: '800',
  },
  lunchChoiceLeft: {
    flex: 1,
    textAlign: 'right',
  },
  lunchChoiceRight: {
    flex: 1,
    textAlign: 'left',
  },
  lunchChoiceActive: {
    fontWeight: '900',
  },
  notesInput: {
    borderRadius: t.radius.md,
    padding: t.spacing.xs,
    minHeight: 60,
    textAlignVertical: 'top',
    borderWidth: 1,
  },
  divider: {
    height: 1,
    marginVertical: t.spacing.sm,
  },
  previewContainer: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
    marginTop: t.spacing.sm,
  },
  previewHeader: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: '900',
    marginBottom: t.spacing.sm,
  },
  previewSummaryCard: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  previewSummaryTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: '900',
  },
  previewSummaryText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: '600',
  },
  previewCard: {
    borderWidth: 1,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.sm,
  },
  previewDay: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: '900',
    marginBottom: t.spacing.xxs,
  },
  previewText: {
    fontSize: t.typography.bodySmall.fontSize,
    marginBottom: t.spacing.none,
    fontWeight: '600',
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: t.radius.lg,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing.xs,
  },
  summaryTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: '900',
  },
  summaryTotal: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: '900',
  },
  summaryMetaText: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: '600',
  },
  summaryGrid: {
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  },
  summaryDayRow: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
  },
  summaryDayLabel: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: '800',
  },
  summaryDaySubLabel: {
    marginTop: t.spacing.none,
    fontSize: t.typography.caption.fontSize,
    fontWeight: '600',
  },
  summaryDayHours: {
    fontSize: t.typography.body.fontSize,
    fontWeight: '900',
  },
  confirmButton: {
    borderWidth: 1,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    marginTop: t.spacing.lg,
  },
  confirmButtonText: {
    fontWeight: '900',
    fontSize: t.typography.body.fontSize,
  },
  backButton: {
    borderWidth: 1,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.pill,
    alignItems: 'center',
    marginTop: t.spacing.xs,
  },
  backButtonText: {
    fontWeight: '800',
    fontSize: t.typography.body.fontSize,
  },
  
  submittedBanner: {
    borderWidth: 1,
    padding: t.spacing.xs,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.sm,
  },
  submittedBannerText: {
    textAlign: 'center',
    fontWeight: '800',
    fontSize: t.typography.bodySmall.fontSize,
  },
  
});
