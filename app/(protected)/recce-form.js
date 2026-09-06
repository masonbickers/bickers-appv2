import { AppText as Text, AppPressable as TouchableOpacity, FormField, TextArea } from "../../components/ui/AppPrimitives";
// app/screens/recce-form.js

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  useLocalSearchParams,
  useRouter } from "expo-router";
import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

// Firebase Imports
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";

import { auth, db, storage } from "../../firebaseConfig";
import { isBookingVisibleToEmployee } from "../../lib/bookingVisibility";
import { formatDateDDMMYYYY } from "../../lib/dateFormat";
import { useAuth } from "../../providers/AuthProvider";
import { useDataCache } from "../../providers/DataCacheProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";

/* ---------- CONSTANTS AND UTILS ---------- */

const COLORS = {
  background: staticColors.hex_0d0d0d_af235e,
  card: staticColors.hex_1a1a1a_8nhjiu,
  border: staticColors.hex_333333_8y2gva,
  textHigh: staticColors.hex_ffffff_5c2ocm,
  textMid: staticColors.hex_e0e0e0_5lga4z,
  textLow: staticColors.hex_888888_dds7pi,
  primaryAction: staticColors.hex_2176ff_71kvdw,
  recceAction: staticColors.hex_ed1c25_4py4qa,
  inputBg: staticColors.hex_2a2a2a_631aj9,
  lightGray: staticColors.hex_4a4a4a_7aurwz,
};

const IMAGES_ONLY = ImagePicker?.MediaTypeOptions?.Images ?? "Images"; // Fallback for safety

// Unique document key: bookingId__dateISO__userCode
const recceDocKey = (bookingId, dateISO, userCode) =>
  `${bookingId}__${dateISO}__${userCode || "N/A"}`;

const recceDraftKey = (bookingId, dateISO, userCode) =>
  `recceDraft:${recceDocKey(bookingId, dateISO, userCode)}`;

const normaliseParam = (value) =>
  Array.isArray(value) ? String(value[0] || "") : String(value || "");

