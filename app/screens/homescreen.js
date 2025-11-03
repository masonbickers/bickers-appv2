import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Dimensions, SafeAreaView, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from 'react-native-vector-icons/Feather';
import { signOut } from 'firebase/auth';
import Footer from '../components/footer';
import { auth } from '../../firebaseConfig';


const buttons = [
  { label: 'Schedule', icon: 'calendar', group: 'Operations' },
  { label: 'Work Diary', icon: 'clipboard', group: 'Operations' },
  { label: 'Vehicle Maintenance', icon: 'settings', group: 'Operations' },
  { label: 'Employee Contacts', icon: 'users', group: 'HR' },
  { label: 'Holidays', icon: 'briefcase', group: 'HR' },
  { label: 'Time Sheet', icon: 'clock', group: 'HR' },
  { label: 'Client Contacts', icon: 'phone', group: 'Other' },
  { label: 'Job Numbers', icon: 'hash', group: 'Other' },
  { label: 'Risk Assessments', icon: 'alert-circle', group: 'Other' },
  { label: 'Insurance & Compliance', icon: 'shield', group: 'Other' },
  { label: 'Company Updates', icon: 'info', group: 'Other' },
  { label: 'Settings', icon: 'settings', group: 'Other' },
];

const screenWidth = Dimensions.get('window').width;
const numColumns = 3;
const buttonSpacing = 12;
const buttonSize = (screenWidth - (buttonSpacing * (numColumns + 1))) / numColumns;

export default function HomeScreen() {
  const router = useRouter();
  const [showAccountModal, setShowAccountModal] = useState(false);

  const groups = buttons.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/login'); // ✅ Make sure /login exists
      console.log('User signed out');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };
  
  const user = auth.currentUser;
const userName = user?.displayName || 'Unknown User';
const userEmail = user?.email || 'No email';
const userInitials = userName
  .split(' ')
  .map(name => name[0])
  .join('')
  .toUpperCase()
  .slice(0, 2);


  return (
    <SafeAreaView style={styles.container}>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <Image
              source={require('../../assets/images/bickers-action-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
         <TouchableOpacity style={styles.userIcon} onPress={() => setShowAccountModal(true)}>
            <Text style={styles.userInitials}>{userInitials}</Text>
          </TouchableOpacity>

          </View>

          {Object.entries(groups).map(([groupName, groupItems]) => (
            <View key={groupName} style={{ marginBottom: 20 }}>
              <Text style={styles.groupTitle}>{groupName}</Text>
              <View style={styles.grid}>
                {groupItems.map((btn, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[styles.button, styles.buttonColor]}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (btn.label === 'Work Diary') {
                        router.push('/work-diary');
                      } else if (btn.label === 'Employee Contacts') {
                        router.push('/contacts');
                      } else if (btn.label === 'Holidays') {
                        router.push('/holidaypage');
                      } else if (btn.label === 'Time Sheet') {
                        router.push('/timesheet');
                      }  else if (btn.label === 'Vehicle Maintenance') {
                        router.push('/maintenance');
                      }
                      
                      
                    }}
                  >
                    <Icon name={btn.icon} size={24} color="#fff" style={{ marginBottom: 6 }} />
                    <Text style={styles.buttonText}>{btn.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

                  {/* 🔥 Add red divider below each group */}
    <View style={styles.groupDivider} />
  </View>
))}
     
        </ScrollView>

        {/* ✅ Footer fixed at bottom */}
        <Footer />

        {/* Account Modal */}
        {showAccountModal && (
          <View style={styles.modalBackdrop}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>My Account</Text>
              <Text style={styles.modalDetail}>Name: {userName}</Text>
<Text style={styles.modalDetail}>Email: {userEmail}</Text>


              <TouchableOpacity style={styles.modalButton}>
                <Text style={styles.buttonText}>Edit Profile</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#f44336', marginTop: 10 }]}
                onPress={handleLogout}
              >
                <Text style={styles.buttonText}>Logout</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#505050', marginTop: 10 }]}
                onPress={() => setShowAccountModal(false)}
              >
                <Text style={styles.buttonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { paddingHorizontal: buttonSpacing, paddingTop: 20, paddingBottom: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingHorizontal: 4 },
  logo: { width: 150, height: 50 },
  userIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2E2E2E', justifyContent: 'center', alignItems: 'center' },
  userInitials: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  groupTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    marginLeft: 4,
  },
    grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    button: {
      width: buttonSize,
      height: buttonSize,
      borderRadius: 12,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: buttonSpacing,
      backgroundColor: '#2E2E2E',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 4,
    },
    
    buttonColor: { backgroundColor: '#2E2E2E' },
  buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', textAlign: 'center', paddingHorizontal: 4 },

  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#1a1a1a', padding: 20, borderRadius: 10, width: '80%' },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 12 },
  modalDetail: { color: '#ccc', fontSize: 14, marginBottom: 6 },
  modalButton: {
    backgroundColor: '#333',  // change from #2E2E2E
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  groupDivider: {
    height: 1,
    backgroundColor: '#333',
    marginTop: 6,
    borderRadius: 1,
    opacity: 0.7,
  },
  
  });
