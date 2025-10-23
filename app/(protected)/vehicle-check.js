// app/vehicle-check.js (or app/screens/vehicle-check.js)
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';

// Adjust these paths if this file is under /screens/
import { auth, db, storage } from '../../firebaseConfig';

const MediaEnum = ImagePicker?.MediaType ?? ImagePicker?.MediaTypeOptions;
const IMAGES_ONLY = MediaEnum?.Images ?? undefined;

const CHECK_ITEMS = [
  'Fuel / Oil / Fluid leaks',
  'Body and Wings Security (Condition)',
  'Tyres / Wheels and Wheel Fixings',
  'Battery Security (If easily accessible)',
  'Brake Lines*',
  'Coupling Security*',
  'Electrical Connections*',
  'Air Build-Up / Leaks',
  'Spray Suppression Devices',
  'Vehicle Height / Load Security (Condition)',
  'Excessive Engine Smoke',
  'Registration Plates',
  'Cab Interior / Seat Belts (Condition)',
  'Tachograph / Sufficient Print Rolls',
  'Steering / Brakes (Inc. ABS / EBS)',
  'Mirrors / Glass / Visibility',
  'Lights / Indicators / Side Repeaters',
  'Wipers / Washers / Horn',
  'Reflectors / Markers',
  'Warning Lamps / MIL (If required)',
  'Speedometer / Speed Limiter',
  'Operator Licence (Visible)',
  'Adblue® / DEF (If required)',
  'Nil Defects',
];
// notes on the sheet: * refers to vehicle & trailer combinations

const STATUS = {
  SERVICEABLE: 'serviceable',
  DEFECT: 'defect',
  NA: 'na',
};

