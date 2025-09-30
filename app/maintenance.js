import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { addDoc, collection, getDocs } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import Footer from './components/footer';
import { db } from './firebaseConfig';

export default function VehicleIssuesPage() {
  const router = useRouter();

  const [vehicles, setVehicles] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedCategory, setSelectedCategory] = useState('');
  const [filteredVehicles, setFilteredVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [issueText, setIssueText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const fetchVehicles = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'vehicles'));
        const vehicleList = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

        setVehicles(vehicleList);

        const cats = [...new Set(vehicleList.map((v) => v.category || 'Other'))];
        setCategories(cats);
      } catch (error) {
        console.error('Error fetching vehicles:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchVehicles();
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      const filtered = vehicles.filter((v) => v.category === selectedCategory);
      setFilteredVehicles(filtered);
      setSelectedVehicle('');
    }
  }, [selectedCategory, vehicles]);

  const reportIssue = async () => {
    if (!selectedCategory) {
      Alert.alert('Error', 'Please select a category.');
      return;
    }
    if (!selectedVehicle) {
      Alert.alert('Error', 'Please select a vehicle.');
      return;
    }
    if (!issueText.trim()) {
      Alert.alert('Error', 'Please enter an issue.');
      return;
    }

    try {
      setSubmitting(true);
      const vehicle = vehicles.find((v) => v.id === selectedVehicle);

      await addDoc(collection(db, 'vehicleIssues'), {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name || 'Unnamed Vehicle',
        category: vehicle.category || 'Other',
        description: issueText.trim(),
        createdAt: new Date().toISOString(),
      });

      Alert.alert('✅ Success', `Issue reported for ${vehicle.name || 'vehicle'}`);
      setIssueText('');
      setSelectedVehicle('');
      setSelectedCategory('');
    } catch (err) {
      console.error('Error reporting issue:', err);
      Alert.alert('❌ Error', 'Failed to report issue. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}> {/* ✅ fixes content being cut off */}
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Back button */}
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Icon name="arrow-left" size={22} color="#fff" />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <Text style={styles.header}>Report Vehicle Issues</Text>

          {loading ? (
            <ActivityIndicator size="large" color="#fff" style={{ marginTop: 20 }} />
          ) : vehicles.length === 0 ? (
            <Text style={styles.noItems}>No vehicles available</Text>
          ) : (
            <>
              {/* Category dropdown */}
              <Text style={styles.label}>Select Category:</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={selectedCategory}
                  dropdownIconColor="#fff"
                  style={styles.picker}
                  onValueChange={(value) => setSelectedCategory(value)}
                >
                  <Picker.Item label="-- Select Category --" value="" />
                  {categories.map((cat, idx) => (
                    <Picker.Item key={idx} label={cat} value={cat} />
                  ))}
                </Picker>
              </View>

              {/* Vehicle dropdown */}
              {selectedCategory !== '' && (
                <>
                  <Text style={styles.label}>Select Vehicle:</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={selectedVehicle}
                      dropdownIconColor="#fff"
                      style={styles.picker}
                      onValueChange={(value) => setSelectedVehicle(value)}
                    >
                      <Picker.Item label="-- Select Vehicle --" value="" />
                      {filteredVehicles.map((v) => (
                        <Picker.Item
                          key={v.id}
                          label={v.name || 'Unnamed Vehicle'}
                          value={v.id}
                        />
                      ))}
                    </Picker>
                  </View>
                </>
              )}

              {/* Issue text */}
              {selectedVehicle !== '' && (
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Describe the issue..."
                    placeholderTextColor="#888"
                    multiline
                    value={issueText}
                    onChangeText={setIssueText}
                  />

                  <TouchableOpacity
                    style={styles.button}
                    onPress={reportIssue}
                    disabled={submitting}
                  >
                    <Text style={styles.buttonText}>
                      {submitting ? 'Submitting...' : 'Report Issue'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </ScrollView>

        <Footer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' }, // ✅ stops content being cut off
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 20, paddingBottom: 100 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 6,
  },
  header: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  noItems: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 20,
  },
  label: { color: '#fff', marginBottom: 8, fontSize: 16 },
  pickerContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    marginBottom: 16,
  },
  picker: { color: '#fff' },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 6,
    padding: 8,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#007bff',
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
