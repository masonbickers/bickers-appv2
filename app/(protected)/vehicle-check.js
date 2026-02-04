// app/vehicle-check.js  (or app/screens/vehicle-check.js)
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

// ⛽ Firebase + Auth provider
import { auth, db, storage } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider"; // if file is app/vehicle-check.js use "./providers/AuthProvider"
import { useTheme } from "../providers/ThemeProvider"; // 🎨 theme

const MediaEnum = ImagePicker?.MediaType ?? ImagePicker?.MediaTypeOptions;
const IMAGES_ONLY = MediaEnum?.Images ?? undefined;

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
  "Nil Defects",
];

const STATUS = { SERVICEABLE: "serviceable", DEFECT: "defect", NA: "na" };

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
  const jobId = params?.jobId;
  const dateISOParam = params?.dateISO;

  const { employee, user, isAuthed, loading } = useAuth();
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

  // 🔑 One doc per job
  const checkDocId = useMemo(() => jobId || "nojob", [jobId]);

  const loadData = useCallback(async () => {
    if (loading || !isAuthed) {
      setLoadingDoc(false);
      return;
    }
    try {
      setLoadingDoc(true);

      // Load booking
      if (jobId) {
        const snap = await getDoc(doc(db, "bookings", jobId));
        if (snap.exists()) {
          const j = { id: snap.id, ...snap.data() };
          setJob(j);
          const vs = Array.isArray(j.vehicles) ? j.vehicles : [];
          setVehicles(vs);
          if (!vehicle && vs.length) setVehicle(vs[0]);
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
        if (d.vehicle) setVehicle(d.vehicle);

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
  }, [jobId, checkDocId, vehicle, loading, isAuthed, dateISO, timeStr]);

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

  const takePhoto = async () => {
    if (Platform.OS !== "web") {
      const { status } =
        await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted")
        return Alert.alert("Permission", "Camera permission is required.");
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: IMAGES_ONLY,
      quality: 1,
    });
    if (res.canceled) return;
    const a = res.assets?.[0];
    if (a)
      setPhotos((p) => [...p, { uri: a.uri }].slice(0, 10));
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
      const path = `vehicle-checks/${uid}/${jobId || "nojob"}/${filename}`;
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
    const anyAnswered = items.some((it) => it.status);
    if (!anyAnswered) return "Please mark at least one check item.";
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
    try {
      setSaving(true);
      const photoUrls = await uploadPhotos();

      const payload = {
        bookingId: jobId, // 🔑 for JobDay lookup
        jobId,
        dateISO,
        time: timeStr,
        vehicle,
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
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={{ color: colors.textMuted, marginTop: 10 }}>
          Loading…
        </Text>
      </SafeAreaView>
    );
  }

  const primaryBtnLabel = hasExisting
    ? saving
      ? "Updating…"
      : "Update Check"
    : saving
    ? "Submitting…"
    : "Submit Check";

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header with Back Button */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <Icon name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={[styles.title, { color: colors.text }]}>
              Vehicle Defect Report
            </Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              {job
                ? `Job #${job.jobNumber || "N/A"} · ${
                    job.client || "No client"
                  }`
                : ""}
            </Text>
            {hasExisting && (
              <Text
                style={[
                  styles.existingBadge,
                  { color: colors.success },
                ]}
              >
                Existing check on file for this job
              </Text>
            )}
          </View>
        </View>

        {/* Top fields */}
        <View style={styles.grid2}>
          <Field label="Driver’s Name">
            <TextInput
              value={driverName}
              editable={false}
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
              placeholderTextColor={colors.textMuted}
            />
          </Field>

          <Field label="Vehicle">
            <PickerLike
              value={vehicle}
              options={vehicles.length ? vehicles : [""]}
              onChange={setVehicle}
            />
          </Field>

          <Field label="Date">
            <TextInput
              value={dateISO}
              onChangeText={setDateISO}
              placeholder="YYYY-MM-DD"
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
              placeholderTextColor={colors.textMuted}
            />
          </Field>

          <Field label="Time">
            <TextInput
              value={timeStr}
              onChangeText={setTimeStr}
              placeholder="HH:MM"
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
              placeholderTextColor={colors.textMuted}
            />
          </Field>

          <Field label="Odometer Reading">
            <TextInput
              value={odometer}
              onChangeText={setOdometer}
              placeholder="e.g., 123456"
              keyboardType="numeric"
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                  color: colors.text,
                },
              ]}
              placeholderTextColor={colors.textMuted}
            />
          </Field>
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <LegendPill text="✓ Serviceable" />
          <LegendPill text="✗ Defect" />
          <LegendPill text="– N/A" />
        </View>

        {/* Checks */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Daily Check
          </Text>
          {items.map((it, idx) => (
            <View key={it.i} style={styles.itemRow}>
              <Text
                style={[
                  styles.itemIndex,
                  { color: colors.textMuted },
                ]}
              >
                {String(it.i).padStart(2, "0")}
              </Text>
              <Text style={[styles.itemLabel, { color: colors.text }]}>
                {it.label}
              </Text>

              <TouchableOpacity
                onPress={() => setItemStatus(idx)}
                activeOpacity={0.85}
                style={[
                  styles.statusBadge,
                  it.status === STATUS.SERVICEABLE && {
                    borderColor: "#1db954",
                    backgroundColor: "#bbf7d0",
                  },
                  it.status === STATUS.DEFECT && {
                    borderColor: "#C8102E",
                    backgroundColor: "#fee2e2",
                  },
                  it.status === STATUS.NA && {
                    borderColor: "#666",
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    {
                      color:
                        it.status === STATUS.SERVICEABLE ||
                        it.status === STATUS.DEFECT
                          ? "#052e16"
                          : colors.background,
                    },
                  ]}
                >
                  {it.status === STATUS.SERVICEABLE
                    ? "✓"
                    : it.status === STATUS.DEFECT
                    ? "✗"
                    : it.status === STATUS.NA
                    ? "–"
                    : "Tap"}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Defect notes */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Defect Report Here
          </Text>
          <Text
            style={{
              color: colors.textMuted,
              marginBottom: 6,
              fontSize: 12,
            }}
          >
            Record any defects / irregularities. Add a note for every
            item marked ✗ Defect.
          </Text>

          {items.map((it, idx) =>
            it.status === STATUS.DEFECT ? (
              <View key={`def-${it.i}`} style={{ marginBottom: 8 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: "700",
                    marginBottom: 4,
                  }}
                >
                  {String(it.i).padStart(2, "0")} · {it.label}
                </Text>
                <TextInput
                  value={it.note}
                  onChangeText={(t) => setItemNote(idx, t)}
                  placeholder="Describe the defect, location, severity…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  style={[
                    styles.input,
                    {
                      minHeight: 68,
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.text,
                    },
                  ]}
                />
              </View>
            ) : null
          )}

          <Text
            style={{
              color: colors.text,
              fontWeight: "700",
              marginTop: 8,
              marginBottom: 4,
            }}
          >
            Additional Notes
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else to report (accident damage, irregular circumstances, etc.)"
            placeholderTextColor={colors.textMuted}
            multiline
            style={[
              styles.input,
              {
                minHeight: 88,
                backgroundColor: colors.inputBackground,
                borderColor: colors.inputBorder,
                color: colors.text,
              },
            ]}
          />
        </View>

        {/* Photos */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Photos
          </Text>
          <View
            style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}
          >
            <SmallBtn icon="image" text="Library" onPress={pickPhotos} />
            <SmallBtn icon="camera" text="Camera" onPress={takePhoto} />
          </View>

          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
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
                    borderRadius: 8,
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
                    style={{ color: "#fff", fontWeight: "900" }}
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
        </View>

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
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
              { backgroundColor: "#C8102E", flex: 1 },
            ]}
            activeOpacity={0.9}
            disabled={saving}
          >
            <Text style={styles.actionText}>{primaryBtnLabel}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- tiny UI helpers ---------- */
const Field = ({ label, children }) => {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 12,
          fontWeight: "700",
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
};

const PickerLike = ({ value, options, onChange }) => {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.pickerLike,
        {
          backgroundColor: colors.inputBackground,
          borderColor: colors.inputBorder,
        },
      ]}
    >
      <Text
        style={{
          color: value ? colors.text : colors.textMuted,
          flex: 1,
        }}
        numberOfLines={1}
      >
        {value || "Select…"}
      </Text>
      <TouchableOpacity
        onPress={() => {
          if (!options.length) return;
          const i = Math.max(0, options.indexOf(value));
          const next = options[(i + 1) % options.length];
          onChange(next);
        }}
      >
        <Icon name="chevron-down" size={18} color={colors.text} />
      </TouchableOpacity>
    </View>
  );
};

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
          fontSize: 12,
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
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  backButton: { padding: 8, marginRight: 10 },
  headerTitleContainer: { flex: 1 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#9e9e9e", marginTop: 4 },
  existingBadge: {
    marginTop: 4,
    color: "#30D158",
    fontSize: 12,
    fontWeight: "700",
  },

  grid2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
  },
  input: {
    color: "#fff",
    backgroundColor: "#232323",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  pickerLike: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#232323",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },

  legend: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    marginBottom: 6,
  },
  card: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  cardTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 6,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  itemIndex: { width: 26, color: "#bdbdbd", fontWeight: "700" },
  itemLabel: { flex: 1, color: "#fff" },
  statusBadge: {
    minWidth: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: "#141414",
    borderColor: "#333",
  },
  statusText: { color: "#fff", fontWeight: "800" },

  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#2E2E2E",
    borderRadius: 8,
  },
  closeChip: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "#C8102E",
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: "#fff", fontWeight: "800" },

  legendPill: {
    backgroundColor: "#232323",
    borderColor: "#333",
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  legendPillText: { color: "#fff", fontWeight: "700" },
});

function LegendPill({ text }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.legendPill,
        { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.legendPillText,
          { color: colors.text },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
