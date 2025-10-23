// app/screens/job-day.js (or app/job-day.js)
// A focused "Jobs by Day" page with prev/next day, Vehicle Check, and Recce actions.

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
// Import 'Timestamp' if you're using it for dates in Firestore; using `query` is key for efficiency.
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebaseConfig';

/* ---------- Constants and Utils (Moved to separate files in a real app) ---------- */

// --- MODERN DARK THEME COLORS ---
const COLORS = {
    background: '#0D0D0D',   // Deep background
    card: '#1A1A1A',         // Card surface, slightly lighter
    border: '#333333',       // Subtle separation line
    textHigh: '#FFFFFF',     // Main text
    textMid: '#E0E0E0',      // Detail text
    textLow: '#888888',      // Label/Subdued text
    primaryAction: '#2176FF', // Vehicle Check (a friendly blue)
    recceAction: '#FF3B30',  // Recce (a warning red)
    callTime: '#FFD60A',     // Yellow for high-alert data
};

// Use a consistent date format function.
const toISO = (d) => d.toISOString().split('T')[0];

const DAY_FORMAT_LONG = { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' };
const DAY_FORMAT_SHORT = { weekday: 'long', day: '2-digit', month: 'short' };

/**
 * Normalizes call time retrieval across different potential field names.
 */
const getCallTime = (job, dateISO) => {
    const byDate = 
        job.callTimes?.[dateISO] || 
        job.callTimeByDate?.[dateISO] || 
        job.call_times?.[dateISO];

    const single = job.callTime || job.calltime || job.call_time;

    const fromNotes =
        job.notesByDate?.[`${dateISO}-callTime`] ||
        job.notesByDate?.[dateISO]?.callTime;

    return byDate || single || fromNotes || null;
};

/**
 * Gets a day-specific note, falling back to a general note.
 */
const getDayNote = (job, dateISO) => {
    const v = job?.notesByDate?.[dateISO];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof job?.notes === 'string' && job.notes.trim()) return job.notes.trim();
    return null;
};

// Use a more robust check for a specific, common tag.
const isRecceDay = (job, dateISO) => {
    const note = getDayNote(job, dateISO);
    // Use \b for word boundaries to prevent matching "not recce day"
    return /\b(recce\s*day)\b/i.test(note || ''); 
};

/* ---------- Components (For better readability) ---------- */

/**
 * Reusable component for displaying a single job's details.
 */
