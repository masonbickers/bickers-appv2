import { AppButton, AppModal, AppText as Text, AppPressable as TouchableOpacity, SelectField } from "../../components/ui/AppPrimitives";
// app/(protected)/timesheet-overview.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useRouter } from "expo-router";
import { doc,
  updateDoc } from "firebase/firestore";
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  Alert,
  StyleSheet,
  View,
} from "react-native";

import Icon from "react-native-vector-icons/Feather";

import { AsyncContentState, EmptyState } from "../../components/AsyncState";
import { db } from "../../firebaseConfig";
import {
  useEmployees,
  useEmployeeTimesheets,
  useTimesheetQueries,
} from "../../hooks/useOperationalData";
import { formatDateDDMMYYYY } from "../../lib/dateFormat";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { withAlpha } from "../../lib/design/color";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell"; // 👈 theme

/* helpers */
const DEFAULT_YARD_START = "08:00";
const DEFAULT_YARD_END = "16:30";
const DEFAULT_OFFICE_START = "09:00";
const DEFAULT_OFFICE_END = "17:00";
const TIME_OPTIONS = (() => {
  const out = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return out;
})();

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
  return minutesToHHMM(timeToMinutes(v));
}

function normaliseAutofillType(v) {
  const value = String(v || "").trim().toLowerCase();
  if (value === "office" || value === "workshop") return value;
  return "yard";
}

function getMonday(d) {
  d = new Date(d);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}
