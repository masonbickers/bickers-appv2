import { AppText as Text, AppPressable as TouchableOpacity, FormField, SelectField, TextArea } from "../../components/ui/AppPrimitives";
// app/vehicle-check.js  (or app/screens/vehicle-check.js)
import {
  useLocalSearchParams,
  useRouter } from "expo-router";
import { useCallback,
  useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import PageShell from "../../components/layout/PageShell";

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { collection, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

// ⛽ Firebase + Auth provider
import { auth, db, storage } from "../../firebaseConfig";
import { useVehicles } from "../../hooks/useOperationalData";
import { isBookingVisibleToEmployee } from "../../lib/bookingVisibility";
import { formatDateDDMMYYYY } from "../../lib/dateFormat";
import {
  findVehicleRecord,
  getBookingVehicleReferences,
  getVehicleDisplayLabel,
  getVehicleDisplayName,
  getVehicleReferenceId,
  getVehicleRegistration,
} from "../../lib/fleetSchema";
import { useAuth } from "../../providers/AuthProvider"; // if file is app/vehicle-check.js use "./providers/AuthProvider"
import { useDataCache } from "../../providers/DataCacheProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { designTokens as t } from "../../lib/design/tokens"; // 🎨 theme

const IMAGES_ONLY = ImagePicker.MediaTypeOptions.Images;

const CHECK_ITEMS = [
  "Fuel / Oil / Fluid leaks",
  "Body and Wings Security (Condition)",
  "Tyres / Wheels and Wheel Fixings",
  "Battery Security (If easily accessible)",
  "Brake Lines*",
  "Coupling Security*",
  "Electrical Connections*",
  "Air Build-Up / Leaks",
  "Spray Suppression Devices",
  "Vehicle Height / Load Security (Condition)",
  "Excessive Engine Smoke",
  "Registration Plates",
  "Cab Interior / Seat Belts (Condition)",
  "Tachograph / Sufficient Print Rolls",
  "Steering / Brakes (Inc. ABS / EBS)",
  "Mirrors / Glass / Visibility",
  "Lights / Indicators / Side Repeaters",
  "Wipers / Washers / Horn",
  "Reflectors / Markers",
  "Warning Lamps / MIL (If required)",
  "Speedometer / Speed Limiter",
  "Operator Licence (Visible)",
  "Adblue® / DEF (If required)",
];

const CHECK_SECTIONS = [
  {
    id: "cab",
    title: "Cab & controls",
    icon: "truck",
    description: "Visibility, controls, warnings and driver equipment",
    itemNumbers: [13, 14, 15, 16, 18, 20, 21],
  },
  {
    id: "exterior",
    title: "Exterior & body",
    icon: "maximize",
    description: "Leaks, bodywork, lights, plates and markers",
    itemNumbers: [1, 2, 4, 11, 12, 17, 19, 22, 23],
  },
  {
    id: "running",
    title: "Wheels & brakes",
    icon: "disc",
    description: "Tyres, wheel fixings, brakes and air system",
    itemNumbers: [3, 5, 8, 9],
  },
  {
    id: "equipment",
    title: "Load & equipment",
    icon: "package",
    description: "Coupling, connections, height and load security",
    itemNumbers: [6, 7, 10],
  },
];

const STATUS = { SERVICEABLE: "serviceable", DEFECT: "defect", NA: "na" };
const OK_GREEN = staticColors.hex_24c77a_6x4mf6;
const OK_GREEN_TEXT = staticColors.hex_052e1a_89bntw;

const normaliseParam = (value) => {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : "";
  return value ? String(value) : "";
};

const toISO = (d) =>
  (d?.toISOString?.() || new Date(d)).split?.("T")?.[0] ??
  new Date().toISOString().split("T")[0];

const ensureFileUri = async (uri) => {
  if (!uri) return null;
  try {
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1600 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manip?.uri || uri;
  } catch {
    return uri;
  }
};

export default function VehicleCheckPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const jobId = normaliseParam(params?.jobId);
  const dateISOParam = normaliseParam(params?.dateISO);
  const [standaloneCheckDocId] = useState(
    () => doc(collection(db, "vehicleChecks")).id
  );

  const { employee, user, isAuthed, loading } = useAuth();
  const vehiclesResource = useVehicles();
  const { invalidate } = useDataCache();
  const { colors } = useTheme(); // 🎨

  const [loadingDoc, setLoadingDoc] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);

  // Identity
  const userCode = employee?.userCode || "N/A";
  const driverName =
    employee?.name ||
    employee?.displayName ||
    user?.displayName ||
    "Unknown";

  const [job, setJob] = useState(null);
  const [vehicles, setVehicles] = useState([]); // from booking
  const [vehicle, setVehicle] = useState("");
  const vehicleOptions = useMemo(() => {
    const refs = jobId ? vehicles : vehiclesResource.data;
    return refs.map((vehicleRef) => {
      const matched = findVehicleRecord(vehicleRef, vehiclesResource.data);
      const resolved = matched || vehicleRef;
      return {
        value: getVehicleReferenceId(resolved),
        label: getVehicleDisplayLabel(resolved, vehiclesResource.data),
        vehicle: resolved,
      };
    }).filter((option) => option.value);
  }, [jobId, vehicles, vehiclesResource.data]);
  const selectedVehicleOption = useMemo(
    () => vehicleOptions.find((option) => option.value === vehicle) || null,
    [vehicle, vehicleOptions]
  );

  const [dateISO, setDateISO] = useState(
    () => dateISOParam || toISO(new Date())
  );
  const [timeStr, setTimeStr] = useState(() => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  });

  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");

  const [items, setItems] = useState(() =>
    CHECK_ITEMS.map((label, idx) => ({
      i: idx + 1,
      label,
      status: null,
      note: "",
    }))
  );

  const [photos, setPhotos] = useState([]); // [{uri, remote?}]
  const [expandedSection, setExpandedSection] = useState(null);

  // One doc per job. Standalone checks get their own generated doc ID.
  const checkDocId = useMemo(
    () => jobId || standaloneCheckDocId,
    [jobId, standaloneCheckDocId]
  );

  const normalizeMaintenanceBooking = useCallback((id, data) => {
    if (!data) return null;
    return {
      id,
      ...data,
      // Compatibility adapter: maintenanceBookings is the web-canonical
      // collection, but this screen still expects the legacy booking shape.
      status: data.status === "Booked" ? "Confirmed" : data.status,
      date: data.appointmentDateISO || data.startDateISO || "",
      startDate: data.startDateISO || data.appointmentDateISO || "",
      endDate:
        data.endDateISO || data.startDateISO || data.appointmentDateISO || "",
      vehicles: data.vehicleId
        ? [
            {
              id: data.vehicleId,
              name: data.vehicleLabel || "Vehicle",
              vehicleName: data.vehicleLabel || "Vehicle",
            },
          ]
        : [],
    };
  }, []);

  const loadData = useCallback(async () => {
    if (loading || !isAuthed) {
      setLoadingDoc(false);
      return;
    }
    try {
      setLoadingDoc(true);

      // Load booking
      if (jobId) {
        let snap = await getDoc(doc(db, "bookings", jobId));
        let j = null;
        let isEmployeeBooking = false;
        if (snap.exists()) {
          j = { id: snap.id, ...snap.data() };
          isEmployeeBooking = true;
        } else {
          snap = await getDoc(doc(db, "maintenanceBookings", jobId));
          if (snap.exists()) {
            j = normalizeMaintenanceBooking(snap.id, snap.data());
          }
        }
        if (j) {
          if (isEmployeeBooking && !isBookingVisibleToEmployee(j, employee)) {
            setJob(null);
            Alert.alert(
              "Booking unavailable",
              "This booking is not currently published to your employee app."
            );
            router.back();
            return;
          }
          setJob(j);
          const vs = getBookingVehicleReferences(j);
          setVehicles(vs);
        }
      }

      // Load existing vehicle check for this job
      const existingRef = doc(db, "vehicleChecks", checkDocId);
      const existingSnap = await getDoc(existingRef);
      if (existingSnap.exists()) {
        setHasExisting(true);
        const d = existingSnap.data();

        setDateISO(d.dateISO || dateISO);
        setTimeStr(d.time || timeStr);
        setOdometer(d.odometer || "");
        setNotes(d.notes || "");
        const storedVehicle = d.vehicleId || d.vehicle;
        const matchedVehicle = findVehicleRecord(
          storedVehicle,
          vehiclesResource.data
        );
        if (storedVehicle) {
          setVehicle(getVehicleReferenceId(matchedVehicle || storedVehicle));
        }

        if (Array.isArray(d.items) && d.items.length) {
          setItems((prev) =>
            prev.map((p, idx) => ({
              ...p,
              status: d.items[idx]?.status ?? p.status,
              note: d.items[idx]?.note ?? p.note,
            }))
          );
        }

        const urls = Array.isArray(d.photos) ? d.photos : [];
        setPhotos(urls.map((u) => ({ uri: u, remote: true })));
      } else {
        setHasExisting(false);
      }
    } finally {
      setLoadingDoc(false);
    }
  }, [
    jobId,
    checkDocId,
    loading,
    isAuthed,
    employee,
    router,
    dateISO,
    timeStr,
    normalizeMaintenanceBooking,
    vehiclesResource.data,
  ]);

  useEffect(() => {
    if (!vehicle && vehicleOptions.length === 1) setVehicle(vehicleOptions[0].value);
  }, [vehicle, vehicleOptions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const cycleStatus = (cur) => {
    if (cur === STATUS.SERVICEABLE) return STATUS.DEFECT;
    if (cur === STATUS.DEFECT) return STATUS.NA;
    if (cur === STATUS.NA) return STATUS.SERVICEABLE;
    return STATUS.SERVICEABLE;
  };

  const setItemStatus = (index) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === index ? { ...it, status: cycleStatus(it.status) } : it
      )
    );
  };
  const setItemNote = (index, t) => {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, note: t } : it))
    );
  };

  const markSectionServiceable = (section) => {
    const sectionNumbers = new Set(section.itemNumbers);
    setItems((prev) =>
      prev.map((item) =>
        !sectionNumbers.has(item.i) || item.status === STATUS.DEFECT
          ? item
          : { ...item, status: STATUS.SERVICEABLE }
      )
    );
  };

  const pickPhotos = async () => {
    if (Platform.OS !== "web") {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted")
        return Alert.alert(
          "Permission",
          "Photo library permission is required."
        );
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      selectionLimit: 6,
      mediaTypes: IMAGES_ONLY,
      quality: 1,
    });
    if (res.canceled) return;
    const assets = res.assets ?? [];
    setPhotos((p) =>
      [...p, ...assets.map((a) => ({ uri: a.uri }))].slice(0, 10)
    );
  };

  const uploadPhotos = async () => {
    const uid = user?.uid || auth.currentUser?.uid || "public";
    const uploaded = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (p.remote || (p.uri || "").startsWith("http")) {
        uploaded.push(p.uri);
        continue;
      }
      const fileUri = await ensureFileUri(p.uri);
      if (!fileUri) continue;

      const filename = `${Date.now()}_${i}.jpg`;
      const path = `vehicle-checks/${uid}/${checkDocId}/${filename}`;
      const r = ref(storage, path);

      const resp = await fetch(fileUri);
      const blob = await resp.blob();

      await new Promise((resolve, reject) =>
        uploadBytesResumable(r, blob, {
          contentType: "image/jpeg",
        }).on("state_changed", undefined, reject, resolve)
      );
      uploaded.push(await getDownloadURL(r));
    }
    return uploaded;
  };

  const validateBeforeSubmit = () => {
    const incomplete = items.some((it) => !it.status);
    if (incomplete) return "Please complete every check item before submitting.";
    const defectsNeedNote = items.some(
      (it) => it.status === STATUS.DEFECT && !it.note?.trim()
    );
    if (defectsNeedNote)
      return "Please add a note for each item marked as DEFECT.";
    if (!vehicle) return "Please select a vehicle.";
    if (!odometer.trim()) return "Please enter the odometer reading.";
    return null;
  };

  const save = async (finalize = false) => {
    if (saving) return;

    try {
      setSaving(true);
      const photoUrls = await uploadPhotos();

      const payload = {
        bookingId: jobId || null, // for JobDay lookup when linked to a job
        jobId: jobId || null,
        checkId: checkDocId,
        dateISO,
        time: timeStr,
        vehicle: selectedVehicleOption?.label || "Unknown vehicle",
        vehicleId: selectedVehicleOption?.value || vehicle,
        vehicleName: getVehicleDisplayName(
          selectedVehicleOption?.vehicle,
          vehiclesResource.data
        ),
        registration: getVehicleRegistration(selectedVehicleOption?.vehicle) || "",
        odometer,
        driverName,
        driverCode: userCode,
        items,
        notes,
        photos: photoUrls,
        status: finalize ? "submitted" : "draft",
        updatedAt: serverTimestamp(),
      };

      // If it's brand new, also set createdAt
      if (!hasExisting) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(doc(db, "vehicleChecks", checkDocId), payload, {
        merge: true,
      });
      await invalidate("collection:vehicleChecks");

      if (finalize) {
        setHasExisting(true);
        Alert.alert("Saved", "Vehicle check updated.");
        router.back();
      } else {
        setHasExisting(true);
        Alert.alert("Saved", "Draft saved.");
      }
    } catch (e) {
      console.error("vehicle-check save error", e);
      Alert.alert("Error", "Could not save vehicle check.");
    } finally {
      setSaving(false);
    }
  };

  const onSubmitOrUpdate = async () => {
    const err = validateBeforeSubmit();
    if (err) return Alert.alert("Incomplete", err);
    await save(true);
  };

  if (loading || !isAuthed) return null;

  if (loadingDoc) {
    return (
      <PageShell mode="form" width="form" header={{ variant: "compact", title: "Daily Vehicle Check", onBack: router.back }}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={{ color: colors.textMuted, marginTop: t.spacing.xs }}>
          Loading…
        </Text>
      </PageShell>
    );
  }

  const primaryBtnLabel = hasExisting
    ? saving
      ? "Updating…"
      : "Update Check"
    : saving
    ? "Submitting…"
    : "Submit Check";
  const sectionStates = CHECK_SECTIONS.map((section) => {
    const sectionItems = items.filter((item) => section.itemNumbers.includes(item.i));
    return {
      ...section,
      items: sectionItems,
      completed: sectionItems.every((item) => !!item.status),
      defectCount: sectionItems.filter((item) => item.status === STATUS.DEFECT).length,
    };
  });
  const completedSectionCount = sectionStates.filter((section) => section.completed).length;
  const defectCount = items.filter((item) => item.status === STATUS.DEFECT).length;

  return (
    <PageShell
      mode="form"
      width="form"
      header={{
        variant: "compact",
        title: "Daily Vehicle Check",
        subtitle: job ? `Job #${job.jobNumber || "N/A"} · ${job.client || "No client"}` : undefined,
        onBack: router.back,
        metadata: hasExisting ? <Text style={[styles.existingBadge, { color: colors.success }]}>Existing check on file for this job</Text> : undefined,
      }}
    >

        <View style={styles.checkContext}>
          <CheckContextItem icon="user" label="Driver" value={driverName} colors={colors} />
          <CheckContextItem
            icon="calendar"
            label="Check time"
            value={`${formatDateDDMMYYYY(dateISO) || dateISO} · ${timeStr}`}
            colors={colors}
          />
        </View>

        <View style={styles.grid2}>
          <SelectField
              label="Vehicle"
              value={vehicle}
              options={vehicleOptions}
              onChange={setVehicle}
              searchable
            />
          <FormField
              label="Odometer Reading"
              value={odometer}
              onChangeText={setOdometer}
              placeholder="e.g., 123456"
              inputProps={{ keyboardType: "numeric" }}
            />
        </View>

        {/* Checks */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <View style={styles.checkSectionHeader}>
            <View>
              <Text style={[styles.cardTitle, { color: colors.text }]}>Daily Check</Text>
              <Text style={[styles.progressText, { color: colors.textMuted }]}>
                {completedSectionCount} of {CHECK_SECTIONS.length} sections complete
                {defectCount ? ` · ${defectCount} defect${defectCount === 1 ? "" : "s"}` : ""}
              </Text>
            </View>
          </View>
          <View style={styles.sectionList}>
            {sectionStates.map((section) => {
              const isExpanded = expandedSection === section.id;
              return (
                <View
                  key={section.id}
                  style={[styles.checkGroup, { borderColor: colors.border }]}
                >
                  <View style={styles.checkGroupHeader}>
                    <TouchableOpacity
                      onPress={() => setExpandedSection(isExpanded ? null : section.id)}
                      style={styles.groupMain}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isExpanded }}
                      accessibilityLabel={`Open ${section.title} checks`}
                    >
                      <View
                        style={[
                          styles.groupIcon,
                          { backgroundColor: section.defectCount ? colors.danger : colors.surface },
                        ]}
                      >
                        <Icon name={section.icon} size={17} color={section.defectCount ? staticColors.hex_fff_yhjmu8 : colors.textMuted} />
                      </View>
                      <View style={styles.groupCopy}>
                        <Text style={[styles.groupTitle, { color: colors.text }]}>{section.title}</Text>
                        <Text style={[styles.groupDescription, { color: colors.textMuted }]} numberOfLines={1}>
                          {section.defectCount
                            ? `${section.defectCount} defect${section.defectCount === 1 ? "" : "s"} reported`
                            : section.completed
                            ? "Completed · all items checked"
                            : section.description}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => markSectionServiceable(section)}
                      style={[
                        styles.headerOkButton,
                        {
                          backgroundColor:
                            section.completed && !section.defectCount
                              ? OK_GREEN
                              : colors.surface,
                          borderColor: OK_GREEN,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Mark ${section.title} all OK`}
                    >
                      <Icon
                        name="check"
                        size={15}
                        color={section.completed && !section.defectCount ? OK_GREEN_TEXT : OK_GREEN}
                      />
                      <Text
                        style={[
                          styles.headerOkText,
                          {
                            color:
                              section.completed && !section.defectCount
                                ? OK_GREEN_TEXT
                                : OK_GREEN,
                          },
                        ]}
                      >
                        OK
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setExpandedSection(isExpanded ? null : section.id)}
                      style={styles.expandButton}
                      accessibilityRole="button"
                      accessibilityLabel={`${isExpanded ? "Close" : "Open"} ${section.title} checks`}
                    >
                      <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  {isExpanded ? (
                    <View style={[styles.groupItems, { borderTopColor: colors.border }]}>
                      {section.items.map((it) => {
                        const itemIndex = items.findIndex((item) => item.i === it.i);
                        return (
                          <View key={it.i} style={styles.itemRow}>
                            <Text style={[styles.itemLabel, { color: colors.text }]}>{it.label}</Text>
                            <TouchableOpacity
                              onPress={() => setItemStatus(itemIndex)}
                              activeOpacity={0.85}
                              style={[
                                styles.statusBadge,
                                it.status === STATUS.SERVICEABLE && styles.statusOk,
                                it.status === STATUS.DEFECT && styles.statusDefect,
                                it.status === STATUS.NA && { borderColor: staticColors.hex_666_yhlfzk, backgroundColor: colors.surface },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.statusText,
                                  {
                                    color:
                                      it.status === STATUS.SERVICEABLE
                                        ? staticColors.hex_052e16_89ayk3
                                        : it.status === STATUS.DEFECT
                                        ? staticColors.hex_7f1d1d_81m7ef
                                        : colors.text,
                                  },
                                ]}
                              >
                                {it.status === STATUS.SERVICEABLE
                                  ? "OK"
                                  : it.status === STATUS.DEFECT
                                  ? "Defect"
                                  : it.status === STATUS.NA
                                  ? "N/A"
                                  : "Set"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>

        {defectCount > 0 ? (
          <View
            style={[
              styles.card,
              styles.defectCard,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.danger },
            ]}
          >
          <Text style={[styles.cardTitle, { color: colors.text }]}>Defect details</Text>
          <Text
            style={{
              color: colors.textMuted,
              marginBottom: t.spacing.xxs,
              fontSize: t.typography.metadata.fontSize,
            }}
          >
            Add a short note for every item marked as a defect.
          </Text>

          {items.map((it, idx) =>
            it.status === STATUS.DEFECT ? (
              <View key={`def-${it.i}`} style={{ marginBottom: t.spacing.xs }}>
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: "700",
                    marginBottom: t.spacing.xxs,
                  }}
                >
                  {String(it.i).padStart(2, "0")} · {it.label}
                </Text>
                <TextArea
                  label={`${String(it.i).padStart(2, "0")} ${it.label} defect`}
                  value={it.note}
                  onChangeText={(t) => setItemNote(idx, t)}
                  placeholder="Describe the defect, location, severity…"
                />
              </View>
            ) : null
          )}

          <Text
            style={{
              color: colors.text,
              fontWeight: "700",
              marginTop: t.spacing.xs,
              marginBottom: t.spacing.xxs,
            }}
          >
            Additional Notes
          </Text>
          <TextArea
            label="Additional Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else to report (accident damage, irregular circumstances, etc.)"
          />
          </View>
        ) : (
          <View style={[styles.allClearCard, { backgroundColor: colors.surfaceAlt }]}>
            <Icon name="shield" size={17} color={colors.success} />
            <Text style={[styles.allClearText, { color: colors.textMuted }]}>
              Defect details will appear here only when an item is marked Defect.
            </Text>
          </View>
        )}

        {/* Photos */}
        {(defectCount > 0 || photos.length > 0) ? <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Photos
          </Text>
          <View
            style={{ flexDirection: "row", gap: t.spacing.xs, marginBottom: t.spacing.xs }}
          >
            <SmallBtn icon="image" text="Library" onPress={pickPhotos} />
          </View>

          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.xs }}
          >
            {photos.map((p, idx) => (
              <View
                key={`${p.uri}-${idx}`}
                style={{ position: "relative" }}
              >
                <Image
                  source={{ uri: p.uri }}
                  style={{
                    width: 86,
                    height: 86,
                    borderRadius: t.radius.sm,
                  }}
                />
                <TouchableOpacity
                  onPress={() =>
                    setPhotos((prev) =>
                      prev.filter((_, i) => i !== idx)
                    )
                  }
                  style={styles.closeChip}
                >
                  <Text
                    style={{ color: staticColors.hex_fff_yhjmu8, fontWeight: "900" }}
                  >
                    ×
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
            {photos.length === 0 && (
              <Text style={{ color: colors.textMuted }}>
                No photos added.
              </Text>
            )}
          </View>
        </View> : null}

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: t.spacing.xs, marginTop: t.spacing.xs }}>
          <TouchableOpacity
            onPress={() => save(false)}
            style={[
              styles.actionBtn,
              { backgroundColor: colors.surfaceAlt },
            ]}
            activeOpacity={0.85}
            disabled={saving}
          >
            <Text
              style={[
                styles.actionText,
                { color: colors.text },
              ]}
            >
              {saving ? "Saving…" : "Save Draft"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSubmitOrUpdate}
            style={[
              styles.actionBtn,
              { backgroundColor: colors.accent, flex: 1 },
            ]}
            activeOpacity={0.9}
            disabled={saving}
          >
            <Text style={styles.actionText}>{primaryBtnLabel}</Text>
          </TouchableOpacity>
        </View>
    </PageShell>
  );
}

/* ---------- tiny UI helpers ---------- */
const CheckContextItem = ({ icon, label, value, colors }) => (
  <View style={styles.checkContextItem}>
    <View style={[styles.contextIcon, { backgroundColor: colors.surface }]}>
      <Icon name={icon} size={15} color={colors.textMuted} />
    </View>
    <View style={styles.contextText}>
      <Text style={[styles.contextLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.contextValue, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  </View>
);

const SmallBtn = ({ icon, text, onPress }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.smallBtn,
        { backgroundColor: colors.surfaceAlt },
      ]}
      activeOpacity={0.85}
    >
      <Icon name={icon} size={14} color={colors.text} />
      <Text
        style={{
          color: colors.text,
          fontWeight: "700",
          fontSize: t.typography.metadata.fontSize,
        }}
      >
        {text}
      </Text>
    </TouchableOpacity>
  );
};

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  header: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 64,
    marginBottom: t.spacing.xs,
  },
  backButton: { position: "absolute", left: 0, padding: t.spacing.xs, zIndex: 1 },
  headerTitleContainer: { width: "100%", paddingHorizontal: 48, alignItems: "center" },
  title: { color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.titleSmall.fontSize, fontWeight: "800", textAlign: "center" },
  subtitle: { color: staticColors.hex_9e9e9e_ec6lmi, marginTop: t.spacing.xxs, textAlign: "center" },
  existingBadge: {
    marginTop: t.spacing.xxs,
    color: staticColors.hex_30d158_8wag71,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
    textAlign: "center",
  },
  checkContext: {
    marginTop: t.spacing.sm,
    paddingHorizontal: t.spacing.none,
    paddingVertical: t.spacing.xxs,
    flexDirection: "row",
    gap: t.spacing.sm,
  },
  checkContextItem: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: t.spacing.xs },
  contextIcon: {
    width: 32,
    height: 32,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  contextText: { flex: 1, minWidth: 0 },
  contextLabel: { fontSize: t.typography.micro.fontSize, lineHeight: t.typography.micro.lineHeight, fontWeight: "700" },
  contextValue: { marginTop: t.spacing.none, fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight, fontWeight: "800" },

  grid2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.sm,
    marginTop: t.spacing.sm,
  },
  field: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 0,
    marginBottom: t.spacing.xs,
  },
  input: {
    color: staticColors.hex_fff_yhjmu8,
    backgroundColor: staticColors.hex_232323_72yy4n,
    borderColor: staticColors.hex_333_yhlln9,
    borderWidth: 1,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  pickerLike: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    backgroundColor: staticColors.hex_232323_72yy4n,
    borderColor: staticColors.hex_333_yhlln9,
    borderWidth: 1,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },

  card: {
    backgroundColor: staticColors.hex_1a1a1a_98rvna,
    borderWidth: 1,
    borderColor: staticColors.hex_262626_70t9oi,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginTop: t.spacing.sm,
  },
  cardTitle: {
    color: staticColors.hex_fff_yhjmu8,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "800",
    marginBottom: t.spacing.xxs,
  },
  checkSectionHeader: {
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.xs,
  },
  progressText: { fontSize: t.typography.caption.fontSize, fontWeight: "700" },
  sectionList: { gap: t.spacing.xs, marginTop: t.spacing.xxs },
  checkGroup: { borderWidth: 1, borderRadius: t.radius.md, overflow: "hidden" },
  checkGroupHeader: {
    minHeight: 66,
    paddingLeft: t.spacing.sm,
    paddingRight: t.spacing.xxs,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  groupMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  groupCopy: { flex: 1, minWidth: 0 },
  groupTitle: { fontSize: t.typography.body.fontSize, lineHeight: t.typography.body.lineHeight, fontWeight: "800" },
  groupDescription: { marginTop: t.spacing.none, fontSize: t.typography.caption.fontSize, lineHeight: t.typography.caption.lineHeight, fontWeight: "600" },
  headerOkButton: {
    minWidth: 54,
    minHeight: 38,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  headerOkText: { fontSize: t.typography.metadata.fontSize, fontWeight: "900" },
  expandButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  groupItems: { paddingHorizontal: t.spacing.xs, paddingVertical: t.spacing.xxs, borderTopWidth: 1 },
  defectCard: { borderWidth: 1 },
  allClearCard: {
    marginTop: t.spacing.xs,
    padding: t.spacing.sm,
    borderRadius: t.radius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  allClearText: { flex: 1, fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight, fontWeight: "600" },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  itemLabel: { flex: 1, color: staticColors.hex_fff_yhjmu8, fontSize: t.typography.metadata.fontSize, lineHeight: t.typography.metadata.lineHeight },
  statusBadge: {
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.xxs,
    paddingHorizontal: t.spacing.xs,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    backgroundColor: staticColors.hex_141414_a6icwz,
    borderColor: staticColors.hex_333_yhlln9,
  },
  statusOk: { borderColor: staticColors.hex_1db954_99nzwp, backgroundColor: staticColors.hex_bbf7d0_ry6j9f },
  statusDefect: { borderColor: staticColors.hex_c8102e_6za5cb, backgroundColor: staticColors.hex_fee2e2_pb1qh1 },
  statusText: { color: staticColors.hex_fff_yhjmu8, fontWeight: "800" },

  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    backgroundColor: staticColors.hex_2e2e2e_6o7581,
    borderRadius: t.radius.sm,
  },
  closeChip: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: staticColors.hex_c8102e_6za5cb,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.xxs,
    paddingVertical: t.spacing.none,
  },
  actionBtn: {
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: staticColors.hex_fff_yhjmu8, fontWeight: "800" },

});
