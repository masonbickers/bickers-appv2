// app/(protected)/service/defect-form.jsx
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Icon from "react-native-vector-icons/Feather";

import {
    arrayUnion,
    collection,
    doc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "../../../firebaseConfig";
import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  inputBg: "#1F1F1F",
  primaryAction: "#ED1C25",
  pillBg: "#262626",
};

function isDownloadUrl(uri) {
  return typeof uri === "string" && /^https?:\/\//i.test(uri);
}

function sanitizeStorageSegment(value) {
  return String(value || "item")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

async function ensureUploadableImageUri(uri) {
  if (!uri || isDownloadUrl(uri)) return uri;

  try {
    const manip = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1600 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
    );
    return manip?.uri || uri;
  } catch {
    return uri;
  }
}

async function uploadImageUri(uri, path) {
  if (isDownloadUrl(uri)) return uri;

  const uploadableUri = await ensureUploadableImageUri(uri);
  const response = await fetch(uploadableUri);
  if (!response.ok) {
    throw new Error("Could not read selected photo for upload.");
  }

  const blob = await response.blob();
  const storageRef = ref(storage, path);

  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, {
      contentType: blob.type || "image/jpeg",
    });
    task.on("state_changed", undefined, reject, resolve);
  });

  return getDownloadURL(storageRef);
}

async function uploadPhotoList(uris, basePath) {
  const uploaded = [];
  const photoUris = Array.isArray(uris) ? uris.filter(Boolean) : [];

  for (const [index, uri] of photoUris.entries()) {
    if (isDownloadUrl(uri)) {
      uploaded.push(uri);
      continue;
    }

    const filename = `${Date.now()}-${index}.jpg`;
    uploaded.push(await uploadImageUri(uri, `${basePath}/${filename}`));
  }

  return uploaded;
}

