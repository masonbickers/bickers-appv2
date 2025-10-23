// app/screens/recce-form.js

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
    View
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';

// Firebase Imports
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';

// Assuming firebaseConfig.js and global.employee are accessible
import { auth, db, storage } from '../../firebaseConfig';

/* ---------- CONSTANTS AND UTILS ---------- */

const COLORS = {
    background: '#0D0D0D',   
    card: '#1A1A1A',         
    border: '#333333',       
    textHigh: '#FFFFFF',     
    textMid: '#E0E0E0',      
    textLow: '#888888',      
    primaryAction: '#2176FF', 
    recceAction: '#FF3B30',  
    inputBg: '#2a2a2a',
    lightGray: '#4a4a4a',
};

const IMAGES_ONLY = ImagePicker?.MediaTypeOptions?.Images ?? 'Images'; // Fallback for safety

// Unique document key: bookingId__dateISO__userCode
const recceDocKey = (bookingId, dateISO, userCode) =>
    `${bookingId}__${dateISO}__${userCode || 'N/A'}`;

// Ensure URI is a file URI and resized (iOS ph:// fix)
const ensureFileUri = async (uri) => {
    if (!uri) return null;
    try {
        const manip = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 1600 } }],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
        );
        return manip?.uri || null;
    } catch {
        return uri;
    }
};

// Upload via Blob (safe across RN/Expo/Web)
const uploadFromUri = async (fileUri, storageRef) => {
    const resp = await fetch(fileUri);
    const blob = await resp.blob();

    await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(storageRef, blob, { contentType: 'image/jpeg' });
        task.on('state_changed', undefined, reject, resolve);
    });

    return getDownloadURL(storageRef);
};


/* ---------- RECIPE SCREEN COMPONENT ---------- */

