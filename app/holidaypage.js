import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView } from 'react-native';
import { collection, getDocs, addDoc, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebaseConfig';
import Footer from './components/footer';  // ✅ make sure this path is correct

export default function HolidayPage() {
  const user = auth.currentUser;
  const [userData, setUserData] = useState(null);
  const [holidays, setHolidays] = useState([]);

  useEffect(() => {
    fetchUserData();
    fetchHolidays();
  }, []);

  const fetchUserData = async () => {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      setUserData(userSnap.data());
    }
  };

  const fetchHolidays = async () => {
    const snapshot = await getDocs(collection(db, 'holidays'));
    const userHolidays = snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(h => h.userId === user.uid);
    setHolidays(userHolidays);
  };

  const bookHoliday = async (startDate, endDate, type) => {
    await addDoc(collection(db, 'holidays'), {
      userId: user.uid,
      startDate,
      endDate,
      type,
    });

    if (type === 'paid') {
      const updatedUsed = (userData.holidaysUsed || 0) + 1;
      await updateDoc(doc(db, 'users', user.uid), {
        holidaysUsed: updatedUsed,
      });
    }

    fetchUserData();
    fetchHolidays();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.header}>My Holidays</Text>

          {userData && (
            <View style={styles.summary}>
              <Text style={styles.summaryText}>Allowance: {userData.holidayAllowance} days</Text>
              <Text style={styles.summaryText}>Used: {userData.holidaysUsed} days</Text>
              <Text style={styles.summaryText}>Remaining: {userData.holidayAllowance - userData.holidaysUsed} days</Text>
            </View>
          )}

          <Text style={styles.subHeader}>Booked Holidays:</Text>
          {holidays.length === 0 ? (
            <Text style={{ color: '#888', textAlign: 'center', marginTop: 12 }}>No holidays booked.</Text>
          ) : (
            holidays.map(h => (
              <View key={h.id} style={styles.holidayCard}>
                <Text style={styles.holidayText}>
                  {h.startDate} → {h.endDate} ({h.type})
                </Text>
              </View>
            ))
          )}

          <TouchableOpacity
            style={styles.bookButton}
            onPress={() => {
              // TODO: open modal or navigate to booking form
            }}
          >
            <Text style={styles.bookButtonText}>+ Book New Holiday</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ✅ Footer fixed at bottom */}
        <Footer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingBottom: 80 },  // extra space for footer
  header: { color: '#fff', fontSize: 24, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' },
  summary: { marginBottom: 20 },
  summaryText: { color: '#fff', fontSize: 16, marginBottom: 4 },
  subHeader: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  holidayCard: { backgroundColor: '#1a1a1a', padding: 10, borderRadius: 6, marginBottom: 8 },
  holidayText: { color: '#ccc' },
  bookButton: { backgroundColor: '#C8102E', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 20 },
  bookButtonText: { color: '#fff', fontWeight: 'bold' },
});