export default function DefectFormScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const params = useLocalSearchParams();
  const allowLeaveRef = useRef(false);

  const initialVehicleName = params.vehicleName || params.name || "";
  const initialReg = params.registration || params.reg || "";
  const initialVehicleId = params.vehicleId || params.id || null;

  // VEHICLE STATE
  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState(
    initialVehicleId ? String(initialVehicleId) : null
  );
  const [vehicleCollapsed, setVehicleCollapsed] = useState(!!initialVehicleId);

  // Manual fields (still allowed but auto-filled from vehicle)
  const [vehicleName, setVehicleName] = useState(initialVehicleName);
  const [registration, setRegistration] = useState(initialReg);

  // DEFECT FIELDS
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("Immediate"); // Immediate / General
  const [offRoad, setOffRoad] = useState(false);
  const [reportedBy, setReportedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState([]); // array of URIs

  const [saving, setSaving] = useState(false);

  /* ---------------- LOAD VEHICLES (same pattern as minor-service) ---------------- */

  useEffect(() => {
    const loadVehicles = async () => {
      try {
        setLoadingVehicles(true);
        const q = query(collection(db, "vehicles"), orderBy("name", "asc"));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => {
          const data = d.data() || {};
          return {
            id: d.id,
            name: data.name || data.vehicleName || "Unnamed vehicle",
            reg: data.registration || data.reg || "",
            manufacturer: data.manufacturer || "",
            model: data.model || "",
            mileage: data.mileage,
            lastService: data.lastService || "",
          };
        });
        setVehicles(list);
      } catch (err) {
        console.error("Failed to load vehicles for defect form:", err);
        Alert.alert("Error", "Could not load vehicles.");
      } finally {
        setLoadingVehicles(false);
      }
    };

    loadVehicles();
  }, []);

  const filteredVehicles = useMemo(() => {
    if (!vehicleSearch.trim()) return vehicles;
    const q = vehicleSearch.toLowerCase();
    return vehicles.filter((v) => {
      const name = (v.name || "").toLowerCase();
      const reg = (v.reg || "").toLowerCase();
      const manufacturer = (v.manufacturer || "").toLowerCase();
      const model = (v.model || "").toLowerCase();
      return (
        name.includes(q) ||
        reg.includes(q) ||
        manufacturer.includes(q) ||
        model.includes(q)
      );
    });
  }, [vehicles, vehicleSearch]);

  const selectedVehicle = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicleId) || null,
    [vehicles, selectedVehicleId]
  );

  const hasUnsavedChanges = useMemo(
    () =>
      String(selectedVehicleId || "") !== String(initialVehicleId || "") ||
      vehicleName.trim() !== String(initialVehicleName || "").trim() ||
      registration.trim() !== String(initialReg || "").trim() ||
      !!vehicleSearch.trim() ||
      !!location.trim() ||
      !!description.trim() ||
      severity !== "Immediate" ||
      offRoad ||
      !!reportedBy.trim() ||
      !!notes.trim() ||
      photos.length > 0,
    [
      description,
      initialReg,
      initialVehicleId,
      initialVehicleName,
      location,
      notes,
      offRoad,
      photos.length,
      registration,
      reportedBy,
      selectedVehicleId,
      severity,
      vehicleName,
      vehicleSearch,
    ]
  );

  const confirmLeave = (onLeave) => {
    if (!hasUnsavedChanges || allowLeaveRef.current) {
      onLeave();
      return;
    }

    Alert.alert(
      "Leave defect report?",
      "You have unsaved defect details. Leave without saving?",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: () => {
            allowLeaveRef.current = true;
            onLeave();
          },
        },
      ]
    );
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!hasUnsavedChanges || allowLeaveRef.current) return;

      event.preventDefault();
      Alert.alert(
        "Leave defect report?",
        "You have unsaved defect details. Leave without saving?",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => {
              allowLeaveRef.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ]
      );
    });

    return unsubscribe;
  }, [hasUnsavedChanges, navigation]);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChanges || allowLeaveRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // When a vehicle is selected, auto-fill the name/reg text fields
  useEffect(() => {
    if (!selectedVehicle) return;
    const name = selectedVehicle.name || "";
    const reg = selectedVehicle.reg || "";
    setVehicleName(name);
    setRegistration(reg);
  }, [selectedVehicle]);

  const handleSelectVehicle = (id) => {
    setSelectedVehicleId(id);
    setVehicleCollapsed(true);
  };

  /* ---------------- PHOTOS ---------------- */

  const handlePickPhoto = async () => {
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to attach images to the defect report."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsMultipleSelection: false,
      });

      if (!result.canceled) {
        const uri =
          result.assets && result.assets.length
            ? result.assets[0].uri
            : null;
        if (uri) {
          setPhotos((prev) => [...prev, uri]);
        }
      }
    } catch (err) {
      console.error("Failed to pick photo:", err);
      Alert.alert("Error", "Could not open photo library.");
    }
  };

  const handleRemovePhoto = (uri) => {
    setPhotos((prev) => prev.filter((p) => p !== uri));
  };

  /* ---------------- SAVE ---------------- */

  const handleSave = async () => {
    if (saving) return;

    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      Alert.alert("Missing description", "Add a short description of the defect.");
      return;
    }

    const effectiveVehicleId =
      selectedVehicleId || (initialVehicleId && String(initialVehicleId)) || null;

    if (!vehicleName.trim() && !registration.trim() && !effectiveVehicleId) {
      Alert.alert(
        "Vehicle details",
        "Please select a vehicle from the list or enter at least a vehicle name/registration."
      );
      return;
    }

    try {
      setSaving(true);
      const defectRef = doc(collection(db, "defectReports"));
      const vehicleSegment = sanitizeStorageSegment(
        effectiveVehicleId || registration || vehicleName || "unassigned"
      );
      let photoURLs = [];

      try {
        photoURLs = await uploadPhotoList(
          photos,
          `defectReports/${defectRef.id}/${vehicleSegment}`
        );
      } catch (uploadErr) {
        console.error("Failed to upload defect photos:", uploadErr);
        Alert.alert(
          "Photo upload failed",
          "Could not upload the defect photos. Please check your connection and try again."
        );
        return;
      }

      const payload = {
        vehicleId: effectiveVehicleId || null,
        vehicleName: vehicleName.trim(),
        registration: registration.trim(),
        location: location.trim(),
        description: trimmedDesc,
        severity,
        priority: severity === "Immediate" ? "high" : "medium",
        offRoad,
        reportedBy: reportedBy.trim(),
        notes: notes.trim(),
        status: "open",
        photoURIs: [],
        photoURLs,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // 1) Save into standalone defectReports collection
      await setDoc(defectRef, payload);

      // 2) ALSO push into the vehicle's defects[] array so it appears in Defects screen
      if (effectiveVehicleId) {
        const vehicleRef = doc(db, "vehicles", String(effectiveVehicleId));

        const embeddedDefect = {
          description: trimmedDesc,
          severity,
          priority: severity === "Immediate" ? "high" : "medium",
          offRoad,
          reportedBy: reportedBy.trim() || null,
          notes: notes.trim() || null,
          status: "open",
          location: location.trim() || null,
          photoURIs: [],
          photoURLs,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await updateDoc(vehicleRef, {
          defects: arrayUnion(embeddedDefect),
        });
      }

      Alert.alert("Saved", "Defect report saved.", [
        {
          text: "OK",
          onPress: () => {
            allowLeaveRef.current = true;
            router.back();
          },
        },
      ]);
    } catch (err) {
      console.error("Failed to save defect report:", err);
      Alert.alert(
        "Error",
        "Could not save the defect report. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  /* ---------------- UI ---------------- */

  const themedCard = {
    backgroundColor: colors.surfaceAlt || COLORS.card,
    borderColor: colors.border || COLORS.border,
  };
  const themedInput = {
    backgroundColor: colors.inputBackground || COLORS.inputBg,
    borderColor: colors.inputBorder || colors.border || COLORS.border,
    color: colors.text || COLORS.textHigh,
  };
  const themedLabel = { color: colors.textMuted || COLORS.textMid };

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => confirmLeave(() => router.back())}
          activeOpacity={0.8}
        >
          <Icon
            name="chevron-left"
            size={20}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.title,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Defect report
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Log issues reported by drivers or crew against a vehicle.
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* VEHICLE SECTION – MATCH MINOR SERVICE STYLE */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Vehicle
          </Text>
          {vehicleCollapsed && selectedVehicle ? (
            <TouchableOpacity
              onPress={() => setVehicleCollapsed(false)}
              activeOpacity={0.8}
            >
              <Text
                style={[styles.sectionHint, { color: COLORS.primaryAction }]}
              >
                Change
              </Text>
            </TouchableOpacity>
          ) : loadingVehicles ? (
            <Text
              style={[
                styles.sectionHint,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Loading fleet…
            </Text>
          ) : null}
        </View>

        <View style={[styles.card, themedCard]}>
          {vehicleCollapsed && selectedVehicle ? (
            <>
              <Text style={[styles.labelSmall, themedLabel]}>
                Selected vehicle
              </Text>
              <View style={styles.selectedVehicleRow}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.vehicleName,
                      { color: colors.text || COLORS.textHigh },
                    ]}
                  >
                    {selectedVehicle.name || "Unnamed vehicle"}
                  </Text>
                  <Text
                    style={[
                      styles.vehicleReg,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {selectedVehicle.reg || "—"}
                  </Text>
                </View>
              </View>
              <View style={styles.vehicleMetaRow}>
                <Text style={[styles.vehicleMeta, themedLabel]}>
                  Current mileage:{" "}
                  {typeof selectedVehicle.mileage === "number"
                    ? `${selectedVehicle.mileage.toLocaleString("en-GB")} mi`
                    : "—"}
                </Text>
                <Text style={[styles.vehicleMeta, themedLabel]}>
                  Last service: {selectedVehicle.lastService || "—"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={[styles.label, themedLabel]}>Search vehicle</Text>
              <View style={[styles.searchBox, themedInput]}>
                <Icon
                  name="search"
                  size={16}
                  color={colors.textMuted || COLORS.textMid}
                  style={{ marginRight: 6 }}
                />
                <TextInput
                  style={[
                    styles.searchInput,
                    { color: colors.text || COLORS.textHigh },
                  ]}
                  placeholder="Name, reg, manufacturer or model…"
                  placeholderTextColor={colors.textMuted || COLORS.textLow}
                  value={vehicleSearch}
                  onChangeText={setVehicleSearch}
                />
              </View>

              {loadingVehicles ? (
                <View style={styles.centerRow}>
                  <ActivityIndicator size="small" color={COLORS.primaryAction} />
                </View>
              ) : filteredVehicles.length === 0 ? (
                <View style={styles.centerRow}>
                  <Text style={[styles.emptyText, themedLabel]}>
                    No vehicles match this search.
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={{ maxHeight: 180, marginTop: 8 }}
                  nestedScrollEnabled
                >
                  {filteredVehicles.map((v) => {
                    const name = v.name || "Unnamed vehicle";
                    const reg = v.reg || "";
                    const isActive = v.id === selectedVehicleId;

                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[
                          styles.vehicleRow,
                          isActive && styles.vehicleRowActive,
                        ]}
                        onPress={() => handleSelectVehicle(v.id)}
                        activeOpacity={0.85}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[
                              styles.vehicleName,
                              { color: colors.text || COLORS.textHigh },
                              isActive && { color: COLORS.primaryAction },
                            ]}
                          >
                            {name}
                          </Text>
                          <Text style={[styles.vehicleReg, themedLabel]}>
                            {reg}
                            {v.manufacturer || v.model
                              ? ` · ${v.manufacturer || ""}${
                                  v.manufacturer && v.model ? " " : ""
                                }${v.model || ""}`
                              : ""}
                          </Text>
                        </View>
                        {isActive && (
                          <Icon
                            name="check-circle"
                            size={18}
                            color={COLORS.primaryAction}
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </>
          )}

          {/* Manual fields still available / prefilled */}
          <Text style={[styles.label, themedLabel, { marginTop: 12 }]}>
            Vehicle name
          </Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="e.g. Amarok, Silverado…"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={vehicleName}
            onChangeText={setVehicleName}
          />

          <Text style={[styles.label, themedLabel]}>Registration</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="e.g. AB12 CDE"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={registration}
            onChangeText={setRegistration}
          />

          <Text style={[styles.label, themedLabel]}>Location on vehicle</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="e.g. OSR wheel, front bumper, dash…"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={location}
            onChangeText={setLocation}
          />
        </View>

        {/* DEFECT DETAILS */}
        <View style={[styles.card, themedCard]}>
          <Text
            style={[
              styles.sectionTitleAlt,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Defect details
          </Text>

          <Text style={[styles.label, themedLabel]}>Description</Text>
          <TextInput
            style={[styles.input, themedInput, styles.multiline]}
            placeholder="Short summary of the issue…"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text style={[styles.label, themedLabel]}>Severity</Text>
          <View style={styles.pillRow}>
            <SeverityPill
              label="Immediate"
              active={severity === "Immediate"}
              onPress={() => setSeverity("Immediate")}
            />
            <SeverityPill
              label="General"
              active={severity === "General"}
              onPress={() => setSeverity("General")}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, themedLabel]}>
                Vehicle off road?
              </Text>
              <Text
                style={[
                  styles.switchHint,
                  { color: colors.textMuted || COLORS.textLow },
                ]}
              >
                If yes, treat as “do not drive / do not use” until cleared.
              </Text>
            </View>
            <Switch
              value={offRoad}
              onValueChange={setOffRoad}
              thumbColor={offRoad ? COLORS.primaryAction : "#999"}
              trackColor={{ true: "rgba(255,59,48,0.4)", false: "#555" }}
            />
          </View>

          <Text style={[styles.label, themedLabel]}>Reported by</Text>
          <TextInput
            style={[styles.input, themedInput]}
            placeholder="Driver / crew name"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={reportedBy}
            onChangeText={setReportedBy}
          />

          <Text style={[styles.label, themedLabel]}>Additional notes</Text>
          <TextInput
            style={[styles.input, themedInput, styles.multiline]}
            placeholder="Any extra context, sounds, when it happens, etc."
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>

        {/* PHOTOS */}
        <View style={[styles.card, themedCard]}>
          <Text
            style={[
              styles.sectionTitleAlt,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Photos
          </Text>
          <Text style={[styles.photosHint, themedLabel]}>
            Add clear photos of the defect, damage or warning lights.
          </Text>

          <View style={styles.photoRow}>
            <TouchableOpacity
              style={[
                styles.addPhotoButton,
                {
                  backgroundColor: colors.surfaceElevated || COLORS.pillBg,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
              onPress={handlePickPhoto}
              activeOpacity={0.9}
            >
              <Icon
                name="camera"
                size={18}
                color={colors.text || COLORS.textHigh}
              />
              <Text
                style={[
                  styles.addPhotoText,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                Add photo
              </Text>
            </TouchableOpacity>
          </View>

          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 10 }}
            >
              {photos.map((uri) => (
                <View key={uri} style={styles.photoThumbWrapper}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                  <TouchableOpacity
                    style={styles.removePhotoBtn}
                    onPress={() => handleRemovePhoto(uri)}
                  >
                    <Icon name="x" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* SAVE BUTTON */}
        <TouchableOpacity
          style={[
            styles.saveButton,
            {
              backgroundColor: saving ? "#555" : COLORS.primaryAction,
            },
          ]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.9}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.textHigh} />
          ) : (
            <>
              <Icon
                name="save"
                size={16}
                color={COLORS.textHigh}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.saveButtonText}>Save defect</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* ---------- SMALL COMPONENTS ---------- */

function SeverityPill({ label, active, onPress }) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={[
        styles.severityPill,
        {
          backgroundColor: colors.surfaceElevated || COLORS.pillBg,
          borderColor: colors.border || COLORS.border,
        },
        active && {
          backgroundColor: colors.accentSoft || "rgba(255,59,48,0.18)",
          borderColor: colors.accent || COLORS.primaryAction,
        },
      ]}
    >
      <Text
        style={[
          styles.severityPillText,
          { color: colors.textMuted || COLORS.textMid },
          active && {
            color: colors.accent || COLORS.primaryAction,
          },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    color: COLORS.textMid,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  /* SECTION HEADERS */
  sectionHeaderRow: {
    marginTop: 6,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  sectionTitleAlt: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMid,
  },

  /* LABELS / INPUTS */
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMid,
    marginTop: 6,
    marginBottom: 4,
  },
  labelSmall: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textLow,
    marginBottom: 4,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textHigh,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: "top",
  },

  /* VEHICLE SELECTION – MATCH MINOR SERVICE */
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: 14,
  },
  centerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  vehicleRowActive: {
    backgroundColor: "rgba(255,59,48,0.12)",
  },
  vehicleName: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: 12,
    color: COLORS.textMid,
  },
  selectedVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  vehicleMetaRow: {
    marginTop: 8,
  },
  vehicleMeta: {
    fontSize: 12,
    color: COLORS.textMid,
  },

  /* SEVERITY / SWITCH */
  pillRow: {
    flexDirection: "row",
    marginTop: 4,
    marginBottom: 4,
  },
  severityPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: COLORS.pillBg,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  severityPillActive: {
    backgroundColor: "rgba(255,59,48,0.18)",
    borderColor: COLORS.primaryAction,
  },
  severityPillText: {
    fontSize: 12,
    color: COLORS.textMid,
    fontWeight: "600",
  },
  severityPillTextActive: {
    color: COLORS.primaryAction,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  switchHint: {
    fontSize: 11,
    color: COLORS.textLow,
    marginTop: 2,
  },

  /* PHOTOS */
  photosHint: {
    fontSize: 12,
    color: COLORS.textMid,
    marginBottom: 8,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#262626",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addPhotoText: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  photoThumbWrapper: {
    marginRight: 10,
    marginTop: 6,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: 8,
  },
  removePhotoBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },

  /* SAVE */
  saveButton: {
    marginTop: 6,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
});
