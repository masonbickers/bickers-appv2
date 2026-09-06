import { AppButton, AppText as Text, AppPressable as TouchableOpacity, Checkbox, FormField, SegmentedControl, TextArea } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
// app/(protected)/service/defect-form.jsx
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams,
  useNavigation,
  useRouter } from "expo-router";
import { useEffect,
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

import {
    arrayUnion,
    collection,
    doc,
    serverTimestamp,
    setDoc,
    updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "../../../firebaseConfig";
import { formatShortDate } from "../../../lib/dateDisplay";
import {
  getVehicleLastService,
  getVehicleManufacturer,
  getVehicleMileage,
  getVehicleName,
  getVehicleRegistration,
} from "../../../lib/fleetSchema";
import { useServiceCacheActions, useServiceCollectionReader } from "../../../hooks/useServiceData";
import { runOrQueueFirestoreMutations } from "../../../lib/sync/firestoreQueue";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";
import { designTokens as t } from "../../../lib/design/tokens";
import PageShell from "../../../components/layout/PageShell";

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
  const readServiceCollection = useServiceCollectionReader();
  const { upsertServiceRow, patchServiceRow } = useServiceCacheActions();
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
        const rows = await readServiceCollection("vehicles", {
          orderByField: "name",
        });
        const list = rows.map((data) => {
          return {
            id: data.id,
            name: getVehicleName(data) || "Unnamed vehicle",
            reg: getVehicleRegistration(data) || "",
            manufacturer: getVehicleManufacturer(data) || "",
            model: data.model || "",
            mileage: getVehicleMileage(data),
            lastService: getVehicleLastService(data) || "",
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
  }, [readServiceCollection]);

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

      const mutations = [
        {
          run: () => setDoc(defectRef, payload),
          mutation: {
            operation: "set",
            docPath: `defectReports/${defectRef.id}`,
            data: payload,
            options: { merge: false },
            entityType: "defectReport",
            entityId: defectRef.id,
          },
        },
      ];

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
        const vehicleUpdate = {
          defects: arrayUnion(embeddedDefect),
        };
        mutations.push({
          run: () => updateDoc(vehicleRef, vehicleUpdate),
          mutation: {
            operation: "update",
            docPath: `vehicles/${effectiveVehicleId}`,
            data: vehicleUpdate,
            entityType: "vehicle",
            entityId: String(effectiveVehicleId),
          },
        });
      }

      const { queued } = await runOrQueueFirestoreMutations(mutations);
      await upsertServiceRow("defectReports", { ...payload, id: defectRef.id });
      if (effectiveVehicleId && mutations[1]?.mutation?.data) {
        await patchServiceRow("vehicles", effectiveVehicleId, mutations[1].mutation.data);
      }

      Alert.alert(queued ? "Saved offline" : "Saved", queued
        ? "No internet right now. This defect report will upload automatically when internet returns."
        : "Defect report saved.", [
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
  const themedLabel = { color: colors.textMuted || COLORS.textMid };

  return (
    <PageShell mode="form" width="form" header={{
      variant: "compact",
      title: "Defect report",
      subtitle: "Log issues reported by drivers or crew against a vehicle.",
      onBack: () => confirmLeave(() => router.back()),
    }}>
      {/* HEADER */}
      

      <>
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
                  Last service: {formatShortDate(selectedVehicle.lastService) || selectedVehicle.lastService || "—"}
                </Text>
              </View>
            </>
          ) : (
            <>
              <FormField
                label="Search vehicle"
                placeholder="Name, reg, manufacturer or model…"
                value={vehicleSearch}
                onChangeText={setVehicleSearch}
              />

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
                <View
                  style={{ maxHeight: 150, marginTop: t.spacing.xs }}
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
                </View>
              )}
            </>
          )}

          {/* Manual fields still available / prefilled */}
          <FormField
            label="Vehicle name"
            style={{ marginTop: t.spacing.sm }}
            placeholder="e.g. Amarok, Silverado…"
            value={vehicleName}
            onChangeText={setVehicleName}
          />

          <FormField
            label="Registration"
            placeholder="e.g. AB12 CDE"
            value={registration}
            onChangeText={setRegistration}
          />

          <FormField
            label="Location on vehicle"
            placeholder="e.g. OSR wheel, front bumper, dash…"
            value={location}
            onChangeText={setLocation}
          />
        </View>

        {/* DEFECT DETAILS */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Defect details
          </Text>
        </View>

        <View style={[styles.card, themedCard]}>

          <TextArea
            label="Description"
            placeholder="Short summary of the issue…"
            value={description}
            onChangeText={setDescription}
          />

          <SegmentedControl
            options={[{ label: "Immediate", value: "Immediate" }, { label: "General", value: "General" }]}
            value={severity}
            onChange={setSeverity}
          />

          <Checkbox
            checked={offRoad}
            onChange={setOffRoad}
            label="Vehicle off road? If yes, treat as “do not drive / do not use” until cleared."
          />

          <FormField
            label="Reported by"
            placeholder="Driver / crew name"
            value={reportedBy}
            onChangeText={setReportedBy}
          />

          <TextArea
            label="Additional notes"
            placeholder="Any extra context, sounds, when it happens, etc."
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        {/* PHOTOS */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Photos
          </Text>
        </View>

        <View style={[styles.card, themedCard]}>
          <Text style={[styles.photosHint, themedLabel]}>
            Add clear photos of the defect, damage or warning lights.
          </Text>

          <View style={styles.photoRow}>
            <TouchableOpacity
              style={[
                styles.addPhotoButton,
                {
                  backgroundColor: colors.inputBackground || staticColors.hex_ffffff_5c2ocm,
                  borderColor: colors.border || COLORS.border,
                },
              ]}
              onPress={handlePickPhoto}
              activeOpacity={0.9}
            >
              <Icon
                name="image"
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
              style={{ marginTop: t.spacing.xs }}
            >
              {photos.map((uri) => (
                <View key={uri} style={styles.photoThumbWrapper}>
                  <Image source={{ uri }} style={styles.photoThumb} />
                  <TouchableOpacity
                    style={styles.removePhotoBtn}
                    onPress={() => handleRemovePhoto(uri)}
                  >
                    <Icon name="x" size={12} color={staticColors.hex_fff_yhjmu8} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}
        </View>

        {/* SAVE BUTTON */}
        <AppButton
          label="Save defect"
          icon="save"
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          fullWidth
        />

        <View style={{ height: 20 }} />
      </>
    </PageShell>
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
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  title: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
    color: COLORS.textHigh,
  },
  subtitle: {
    fontSize: t.typography.bodySmall.fontSize,
    marginTop: t.spacing.none,
    color: COLORS.textMid,
  },
  content: {
    padding: t.spacing.md,
    paddingBottom: 110,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  /* SECTION HEADERS */
  sectionHeaderRow: {
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  sectionTitleAlt: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
    marginBottom: t.spacing.xs,
  },
  sectionHint: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  /* LABELS / INPUTS */
  label: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
  },
  labelSmall: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "600",
    color: COLORS.textLow,
    marginBottom: t.spacing.xxs,
  },
  input: {
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textHigh,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.body.fontSize,
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: "top",
  },

  /* VEHICLE SELECTION – MATCH MINOR SERVICE */
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textHigh,
    fontSize: t.typography.body.fontSize,
  },
  centerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.xs,
  },
  emptyText: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  vehicleRowActive: {
    backgroundColor: staticColors.rgba_mxgb69,
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.xs,
  },
  vehicleName: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  vehicleReg: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  selectedVehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xxs,
  },
  vehicleMetaRow: {
    marginTop: t.spacing.xs,
  },
  vehicleMeta: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  /* SEVERITY / SWITCH */
  pillRow: {
    flexDirection: "row",
    marginTop: t.spacing.xxs,
    marginBottom: t.spacing.xxs,
  },
  severityPill: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    marginRight: t.spacing.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  severityPillActive: {
    backgroundColor: staticColors.rgba_mxgb17,
    borderColor: COLORS.primaryAction,
  },
  severityPillText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    fontWeight: "600",
  },
  severityPillTextActive: {
    color: COLORS.primaryAction,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: t.spacing.xs,
  },
  switchHint: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
    marginTop: t.spacing.none,
  },

  /* PHOTOS */
  photosHint: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginBottom: t.spacing.xs,
  },
  photoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_ffffff_5c2ocm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addPhotoText: {
    marginLeft: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  photoThumbWrapper: {
    marginRight: t.spacing.xs,
    marginTop: t.spacing.xxs,
  },
  photoThumb: {
    width: 90,
    height: 90,
    borderRadius: t.radius.sm,
  },
  removePhotoBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_11xlynb,
    alignItems: "center",
    justifyContent: "center",
  },

  /* SAVE */
  saveButton: {
    marginTop: t.spacing.xxs,
    borderRadius: t.radius.pill,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
});
