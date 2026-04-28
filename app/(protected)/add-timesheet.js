import { useNavigation } from '@react-navigation/native';
import { addDoc, collection } from 'firebase/firestore';
import { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';
import Icon from 'react-native-vector-icons/Feather';
import { db } from '../../firebaseConfig';
import { useTheme } from '../providers/ThemeProvider';

const LUNCH_DEDUCTION_MINUTES = 30;

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const timeOptions = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    const hour = String(h).padStart(2, '0');
    const min = String(m).padStart(2, '0');
    timeOptions.push({ label: `${hour}:${min}`, value: `${hour}:${min}` });
  }
}

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
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

  let start = null;
  let end = null;

  if (type === 'Yard') {
    start = times.startTime || null;
    end = times.endTime || null;
  } else {
    start = times.preCall || times.callTime || times.leaveTime || times.arriveOnSet || null;
    end = times.wrapTime || times.arriveBack || null;

    if (!start || !end) {
      start = times.callTime || times.leaveTime || times.arriveOnSet || times.preCall || null;
      end = times.arriveBack || times.wrapTime || null;
    }
  }

  const grossMinutes = durationMinutes(start, end);
  const lunchDeductionMinutes =
    type === 'On Set' && safeEntry.lunch && grossMinutes > 0
      ? LUNCH_DEDUCTION_MINUTES
      : 0;

  return {
    start,
    end,
    grossMinutes,
    lunchDeductionMinutes,
    netMinutes: Math.max(0, grossMinutes - lunchDeductionMinutes),
    hasHours: grossMinutes > 0,
  };
}

export default function TimesheetPage() {
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
      if (summary.hasHours) acc.filledDays += 1;
      if (summary.lunchDeductionMinutes > 0) acc.lunchDays += 1;
      return acc;
    },
    {
      byDay: {},
      totalMinutes: 0,
      totalGrossMinutes: 0,
      totalLunchDeductionMinutes: 0,
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
          filledDays: weeklySummary.filledDays,
          lunchDays: weeklySummary.lunchDays,
        },
        submittedAt: new Date().toISOString(),
      });
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
      {submittedMessage ? (
  <View
    style={[
      styles.submittedBanner,
      {
        backgroundColor: withAlpha(colors.success || '#22c55e', 0.16),
        borderColor: withAlpha(colors.success || '#22c55e', 0.42),
      },
    ]}
  >
    <Text style={[styles.submittedBannerText, { color: colors.text }]}>{submittedMessage}</Text>
  </View>
) : null}


        <View
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
        </View>

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
                  <Text style={[styles.label, { color: colors.textMuted }]}>Lunch:</Text>
                  <Switch
                    value={!weekData[day].lunch}
                    onValueChange={(value) => handleToggle(day, 'lunch', !value)}
                    trackColor={{
                      false: withAlpha(colors.border, 0.9),
                      true: withAlpha(colors.accent, 0.52),
                    }}
                    thumbColor={!weekData[day].lunch ? colors.accent : colors.surface}
                  />
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
              <Text style={[styles.label, { color: colors.textMuted }]}>Notes:</Text>
              <TextInput
                style={[
                  styles.notesInput,
                  { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border },
                ]}
                value={weekData[day].notes}
                onChangeText={(text) => handleNotesChange(day, text)}
                placeholder="Enter notes..."
                placeholderTextColor={colors.textMuted}
                multiline
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
  </View>
  <ScrollView>
    {daysOfWeek.map((day) => (
      <View
        key={day}
        style={[
          styles.previewCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.previewDay, { color: colors.text }]}>{day}</Text>
        <Text style={[styles.previewText, { color: colors.textMuted }]}>Type: {weekData[day].type}</Text>
        {Object.entries(weekData[day].times).map(([field, value]) => (
          <Text key={field} style={[styles.previewText, { color: colors.textMuted }]}>
            {labelForField(field)}: {value || '—'}
          </Text>
        ))}
        <Text style={[styles.previewText, { color: colors.textMuted }]}>
          Worked: {formatHoursMins(weeklySummary.byDay[day].netMinutes)}
        </Text>
        {weeklySummary.byDay[day].lunchDeductionMinutes > 0 ? (
          <Text style={[styles.previewText, { color: colors.textMuted }]}>
            Lunch deduction: {formatHoursMins(weeklySummary.byDay[day].lunchDeductionMinutes)}
          </Text>
        ) : null}
        <Text style={[styles.previewText, { color: colors.textMuted }]}>Night Supervisor: {weekData[day].nightSupervisor ? 'Yes' : 'No'}</Text>
        <Text style={[styles.previewText, { color: colors.textMuted }]}>Lunch: {!weekData[day].lunch ? 'Yes' : 'No'}</Text>
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
  </ScrollView>

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

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0b' },
  content: { padding: 12, paddingBottom: 24, overflow: 'visible' },

  heroCard: {
    position: 'relative',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 14,
    overflow: 'hidden',
  },
  heroContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  heroEyebrow: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontWeight: '800',
  },
  heroTitle: {
    marginTop: 3,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  heroSubTitle: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  heroMetaRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  heroMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroMetaText: {
    fontSize: 11,
    fontWeight: '700',
  },

  dayCard: {
    borderWidth: 1,
    padding: 16,
    borderRadius: 14,
    marginBottom: 14,
  },
  dayTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
  },
  fieldBlock: {
    marginBottom: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  dropdown: {
    borderWidth: 1,
  },
  dropdownContainer: {
    borderWidth: 1,
  },
  dropdownText: {
    fontSize: 14,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  notesInput: {
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    textAlignVertical: 'top',
    borderWidth: 1,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  previewContainer: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  previewHeader: {
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 12,
  },
  previewSummaryCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  previewSummaryTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  previewSummaryText: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
  },
  previewCard: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  previewDay: {
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 6,
  },
  previewText: {
    fontSize: 13,
    marginBottom: 2,
    fontWeight: '600',
  },
  summaryCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  summaryTotal: {
    fontSize: 18,
    fontWeight: '900',
  },
  summaryMetaText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryGrid: {
    gap: 8,
    marginTop: 10,
  },
  summaryDayRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryDayLabel: {
    fontSize: 13,
    fontWeight: '800',
  },
  summaryDaySubLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  summaryDayHours: {
    fontSize: 14,
    fontWeight: '900',
  },
  confirmButton: {
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    marginTop: 20,
  },
  confirmButtonText: {
    fontWeight: '900',
    fontSize: 14,
  },
  backButton: {
    borderWidth: 1,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    marginTop: 10,
  },
  backButtonText: {
    fontWeight: '800',
    fontSize: 14,
  },
  
  submittedBanner: {
    borderWidth: 1,
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
  },
  submittedBannerText: {
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 13,
  },
  
});