function formatWeekRange(monday) {
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${formatDateDDMMYYYY(monday)} - ${formatDateDDMMYYYY(sunday)}`;
}
function safeStr(v) {
  return String(v ?? "").trim().toLowerCase();
}
function isTimesheetApproved(ts) {
  if (!ts) return false;
  const status = safeStr(ts.status);
  return (
    status === "approved" ||
    ts.approved === true ||
    !!ts.approvedAt
  );
}

function timesheetWeekKey(timesheet) {
  return timesheet?.weekStart || timesheet?.weekISO || "";
}

export default function TimesheetOverview() {
  const router = useRouter();
  const { employee, isAuthed, loading, reloadSession } = useAuth();
  const { colors } = useTheme(); // 🎨
  const employeesResource = useEmployees();
  const timesheetsResource = useEmployeeTimesheets();
  const queriesResource = useTimesheetQueries();
  const timesheetRows = timesheetsResource.data;
  const timesheetQueries = queriesResource.data;
  const refreshTimesheets = timesheetsResource.refresh;
  const refreshTimesheetQueries = queriesResource.refresh;
  const employeeRows = employeesResource.data;
  const refreshEmployees = employeesResource.refresh;
  const upsertEmployee = employeesResource.upsertRow;
  const timesheets = useMemo(
    () => (isAuthed ? timesheetRows : []),
    [isAuthed, timesheetRows]
  );
  const queryWeeksMap = useMemo(() => {
    const weekMap = {};
    timesheetQueries.forEach((queryRow) => {
      const status = String(queryRow.status || "open").toLowerCase();
      if (!queryRow.weekStart || status === "closed" || status === "resolved") return;
      weekMap[queryRow.weekStart] = true;
    });
    return weekMap;
  }, [timesheetQueries]);
  const refreshing =
    timesheetsResource.isRefreshing ||
    queriesResource.isRefreshing ||
    employeesResource.isRefreshing;

  const [settingsDocId, setSettingsDocId] = useState("");
  const [autofillType, setAutofillType] = useState("yard");
  const [autofillStartTime, setAutofillStartTime] = useState(DEFAULT_YARD_START);
  const [autofillEndTime, setAutofillEndTime] = useState(DEFAULT_YARD_END);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const loadAutofillDefaults = useCallback(async () => {
    if (loading) return;
    if (!isAuthed || !employee?.userCode) {
      setSettingsDocId("");
      setAutofillType("yard");
      setAutofillStartTime(DEFAULT_YARD_START);
      setAutofillEndTime(DEFAULT_YARD_END);
      setSettingsBusy(false);
      return;
    }
    if (employeesResource.isInitialLoading && !employeeRows.length) {
      setSettingsBusy(true);
      return;
    }

    try {
      setSettingsBusy(false);
      const employeeId = String(employee?.employeeId || "").trim();
      const employeeCode = String(employee?.userCode || "").trim();
      const profile =
        employeeRows.find((row) => String(row.id || "").trim() === employeeId) ||
        employeeRows.find(
          (row) => String(row.userCode || "").trim() === employeeCode
        ) ||
        null;
      const profileId = String(profile?.id || employeeId || "").trim();

      const mode = normaliseAutofillType(
        profile?.timesheetDefaults?.defaultType ||
          profile?.timesheetDefaultType ||
          employee?.timesheetDefaults?.defaultType ||
          employee?.timesheetDefaultType ||
          "yard"
      );

      const start = normaliseTimeValue(
        mode === "workshop"
          ? profile?.timesheetDefaults?.workshopStart ||
              profile?.workshopStartTime ||
              employee?.workshopStartTime ||
              employee?.timesheetDefaults?.workshopStart ||
              DEFAULT_YARD_START
          : mode === "office"
          ? profile?.timesheetDefaults?.officeStart ||
              profile?.officeStartTime ||
              profile?.officeStart ||
              employee?.officeStartTime ||
              employee?.timesheetDefaults?.officeStart ||
              DEFAULT_OFFICE_START
          : profile?.timesheetDefaults?.yardStart ||
              profile?.yardStartTime ||
              profile?.yardStart ||
              employee?.yardStartTime ||
              employee?.timesheetDefaults?.yardStart ||
              DEFAULT_YARD_START
      );
      const end = normaliseTimeValue(
        mode === "workshop"
          ? profile?.timesheetDefaults?.workshopEnd ||
              profile?.workshopEndTime ||
              employee?.workshopEndTime ||
              employee?.timesheetDefaults?.workshopEnd ||
              DEFAULT_YARD_END
          : mode === "office"
          ? profile?.timesheetDefaults?.officeEnd ||
              profile?.officeEndTime ||
              profile?.officeEnd ||
              employee?.officeEndTime ||
              employee?.timesheetDefaults?.officeEnd ||
              DEFAULT_OFFICE_END
          : profile?.timesheetDefaults?.yardEnd ||
              profile?.yardEndTime ||
              profile?.yardEnd ||
              employee?.yardEndTime ||
              employee?.timesheetDefaults?.yardEnd ||
              DEFAULT_YARD_END
      );

      setSettingsDocId(profileId || "");
      setAutofillType(mode);
      setAutofillStartTime(start || (mode === "office" ? DEFAULT_OFFICE_START : DEFAULT_YARD_START));
      setAutofillEndTime(end || (mode === "office" ? DEFAULT_OFFICE_END : DEFAULT_YARD_END));
    } catch (err) {
      console.error("Error loading timesheet defaults:", err);
      const mode = normaliseAutofillType(
        employee?.timesheetDefaults?.defaultType || employee?.timesheetDefaultType || "yard"
      );
      setSettingsDocId(String(employee?.employeeId || "").trim());
      setAutofillType(mode);
      setAutofillStartTime(
        normaliseTimeValue(
          mode === "workshop"
            ? employee?.workshopStartTime || employee?.timesheetDefaults?.workshopStart
            : mode === "office"
            ? employee?.officeStartTime || employee?.timesheetDefaults?.officeStart
            : employee?.yardStartTime || employee?.timesheetDefaults?.yardStart
        ) || (mode === "office" ? DEFAULT_OFFICE_START : DEFAULT_YARD_START)
      );
      setAutofillEndTime(
        normaliseTimeValue(
          mode === "workshop"
            ? employee?.workshopEndTime || employee?.timesheetDefaults?.workshopEnd
            : mode === "office"
            ? employee?.officeEndTime || employee?.timesheetDefaults?.officeEnd
            : employee?.yardEndTime || employee?.timesheetDefaults?.yardEnd
        ) || (mode === "office" ? DEFAULT_OFFICE_END : DEFAULT_YARD_END)
      );
    } finally {
      setSettingsBusy(false);
    }
  }, [
    employee?.employeeId,
    employee?.officeEndTime,
    employee?.officeStartTime,
    employee?.timesheetDefaultType,
    employee?.timesheetDefaults?.defaultType,
    employee?.timesheetDefaults?.officeEnd,
    employee?.timesheetDefaults?.officeStart,
    employee?.timesheetDefaults?.workshopEnd,
    employee?.timesheetDefaults?.workshopStart,
    employee?.timesheetDefaults?.yardEnd,
    employee?.timesheetDefaults?.yardStart,
    employee?.userCode,
    employee?.workshopEndTime,
    employee?.workshopStartTime,
    employee?.yardEndTime,
    employee?.yardStartTime,
    employeeRows,
    employeesResource.isInitialLoading,
    isAuthed,
    loading,
  ]);

  const saveAutofillDefaults = useCallback(async () => {
    const mode = normaliseAutofillType(autofillType);
    const start = normaliseTimeValue(autofillStartTime);
    const end = normaliseTimeValue(autofillEndTime);

    if (!start || !end) {
      Alert.alert("Invalid time", "Please choose valid start and finish times.");
      return false;
    }

    if (!settingsDocId) {
      Alert.alert("Profile not found", "Could not find your employee profile to save defaults.");
      return false;
    }

    try {
      setSettingsSaving(true);

      const payload =
        mode === "office"
          ? {
              officeStartTime: start,
              officeEndTime: end,
              officeStart: start,
              officeEnd: end,
              timesheetDefaultType: "office",
              "timesheetDefaults.defaultType": "office",
              "timesheetDefaults.officeStart": start,
              "timesheetDefaults.officeEnd": end,
            }
          : mode === "workshop"
          ? {
              workshopStartTime: start,
              workshopEndTime: end,
              workshopStart: start,
              workshopEnd: end,
              timesheetDefaultType: "workshop",
              "timesheetDefaults.defaultType": "workshop",
              "timesheetDefaults.workshopStart": start,
              "timesheetDefaults.workshopEnd": end,
            }
          : {
              yardStartTime: start,
              yardEndTime: end,
              yardStart: start,
              yardEnd: end,
              timesheetDefaultType: "yard",
              "timesheetDefaults.defaultType": "yard",
              "timesheetDefaults.yardStart": start,
              "timesheetDefaults.yardEnd": end,
            };

      await updateDoc(doc(db, "employees", settingsDocId), payload);
      const cachedProfile =
        employeeRows.find((row) => String(row.id || "") === settingsDocId) || {};
      const startKey = `${mode}Start`;
      const endKey = `${mode}End`;
      await upsertEmployee({
        ...cachedProfile,
        id: settingsDocId,
        [`${mode}StartTime`]: start,
        [`${mode}EndTime`]: end,
        [startKey]: start,
        [endKey]: end,
        timesheetDefaultType: mode,
        timesheetDefaults: {
          ...(cachedProfile.timesheetDefaults || {}),
          defaultType: mode,
          [startKey]: start,
          [endKey]: end,
        },
      });

      const sessionPairs = [
        ["timesheetDefaultType", mode],
      ];
      if (mode === "office") {
        sessionPairs.push(["timesheetOfficeStart", start], ["timesheetOfficeEnd", end]);
      } else if (mode === "workshop") {
        sessionPairs.push(["timesheetWorkshopStart", start], ["timesheetWorkshopEnd", end]);
      } else {
        sessionPairs.push(["timesheetYardStart", start], ["timesheetYardEnd", end]);
      }
      await AsyncStorage.multiSet(sessionPairs);

      if (reloadSession) await reloadSession();

      setAutofillType(mode);
      setAutofillStartTime(start);
      setAutofillEndTime(end);
      Alert.alert("Saved", `Your default ${mode} autofill times have been updated.`);
      return true;
    } catch (err) {
      console.error("Error saving timesheet defaults:", err);
      Alert.alert("Error", "Could not save your autofill times.");
      return false;
    } finally {
      setSettingsSaving(false);
    }
  }, [
    autofillEndTime,
    autofillStartTime,
    autofillType,
    employeeRows,
    reloadSession,
    settingsDocId,
    upsertEmployee,
  ]);

  useEffect(() => {
    loadAutofillDefaults();
  }, [loadAutofillDefaults]);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      refreshTimesheets(),
      refreshTimesheetQueries(),
      refreshEmployees(),
    ]);
  }, [refreshEmployees, refreshTimesheetQueries, refreshTimesheets]);

  // Past 4 weeks (including current)
  const weekOptions = useMemo(() => {
    return [...Array(4)].map((_, i) => {
      const monday = getMonday(new Date());
      monday.setDate(monday.getDate() - 7 * i);
      return {
        key: monday.toISOString().split("T")[0],
        label: formatWeekRange(monday),
      };
    });
  }, []);

  // sort newest → oldest
  const sortedTimesheets = useMemo(
    () =>
      timesheets
        .slice()
        .sort((a, b) => new Date(timesheetWeekKey(b)) - new Date(timesheetWeekKey(a))),
    [timesheets]
  );

  // only real submissions for the bottom list
  const submittedSheets = useMemo(
    () => sortedTimesheets.filter((t) => t.submitted === true),
    [sortedTimesheets]
  );

  const thisMonthStatuses = useMemo(() => {
    return weekOptions.map((w) => {
      const existing = timesheets.find((t) => timesheetWeekKey(t) === w.key);
      if (!existing) return "none";
      if (isTimesheetApproved(existing)) return "approved";
      if (existing.submitted === true) return "submitted";
      return "draft";
    });
  }, [timesheets, weekOptions]);

  const thisMonthCompleteCount = thisMonthStatuses.filter(
    (s) => s === "approved" || s === "submitted"
  ).length;

  const WeekStatusPill = ({ status }) => {
    // status: "approved" | "submitted" | "draft" | "none"
    let bgStyle, textColor, iconName, label;

    if (status === "approved") {
      bgStyle = styles.pillApproved;
      textColor = staticColors.hex_022c22_8bgm6t;
      iconName = "check-circle";
      label = "Approved";
    } else if (status === "submitted") {
      bgStyle = styles.pillSubmitted;
      textColor = staticColors.hex_052e16_89ayk3;
      iconName = "check-circle";
      label = "Submitted";
    } else if (status === "draft") {
      bgStyle = styles.pillDraft;
      textColor = staticColors.hex_1e293b_95wh3c;
      iconName = "edit-3";
      label = "Draft saved";
    } else {
      bgStyle = styles.pillNotFilled;
      textColor = staticColors.hex_7c2d12_7wqog7;
      iconName = "alert-circle";
      label = "Not filled";
    }

    return (
      <View style={[styles.pill, bgStyle]}>
        <Icon
          name={iconName}
          size={14}
          color={textColor}
          style={{ marginRight: t.spacing.xxs }}
        />
        <Text style={[styles.pillText, { color: textColor }]}>{label}</Text>
      </View>
    );
  };

  const renderWeekCard = (weekKey, label, status, hasQuery = false) => (
    <TouchableOpacity
      key={weekKey}
      activeOpacity={0.85}
      style={[
        styles.weekCard,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        status === "submitted" && styles.submittedCard,
        status === "approved" && styles.approvedCard,
      ]}
      onPress={() => router.push(`/week/${weekKey}`)}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${status === "approved" ? "approved" : status === "submitted" ? "submitted" : "not filled"}${hasQuery ? ", manager query pending" : ""}`}
      accessibilityHint="Opens this week’s timesheet"
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.weekLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.weekSubLabel, { color: colors.textMuted }]}>
          Monday → Sunday
        </Text>

        {hasQuery && (
          <View style={styles.queryRow}>
            <Icon name="alert-circle" size={13} color={staticColors.hex_f97316_oh807u} />
            <Text style={styles.queryRowText}>Manager query pending</Text>
          </View>
        )}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <WeekStatusPill status={status} />
        <Icon
          name="chevron-right"
          size={20}
          color={colors.textMuted}
          style={{ marginTop: t.spacing.xxs }}
        />
      </View>
    </TouchableOpacity>
  );

  // follow me.js: render nothing while auth resolving or unauthenticated
  if (loading || !isAuthed) return null;

  return (
    <PageShell
      header={{
        variant: "compact",
        eyebrow: "Payroll",
        title: "Timesheets",
        onBack: router.back,
        metadata: <View style={styles.heroMetaRow}>
            <View
              style={[
                styles.heroMetaChip,
                {
                  backgroundColor: withAlpha(colors.surfaceAlt, 0.8),
                  borderColor: withAlpha(colors.border, 0.8),
                },
              ]}
            >
              <Icon name="calendar" size={12} color={colors.textMuted} />
              <Text style={[styles.heroMetaText, { color: colors.text }]}>
                This month: {thisMonthCompleteCount}/{weekOptions.length}
              </Text>
            </View>

            <View
              style={[
                styles.heroMetaChip,
                {
                  backgroundColor: withAlpha(colors.surfaceAlt, 0.8),
                  borderColor: withAlpha(colors.border, 0.8),
                },
              ]}
            >
              <Icon name="archive" size={12} color={colors.textMuted} />
              <Text style={[styles.heroMetaText, { color: colors.text }]}>
                Submitted: {submittedSheets.length}
              </Text>
            </View>
          </View>,
      }}
      refresh={{ refreshing, onRefresh }}
    >
      

      <View
        style={[
          styles.defaultsCard,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={styles.defaultsHeaderCompact}>
          <View style={styles.defaultsHeader}>
            <Icon name="sliders" size={14} color={colors.textMuted} />
            <Text style={[styles.defaultsTitle, { color: colors.text }]}>
              Timesheet Autofill
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.defaultsEditButton,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
                opacity: settingsBusy ? 0.6 : 1,
              },
            ]}
            onPress={() => setSettingsOpen(true)}
            disabled={settingsBusy}
            accessibilityRole="button"
            accessibilityLabel="Edit timesheet autofill settings"
            accessibilityState={{ disabled: settingsBusy }}
          >
            <Icon name="edit-3" size={13} color={colors.text} />
            <Text style={[styles.defaultsEditText, { color: colors.text }]}>
              Edit
            </Text>
          </TouchableOpacity>
        </View>

        {settingsBusy ? (
          <View style={{ marginTop: t.spacing.xs }}>
            <ShimmerLine />
          </View>
        ) : (
          <>
            <Text style={[styles.defaultsSummary, { color: colors.text }]}>
              {autofillType === "office" ? "Office" : autofillType === "workshop" ? "Workshop" : "Yard"} • {autofillStartTime}-{autofillEndTime}
            </Text>
            <Text style={[styles.defaultsHelp, { color: colors.textMuted }]}>
              Tap Edit to change your default type and times.
            </Text>
          </>
        )}
      </View>

      <AppModal
        visible={settingsOpen}
        title="Autofill Settings"
        onRequestClose={() => setSettingsOpen(false)}
        busy={settingsSaving}
        actions={
          <>
            <AppButton label="Cancel" variant="secondary" onPress={() => setSettingsOpen(false)} disabled={settingsSaving} />
            <AppButton
              label={settingsSaving ? "Saving..." : "Save"}
              loading={settingsSaving}
              onPress={async () => {
                const ok = await saveAutofillDefaults();
                if (ok) setSettingsOpen(false);
              }}
            />
          </>
        }
      >
            <Text style={[styles.defaultsHelp, { color: colors.textMuted }]}> 
              Choose one default type and set its times.
            </Text>

            <View style={styles.typeRow}>
              {["yard", "office", "workshop"].map((type) => {
                const active = autofillType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.typeButton,
                      {
                        borderColor: active ? colors.accent : colors.border,
                        backgroundColor: active ? colors.accentSoft : colors.surfaceAlt,
                        opacity: settingsSaving ? 0.6 : 1,
                      },
                    ]}
                    onPress={() => {
                      if (settingsSaving) return;
                      setAutofillType(type);
                      if (type === "office") {
                        setAutofillStartTime(
                          normaliseTimeValue(
                            employee?.officeStartTime || employee?.timesheetDefaults?.officeStart
                          ) || DEFAULT_OFFICE_START
                        );
                        setAutofillEndTime(
                          normaliseTimeValue(
                            employee?.officeEndTime || employee?.timesheetDefaults?.officeEnd
                          ) || DEFAULT_OFFICE_END
                        );
                      } else if (type === "workshop") {
                        setAutofillStartTime(
                          normaliseTimeValue(
                            employee?.workshopStartTime || employee?.timesheetDefaults?.workshopStart
                          ) || DEFAULT_YARD_START
                        );
                        setAutofillEndTime(
                          normaliseTimeValue(
                            employee?.workshopEndTime || employee?.timesheetDefaults?.workshopEnd
                          ) || DEFAULT_YARD_END
                        );
                      } else {
                        setAutofillStartTime(
                          normaliseTimeValue(
                            employee?.yardStartTime || employee?.timesheetDefaults?.yardStart
                          ) || DEFAULT_YARD_START
                        );
                        setAutofillEndTime(
                          normaliseTimeValue(
                            employee?.yardEndTime || employee?.timesheetDefaults?.yardEnd
                          ) || DEFAULT_YARD_END
                        );
                      }
                    }}
                    disabled={settingsSaving}
                    accessibilityRole="radio"
                    accessibilityLabel={`${type === "office" ? "Office" : type === "workshop" ? "Workshop" : "Yard"} autofill type`}
                    accessibilityState={{ checked: active, disabled: settingsSaving }}
                  >
                    <Text style={[styles.typeButtonText, { color: colors.text }]}>
                      {type === "office" ? "Office" : type === "workshop" ? "Workshop" : "Yard"}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.defaultsRow}>
              <TimePickerField
                label="Start"
                value={autofillStartTime}
                onSelect={setAutofillStartTime}
                options={TIME_OPTIONS}
                disabled={settingsSaving}
              />
              <View style={{ width: 8 }} />
              <TimePickerField
                label="Finish"
                value={autofillEndTime}
                onSelect={setAutofillEndTime}
                options={TIME_OPTIONS}
                disabled={settingsSaving}
              />
            </View>

      </AppModal>

      <>
        <AsyncContentState
          resources={[timesheetsResource, queriesResource, employeesResource]}
          hasContent={timesheets.length > 0}
          onRetry={onRefresh}
          loadingLabel="Loading timesheets…"
        >
        {/* Legend row */}
        <View style={styles.legendRow}>
          <LegendSwatch
            color={staticColors.hex_22c55e_74qlvk}
            border={staticColors.hex_16a34a_a655dy}
            label="Approved"
            textColor={colors.text}
          />
          <LegendSwatch
            color={staticColors.hex_bbf7d0_ry6j9f}
            border={staticColors.hex_86efac_dg95e1}
            label="Submitted"
            textColor={colors.text}
          />
          <LegendSwatch
            color={staticColors.hex_fee2b3_pb1qcj}
            border={staticColors.hex_fed7aa_pb14l2}
            label="Draft saved"
            textColor={colors.text}
          />
          <LegendSwatch
            color={staticColors.hex_fed7aa_pb14l2}
            border={staticColors.hex_fdba74_pbro4k}
            label="Not filled"
            textColor={colors.text}
          />
        </View>

        {/* This month (interactive list of 4 weeks) */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>
            This Month
          </Text>
        </View>
        <View
          style={{
            borderRadius: t.radius.lg,
            overflow: "hidden",
            borderColor: colors.border,
            borderWidth: 1,
            marginBottom: t.spacing.sm,
            backgroundColor: colors.surface,
          }}
        >
          {weekOptions.map((w, idx) => {
              const existing = timesheets.find((t) => timesheetWeekKey(t) === w.key);

              let status = "none"; // default: no timesheet
              if (existing) {
                const approved = isTimesheetApproved(existing);
                if (approved) {
                  status = "approved";
                } else if (existing.submitted === true) {
                  status = "submitted";
                } else {
                  status = "draft";
                }
              }

              // ❗ hide query badge if approved
              const hasQuery = !!queryWeeksMap[w.key] && status !== "approved";

              return (
                <View
                  key={w.key}
                  style={{
                    borderBottomWidth:
                      idx === weekOptions.length - 1
                        ? 0
                        : StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  }}
                >
                  {renderWeekCard(w.key, w.label, status, hasQuery)}
                </View>
              );
            })}
        </View>

        {/* Past submissions list */}
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionHeader, { color: colors.text }]}>
            Past Submissions
          </Text>
          <TouchableOpacity
            onPress={onRefresh}
            activeOpacity={0.8}
            style={[
              styles.refreshBtn,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Refresh timesheets"
            accessibilityState={{ busy: refreshing }}
          >
            <Icon name="refresh-ccw" size={14} color={colors.text} />
            <Text
              style={[
                styles.refreshText,
                { color: colors.text, fontWeight: "700" },
              ]}
            >
              Refresh
            </Text>
          </TouchableOpacity>
        </View>

        {submittedSheets.length === 0 ? (
          <EmptyState
            icon="clock"
            title="No submitted timesheets"
            message="Submitted weeks will appear here."
            compact
          />
        ) : (
          <View style={styles.pastList}>
            {submittedSheets.map((item, idx) => {
              const approved = isTimesheetApproved(item);
              const status = approved ? "approved" : "submitted";
              const weekKey = timesheetWeekKey(item);
              const hasQuery = !!queryWeeksMap[weekKey] && !approved;
              const isLast = idx === submittedSheets.length - 1;

              return (
                <View key={item.id} style={!isLast ? { marginBottom: t.spacing.xs } : null}>
                  {renderWeekCard(
                    weekKey,
                    formatWeekRange(new Date(weekKey)),
                    status,
                    hasQuery
                  )}
                </View>
              );
            })}
          </View>
        )}
        </AsyncContentState>
      </>
    </PageShell>
  );
}