export default function RecceFormScreen() {
    const router = useRouter();
    // In a real Expo Router app, params are passed directly in the URL query.
    // The previous screen needs to pass: { pathname: '/recce-form', params: { jobId: '...', dateISO: '...' } }
    const { jobId, dateISO, locationName, jobNumber } = useLocalSearchParams(); 

    const employee = global.employee;
    const initialLocationName = locationName || '';
    const initialJobNumber = jobNumber || 'N/A';

    // Recce form state (matches the structure from the original component)
    const [recceDocId, setRecceDocId] = useState(null);
    const [recceJobData, setRecceJobData] = useState(null); // Full job data once fetched
    const [reccePhotos, setReccePhotos] = useState([]); // [{ uri, remote: boolean }]
    const [saving, setSaving] = useState(false);
    const [loadingJob, setLoadingJob] = useState(true);

    const [recceForm, setRecceForm] = useState({
        lead: employee?.name || '',
        locationName: initialLocationName,
        address: '',
        parking: '', 
        access: '',
        hazards: '',
        power: '',
        measurements: '',
        recommendedKit: '',
        notes: '',
        createdAt: null,
        createdBy: employee?.userCode || 'N/A',
    });

    const updateForm = (key, value) => {
        setRecceForm(prev => ({ ...prev, [key]: value }));
    };

    /* --- Data Loading and Hydration --- */

    // 1. Fetch Job Data (since only ID/Date were passed)
    const loadJobAndForm = useCallback(async () => {
        if (!jobId || !dateISO || !employee) {
            Alert.alert("Error", "Job information is missing. Cannot load form.");
            router.back();
            return;
        }

        setLoadingJob(true);
        const creator = employee.userCode || 'N/A';
        const key = recceDocKey(jobId, dateISO, creator);
        setRecceDocId(key);

        try {
            // Fetch the Job (Booking) details
            const jobSnap = await getDoc(doc(db, 'bookings', jobId));
            const jobData = jobSnap.exists() ? { id: jobSnap.id, ...jobSnap.data() } : null;
            if (!jobData) {
                 Alert.alert("Error", "Job data not found.");
                 router.back();
                 return;
            }
            setRecceJobData(jobData);

            // Fetch the existing Recce Form data
            const recceSnap = await getDoc(doc(db, 'recces', key));
            
            if (recceSnap.exists()) {
                const data = recceSnap.data();
                const a = data?.answers || {};
                const existingUrls = Array.isArray(a.photos) ? a.photos :
                                     (Array.isArray(data?.photos) ? data.photos : []);

                setRecceForm(prev => ({
                    ...prev,
                    lead: a.lead || employee?.name || prev.lead,
                    locationName: a.locationName || jobData?.location || prev.locationName,
                    address: a.address || '',
                    parking: a.parking || '',
                    access: a.access || '',
                    hazards: a.hazards || '',
                    power: a.power || '',
                    measurements: a.measurements || '',
                    recommendedKit: a.recommendedKit || '',
                    notes: a.notes || '',
                    createdAt: a.createdAt || data.createdAt,
                }));

                // Map remote URLs to photo state
                setReccePhotos(existingUrls.map(u => ({ uri: u, remote: true })));

            } else {
                // Initialize new form
                setRecceForm(prev => ({
                    ...prev,
                    lead: employee?.name || prev.lead,
                    locationName: jobData?.location || prev.locationName,
                    createdAt: new Date().toISOString(),
                }));
                setReccePhotos([]);
            }
        } catch (e) {
            console.error('Error loading job or form:', e);
            Alert.alert("Load Error", "Failed to load form data.");
            router.back();
        } finally {
            setLoadingJob(false);
        }
    }, [jobId, dateISO, employee, router]);

    useEffect(() => {
        loadJobAndForm();
    }, [loadJobAndForm]);


    /* --- Photo Management --- */

    const ensureMediaPerms = async (type) => {
        if (Platform.OS === 'web') return;
        const { status } = type === 'camera' 
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();

        if (status !== 'granted') {
            Alert.alert("Permission Required", `Permission to access ${type} is required to continue.`);
            throw new Error(`Permission to access ${type} is required.`);
        }
    };

    const handlePickPhotos = async () => {
        try {
            await ensureMediaPerms('photos');
            const res = await ImagePicker.launchImageLibraryAsync({
                allowsMultipleSelection: true,
                selectionLimit: 8 - reccePhotos.length, // Limit based on current photos
                mediaTypes: IMAGES_ONLY,
                quality: 1, 
            });
            
            if (res.canceled) return;

            const assets = res.assets ?? [];
            setReccePhotos(prev =>
                [...prev, ...assets.map(a => ({ uri: a.uri, remote: false }))].slice(0, 8)
            );
        } catch (e) {
            console.error('Photo pick failed:', e);
        }
    };

    const handleTakePhoto = async () => {
        try {
            await ensureMediaPerms('camera');
            const res = await ImagePicker.launchCameraAsync({
                mediaTypes: IMAGES_ONLY,
                quality: 1,
            });
            
            if (res.canceled) return;

            const a = res.assets?.[0];
            if (a) {
                setReccePhotos(prev =>
                    [...prev, { uri: a.uri, remote: false }].slice(0, 8)
                );
            }
        } catch (e) {
            console.error('Camera failed:', e);
        }
    };

    const removePhoto = (index) => {
        setReccePhotos(prev => prev.filter((_, i) => i !== index));
    };

    const uploadPhotos = async (photosToUpload) => {
        const urls = [];
        const uid = auth.currentUser?.uid || 'public';

        for (let i = 0; i < photosToUpload.length; i++) {
            const item = photosToUpload[i];
            const fileUri = await ensureFileUri(item.uri);
            if (!fileUri) continue;

            const filename = `${Date.now()}_${i}.jpg`;
            const path = `recces/${jobId}/${dateISO}/${uid}/${filename}`;
            const r = ref(storage, path);

            try {
                const url = await uploadFromUri(fileUri, r);
                urls.push(url);
            } catch (e) {
                console.error(`Failed to upload photo ${i}:`, e);
                // Continue to the next photo
            }
        }
        return urls;
    };


    /* --- Submission Logic --- */

    const handleSubmit = async () => {
        if (saving || loadingJob || !jobId || !dateISO || !recceDocId || !recceJobData) return;

        setSaving(true);
        try {
            // Separate photos to keep vs photos to upload
            const keepUrls = reccePhotos
                .filter(p => p.remote || (p.uri || '').startsWith('http'))
                .map(p => p.uri);

            const newLocals = reccePhotos
                .filter(p => !p.remote && !(p.uri || '').startsWith('http'));

            const uploaded = await uploadPhotos(newLocals);
            const finalPhotos = [...keepUrls, ...uploaded];

            const payload = {
                ...recceForm,
                photos: finalPhotos,
                createdAt: recceForm.createdAt || new Date().toISOString(),
                createdBy: employee?.userCode || 'N/A',
                dateISO: dateISO,
                // Add job details for context
                bookingId: jobId,
                jobNumber: recceJobData.jobNumber || null,
                client: recceJobData.client || null,
            };

            // 1. Merge form answers into the main booking document
            await setDoc(
                doc(db, 'bookings', jobId),
                { recceForms: { [dateISO]: payload } },
                { merge: true }
            );

            // 2. Upsert single recce doc at stable id (for easier querying)
            await setDoc(
                doc(db, 'recces', recceDocId),
                {
                    bookingId: jobId,
                    jobNumber: recceJobData.jobNumber || null,
                    client: recceJobData.client || null,
                    dateISO: dateISO,
                    status: 'submitted',
                    answers: payload,
                    photos: finalPhotos,
                    createdAt: recceForm.createdAt ? recceForm.createdAt : serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    createdBy: employee?.userCode || 'N/A',
                },
                { merge: true }
            );

            Alert.alert("Success 🎉", "Recce form submitted successfully!");
            router.back(); 

        } catch (e) {
            console.error('Error saving recce form:', e);
            Alert.alert("Save Error", "Failed to save the Recce form. Please check your connection and try again.");
        } finally {
            setSaving(false);
        }
    };


    /* --- Render --- */

    if (loadingJob) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={COLORS.recceAction} />
                    <Text style={styles.loadingText}>Loading Recce Form...</Text>
                </View>
            </SafeAreaView>
        );
    }
    
    // Helper component for a consistent input field
    const InputField = ({ label, value, onChangeText, multiline = false, keyboardType = 'default' }) => (
        <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>{label}</Text>
            <TextInput
                style={[styles.input, multiline && styles.inputMultiline]}
                value={value}
                onChangeText={onChangeText}
                placeholder={`Enter ${label.toLowerCase()}`}
                placeholderTextColor={COLORS.textLow}
                multiline={multiline}
                numberOfLines={multiline ? 4 : 1}
                keyboardType={keyboardType}
            />
        </View>
    );

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={router.back} style={styles.backButton} disabled={saving}>
                    <Icon name="arrow-left" size={24} color={COLORS.textHigh} />
                </TouchableOpacity>
                <Text style={styles.pageTitle}>Recce Form</Text>
            </View>
            
            <ScrollView contentContainerStyle={styles.scrollContent}>
                
                {/* Job Info Card */}
                <View style={styles.infoCard}>
                    <Text style={styles.infoTextTitle}>Job #{initialJobNumber}</Text>
                    <Text style={styles.infoTextDetail}>{recceJobData?.client || 'N/A Production'}</Text>
                    <Text style={styles.infoTextDetail}>Recce Date: {dateISO}</Text>
                    <Text style={styles.infoTextDetail}>Lead: {employee?.name || 'N/A'}</Text>
                </View>

                {/* --- Form Fields --- */}
                <InputField 
                    label="Recce Lead" 
                    value={recceForm.lead} 
                    onChangeText={(text) => updateForm('lead', text)}
                />
                <InputField 
                    label="Location Name" 
                    value={recceForm.locationName} 
                    onChangeText={(text) => updateForm('locationName', text)}
                />
                <InputField 
                    label="Address / Postcode" 
                    value={recceForm.address} 
                    onChangeText={(text) => updateForm('address', text)}
                />
                
                {/* Section Divider */}
                <View style={styles.sectionDivider}>
                    <Text style={styles.sectionTitle}>Logistics & Safety</Text>
                </View>

                <InputField 
                    label="Parking / Access" 
                    value={recceForm.parking} 
                    onChangeText={(text) => updateForm('parking', text)}
                    multiline
                />
                <InputField 
                    label="Hazards / Risk Notes" 
                    value={recceForm.hazards} 
                    onChangeText={(text) => updateForm('hazards', text)}
                    multiline
                />
                <InputField 
                    label="Site Access Details" 
                    value={recceForm.access} 
                    onChangeText={(text) => updateForm('access', text)}
                    multiline
                />
                <InputField 
                    label="Power / Generator" 
                    value={recceForm.power} 
                    onChangeText={(text) => updateForm('power', text)}
                />
                
                {/* Section Divider */}
                <View style={styles.sectionDivider}>
                    <Text style={styles.sectionTitle}>Equipment & Notes</Text>
                </View>

                <InputField 
                    label="Measurements / Specs" 
                    value={recceForm.measurements} 
                    onChangeText={(text) => updateForm('measurements', text)}
                    multiline
                />
                <InputField 
                    label="Recommended Kit" 
                    value={recceForm.recommendedKit} 
                    onChangeText={(text) => updateForm('recommendedKit', text)}
                    multiline
                />
                <InputField 
                    label="General Notes" 
                    value={recceForm.notes} 
                    onChangeText={(text) => updateForm('notes', text)}
                    multiline
                />

                {/* Photo Management */}
                <View style={styles.photoContainer}>
                    <Text style={styles.photoTitle}>Photos ({reccePhotos.length}/8)</Text>
                    
                    <View style={styles.photoActions}>
                        <TouchableOpacity style={styles.photoActionButton} onPress={handleTakePhoto} disabled={reccePhotos.length >= 8 || saving}>
                            <Icon name="camera" size={20} color={COLORS.textHigh} />
                            <Text style={styles.photoActionText}>Take Photo</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.photoActionButton} onPress={handlePickPhotos} disabled={reccePhotos.length >= 8 || saving}>
                            <Icon name="image" size={20} color={COLORS.textHigh} />
                            <Text style={styles.photoActionText}>Pick from Library</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.photoGrid}>
                        {reccePhotos.map((photo, index) => (
                            <View key={index} style={styles.photoWrapper}>
                                <Image source={{ uri: photo.uri }} style={styles.photoThumbnail} />
                                <TouchableOpacity 
                                    style={styles.deleteButton} 
                                    onPress={() => removePhoto(index)}
                                    disabled={saving}
                                >
                                    <Icon name="x" size={16} color={COLORS.textHigh} />
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                </View>


                {/* Submit Button */}
                <TouchableOpacity 
                    style={[styles.submitButton, saving && styles.submitButtonDisabled]} 
                    onPress={handleSubmit}
                    disabled={saving}
                >
                    {saving ? (
                        <ActivityIndicator color={COLORS.textHigh} />
                    ) : (
                        <Text style={styles.submitButtonText}>Submit Recce Form</Text>
                    )}
                </TouchableOpacity>

                <View style={{ height: 40 }} />
            </ScrollView>
        </SafeAreaView>
    );
}


/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        color: COLORS.textMid,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    backButton: {
        paddingRight: 10,
    },
    pageTitle: {
        color: COLORS.textHigh,
        fontSize: 22,
        fontWeight: '800',
    },
    scrollContent: {
        padding: 16,
    },
    infoCard: {
        backgroundColor: COLORS.card,
        padding: 15,
        borderRadius: 10,
        marginBottom: 20,
        borderLeftWidth: 4,
        borderLeftColor: COLORS.recceAction,
    },
    infoTextTitle: {
        color: COLORS.textHigh,
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 5,
    },
    infoTextDetail: {
        color: COLORS.textMid,
        fontSize: 14,
    },
    sectionDivider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 15,
    },
    sectionTitle: {
        color: COLORS.textHigh,
        fontSize: 16,
        fontWeight: '700',
        paddingRight: 10,
    },
    inputGroup: {
        marginBottom: 15,
    },
    inputLabel: {
        color: COLORS.textMid,
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 5,
    },
    input: {
        backgroundColor: COLORS.inputBg,
        color: COLORS.textHigh,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        fontSize: 16,
        borderWidth: 1,
        borderColor: COLORS.lightGray,
    },
    inputMultiline: {
        height: 100,
        textAlignVertical: 'top',
        paddingTop: 10,
    },
    photoContainer: {
        marginTop: 15,
        marginBottom: 20,
    },
    photoTitle: {
        color: COLORS.textHigh,
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 10,
    },
    photoActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 15,
    },
    photoActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.lightGray,
        padding: 10,
        borderRadius: 8,
        flex: 1,
        marginHorizontal: 5,
        justifyContent: 'center',
    },
    photoActionText: {
        color: COLORS.textHigh,
        marginLeft: 8,
        fontWeight: '600',
    },
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    photoWrapper: {
        width: 80, 
        height: 80, 
        borderRadius: 8,
        overflow: 'hidden',
        position: 'relative',
        marginBottom: 10,
    },
    photoThumbnail: {
        width: '100%',
        height: '100%',
    },
    deleteButton: {
        position: 'absolute',
        top: 5,
        right: 5,
        backgroundColor: COLORS.recceAction,
        borderRadius: 15,
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 10,
    },
    submitButton: {
        backgroundColor: COLORS.recceAction,
        padding: 15,
        borderRadius: 10,
        alignItems: 'center',
        marginTop: 20,
    },
    submitButtonDisabled: {
        backgroundColor: COLORS.lightGray,
    },
    submitButtonText: {
        color: COLORS.textHigh,
        fontSize: 18,
        fontWeight: '800',
    },
});