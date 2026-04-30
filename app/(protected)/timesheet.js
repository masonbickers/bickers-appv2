// app/(protected)/timesheet-overview.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { collection, doc, getDoc, getDocs, limit, query, updateDoc, where } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import { db } from "../../firebaseConfig";
import { formatDateDDMMYYYY } from "../../lib/dateFormat";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider"; // 👈 theme

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
  return String(v || "").trim().toLowerCase() === "office" ? "office" : "yard";
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

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export default function TimesheetOverview() {
  const router = useRouter();
  const { employee, isAuthed, loading, reloadSession } = useAuth();
  const { colors } = useTheme(); // 🎨

  const [timesheets, setTimesheets] = useState([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // weekStart (YYYY-MM-DD) -> true if there is an open manager query
  const [queryWeeksMap, setQueryWeeksMap] = useState({});
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

    try {
      setSettingsBusy(true);
      let profileId = String(employee?.employeeId || "").trim();
      let profile = null;

      if (profileId) {
        const directRef = doc(db, "employees", profileId);
        const directSnap = await getDoc(directRef);
        if (directSnap.exists()) {
          profile = directSnap.data();
        } else {
          profileId = "";
        }
      }

      if (!profileId) {
        const byCode = String(employee?.userCode || "").trim();
        if (byCode) {
          let snap = await getDocs(query(collection(db, "employees"), where("userCode", "==", byCode), limit(1)));
          if (snap.empty) {
            const asNumber = Number(byCode);
            if (!Number.isNaN(asNumber)) {
              snap = await getDocs(query(collection(db, "employees"), where("userCode", "==", asNumber), limit(1)));
            }
          }

          if (!snap.empty) {
            profileId = snap.docs[0].id;
            profile = snap.docs[0].data();
          }
        }
      }

      const mode = normaliseAutofillType(
        profile?.timesheetDefaults?.defaultType ||
          profile?.timesheetDefaultType ||
          employee?.timesheetDefaults?.defaultType ||
          employee?.timesheetDefaultType ||
          "yard"
      );

      const start = normaliseTimeValue(
        mode === "office"
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
        mode === "office"
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
          mode === "office"
            ? employee?.officeStartTime || employee?.timesheetDefaults?.officeStart
            : employee?.yardStartTime || employee?.timesheetDefaults?.yardStart
        ) || (mode === "office" ? DEFAULT_OFFICE_START : DEFAULT_YARD_START)
      );
      setAutofillEndTime(
        normaliseTimeValue(
          mode === "office"
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
    employee?.timesheetDefaults?.yardEnd,
    employee?.timesheetDefaults?.yardStart,
    employee?.userCode,
    employee?.yardEndTime,
    employee?.yardStartTime,
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

      const sessionPairs = [
        ["timesheetDefaultType", mode],
      ];
      if (mode === "office") {
        sessionPairs.push(["timesheetOfficeStart", start], ["timesheetOfficeEnd", end]);
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
  }, [autofillEndTime, autofillStartTime, autofillType, reloadSession, settingsDocId]);

  const loadTimesheets = useCallback(async () => {
    const userCode = employee?.userCode || "";
    if (loading) return;
    if (!isAuthed || !userCode) {
      setTimesheets([]);
      setBusy(false);
      setQueryWeeksMap({});
      return;
    }
    try {
      setBusy(true);

      // 1) Load timesheets for this employee
      const qTs = query(
        collection(db, "timesheets"),
        where("employeeCode", "==", userCode)
      );
      const snapTs = await getDocs(qTs);
      const mySheets = snapTs.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTimesheets(mySheets);

      // 2) Load manager queries for this employee to flag weeks
      const qQueries = query(
        collection(db, "timesheetQueries"),
        where("employeeCode", "==", userCode)
      );
      const snapQueries = await getDocs(qQueries);

      const weekMap = {};
      snapQueries.docs.forEach((docu) => {
        const data = docu.data();
        const status = String(data.status || "open").toLowerCase();
        const weekStart = data.weekStart;

        // Only flag "open-ish" queries
        if (!weekStart) return;
        if (status === "closed" || status === "resolved") return;

        weekMap[weekStart] = true;
      });

      setQueryWeeksMap(weekMap);
    } finally {
      setBusy(false);
    }
  }, [employee?.userCode, isAuthed, loading]);

  useEffect(() => {
    loadTimesheets();
  }, [loadTimesheets]);

  useEffect(() => {
    loadAutofillDefaults();
  }, [loadAutofillDefaults]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadTimesheets();
    setRefreshing(false);
  }, [loadTimesheets]);

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
        .sort((a, b) => new Date(b.weekStart) - new Date(a.weekStart)),
    [timesheets]
  );

  // only real submissions for the bottom list
  const submittedSheets = useMemo(
    () => sortedTimesheets.filter((t) => t.submitted === true),
    [sortedTimesheets]
  );

  const thisMonthStatuses = useMemo(() => {
    return weekOptions.map((w) => {
      const existing = timesheets.find((t) => t.weekStart === w.key);
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
      textColor = "#022c22";
      iconName = "check-circle";
      label = "Approved";
    } else if (status === "submitted") {
      bgStyle = styles.pillSubmitted;
      textColor = "#052e16";
      iconName = "check-circle";
      label = "Submitted";
    } else if (status === "draft") {
      bgStyle = styles.pillDraft;
      textColor = "#1e293b";
      iconName = "edit-3";
      label = "Draft saved";
    } else {
      bgStyle = styles.pillNotFilled;
      textColor = "#7c2d12";
      iconName = "alert-circle";
      label = "Not filled";
    }

    return (
      <View style={[styles.pill, bgStyle]}>
        <Icon
          name={iconName}
          size={14}
          color={textColor}
          style={{ marginRight: 6 }}
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
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.weekLabel, { color: colors.text }]}>{label}</Text>
        <Text style={[styles.weekSubLabel, { color: colors.textMuted }]}>
          Monday → Sunday
        </Text>

        {hasQuery && (
          <View style={styles.queryRow}>
            <Icon name="alert-circle" size={13} color="#f97316" />
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
          style={{ marginTop: 6 }}
        />
      </View>
    </TouchableOpacity>
  );

  // follow me.js: render nothing while auth resolving or unauthenticated
  if (loading || !isAuthed) return null;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      {/* Hero */}
      <View style={styles.heroCard}>
        <View style={styles.heroContent}>
          <View style={styles.heroTopRow}>
            <TouchableOpacity
              onPress={() => router.back()}
              activeOpacity={0.85}
              style={[
                styles.backBtn,
                {
                  backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                  borderColor: withAlpha(colors.border, 0.75),
                },
              ]}
            >
              <Icon name="arrow-left" size={15} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.heroTitleWrap}>
              <Text style={[styles.heroEyebrow, { color: colors.textMuted }]}>
                Payroll
              </Text>
              <Text style={[styles.heroTitle, { color: colors.text }]}>Timesheets</Text>
            </View>

            <View style={styles.heroSpacer} />
          </View>

          <View style={styles.heroMetaRow}>
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
          </View>
        </View>
      </View>

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
          >
            <Icon name="edit-3" size={13} color={colors.text} />
            <Text style={[styles.defaultsEditText, { color: colors.text }]}>
              Edit
            </Text>
          </TouchableOpacity>
        </View>

        {settingsBusy ? (
          <View style={{ marginTop: 8 }}>
            <ShimmerLine />
          </View>
        ) : (
          <>
            <Text style={[styles.defaultsSummary, { color: colors.text }]}>
              {autofillType === "office" ? "Office" : "Yard"} • {autofillStartTime}-{autofillEndTime}
            </Text>
            <Text style={[styles.defaultsHelp, { color: colors.textMuted }]}>
              Tap Edit to change your default type and times.
            </Text>
          </>
        )}
      </View>

      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                Autofill Settings
              </Text>
              <TouchableOpacity
                style={[
                  styles.modalCloseIcon,
                  { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
                ]}
                onPress={() => setSettingsOpen(false)}
                disabled={settingsSaving}
              >
                <Icon name="x" size={14} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.defaultsHelp, { color: colors.textMuted }]}>
              Choose one default type and set its times.
            </Text>

            <View style={styles.typeRow}>
              {["yard", "office"].map((type) => {
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
                  >
                    <Text style={[styles.typeButtonText, { color: colors.text }]}>
                      {type === "office" ? "Office" : "Yard"}
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

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
                ]}
                onPress={() => setSettingsOpen(false)}
                disabled={settingsSaving}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.accentSoft,
                    opacity: settingsSaving ? 0.7 : 1,
                  },
                ]}
                onPress={async () => {
                  const ok = await saveAutofillDefaults();
                  if (ok) setSettingsOpen(false);
                }}
                disabled={settingsSaving}
              >
                <Text style={[styles.modalButtonText, { color: colors.text }]}>
                  {settingsSaving ? "Saving..." : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={styles.pageContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Legend row */}
        <View style={styles.legendRow}>
          <LegendSwatch
            color="#22c55e"
            border="#16a34a"
            label="Approved"
            textColor={colors.text}
          />
          <LegendSwatch
            color="#bbf7d0"
            border="#86efac"
            label="Submitted"
            textColor={colors.text}
          />
          <LegendSwatch
            color="#fee2b3"
            border="#fed7aa"
            label="Draft saved"
            textColor={colors.text}
          />
          <LegendSwatch
            color="#fed7aa"
            border="#fdba74"
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
            borderRadius: 14,
            overflow: "hidden",
            borderColor: colors.border,
            borderWidth: 1,
            marginBottom: 12,
            backgroundColor: colors.surface,
          }}
        >
          {busy ? (
            <View style={{ padding: 10 }}>
              <ShimmerLine />
              <ShimmerLine width="85%" />
              <ShimmerLine width="70%" />
            </View>
          ) : (
            weekOptions.map((w, idx) => {
              const existing = timesheets.find((t) => t.weekStart === w.key);

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
            })
          )}
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

        {busy ? (
          <View style={{ paddingTop: 4 }}>
            <ShimmerLine />
            <ShimmerLine width="90%" />
            <ShimmerLine width="80%" />
          </View>
        ) : submittedSheets.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>
            No timesheets submitted yet.
          </Text>
        ) : (
          <View style={styles.pastList}>
            {submittedSheets.map((item, idx) => {
              const approved = isTimesheetApproved(item);
              const status = approved ? "approved" : "submitted";
              const hasQuery = !!queryWeeksMap[item.weekStart] && !approved;
              const isLast = idx === submittedSheets.length - 1;

              return (
                <View key={item.id} style={!isLast ? { marginBottom: 8 } : null}>
                  {renderWeekCard(
                    item.weekStart,
                    formatWeekRange(new Date(item.weekStart)),
                    status,
                    hasQuery
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* tiny components */
function TimePickerField({ label, value, onSelect, options, disabled }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.defaultsFieldLabel, { color: colors.textMuted }]}>
        {label}
      </Text>
      <TouchableOpacity
        style={[
          styles.defaultsField,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
            opacity: disabled ? 0.65 : 1,
          },
        ]}
        onPress={() => setOpen(true)}
        disabled={disabled}
      >
        <Text style={{ color: value ? colors.text : colors.textMuted }}>
          {value || "Select"}
        </Text>
        <Icon name="chevron-down" size={14} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.pickerModalOverlay}>
          <View
            style={[
              styles.pickerModalCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.pickerModalItem,
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
              keyboardShouldPersistTaps="handled"
            />

            <TouchableOpacity
              style={[
                styles.pickerModalClose,
                { backgroundColor: colors.surfaceAlt },
              ]}
              onPress={() => setOpen(false)}
            >
              <Text style={{ color: colors.text, fontWeight: "700" }}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  container: { flex: 1, backgroundColor: "#0b0b0b", padding: 12 },
  pageContent: { paddingBottom: 0 },
  pastList: { paddingBottom: 6 },

  heroCard: {
    position: "relative",
    marginBottom: 8,
  },
  heroContent: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitleWrap: {
    flex: 1,
    paddingTop: 1,
    alignItems: "center",
  },
  heroSpacer: {
    width: 34,
    height: 34,
  },
  heroEyebrow: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "800",
    textAlign: "center",
  },
  heroTitle: {
    marginTop: 2,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  heroSubTitle: {
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  heroMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  heroMetaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroMetaText: {
    fontSize: 11,
    fontWeight: "700",
  },
  defaultsCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  defaultsHeaderCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  defaultsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  defaultsTitle: {
    fontSize: 12,
    fontWeight: "800",
  },
  defaultsEditButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  defaultsEditText: {
    fontSize: 11,
    fontWeight: "800",
  },
  defaultsSummary: {
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  defaultsHelp: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
    marginBottom: 2,
  },
  defaultsRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 10,
  },
  defaultsFieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
  },
  defaultsField: {
    borderWidth: 1,
    borderRadius: 9,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  typeRow: {
    flexDirection: "row",
    marginBottom: 10,
    justifyContent: "center",
    gap: 8,
  },
  typeButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  typeButtonText: {
    fontSize: 12,
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  modalCard: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "900",
  },
  modalCloseIcon: {
    borderWidth: 1,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  modalButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  modalButtonText: {
    fontSize: 12,
    fontWeight: "800",
  },

  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  legendText: { color: "#cfcfcf", fontSize: 11 },

  sectionHeaderRow: {
    marginTop: 2,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionHeader: {
    fontSize: 15,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 0,
  },

  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1f2937",
    borderColor: "#374151",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  refreshText: { color: "#fff", fontSize: 12 },

  weekCard: {
    backgroundColor: "#111111",
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  submittedCard: { borderLeftWidth: 3, borderLeftColor: "#22c55e" },
  approvedCard: { borderLeftWidth: 3, borderLeftColor: "#16a34a" },

  weekLabel: { color: "#fff", fontSize: 15, fontWeight: "700" },
  weekSubLabel: { color: "#9ca3af", fontSize: 12, marginTop: 2 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillApproved: { backgroundColor: "#22c55e", borderColor: "#16a34a" },
  pillSubmitted: { backgroundColor: "#bbf7d0", borderColor: "#86efac" },
  pillDraft: { backgroundColor: "#fee2b3", borderColor: "#fed7aa" },
  pillNotFilled: { backgroundColor: "#fed7aa", borderColor: "#fdba74" },
  pillText: { fontSize: 12, fontWeight: "800" },

  queryRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 4,
  },
  queryRowText: {
    fontSize: 11,
    color: "#f97316",
    fontWeight: "600",
  },

  emptyText: { color: "#9ca3af", fontStyle: "italic", marginTop: 6 },

  pickerModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  pickerModalCard: {
    width: "100%",
    maxHeight: "62%",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  pickerModalItem: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
  },
  pickerModalClose: {
    margin: 10,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },

  shimmer: {
    height: 12,
    borderRadius: 6,
    backgroundColor: "#1f1f1f",
    marginBottom: 10,
  },
});