const JobCard = ({ job, dateISO, router }) => {
    const callTime = useMemo(() => getCallTime(job, dateISO), [job, dateISO]);
    const note = useMemo(() => getDayNote(job, dateISO), [job, dateISO]);
    const recce = useMemo(() => isRecceDay(job, dateISO), [job, dateISO]);

    const handleActionPress = (pathname) => {
        router.push({
            pathname,
            params: { jobId: job.id, dateISO },
        });
    };

    return (
        <View key={job.id} style={styles.jobCard}>
            <View style={styles.titleRow}>
                <Text style={styles.jobTitle}>JOB #{job.jobNumber || 'N/A'}</Text>
                {callTime ? (
                     <View style={styles.callBadge}>
                        <Icon name="clock" size={12} color={COLORS.card} style={{ marginRight: 4 }} />
                        <Text style={styles.callBadgeText}>{callTime}</Text>
                    </View>
                ) : null}
            </View>
            
            <View style={styles.detailsContainer}>
                {job.client && (
                    <Text style={styles.jobLine}>
                        <Text style={styles.jobLabel}>Production:</Text> {job.client}
                    </Text>
                )}
                {job.location && (
                    <Text style={styles.jobLine}>
                        <Text style={styles.jobLabel}>Location:</Text> {job.location}
                    </Text>
                )}
                {job.vehicles?.length > 0 && (
                    <Text style={styles.jobLine}>
                        <Text style={styles.jobLabel}>Vehicles:</Text> {job.vehicles.join(', ')}
                    </Text>
                )}
                {job.employees?.length > 0 && (
                    <Text style={styles.jobLine}>
                        <Text style={styles.jobLabel}>Crew:</Text>
                        {job.employees.map((e) => e.name || e).join(', ')}
                    </Text>
                )}
            </View>

            {note && (
                <View style={styles.noteBox}>
                    <Icon name="message-square" size={14} color={COLORS.textHigh} style={{ marginRight: 8 }} />
                    <Text style={styles.noteText}>
                         <Text style={styles.jobLabel}>Day Note:</Text> {note}
                    </Text>
                </View>
            )}

            {/* Actions */}
            <View style={styles.actionsRow}>
                {/* Vehicle Check */}
                <TouchableOpacity
                    style={[styles.actionBtn, styles.actionCheck]}
                    activeOpacity={0.8}
                    onPress={() => handleActionPress('/vehicle-check')}
                >
                    <Icon name="truck" size={16} color={COLORS.textHigh} />
                    <Text style={styles.actionText}>Vehicle Check</Text>
                </TouchableOpacity>

                {/* Recce Form (visible only if it's a Recce Day) */}
                {recce && (
                    <TouchableOpacity
                        style={[styles.actionBtn, styles.actionRecce]}
                        activeOpacity={0.8}
                        onPress={() => handleActionPress('/recce')}
                    >
                        <Icon name="map-pin" size={16} color={COLORS.textHigh} />
                        <Text style={styles.actionText}>Recce Form</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
};


/* ---------- Screen ---------- */
export default function JobDayScreen() {
    const router = useRouter();
    const employee = global.employee; 

    const [selectedDate, setSelectedDate] = useState(() => new Date());
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false); 

    const dateISO = useMemo(() => toISO(selectedDate), [selectedDate]);

    const loadAllEmployees = useCallback(async () => {
        const empSnap = await getDocs(collection(db, 'employees'));
        return empSnap.docs.map((d) => d.data());
    }, []);

    const loadJobs = useCallback(async () => {
        if (!employee) return;
        setLoading(true);

        try {
            const allEmployees = await loadAllEmployees();

            const jobsQuery = query(
                collection(db, 'bookings'),
                where('bookingDates', 'array-contains', dateISO)
            );
            const jobsSnap = await getDocs(jobsQuery);
            let allJobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

            const todaysJobs = allJobs
                .map((job) => {
                    const codes = (job.employees || [])
                        .map((emp) => {
                            if (emp?.userCode) return emp.userCode;
                            const found = allEmployees.find((e) => e.name === emp?.name);
                            return found ? found.userCode : null;
                        })
                        .filter(Boolean);
                    
                    return { ...job, employeeCodes: codes };
                })
                .filter((j) => j.employeeCodes.includes(employee.userCode));
            
            setJobs(todaysJobs);

        } catch (error) {
            console.error("Error loading jobs:", error);
            setJobs([]);
        } finally {
            setLoading(false);
        }
    }, [employee, dateISO, loadAllEmployees]);

    useEffect(() => {
        loadJobs();
    }, [loadJobs]);

    const goPrevDay = () => {
        setSelectedDate((d) => {
            const nd = new Date(d);
            nd.setUTCDate(nd.getUTCDate() - 1);
            return nd;
        });
    };

    const goNextDay = () => {
        setSelectedDate((d) => {
            const nd = new Date(d);
            nd.setUTCDate(nd.getUTCDate() + 1);
            return nd;
        });
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Daily Schedule</Text>
                <Text style={styles.headerDate}>
                    {selectedDate.toLocaleDateString('en-GB', DAY_FORMAT_LONG)}
                </Text>
            </View>

            {/* Day Nav */}
            <View style={styles.dayHeader}>
                <TouchableOpacity onPress={goPrevDay} disabled={loading} style={styles.dayNavButton}>
                    <Icon name="chevron-left" size={24} color={loading ? COLORS.textLow : COLORS.textHigh} />
                </TouchableOpacity>
                <Text style={styles.dayTitle}>
                    {selectedDate.toLocaleDateString('en-GB', DAY_FORMAT_SHORT)}
                </Text>
                <TouchableOpacity onPress={goNextDay} disabled={loading} style={styles.dayNavButton}>
                    <Icon name="chevron-right" size={24} color={loading ? COLORS.textLow : COLORS.textHigh} />
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollViewContent}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={loadJobs} tintColor={COLORS.textHigh} />}
            >
                {loading && jobs.length === 0 ? (
                    <View style={styles.loadingWrap}>
                        <ActivityIndicator size="large" color={COLORS.primaryAction} />
                    </View>
                ) : jobs.length === 0 ? (
                    <View style={styles.emptyWrap}>
                         <Icon name="calendar" size={30} color={COLORS.textLow} style={{ marginBottom: 10 }}/>
                        <Text style={styles.emptyText}>No assigned jobs on this date.</Text>
                    </View>
                ) : (
                    jobs.map((job) => (
                        <JobCard 
                            key={job.id} 
                            job={job} 
                            dateISO={dateISO} 
                            router={router} 
                        />
                    ))
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

/* ---------- Styles ---------- */
const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    
    // Header
    header: { 
        paddingHorizontal: 16, 
        paddingTop: Platform.OS === 'android' ? 24 : 12,
        paddingBottom: 8 
    },
    headerTitle: { color: COLORS.textHigh, fontSize: 24, fontWeight: '900' },
    headerDate: { color: COLORS.textLow, fontSize: 13, marginTop: 4 },

    // Day Navigation
    dayHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        marginBottom: 8, // Added margin below the separator
    },
    dayNavButton: { padding: 4 }, // Increased touch area
    dayTitle: { color: COLORS.textHigh, fontSize: 18, fontWeight: '700' },

    // ScrollView
    scrollViewContent: { padding: 16, paddingBottom: 40 },

    // Job Card
    jobCard: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        // Added subtle shadow for lift
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 8,
    },
    titleRow: { 
        flexDirection: 'row', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        paddingBottom: 12, 
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
    },
    jobTitle: { 
        color: COLORS.textHigh, 
        fontSize: 18, 
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    callBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.callTime, // High-visibility yellow
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 10,
    },
    callBadgeText: {
        color: COLORS.card, // Dark text on yellow for contrast
        fontWeight: '800',
        fontSize: 13,
    },
    
    detailsContainer: {
        paddingTop: 10,
        marginBottom: 10,
    },
    jobLine: { color: COLORS.textMid, fontSize: 14, marginBottom: 4 },
    jobLabel: { 
        color: COLORS.textLow, 
        fontWeight: '600', 
        marginRight: 4, 
    },

    // Day Note Styling - Separated and highlighted
    noteBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: COLORS.border, // Darker contrast for note background
        padding: 10,
        borderRadius: 8,
        marginBottom: 15,
        borderLeftWidth: 4,
        borderLeftColor: COLORS.primaryAction, // Highlight with action color
    },
    noteText: {
        color: COLORS.textMid,
        fontSize: 14,
        flexShrink: 1, // Allows text to wrap
    },

    // Actions
    actionsRow: { 
        flexDirection: 'row', 
        flexWrap: 'wrap', 
        gap: 12, 
        marginTop: 10 
    },
    actionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12, 
        paddingHorizontal: 16,
        borderRadius: 10,
        flex: 1,
        minWidth: 150, 
    },
    actionCheck: { 
        backgroundColor: COLORS.primaryAction, 
        borderWidth: 0 // Solid background
    },
    actionRecce: { 
        backgroundColor: COLORS.recceAction, // Danger/Alert color
    },
    actionText: { 
        color: COLORS.textHigh, 
        fontWeight: '700', 
        fontSize: 14 
    },

    // Empty/Loading State
    emptyWrap: { 
        padding: 40, 
        alignItems: 'center', 
        backgroundColor: COLORS.card,
        borderRadius: 12,
        marginTop: 10
    },
    emptyText: { color: COLORS.textLow, fontSize: 15, fontWeight: '500' },
    loadingWrap: { padding: 30, alignItems: 'center' },
});