const toISO = (d) => d?.toISOString?.().split('T')[0];

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

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const employee = global.employee;
  const user = auth.currentUser;
  const userCode = employee?.userCode || 'N/A';
  const driverName = employee?.name || user?.displayName || 'Unknown';

  const [job, setJob] = useState(null);
  const [vehicles, setVehicles] = useState([]); // from booking
  const [vehicle, setVehicle] = useState(''); // selected vehicle

  const [dateISO, setDateISO] = useState(() => {
    // fallback to today if not provided
    return dateISOParam || toISO(new Date());
  });

  const [timeStr, setTimeStr] = useState(() => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  });

  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');

  // per item status & per-item defect note (optional)
  const [items, setItems] = useState(() =>
    CHECK_ITEMS.map((label, idx) => ({
      i: idx + 1,
      label,
      status: null, // 'serviceable' | 'defect' | 'na'
      note: '',
    }))
  );

  // photos
  const [photos, setPhotos] = useState([]); // [{uri, remote?}]

  const docId = useMemo(() => {
    const vKey = (vehicle || 'Unknown').replace(/[^\w\-]+/g, '_');
    return `${jobId || 'nojob'}__${dateISO || 'nodate'}__${vKey}__${userCode}`;
  }, [jobId, dateISO, vehicle, userCode]);

  // Load booking, vehicles, and any existing saved check (draft or submitted)
  const loadData = useCallback(async () => {
    if (!jobId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const snap = await getDoc(doc(db, 'bookings', jobId));
      if (snap.exists()) {
        const j = { id: snap.id, ...snap.data() };
        setJob(j);
        const vs = Array.isArray(j.vehicles) ? j.vehicles : [];
        setVehicles(vs);
        if (!vehicle && vs.length) setVehicle(vs[0]);
      }

      // try to load an existing draft/submission for this docId
      const existingRef = doc(db, 'vehicleChecks', docId);
      const existingSnap = await getDoc(existingRef);
      if (existingSnap.exists()) {
        const d = existingSnap.data();
        setDateISO(d.dateISO || dateISO);
        setTimeStr(d.time || timeStr);
        setOdometer(d.odometer || '');
        setNotes(d.notes || '');

        // merge statuses by label index
        if (Array.isArray(d.items) && d.items.length) {
          setItems((prev) =>
            prev.map((p, idx) => ({
              ...p,
              status: d.items[idx]?.status ?? p.status,
              note: d.items[idx]?.note ?? p.note,
            }))
          );
        }
        // photos
        const urls = Array.isArray(d.photos) ? d.photos : [];
        setPhotos(urls.map((u) => ({ uri: u, remote: true })));
      }
    } finally {
      setLoading(false);
    }
  }, [jobId, docId, vehicle]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]); // reload if vehicle/date changes to new docId

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
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, note: t } : it)));
  };

  const pickPhotos = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission', 'Photo library permission is required.');
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      selectionLimit: 6,
      mediaTypes: IMAGES_ONLY,
      quality: 1,
    });
    if (res.canceled) return;
    const assets = res.assets ?? [];
    setPhotos((p) => [...p, ...assets.map((a) => ({ uri: a.uri }))].slice(0, 10));
  };

  const takePhoto = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') return Alert.alert('Permission', 'Camera permission is required.');
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: IMAGES_ONLY,
      quality: 1,
    });
    if (res.canceled) return;
    const a = res.assets?.[0];
    if (a) setPhotos((p) => [...p, { uri: a.uri }].slice(0, 10));
  };

  const uploadPhotos = async () => {
    const uid = auth.currentUser?.uid || 'public';
    const uploaded = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (p.remote || (p.uri || '').startsWith('http')) {
        uploaded.push(p.uri);
        continue;
      }
      const fileUri = await ensureFileUri(p.uri);
      if (!fileUri) continue;

      const filename = `${Date.now()}_${i}.jpg`;
      const path = `vehicle-checks/${uid}/${jobId}/${dateISO}/${filename}`;
      const r = ref(storage, path);

      const resp = await fetch(fileUri);
      const blob = await resp.blob();

      await new Promise((resolve, reject) =>
        uploadBytesResumable(r, blob, { contentType: 'image/jpeg' }).on('state_changed', undefined, reject, resolve)
      );
      uploaded.push(await getDownloadURL(r));
    }
    return uploaded;
  };

  const validateBeforeSubmit = () => {
    // At least one item answered
    const anyAnswered = items.some((it) => it.status);
    if (!anyAnswered) return 'Please mark at least one check item.';
    // Any defects must have a note
    const defectsNeedNote = items.some((it) => it.status === STATUS.DEFECT && !it.note?.trim());
    if (defectsNeedNote) return 'Please add a note for each item marked as DEFECT.';
    if (!vehicle) return 'Please select a vehicle.';
    if (!odometer.trim()) return 'Please enter the odometer reading.';
    return null;
  };

  const save = async (finalize = false) => {
    try {
      setSaving(true);
      const photoUrls = await uploadPhotos();

      const payload = {
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
        status: finalize ? 'submitted' : 'draft',
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'vehicleChecks', docId), payload, { merge: true });

      if (finalize) {
        Alert.alert('Saved', 'Vehicle check submitted.');
        router.back();
      } else {
        Alert.alert('Saved', 'Draft saved.');
      }
    } catch (e) {
      console.error('vehicle-check save error', e);
      Alert.alert('Error', 'Could not save vehicle check.');
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async () => {
    const err = validateBeforeSubmit();
    if (err) return Alert.alert('Incomplete', err);
    await save(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#C8102E" />
        <Text style={{ color: '#9e9e9e', marginTop: 10 }}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        {/* Header with Back Button */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Icon name="arrow-left" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.title}>Vehicle Defect Report</Text>
            <Text style={styles.subtitle}>
              {job ? `Job #${job.jobNumber || 'N/A'} · ${job.client || ''}` : ''}
            </Text>
          </View>
        </View>

        {/* Top fields */}
        <View style={styles.grid2}>
          <Field label="Driver’s Name">
            <TextInput value={driverName} editable={false} style={styles.input} placeholderTextColor="#8e8e8e" />
          </Field>

          <Field label="Vehicle">
            <PickerLike
              value={vehicle}
              options={vehicles.length ? vehicles : ['']}
              onChange={setVehicle}
            />
          </Field>

          <Field label="Date">
            <TextInput
              value={dateISO}
              onChangeText={setDateISO}
              placeholder="YYYY-MM-DD"
              style={styles.input}
              placeholderTextColor="#8e8e8e"
            />
          </Field>

          <Field label="Time">
            <TextInput
              value={timeStr}
              onChangeText={setTimeStr}
              placeholder="HH:MM"
              style={styles.input}
              placeholderTextColor="#8e8e8e"
            />
          </Field>

          <Field label="Odometer Reading">
            <TextInput
              value={odometer}
              onChangeText={setOdometer}
              placeholder="e.g., 123456"
              keyboardType="numeric"
              style={styles.input}
              placeholderTextColor="#8e8e8e"
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Daily Check</Text>
          {items.map((it, idx) => (
            <View key={it.i} style={styles.itemRow}>
              <Text style={styles.itemIndex}>{String(it.i).padStart(2, '0')}</Text>
              <Text style={styles.itemLabel}>{it.label}</Text>

              <TouchableOpacity
                onPress={() => setItemStatus(idx)}
                activeOpacity={0.85}
                style={[
                  styles.statusBadge,
                  it.status === STATUS.SERVICEABLE && { borderColor: '#1db954', backgroundColor: '#103d27' },
                  it.status === STATUS.DEFECT && { borderColor: '#C8102E', backgroundColor: '#3c1016' },
                  it.status === STATUS.NA && { borderColor: '#666', backgroundColor: '#222' },
                ]}
              >
                <Text style={styles.statusText}>
                  {it.status === STATUS.SERVICEABLE ? '✓' : it.status === STATUS.DEFECT ? '✗' : it.status === STATUS.NA ? '–' : 'Tap'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Defect notes */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Defect Report Here</Text>
          <Text style={{ color: '#9e9e9e', marginBottom: 6, fontSize: 12 }}>
            Record any defects / irregularities. Add a note for every item marked ✗ Defect.
          </Text>

          {/* Per-item defect notes (shown only for items marked defect) */}
          {items.map((it, idx) =>
            it.status === STATUS.DEFECT ? (
              <View key={`def-${it.i}`} style={{ marginBottom: 8 }}>
                <Text style={{ color: '#fff', fontWeight: '700', marginBottom: 4 }}>
                  {String(it.i).padStart(2, '0')} · {it.label}
                </Text>
                <TextInput
                  value={it.note}
                  onChangeText={(t) => setItemNote(idx, t)}
                  placeholder="Describe the defect, location, severity…"
                  placeholderTextColor="#8e8e8e"
                  multiline
                  style={[styles.input, { minHeight: 68 }]}
                />
              </View>
            ) : null
          )}

          {/* Overall notes */}
          <Text style={{ color: '#fff', fontWeight: '700', marginTop: 8, marginBottom: 4 }}>
            Additional Notes
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything else to report (accident damage, irregular circumstances, etc.)"
            placeholderTextColor="#8e8e8e"
            multiline
            style={[styles.input, { minHeight: 88 }]}
          />
        </View>

        {/* Photos */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Photos</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            <SmallBtn icon="image" text="Library" onPress={pickPhotos} />
            <SmallBtn icon="camera" text="Camera" onPress={takePhoto} />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {photos.map((p, idx) => (
              <View key={`${p.uri}-${idx}`} style={{ position: 'relative' }}>
                <Image source={{ uri: p.uri }} style={{ width: 86, height: 86, borderRadius: 8 }} />
                <TouchableOpacity
                  onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                  style={styles.closeChip}
                >
                  <Text style={{ color: '#fff', fontWeight: '900' }}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            {photos.length === 0 && <Text style={{ color: '#8e8e8e' }}>No photos added.</Text>}
          </View>
        </View>

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <TouchableOpacity
            onPress={() => save(false)}
            style={[styles.actionBtn, { backgroundColor: '#2E2E2E' }]}
            activeOpacity={0.85}
            disabled={saving}
          >
            <Text style={styles.actionText}>{saving ? 'Saving…' : 'Save Draft'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onSubmit}
            style={[styles.actionBtn, { backgroundColor: '#C8102E', flex: 1 }]}
            activeOpacity={0.9}
            disabled={saving}
          >
            <Text style={styles.actionText}>{saving ? 'Submitting…' : 'Submit'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- tiny UI helpers ---------- */
const Field = ({ label, children }) => (
  <View style={{ marginBottom: 10 }}>
    <Text style={{ color: '#bdbdbd', fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{label}</Text>
    {children}
  </View>
);

const PickerLike = ({ value, options, onChange }) => (
  <View style={styles.pickerLike}>
    <Text style={{ color: value ? '#fff' : '#8e8e8e', flex: 1 }}>
      {value || 'Select…'}
    </Text>
    <TouchableOpacity
      onPress={() => {
        // simple cycle through options (keeps code light). Swap for a real Picker if you prefer.
        if (!options.length) return;
        const i = Math.max(0, options.indexOf(value));
        const next = options[(i + 1) % options.length];
        onChange(next);
      }}
    >
      <Icon name="chevron-down" size={18} color="#fff" />
    </TouchableOpacity>
  </View>
);

const SmallBtn = ({ icon, text, onPress }) => (
  <TouchableOpacity onPress={onPress} style={styles.smallBtn} activeOpacity={0.85}>
    <Icon name={icon} size={14} color="#fff" />
    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{text}</Text>
  </TouchableOpacity>
);

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  backButton: {
    padding: 8,
    marginRight: 10,
  },
  headerTitleContainer: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9e9e9e',
    marginTop: 4,
  },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  input: {
    color: '#fff',
    backgroundColor: '#232323',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  pickerLike: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#232323',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  legend: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 6 },
  card: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#262626',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '800', marginBottom: 6 },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  itemIndex: { width: 26, color: '#bdbdbd', fontWeight: '700' },
  itemLabel: { flex: 1, color: '#fff' },
  statusBadge: {
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: '#141414',
    borderColor: '#333',
  },
  statusText: { color: '#fff', fontWeight: '800' },

  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#2E2E2E',
    borderRadius: 8,
  },
  closeChip: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#C8102E',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { color: '#fff', fontWeight: '800' },

  legendPill: {
    backgroundColor: '#232323',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  legendPillText: { color: '#fff', fontWeight: '700' },
});

function LegendPill({ text }) {
  return (
    <View style={styles.legendPill}>
      <Text style={styles.legendPillText}>{text}</Text>
    </View>
  );
}