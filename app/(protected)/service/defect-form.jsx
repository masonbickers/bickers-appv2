// app/(protected)/service/defect-form.jsx
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import {
    addDoc,
    arrayUnion,
    collection,
    doc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
} from "firebase/firestore";
import { db } from "../../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  inputBg: "#1F1F1F",
  primaryAction: "#FF3B30",
  pillBg: "#262626",
};

export default function DefectFormScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams();

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
        photoURIs: photos,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // 1) Save into standalone defectReports collection
      await addDoc(collection(db, "defectReports"), payload);

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
          createdAt: new Date().toISOString(),
        };

        await updateDoc(vehicleRef, {
          defects: arrayUnion(embeddedDefect),
        });
      }

      Alert.alert("Saved", "Defect report saved.", [
        {
          text: "OK",
          onPress: () => router.back(),
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

  return (
    <SafeAreaView
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
          onPress={() => router.back()}
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

        <View style={styles.card}>
          {vehicleCollapsed && selectedVehicle ? (
            <>
              <Text style={styles.labelSmall}>Selected vehicle</Text>
              <View style={styles.selectedVehicleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vehicleName}>
                    {selectedVehicle.name || "Unnamed vehicle"}
                  </Text>
                  <Text style={styles.vehicleReg}>
                    {selectedVehicle.reg || "—"}
                  </Text>
                </View>
              </View>
              <View style={styles.vehicleMetaRow}>
                <Text style={styles.vehicleMeta}>
                  Current mileage:{" "}
                  {typeof selectedVehicle.mileage === "number"
                    ? `${selectedVehicle.mileage.toLocaleString("en-GB")} mi`
                    : "—"}
                </Text>
                <Text style={styles.vehicleMeta}>
                  Last service: {selectedVehicle.lastService || "—"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.label}>Search vehicle</Text>
              <View style={styles.searchBox}>
                <Icon
                  name="search"
                  size={16}
                  color={COLORS.textMid}
                  style={{ marginRight: 6 }}
                />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Name, reg, manufacturer or model…"
                  placeholderTextColor={COLORS.textLow}
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
                  <Text style={styles.emptyText}>
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
                              isActive && { color: COLORS.primaryAction },
                            ]}
                          >
                            {name}
                          </Text>
                          <Text style={styles.vehicleReg}>
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
          <Text style={[styles.label, { marginTop: 12 }]}>Vehicle name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Amarok, Silverado…"
            placeholderTextColor={COLORS.textLow}
            value={vehicleName}
            onChangeText={setVehicleName}
          />

          <Text style={styles.label}>Registration</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. AB12 CDE"
            placeholderTextColor={COLORS.textLow}
            value={registration}
            onChangeText={setRegistration}
          />

          <Text style={styles.label}>Location on vehicle</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. OSR wheel, front bumper, dash…"
            placeholderTextColor={COLORS.textLow}
            value={location}
            onChangeText={setLocation}
          />
        </View>

        {/* DEFECT DETAILS */}
        <View style={styles.card}>
          <Text style={styles.sectionTitleAlt}>Defect details</Text>

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Short summary of the issue…"
            placeholderTextColor={COLORS.textLow}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text style={styles.label}>Severity</Text>
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
              <Text style={styles.label}>Vehicle off road?</Text>
              <Text style={styles.switchHint}>
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

          <Text style={styles.label}>Reported by</Text>
          <TextInput
            style={styles.input}
            placeholder="Driver / crew name"
            placeholderTextColor={COLORS.textLow}
            value={reportedBy}
            onChangeText={setReportedBy}
          />

          <Text style={styles.label}>Additional notes</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="Any extra context, sounds, when it happens, etc."
            placeholderTextColor={COLORS.textLow}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>

        {/* PHOTOS */}
        <View style={styles.card}>
          <Text style={styles.sectionTitleAlt}>Photos</Text>
          <Text style={styles.photosHint}>
            Add clear photos of the defect, damage or warning lights.
          </Text>

          <View style={styles.photoRow}>
            <TouchableOpacity
              style={styles.addPhotoButton}
              onPress={handlePickPhoto}
              activeOpacity={0.9}
            >
              <Icon name="camera" size={18} color={COLORS.textHigh} />
              <Text style={styles.addPhotoText}>Add photo</Text>
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
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={[
        styles.severityPill,
        active && styles.severityPillActive,
      ]}
    >
      <Text
        style={[
          styles.severityPillText,
          active && styles.severityPillTextActive,
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