/* tiny components */
function TimePickerField({ label, value, onSelect, options, disabled }) {
  return (
    <View style={{ flex: 1 }}>
      <SelectField
        label={label}
        value={value}
        onChange={onSelect}
        options={options.map((time) => ({ label: time, value: time }))}
        placeholder="Select"
        disabled={disabled}
      />
    </View>
  );
}

function LegendSwatch({ color, border, label, textColor }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendDot,
          { backgroundColor: color, borderColor: border },
        ]}
      />
      <Text style={[styles.legendText, { color: textColor }]}>{label}</Text>
    </View>
  );
}
function ShimmerLine({ width = "100%" }) {
  return <View style={[styles.shimmer, { width }]} />;
}

/* styles */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: staticColors.hex_0b0b0b_9v81ck, padding: t.spacing.sm },
  pageContent: { paddingBottom: t.spacing.none },
  pastList: { paddingBottom: t.spacing.xxs },

  heroCard: {
    position: "relative",
    marginBottom: t.spacing.xs,
  },
  heroContent: {
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.sm,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.xs,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitleWrap: {
    flex: 1,
    paddingTop: t.spacing.none,
    alignItems: "center",
  },
  heroSpacer: {
    width: 34,
    height: 34,
  },
  heroEyebrow: {
    fontSize: t.typography.metadata.fontSize,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "800",
    textAlign: "center",
  },
  heroTitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.pageTitle.fontSize,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  heroSubTitle: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    lineHeight: t.typography.bodySmall.lineHeight,
    fontWeight: "600",
    textAlign: "center",
  },
  heroMetaRow: {
    marginTop: t.spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    justifyContent: "center",
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  heroMetaText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  defaultsCard: {
    borderRadius: t.radius.lg,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    marginBottom: t.spacing.none,
  },
  defaultsHeaderCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.none,
  },
  defaultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  defaultsTitle: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  defaultsEditButton: {
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  defaultsEditText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
  },
  defaultsSummary: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
    marginTop: t.spacing.none,
  },
  defaultsHelp: {
    fontSize: t.typography.caption.fontSize,
    lineHeight: t.typography.caption.lineHeight,
    marginTop: t.spacing.none,
    marginBottom: t.spacing.none,
  },
  defaultsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: t.spacing.xs,
  },
  defaultsFieldLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
    marginBottom: t.spacing.xxs,
  },
  defaultsField: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    minHeight: 40,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  typeRow: {
    flexDirection: "row",
    marginBottom: t.spacing.xs,
    justifyContent: "center",
    gap: t.spacing.xs,
  },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.xs,
    alignItems: "center",
  },
  typeButtonText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: staticColors.rgba_11xlylh,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.md,
  },
  modalCard: {
    width: "100%",
    borderRadius: t.radius.lg,
    borderWidth: 1,
    padding: t.spacing.sm,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: t.spacing.xxs,
  },
  modalTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "900",
  },
  modalCloseIcon: {
    borderWidth: 1,
    width: 30,
    height: 30,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: t.spacing.xs,
  },
  modalButton: {
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
  },
  modalButtonText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "800",
  },

  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginBottom: t.spacing.sm,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: t.spacing.xxs },
  legendDot: { width: 12, height: 12, borderRadius: t.radius.pill, borderWidth: 1 },
  legendText: { color: staticColors.hex_cfcfcf_r9h9nn, fontSize: t.typography.caption.fontSize },

  sectionHeaderRow: {
    marginTop: t.spacing.none,
    marginBottom: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeader: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    color: staticColors.hex_ffffff_pfr1l2,
    marginBottom: t.spacing.none,
  },

  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    backgroundColor: staticColors.hex_1f2937_96ncbi,
    borderColor: staticColors.hex_374151_8ve4w3,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
  },
  refreshText: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.metadata.fontSize },

  weekCard: {
    backgroundColor: staticColors.hex_111111_a7aqp2,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  submittedCard: { borderLeftWidth: 3, borderLeftColor: staticColors.hex_22c55e_74qlvk },
  approvedCard: { borderLeftWidth: 3, borderLeftColor: staticColors.hex_16a34a_a655dy },

  weekLabel: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.bodyLarge.fontSize, fontWeight: "700" },
  weekSubLabel: { color: staticColors.hex_9ca3af_effbxl, fontSize: t.typography.metadata.fontSize, marginTop: t.spacing.none },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
  },
  pillApproved: { backgroundColor: staticColors.hex_22c55e_74qlvk, borderColor: staticColors.hex_16a34a_a655dy },
  pillSubmitted: { backgroundColor: staticColors.hex_bbf7d0_ry6j9f, borderColor: staticColors.hex_86efac_dg95e1 },
  pillDraft: { backgroundColor: staticColors.hex_fee2b3_pb1qcj, borderColor: staticColors.hex_fed7aa_pb14l2 },
  pillNotFilled: { backgroundColor: staticColors.hex_fed7aa_pb14l2, borderColor: staticColors.hex_fdba74_pbro4k },
  pillText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },

  queryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: t.spacing.xxs,
    gap: t.spacing.xxs,
  },
  queryRowText: {
    fontSize: t.typography.caption.fontSize,
    color: staticColors.hex_f97316_oh807u,
    fontWeight: "600",
  },

  emptyText: { color: staticColors.hex_9ca3af_effbxl, fontStyle: "italic", marginTop: t.spacing.xxs },

  pickerModalOverlay: {
    flex: 1,
    backgroundColor: staticColors.rgba_11xlylh,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.lg,
  },
  pickerModalCard: {
    width: "100%",
    maxHeight: "62%",
    borderRadius: t.radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  pickerModalItem: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.sm,
    borderBottomWidth: 1,
  },
  pickerModalClose: {
    margin: t.spacing.xs,
    borderRadius: t.radius.sm,
    paddingVertical: t.spacing.xs,
    alignItems: "center",
  },

  shimmer: {
    height: 12,
    borderRadius: t.radius.sm,
    backgroundColor: staticColors.hex_1f1f1f_96hprl,
    marginBottom: t.spacing.xs,
  },
});
