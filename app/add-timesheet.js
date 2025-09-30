import { useNavigation } from '@react-navigation/native';
import { addDoc, collection, getFirestore } from 'firebase/firestore';
import { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DropDownPicker from 'react-native-dropdown-picker';
import Footer from './components/footer';



const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const timeOptions = [];
for (let h = 0; h < 24; h++) {
  for (let m = 0; m < 60; m += 15) {
    const hour = String(h).padStart(2, '0');
    const min = String(m).padStart(2, '0');
    timeOptions.push({ label: `${hour}:${min}`, value: `${hour}:${min}` });
  }
}

export default function TimesheetPage() {
  const [weekData, setWeekData] = useState(
    daysOfWeek.reduce((acc, day) => {
      acc[day] = {
        type: 'Yard',
        times: {},
        nightSupervisor: false,
        lunch: false,
        overnight: false,
        saturdaySupervisor: false,
        sundaySupervisor: false,
        notes: '',
      };
      return acc;
    }, {})
  );

  const [openDropdowns, setOpenDropdowns] = useState({});

  const handleChange = (day, field, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        times: {
          ...prev[day].times,
          [field]: value,
        },
      },
    }));
  };

  const handleToggle = (day, field, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        [field]: value,
      },
    }));
  };

  const handleNotesChange = (day, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        notes: value,
      },
    }));
  };

  const handleTypeChange = (day, value) => {
    setWeekData((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        type: value,
        times: {},
        nightSupervisor: false,
      },
    }));
  };
  const navigation = useNavigation();


  const getFilteredTimes = (previousValue, allowFullDay = false) => {
    if (!previousValue || allowFullDay) return timeOptions;
    return timeOptions.filter((t) => t.value > previousValue);
  };

  const [showPreview, setShowPreview] = useState(false);
  const db = getFirestore(app);
  const [submittedMessage, setSubmittedMessage] = useState('');

  const submitTimesheetToFirebase = async () => {
    try {
      await addDoc(collection(db, 'timesheets'), {
        weekData,
        submittedAt: new Date().toISOString(),
      });
      setSubmittedMessage('✅ Timesheet submitted for approval!');
      setShowPreview(false);
      // Optionally reset form:
      // setWeekData(initial empty state)
    } catch (error) {
      console.error('Error submitting timesheet:', error);
      setSubmittedMessage('❌ Error submitting timesheet, please try again.');
      setShowPreview(false);
    }
  };
  
  

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
      {submittedMessage ? (
  <View style={styles.submittedBanner}>
    <Text style={styles.submittedBannerText}>{submittedMessage}</Text>
  </View>
) : null}


        <Text style={styles.header}>Weekly Timesheet</Text>

        {daysOfWeek.map((day, dayIndex) => (
          <View key={day} style={styles.dayCard}>
            <Text style={styles.dayTitle}>{day}</Text>

            {/* Type */}
            <View style={[styles.fieldBlock, { zIndex: 5000 - dayIndex * 10 }]}>
              <Text style={styles.label}>Type:</Text>
              <DropDownPicker
                open={openDropdowns[`${day}_type`] || false}
                value={weekData[day].type}
                items={[
                  { label: 'Yard', value: 'Yard' },
                  { label: 'On Set', value: 'On Set' },
                ]}
                setOpen={(open) =>
                  setOpenDropdowns((prev) => ({ ...prev, [`${day}_type`]: open }))
                }
                setValue={(callback) => handleTypeChange(day, callback())}
                placeholder="Select Type"
                style={styles.dropdown}
                dropDownContainerStyle={styles.dropdownContainer}
                textStyle={styles.dropdownText}
              />
            </View>

            {/* Time Pickers */}
            {weekData[day].type === 'Yard'
              ? ['startTime', 'endTime'].map((field, idx) => {
                  const startTime = weekData[day].times['startTime'];
                  const filteredTimes =
                    field === 'endTime' && startTime
                      ? getFilteredTimes(startTime)
                      : timeOptions;

                  return (
                    <View key={field} style={[styles.fieldBlock, { zIndex: 5000 - dayIndex * 10 - idx - 1 }]}>
                      <Text style={styles.label}>
                        {field === 'startTime' ? 'Start Time:' : 'End Time:'}
                      </Text>
                      <DropDownPicker
                        open={openDropdowns[`${day}_${field}`] || false}
                        value={weekData[day].times[field]}
                        items={filteredTimes}
                        setOpen={(open) =>
                          setOpenDropdowns((prev) => ({
                            ...prev,
                            [`${day}_${field}`]: open,
                          }))
                        }
                        setValue={(callback) => handleChange(day, field, callback())}
                        placeholder="Select Time"
                        style={styles.dropdown}
                        dropDownContainerStyle={styles.dropdownContainer}
                        textStyle={styles.dropdownText}
                      />
                    </View>
                  );
                })
              : ['leaveTime', 'arriveOnSet', 'preCall', 'callTime', 'wrapTime', 'arriveBack'].map(
                  (field, idx, arr) => {
                    const previousField = arr[idx - 1];
                    const previousValue = previousField ? weekData[day].times[previousField] : null;
                    const allowFullDay = field === 'wrapTime' || field === 'arriveBack';
                    const filteredTimes = getFilteredTimes(previousValue, allowFullDay);
                    

                    const labelMap = {
                      leaveTime: 'Leave Time:',
                      arriveOnSet: 'Arrive On Set:',
                      preCall: 'Pre-Call:',
                      callTime: 'Call Time:',
                      wrapTime: 'Wrap Time:',
                      arriveBack: 'Arrive Back at Yard:',
                    };

                    return (
                      <View key={field} style={[styles.fieldBlock, { zIndex: 5000 - dayIndex * 10 - idx - 1 }]}>
                        <Text style={styles.label}>{labelMap[field]}</Text>
                        <DropDownPicker
                          open={openDropdowns[`${day}_${field}`] || false}
                          value={weekData[day].times[field]}
                          items={filteredTimes}
                          setOpen={(open) =>
                            setOpenDropdowns((prev) => ({
                              ...prev,
                              [`${day}_${field}`]: open,
                            }))
                          }
                          setValue={(callback) => handleChange(day, field, callback())}
                          placeholder="Select Time"
                          style={styles.dropdown}
                          dropDownContainerStyle={styles.dropdownContainer}
                          textStyle={styles.dropdownText}
                        />
                      </View>
                    );
                  }
                )}

            {/* Toggles */}
            {weekData[day].type === 'On Set' && (
              <>
                

                <View style={styles.switchRow}>
                  <Text style={styles.label}>Lunch:</Text>
                  <Switch
                    value={weekData[day].lunch}
                    onValueChange={(value) => handleToggle(day, 'lunch', value)}
                  />
                </View>
                <View style={styles.switchRow}>
                  <Text style={styles.label}>Overnight:</Text>
                  <Switch
                    value={weekData[day].overnight}
                    onValueChange={(value) => handleToggle(day, 'overnight', value)}
                  />
                </View>
                {day === 'Saturday' && (
                  <View style={styles.switchRow}>
                    <Text style={styles.label}>Saturday Supervisor:</Text>
                    <Switch
                      value={weekData[day].saturdaySupervisor}
                      onValueChange={(value) => handleToggle(day, 'saturdaySupervisor', value)}
                    />
                  </View>
                )}

                {day === 'Sunday' && (
                  <View style={styles.switchRow}>
                    <Text style={styles.label}>Sunday Supervisor:</Text>
                    <Switch
                      value={weekData[day].sundaySupervisor}
                      onValueChange={(value) => handleToggle(day, 'sundaySupervisor', value)}
                    />
                  </View>
                )}
              </>
            )}
            {/* Separation line */}
                <View style={styles.divider} />

            {/* Notes */}
            <View style={styles.fieldBlock}>
              <Text style={styles.label}>Notes:</Text>
              <TextInput
                style={styles.notesInput}
                value={weekData[day].notes}
                onChangeText={(text) => handleNotesChange(day, text)}
                placeholder="Enter notes..."
                placeholderTextColor="#888"
                multiline
              />
            </View>
          </View>
        ))}

