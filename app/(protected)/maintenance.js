// VehicleIssuesPage.js
import { Picker } from '@react-native-picker/picker';
import { addDoc, collection, getDocs } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { db } from '../../firebaseConfig';

const MAX_CHARS = 600;

/* ------------------------- Mobile-friendly Select ------------------------- */
// Android: native <Picker mode="dialog">
// iOS: tap field -> modal bottom sheet with wheel + Done
function Select({ value, onChange, items, placeholder = 'Select…', disabled, testID }) {
  const [open, setOpen] = useState(false);
  const selectedLabel =
    items.find((i) => i.value === value)?.label || '';

  if (Platform.OS === 'android') {
    return (
      <View style={styles.pickerShellAndroid}>
        <Picker
          mode="dialog"
          enabled={!disabled}
          selectedValue={value}
          onValueChange={onChange}
          dropdownIconColor="#fff"
          style={{ color: '#fff', height: 44, width: '100%' }}
          testID={testID}
        >
          <Picker.Item label={`-- ${placeholder} --`} value="" />
          {items.map((i) => (
            <Picker.Item key={i.value} label={i.label} value={i.value} />
          ))}
        </Picker>
      </View>
    );
  }

  // iOS
  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[styles.selectField, disabled && { opacity: 0.6 }]}
        accessibilityRole="button"
        testID={testID}
      >
        <Text style={[styles.selectFieldText, !selectedLabel && { color: '#8b8b8b' }]}>
          {selectedLabel || `-- ${placeholder} --`}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetToolbar}>
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Text style={styles.doneText}>Done</Text>
            </TouchableOpacity>
          </View>
          <Picker
            selectedValue={value}
            onValueChange={(v) => onChange(v)}
            style={{ width: '100%', height: 216, backgroundColor: '#111' }}
            itemStyle={{ color: '#fff' }}
          >
            <Picker.Item label={`-- ${placeholder} --`} value="" />
            {items.map((i) => (
              <Picker.Item key={i.value} label={i.label} value={i.value} />
            ))}
          </Picker>
        </View>
      </Modal>
    </>
  );
}
/* ------------------------------------------------------------------------- */

// normalize category
const normalizeCategory = (cat) => {
  if (typeof cat !== 'string') return 'Other';
  const c = cat.trim();
  return c.length ? c : 'Other';
};

