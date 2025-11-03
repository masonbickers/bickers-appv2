import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity
} from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { useRouter } from 'expo-router';
import { db, auth } from '../firebaseConfig';
import Footer from './components/footer';

export default function TimeSheetHomePage() {
  const [timesheets, setTimesheets] = useState([]);
  const router = useRouter();

  useEffect(() => {
    fetchTimeSheets();
  }, []);

  const fetchTimeSheets = async () => {
    const user = auth.currentUser;
    if (!user) {
      console.warn('No user logged in');
      return;
    }

    try {
      const q = query(collection(db, 'timesheets'), where('uid', '==', user.uid));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
      setTimesheets(data);
    } catch (error) {
      console.error('Error fetching timesheets:', error);
    }
  };

  const getTotalHours = (hoursObj) => {
    return Object.values(hoursObj)
      .reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>My Timesheets</Text>

        {timesheets.length === 0 ? (
          <Text style={styles.noData}>No timesheets submitted yet.</Text>
        ) : (
          timesheets.map(sheet => (
            <View key={sheet.id} style={styles.card}>
              <Text style={styles.week}>Week of: {sheet.week}</Text>
              <Text style={styles.hours}>Total Hours: {getTotalHours(sheet.hours)}</Text>
              <Text style={styles.status}>Status: {sheet.status || 'Submitted'}</Text>
            </View>
          ))
        )}

        {/* ✅ Buttons Section */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/add-timesheet')}
          >
            <Text style={styles.addButtonText}>+ Add Timesheet</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/timesheet-details')}
          >
            <Text style={styles.secondaryButtonText}>View Details</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ✅ Footer fixed at bottom */}
      <Footer />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingBottom: 100 },
  header: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  card: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  week: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hours: { color: '#ccc', fontSize: 14, marginTop: 4 },
  status: { color: '#ccc', fontSize: 14, marginTop: 4 },
  noData: { color: '#888', textAlign: 'center', marginTop: 20 },

  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  addButton: {
    backgroundColor: '#C8102E',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    marginRight: 8,
    alignItems: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  secondaryButton: {
    backgroundColor: '#444',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    marginLeft: 8,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
