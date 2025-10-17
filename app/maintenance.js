import { Picker } from '@react-native-picker/picker';
import { addDoc, collection, getDocs } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { db } from '../firebaseConfig';

const MAX_CHARS = 600;

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

                <View
                  style={[
                    styles.pickerShell,
                    Platform.OS === 'android' && { overflow: 'visible' }, // <-- important
                  ]}
                >
                  <Picker
                    // Use dialog on Android to avoid clipping/overlap issues
                    mode={Platform.OS === 'android' ? 'dialog' : 'dropdown'}
                    selectedValue={selectedCategory}
                    onValueChange={(value) => setSelectedCategory(value)}
                    dropdownIconColor={Platform.OS === 'android' ? '#fff' : undefined}
                    style={styles.picker}
                    itemStyle={Platform.OS === 'ios' ? styles.pickerItemIOS : undefined}
                    enabled={!submitting}
                  >
                    <Picker.Item label="-- Select Category --" value="" />
                    {categories.map((cat) => (
                      <Picker.Item key={cat} label={cat} value={cat} />
                    ))}
                  </Picker>
                </View>
              </View>

              {/* Vehicle */}
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Icon name="truck" size={16} color="#cfcfcf" />
                  <Text style={styles.cardHeaderText}>Vehicle</Text>
                </View>

                <View
                  style={[
                    styles.pickerShell,
                    Platform.OS === 'android' && { overflow: 'visible' }, // <-- important
                    !selectedCategory && { opacity: 0.6 },
                  ]}
                >
                  <Picker
                    mode={Platform.OS === 'android' ? 'dialog' : 'dropdown'}
                    enabled={!!selectedCategory && !submitting}
                    selectedValue={selectedVehicle}
                    onValueChange={(value) => setSelectedVehicle(value)}
                    dropdownIconColor={Platform.OS === 'android' ? '#fff' : undefined}
                    style={styles.picker}
                    itemStyle={Platform.OS === 'ios' ? styles.pickerItemIOS : undefined}
                  >
                    <Picker.Item label="-- Select Vehicle --" value="" />
                    {filteredVehicles.map((v) => (
                      <Picker.Item key={v.id} label={v.name || 'Unnamed Vehicle'} value={v.id} />
                    ))}
                  </Picker>
                </View>

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

  pickerShell: {
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#252525',
    borderRadius: 10,
    // NOTE: on Android we set overflow: 'visible' inline where used
    overflow: 'hidden',
  },
  picker: { color: '#fff', height: 44, width: '100%' },
  pickerItemIOS: { color: '#fff' },

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