<TouchableOpacity
  style={styles.confirmButton}
  onPress={submitTimesheetToFirebase}
>
  <Text style={styles.confirmButtonText}>Confirm & Send</Text>
</TouchableOpacity>


      <View style={styles.previewContainer}>
  <Text style={styles.previewHeader}>Preview Timesheet</Text>
  <ScrollView>
    {daysOfWeek.map((day) => (
      <View key={day} style={styles.previewCard}>
        <Text style={styles.previewDay}>{day}</Text>
        <Text style={styles.previewText}>Type: {weekData[day].type}</Text>
        {Object.entries(weekData[day].times).map(([field, value]) => (
          <Text key={field} style={styles.previewText}>
            {field}: {value || '—'}
          </Text>
        ))}
        <Text style={styles.previewText}>Night Supervisor: {weekData[day].nightSupervisor ? 'Yes' : 'No'}</Text>
        <Text style={styles.previewText}>Lunch: {weekData[day].lunch ? 'Yes' : 'No'}</Text>
        <Text style={styles.previewText}>Overnight: {weekData[day].overnight ? 'Yes' : 'No'}</Text>
        {day === 'Saturday' && (
          <Text style={styles.previewText}>Saturday Supervisor: {weekData[day].saturdaySupervisor ? 'Yes' : 'No'}</Text>
        )}
        {day === 'Sunday' && (
          <Text style={styles.previewText}>Sunday Supervisor: {weekData[day].sundaySupervisor ? 'Yes' : 'No'}</Text>
        )}
        <Text style={styles.previewText}>Notes: {weekData[day].notes || '—'}</Text>
      </View>
    ))}
  </ScrollView>

  <TouchableOpacity
    style={styles.confirmButton}
    onPress={async () => {
        await submitTimesheetToFirebase();
        navigation.navigate('Timesheet'); // <- use your screen name here
    }}
      
  >
    <Text style={styles.confirmButtonText}>Confirm & Send</Text>
  </TouchableOpacity>

  <TouchableOpacity style={styles.backButton} onPress={() => setShowPreview(false)}>
    <Text style={styles.backButtonText}>Back to Edit</Text>
  </TouchableOpacity>
</View>

      </ScrollView>
      <Footer />


      
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 20, paddingBottom: 100, overflow: 'visible' },
  header: {
    color: '#fff',
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  dayCard: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderRadius: 10,
    marginBottom: 20,
  },
  dayTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  fieldBlock: {
    marginBottom: 14,
  },
  label: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 6,
  },
  dropdown: {
    backgroundColor: '#2e2e2e',
    borderColor: '#444',
  },
  dropdownContainer: {
    backgroundColor: '#2e2e2e',
    borderColor: '#444',
  },
  dropdownText: {
    color: '#fff',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  notesInput: {
    backgroundColor: '#2e2e2e',
    color: '#fff',
    borderRadius: 6,
    padding: 8,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitButton: {
    backgroundColor: '#C8102E',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 30,
    marginBottom: 20,
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 12,
  },
  previewContainer: {
    flex: 1,
    padding: 20,
  },
  previewHeader: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  previewCard: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  previewDay: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  previewText: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 2,
  },
  confirmButton: {
    backgroundColor: '#28a745',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  confirmButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  backButton: {
    backgroundColor: '#6c757d',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  
  submittedBanner: {
    backgroundColor: '#28a745',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  submittedBannerText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: 'bold',
  },
  
});