export default function VehicleIssuesPage() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [issueText, setIssueText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const normalizedVehicles = useMemo(
    () => vehicles.map((v) => ({ ...v, category: normalizeCategory(v.category) })),
    [vehicles]
  );

  const categories = useMemo(() => {
    const set = new Set(normalizedVehicles.map((v) => v.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [normalizedVehicles]);

  const filteredVehicles = useMemo(() => {
    if (!selectedCategory) return [];
    return normalizedVehicles.filter((v) => v.category === selectedCategory);
  }, [normalizedVehicles, selectedCategory]);

  const isValid = selectedCategory && selectedVehicle && issueText.trim().length > 0;
  const charCount = issueText.length;

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'vehicles'));
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setVehicles(list);
      } catch (e) {
        console.error('Error fetching vehicles:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchVehicles();
  }, []);

  // clear vehicle when category changes
  useEffect(() => {
    setSelectedVehicle('');
  }, [selectedCategory]);

  const reportIssue = async () => {
    if (!isValid) {
      Alert.alert('Missing info', 'Please complete all fields before submitting.');
      return;
    }
    try {
      setSubmitting(true);
      const vehicle = normalizedVehicles.find((v) => v.id === selectedVehicle);

      await addDoc(collection(db, 'vehicleIssues'), {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name || 'Unnamed Vehicle',
        category: vehicle.category || 'Other',
        description: issueText.trim(),
        createdAt: new Date().toISOString(),
      });

      Alert.alert('✅ Issue reported', `Thanks! We logged an issue for ${vehicle.name || 'vehicle'}.`);
      setIssueText('');
      setSelectedVehicle('');
      setSelectedCategory('');
    } catch (err) {
      console.error('Error reporting issue:', err);
      Alert.alert('❌ Error', 'Failed to report the issue. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {/* Header */}
          <View style={styles.headerWrap}>
            <Text style={styles.title}>Report Vehicle Issues</Text>
            <Text style={styles.subtitle}>Log problems quickly so the team can action them.</Text>
          </View>

          {/* Loading / Empty */}
          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#ffffff" />
              <Text style={styles.loadingText}>Loading vehicles…</Text>
            </View>
          ) : vehicles.length === 0 ? (
            <View style={styles.emptyCard}>
              <Icon name="truck" size={22} color="#9a9a9a" />
              <Text style={styles.emptyTitle}>No vehicles found</Text>
              <Text style={styles.emptyText}>Add vehicles in the admin area, then report issues here.</Text>
            </View>
          ) : (
            <>
              {/* Category */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Icon name="tag" size={16} color="#cfcfcf" />
                  <Text style={styles.cardHeaderText}>Category</Text>
                </View>

                <Select
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  placeholder="Select Category"
                  disabled={submitting}
                  items={categories.map((cat) => ({ label: cat, value: cat }))}
                  testID="category-select"
                />
              </View>

              {/* Vehicle */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Icon name="truck" size={16} color="#cfcfcf" />
                  <Text style={styles.cardHeaderText}>Vehicle</Text>
                </View>

                <Select
                  value={selectedVehicle}
                  onChange={setSelectedVehicle}
                  placeholder="Select Vehicle"
                  disabled={!selectedCategory || submitting}
                  items={filteredVehicles.map((v) => ({
                    label: v.name || 'Unnamed Vehicle',
                    value: v.id,
                  }))}
                  testID="vehicle-select"
                />

                {selectedVehicle ? (
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>
                      ID: <Text style={styles.metaValue}>{selectedVehicle}</Text>
                    </Text>
                    <Text style={styles.metaDot}>•</Text>
                    <Text style={styles.meta}>
                      Cat: <Text style={styles.metaValue}>{selectedCategory || 'Other'}</Text>
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Issue description */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Icon name="alert-triangle" size={16} color="#cfcfcf" />
                  <Text style={styles.cardHeaderText}>Describe the issue</Text>
                </View>

                <TextInput
                  editable={!!selectedVehicle && !submitting}
                  style={styles.input}
                  placeholder="e.g. Brakes squeaking above 40mph, warning light on, tyre low…"
                  placeholderTextColor="#8b8b8b"
                  multiline
                  value={issueText}
                  onChangeText={(t) => setIssueText(t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t)}
                />
                <View style={styles.counterRow}>
                  <Text style={styles.counterText}>{charCount}/{MAX_CHARS}</Text>
                </View>

                <TouchableOpacity
                  style={[styles.button, !isValid || submitting ? styles.buttonDisabled : null]}
                  onPress={reportIssue}
                  disabled={!isValid || submitting}
                  activeOpacity={0.9}
                >
                  <Text style={styles.buttonText}>{submitting ? 'Submitting…' : 'Report Issue'}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingBottom: 24 },

  headerWrap: { alignItems: 'center', marginBottom: 12 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.2, textAlign: 'center' },
  subtitle: { color: '#bdbdbd', marginTop: 6, fontSize: 13, textAlign: 'center' },

  card: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 12,
    marginTop: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  cardHeaderText: { color: '#eaeaea', fontSize: 14, fontWeight: '700' },

  // Android inline shell
  pickerShellAndroid: {
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 10,
    overflow: 'hidden',
  },

  // iOS tap field
  selectField: {
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectFieldText: { color: '#fff' },

  // iOS modal sheet
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 24,
  },
  sheetToolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  doneText: { color: '#fff', fontWeight: '700' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  meta: { color: '#bdbdbd', fontSize: 12 },
  metaValue: { color: '#fff', fontWeight: '700' },
  metaDot: { color: '#4a4a4a' },

  input: {
    backgroundColor: '#151515',
    color: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#252525',
    minHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  counterRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  counterText: { color: '#8b8b8b', fontSize: 12 },

  button: {
    backgroundColor: '#C8102E',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#C8102E',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  loadingCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 20,
    alignItems: 'center',
    marginTop: 16,
  },
  loadingText: { color: '#cfcfcf', marginTop: 10 },
  emptyCard: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f1f1f',
    padding: 20,
    alignItems: 'center',
    marginTop: 16,
    gap: 8,
  },
  emptyTitle: { color: '#fff', fontWeight: '800' },
  emptyText: { color: '#bdbdbd', textAlign: 'center' },
});