const createLocation = (locationName = "") => ({
  id: `location-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  locationName,
  address: "",
  parking: "",
  access: "",
  hazards: "",
  power: "",
  measurements: "",
  recommendedKit: "",
  notes: "",
  photos: [],
});

const normaliseLocation = (location, fallbackName = "") => ({
  ...createLocation(),
  ...location,
  id: location?.id || createLocation().id,
  locationName: location?.locationName || fallbackName,
  photos: Array.isArray(location?.photos)
    ? location.photos.map((photo) =>
        typeof photo === "string" ? { uri: photo, remote: true } : photo
      )
    : [],
});

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
    const task = uploadBytesResumable(storageRef, blob, {
      contentType: "image/jpeg",
    });
    task.on("state_changed", undefined, reject, resolve);
  });

  return getDownloadURL(storageRef);
};

function RecceInputField({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = "default",
}) {
  return (
    <View style={styles.inputGroup}>
      {multiline ? (
        <TextArea label={label} value={value} onChangeText={onChangeText} placeholder={`Enter ${label.toLowerCase()}`} />
      ) : (
        <FormField
          label={label}
          value={value}
          onChangeText={onChangeText}
          placeholder={`Enter ${label.toLowerCase()}`}
          inputProps={{ keyboardType }}
        />
      )}
    </View>
  );
}

/* ---------- RECCE SCREEN COMPONENT ---------- */

export default function RecceFormScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { employee: authEmployee, user } = useAuth();
  const { invalidate } = useDataCache();

  // In a real Expo Router app, params are passed directly in the URL query.
  // { pathname: '/recce-form', params: { jobId: '...', dateISO: '...' } }
  const params = useLocalSearchParams();
  const jobId = normaliseParam(params.jobId);
  const dateISO = normaliseParam(params.dateISO);
  const locationName = normaliseParam(params.locationName);
  const jobNumber = normaliseParam(params.jobNumber);

  const employee = authEmployee; // replaces global.employee
  const signedInName =
    employee?.name || employee?.displayName || user?.displayName || "";
  const initialLocationName = locationName || "";
  const initialJobNumber = jobNumber || "N/A";

  const [recceDocId, setRecceDocId] = useState(null);
  const [recceJobData, setRecceJobData] = useState(null); // Full job data once fetched
  const [locations, setLocations] = useState(() => [createLocation(initialLocationName)]);
  const [activeLocationIndex, setActiveLocationIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingJob, setLoadingJob] = useState(true);
  const [draftReady, setDraftReady] = useState(false);
  const draftDisabledRef = useRef(false);

  const localDraftKey = useMemo(
    () =>
      jobId && dateISO && employee
        ? recceDraftKey(jobId, dateISO, employee.userCode || "N/A")
        : "",
    [dateISO, employee, jobId]
  );

  const [recceForm, setRecceForm] = useState({
    lead: signedInName,
    createdAt: null,
    createdBy: employee?.userCode || "N/A",
  });

  const activeLocation = locations[activeLocationIndex] || locations[0];

  const updateForm = (key, value) => {
    setRecceForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateLocation = (key, value) => {
    setLocations((current) =>
      current.map((location, index) =>
        index === activeLocationIndex ? { ...location, [key]: value } : location
      )
    );
  };

  const addLocation = () => {
    const nextIndex = locations.length;
    setLocations((current) => [...current, createLocation()]);
    setActiveLocationIndex(nextIndex);
  };

  const removeActiveLocation = () => {
    if (locations.length <= 1) return;
    const label = activeLocation?.locationName || `Location ${activeLocationIndex + 1}`;
    Alert.alert("Remove location?", `${label} and its unsaved details will be removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          setLocations((current) => current.filter((_, index) => index !== activeLocationIndex));
          setActiveLocationIndex((current) => Math.max(0, current - 1));
        },
      },
    ]);
  };

  /* --- Data Loading and Hydration --- */

  const loadJobAndForm = useCallback(async () => {
    if (!jobId || !dateISO || !employee) {
      Alert.alert("Error", "Job information is missing. Cannot load form.");
      router.back();
      return;
    }

    setLoadingJob(true);
    const creator = employee.userCode || "N/A";
    const key = recceDocKey(jobId, dateISO, creator);
    setRecceDocId(key);

    try {
      // Fetch the Job (Booking) details
      const jobSnap = await getDoc(doc(db, "bookings", jobId));
      const jobData = jobSnap.exists()
        ? { id: jobSnap.id, ...jobSnap.data() }
        : null;
      if (!jobData) {
        Alert.alert("Error", "Job data not found.");
        router.back();
        return;
      }
      if (!isBookingVisibleToEmployee(jobData, employee)) {
        Alert.alert(
          "Booking unavailable",
          "This booking is not currently published to your employee app."
        );
        router.back();
        return;
      }
      setRecceJobData(jobData);

      // Fetch the existing Recce Form data
      const recceSnap = await getDoc(doc(db, "recces", key));

      if (recceSnap.exists()) {
        const data = recceSnap.data();
        const a = data?.answers || {};
        const existingUrls = Array.isArray(a.photos)
          ? a.photos
          : Array.isArray(data?.photos)
          ? data.photos
          : [];

        setRecceForm((prev) => ({
          ...prev,
          lead: a.lead || signedInName || prev.lead,
          createdAt: a.createdAt || data.createdAt,
        }));
        const storedLocations = Array.isArray(a.locations) && a.locations.length
          ? a.locations
          : [
              {
                locationName: a.locationName || jobData?.location || initialLocationName,
                address: a.address || "",
                parking: a.parking || "",
                access: a.access || "",
                hazards: a.hazards || "",
                power: a.power || "",
                measurements: a.measurements || "",
                recommendedKit: a.recommendedKit || "",
                notes: a.notes || "",
                photos: existingUrls,
              },
            ];
        setLocations(
          storedLocations.map((location, index) =>
            normaliseLocation(
              location,
              index === 0 ? jobData?.location || initialLocationName : ""
            )
          )
        );
        setActiveLocationIndex(0);
      } else {
        // Initialize new form
        setRecceForm((prev) => ({
          ...prev,
          lead: signedInName || prev.lead,
          createdAt: new Date().toISOString(),
        }));
        setLocations([createLocation(jobData?.location || initialLocationName)]);
        setActiveLocationIndex(0);
      }

      const storedDraft = localDraftKey
        ? await AsyncStorage.getItem(localDraftKey)
        : null;
      if (storedDraft) {
        try {
          const draft = JSON.parse(storedDraft);
          if (draft?.form && typeof draft.form === "object") {
            setRecceForm((current) => ({
              ...current,
              ...draft.form,
              lead: draft.form.lead?.trim() || signedInName || current.lead,
            }));
          }
          if (Array.isArray(draft?.locations) && draft.locations.length) {
            setLocations(draft.locations.map((location) => normaliseLocation(location)));
            setActiveLocationIndex(
              Math.min(
                Math.max(Number(draft.activeLocationIndex) || 0, 0),
                draft.locations.length - 1
              )
            );
          } else if (draft?.form && typeof draft.form === "object") {
            setLocations([
              normaliseLocation({
                ...draft.form,
                photos: Array.isArray(draft.photos) ? draft.photos : [],
              }),
            ]);
            setActiveLocationIndex(0);
          }
        } catch (draftError) {
          console.warn("Could not restore recce draft:", draftError);
        }
      }
    } catch (e) {
      console.error("Error loading job or form:", e);
      Alert.alert("Load Error", "Failed to load form data.");
      router.back();
    } finally {
      setDraftReady(true);
      setLoadingJob(false);
    }
  }, [jobId, dateISO, employee, initialLocationName, localDraftKey, router, signedInName]);

  useEffect(() => {
    loadJobAndForm();
  }, [loadJobAndForm]);

  useEffect(() => {
    if (!draftReady || loadingJob || saving || !localDraftKey) return undefined;

    const serializedDraft = JSON.stringify({
      form: recceForm,
      locations,
      activeLocationIndex,
      savedAt: new Date().toISOString(),
    });
    const saveDraft = () => {
      if (draftDisabledRef.current) return;
      AsyncStorage.setItem(localDraftKey, serializedDraft).catch((error) =>
        console.warn("Could not save recce draft:", error)
      );
    };
    const timer = setTimeout(saveDraft, 350);

    return () => {
      clearTimeout(timer);
      saveDraft();
    };
  }, [
    activeLocationIndex,
    draftReady,
    loadingJob,
    localDraftKey,
    locations,
    recceForm,
    saving,
  ]);

  /* --- Photo Management --- */

  const ensureMediaPerms = async () => {
    if (Platform.OS === "web") return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (status !== "granted") {
      Alert.alert(
        "Permission Required",
        "Permission to access photos is required to continue."
      );
      throw new Error("Permission to access photos is required.");
    }
  };

  const handlePickPhotos = async () => {
    try {
      await ensureMediaPerms();
      const res = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        selectionLimit: 8 - (activeLocation?.photos?.length || 0),
        mediaTypes: IMAGES_ONLY,
        quality: 1,
      });

      if (res.canceled) return;

      const assets = res.assets ?? [];
      updateLocation(
        "photos",
        [
          ...(activeLocation?.photos || []),
          ...assets.map((asset) => ({ uri: asset.uri, remote: false })),
        ].slice(0, 8)
      );
    } catch (e) {
      console.error("Photo pick failed:", e);
    }
  };

  const removePhoto = (index) => {
    updateLocation(
      "photos",
      (activeLocation?.photos || []).filter((_, photoIndex) => photoIndex !== index)
    );
  };

  const uploadPhotos = async (photosToUpload, locationId) => {
    const urls = [];
    const uid = auth.currentUser?.uid || "public";

    for (let i = 0; i < photosToUpload.length; i++) {
      const item = photosToUpload[i];
      const fileUri = await ensureFileUri(item.uri);
      if (!fileUri) continue;

      const filename = `${Date.now()}_${i}.jpg`;
      const path = `recces/${jobId}/${dateISO}/${uid}/${locationId}/${filename}`;
      const r = ref(storage, path);

      try {
        const url = await uploadFromUri(fileUri, r);
        urls.push(url);
      } catch (e) {
        console.error(`Failed to upload photo ${i}:`, e);
        throw new Error(`Photo ${i + 1} could not be uploaded.`);
      }
    }
    return urls;
  };

  /* --- Submission Logic --- */

  const handleSubmit = async () => {
    if (
      saving ||
      loadingJob ||
      !jobId ||
      !dateISO ||
      !recceDocId ||
      !recceJobData
    )
      return;

    const unnamedLocationIndex = locations.findIndex(
      (location) => !location.locationName?.trim()
    );
    if (unnamedLocationIndex >= 0) {
      setActiveLocationIndex(unnamedLocationIndex);
      Alert.alert(
        "Location name required",
        `Add a name for location ${unnamedLocationIndex + 1} before submitting.`
      );
      return;
    }

    setSaving(true);
    try {
      const submittedLocations = [];
      for (const location of locations) {
        const locationPhotos = Array.isArray(location.photos) ? location.photos : [];
        const keepUrls = locationPhotos
          .filter((photo) => photo.remote || (photo.uri || "").startsWith("http"))
          .map((photo) => photo.uri);
        const newLocals = locationPhotos.filter(
          (photo) => !photo.remote && !(photo.uri || "").startsWith("http")
        );
        const uploaded = await uploadPhotos(newLocals, location.id);
        submittedLocations.push({
          ...location,
          photos: [...keepUrls, ...uploaded],
        });
      }

      const primaryLocation = submittedLocations[0];
      const allPhotos = submittedLocations.flatMap((location) => location.photos);

      const payload = {
        ...recceForm,
        ...primaryLocation,
        locations: submittedLocations,
        locationCount: submittedLocations.length,
        photos: primaryLocation.photos,
        createdAt: recceForm.createdAt || new Date().toISOString(),
        createdBy: employee?.userCode || "N/A",
        dateISO: dateISO,
        bookingId: jobId,
        jobNumber: recceJobData.jobNumber || null,
        client: recceJobData.client || null,
      };

      // 1. Merge form answers into the main booking document
      await setDoc(
        doc(db, "bookings", jobId),
        { recceForms: { [dateISO]: payload } },
        { merge: true }
      );

      // 2. Upsert single recce doc at stable id (for easier querying)
      await setDoc(
        doc(db, "recces", recceDocId),
        {
          bookingId: jobId,
          jobNumber: recceJobData.jobNumber || null,
          client: recceJobData.client || null,
          dateISO: dateISO,
          status: "submitted",
          answers: payload,
          photos: allPhotos,
          createdAt: recceForm.createdAt
            ? recceForm.createdAt
            : serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: employee?.userCode || "N/A",
        },
        { merge: true }
      );
      await invalidate("collection:bookings");
      draftDisabledRef.current = true;
      setDraftReady(false);
      if (localDraftKey) await AsyncStorage.removeItem(localDraftKey);

      Alert.alert("Success 🎉", "Recce form submitted successfully!");
      router.back();
    } catch (e) {
      console.error("Error saving recce form:", e);
      Alert.alert(
        "Save Error",
        "Failed to save the Recce form. Please check your connection and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  /* --- Render --- */

  if (loadingJob) {
    return (
      <PageShell mode="form" width="form" header={{ variant: "compact", title: "Recce Form", onBack: router.back }}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.recceAction} />
          <Text
            style={[
              styles.loadingText,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Loading Recce Form...
          </Text>
        </View>
      </PageShell>
    );
  }

  return (
    <PageShell mode="form" width="form" header={{ variant: "compact", title: "Recce Form", onBack: saving ? () => {} : router.back }}>

        {/* Job Info Card */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderLeftColor: COLORS.recceAction,
            },
          ]}
        >
          <Text
            style={[
              styles.infoTextTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Job #{initialJobNumber}
          </Text>
          <Text
            style={[
              styles.infoTextDetail,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            {recceJobData?.client || "N/A Production"}
          </Text>
          <Text
            style={[
              styles.infoTextDetail,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Recce Date: {formatDateDDMMYYYY(dateISO) || dateISO}
          </Text>
          <Text
            style={[
              styles.infoTextDetail,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Completed by: {recceForm.lead || signedInName || "N/A"}
          </Text>
        </View>

        {/* --- Form Fields --- */}
        <RecceInputField
          label="Completed by"
          value={recceForm.lead}
          onChangeText={(text) => updateForm("lead", text)}
        />
        <View style={styles.locationHeader}>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text || COLORS.textHigh }]}>
              Locations
            </Text>
            <Text style={[styles.locationCount, { color: colors.textMuted || COLORS.textMid }]}>
              {locations.length} location{locations.length === 1 ? "" : "s"} in this recce
            </Text>
          </View>
          <TouchableOpacity
            onPress={addLocation}
            style={[styles.addLocationButton, { borderColor: colors.accent }]}
            disabled={saving}
          >
            <Icon name="plus" size={15} color={colors.accent} />
            <Text style={[styles.addLocationText, { color: colors.accent }]}>Add location</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.locationTabs}
          keyboardShouldPersistTaps="handled"
        >
          {locations.map((location, index) => {
            const selected = index === activeLocationIndex;
            return (
              <TouchableOpacity
                key={location.id}
                onPress={() => setActiveLocationIndex(index)}
                style={[
                  styles.locationTab,
                  {
                    backgroundColor: selected ? colors.accent : colors.surfaceAlt,
                    borderColor: selected ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text
                  style={[styles.locationTabText, { color: selected ? staticColors.hex_fff_yhjmu8 : colors.text }]}
                  numberOfLines={1}
                >
                  {location.locationName?.trim() || `Location ${index + 1}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {locations.length > 1 ? (
          <TouchableOpacity onPress={removeActiveLocation} style={styles.removeLocationButton}>
            <Icon name="trash-2" size={13} color={colors.danger} />
            <Text style={[styles.removeLocationText, { color: colors.danger }]}>Remove this location</Text>
          </TouchableOpacity>
        ) : null}
        <RecceInputField
          label="Location Name"
          value={activeLocation?.locationName || ""}
          onChangeText={(text) => updateLocation("locationName", text)}
        />
        <RecceInputField
          label="Address / Postcode"
          value={activeLocation?.address || ""}
          onChangeText={(text) => updateLocation("address", text)}
        />

        {/* Section Divider */}
        <View style={styles.sectionDivider}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Logistics & Safety
          </Text>
        </View>

        <RecceInputField
          label="Parking / Access"
          value={activeLocation?.parking || ""}
          onChangeText={(text) => updateLocation("parking", text)}
          multiline
        />
        <RecceInputField
          label="Hazards / Risk Notes"
          value={activeLocation?.hazards || ""}
          onChangeText={(text) => updateLocation("hazards", text)}
          multiline
        />
        <RecceInputField
          label="Site Access Details"
          value={activeLocation?.access || ""}
          onChangeText={(text) => updateLocation("access", text)}
          multiline
        />
        <RecceInputField
          label="Power / Generator"
          value={activeLocation?.power || ""}
          onChangeText={(text) => updateLocation("power", text)}
        />

        {/* Section Divider */}
        <View style={styles.sectionDivider}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Equipment & Notes
          </Text>
        </View>

        <RecceInputField
          label="Measurements / Specs"
          value={activeLocation?.measurements || ""}
          onChangeText={(text) => updateLocation("measurements", text)}
          multiline
        />
        <RecceInputField
          label="Recommended Kit"
          value={activeLocation?.recommendedKit || ""}
          onChangeText={(text) => updateLocation("recommendedKit", text)}
          multiline
        />
        <RecceInputField
          label="General Notes"
          value={activeLocation?.notes || ""}
          onChangeText={(text) => updateLocation("notes", text)}
          multiline
        />

        {/* Photo Management */}
        <View style={styles.photoContainer}>
          <Text
            style={[
              styles.photoTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Photos for this location ({activeLocation?.photos?.length || 0}/8)
          </Text>

          <View style={styles.photoActions}>
            <TouchableOpacity
              style={[
                styles.photoActionButton,
                {
                  backgroundColor: colors.surfaceAlt || COLORS.lightGray,
                },
              ]}
              onPress={handlePickPhotos}
              disabled={(activeLocation?.photos?.length || 0) >= 8 || saving}
            >
              <Icon
                name="image"
                size={20}
                color={colors.text || COLORS.textHigh}
              />
              <Text
                style={[
                  styles.photoActionText,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Pick from Library
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.photoGrid}>
            {(activeLocation?.photos || []).map((photo, index) => (
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
          style={[
            styles.submitButton,
            saving && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={COLORS.textHigh} />
          ) : (
            <Text style={styles.submitButtonText}>Submit Recce Form</Text>
          )}
        </TouchableOpacity>

    </PageShell>
  );
}

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: t.spacing.xs,
    color: COLORS.textMid,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  pageTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingBottom: t.spacing["2xl"],
  },
  infoCard: {
    backgroundColor: COLORS.card,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    marginBottom: t.spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.recceAction,
  },
  infoTextTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "700",
    marginBottom: t.spacing.xxs,
  },
  infoTextDetail: {
    color: COLORS.textMid,
    fontSize: t.typography.body.fontSize,
  },
  sectionDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: t.spacing.md,
  },
  sectionTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    paddingRight: t.spacing.xs,
  },
  locationHeader: {
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.sm,
  },
  locationCount: { marginTop: t.spacing.none, fontSize: t.typography.metadata.fontSize, fontWeight: "600" },
  addLocationButton: {
    minHeight: 38,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  addLocationText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  locationTabs: { gap: t.spacing.xs, paddingBottom: t.spacing.xs },
  locationTab: {
    maxWidth: 180,
    minHeight: 38,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  locationTabText: { fontSize: t.typography.metadata.fontSize, fontWeight: "800" },
  removeLocationButton: {
    alignSelf: "flex-end",
    paddingHorizontal: t.spacing.xxs,
    paddingVertical: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xxs,
  },
  removeLocationText: { fontSize: t.typography.caption.fontSize, fontWeight: "700" },
  inputGroup: {
    marginBottom: t.spacing.md,
  },
  inputLabel: {
    color: COLORS.textMid,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "600",
    marginBottom: t.spacing.xxs,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    color: COLORS.textHigh,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.sm,
    fontSize: t.typography.bodyLarge.fontSize,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
  },
  inputMultiline: {
    height: 100,
    textAlignVertical: "top",
    paddingTop: t.spacing.xs,
  },
  photoContainer: {
    marginTop: t.spacing.md,
    marginBottom: t.spacing.lg,
  },
  photoTitle: {
    color: COLORS.textHigh,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    marginBottom: t.spacing.xs,
  },
  photoActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: t.spacing.md,
  },
  photoActionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.lightGray,
    padding: t.spacing.xs,
    borderRadius: t.radius.sm,
    flex: 1,
    marginHorizontal: t.spacing.xxs,
    justifyContent: "center",
  },
  photoActionText: {
    color: COLORS.textHigh,
    marginLeft: t.spacing.xs,
    fontWeight: "600",
  },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  },
  photoWrapper: {
    width: 80,
    height: 80,
    borderRadius: t.radius.sm,
    overflow: "hidden",
    position: "relative",
    marginBottom: t.spacing.xs,
  },
  photoThumbnail: {
    width: "100%",
    height: "100%",
  },
  deleteButton: {
    position: "absolute",
    top: 5,
    right: 5,
    backgroundColor: COLORS.recceAction,
    borderRadius: t.radius.lg,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  submitButton: {
    backgroundColor: COLORS.recceAction,
    padding: t.spacing.md,
    borderRadius: t.radius.md,
    alignItems: "center",
    marginTop: t.spacing.lg,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.lightGray,
  },
  submitButtonText: {
    color: COLORS.textHigh,
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
  },
});
