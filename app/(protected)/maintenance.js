// app/(protected)/vehicle-issues.js
import { Picker } from "@react-native-picker/picker";
import { useRouter } from "expo-router";
import {
  addDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

// 🔑 Firebase + Auth provider (paths for app/(protected)/*)
import { db } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

const MAX_CHARS = 600;

/* ------------------------- Mobile-friendly Select ------------------------- */
function Select({
  value,
  onChange,
  items,
  placeholder = "Select…",
  disabled,
  testID,
  colors,
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = items.find((i) => i.value === value)?.label || "";

  if (Platform.OS === "android") {
    return (
      <View
        style={[
          styles.pickerShellAndroid,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
          },
        ]}
      >
        <Picker
          mode="dialog"
          enabled={!disabled}
          selectedValue={value}
          onValueChange={onChange}
          dropdownIconColor={colors.text}
          style={{ color: colors.text, height: 44, width: "100%" }}
          testID={testID}
        >
          <Picker.Item
            label={`-- ${placeholder} --`}
            value=""
            color={colors.textMuted}
          />
          {items.map((i) => (
            <Picker.Item
              key={i.value}
              label={i.label}
              value={i.value}
              color={colors.text}
            />
          ))}
        </Picker>
      </View>
    );
  }

  // iOS
  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[
          styles.selectField,
          {
            backgroundColor: colors.inputBackground,
            borderColor: colors.inputBorder,
          },
          disabled && { opacity: 0.6 },
        ]}
        accessibilityRole="button"
        testID={testID}
      >
        <Text
          style={[
            styles.selectFieldText,
            { color: selectedLabel ? colors.text : colors.textMuted },
          ]}
        >
          {selectedLabel || `-- ${placeholder} --`}
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setOpen(false)}
        />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View
            style={[
              styles.sheetToolbar,
              { borderBottomColor: colors.border },
            ]}
          >
            <TouchableOpacity onPress={() => setOpen(false)}>
              <Text style={[styles.doneText, { color: colors.text }]}>
                Done
              </Text>
            </TouchableOpacity>
          </View>
          <Picker
            selectedValue={value}
            onValueChange={(v) => onChange(v)}
            style={{
              width: "100%",
              height: 216,
              backgroundColor: colors.surface,
            }}
            itemStyle={{ color: colors.text }}
          >
            <Picker.Item
              label={`-- ${placeholder} --`}
              value=""
              color={colors.textMuted}
            />
            {items.map((i) => (
              <Picker.Item
                key={i.value}
                label={i.label}
                value={i.value}
                color={colors.text}
              />
            ))}
          </Picker>
        </View>
      </Modal>
    </>
  );
}
/* ------------------------------------------------------------------------- */

// normalise category
const normalizeCategory = (cat) => {
  if (typeof cat !== "string") return "Other";
  const c = cat.trim();
  return c.length ? c : "Other";
};

export default function VehicleIssuesPage() {
  const router = useRouter();

  // ✅ mirror me.js
  const { employee, user, isAuthed, loading } = useAuth();
  const { colors } = useTheme();

  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [issueText, setIssueText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const normalizedVehicles = useMemo(
    () => vehicles.map((v) => ({ ...v, category: normalizeCategory(v.category) })),
    [vehicles]
  );

  const categories = useMemo(() => {
    const set = new Set(normalizedVehicles.map((v) => v.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [normalizedVehicles]);

  const filteredVehicles = useMemo(() => {
    if (!selectedCategory) return [];
    return normalizedVehicles.filter((v) => v.category === selectedCategory);
  }, [normalizedVehicles, selectedCategory]);

  const isValid =
    selectedCategory && selectedVehicle && issueText.trim().length > 0;
  const charCount = issueText.length;

  useEffect(() => {
    // gate like me.js
    if (loading || !isAuthed) return;
    const fetchVehicles = async () => {
      try {
        const snapshot = await getDocs(collection(db, "vehicles"));
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setVehicles(list);
      } catch (e) {
        console.error("Error fetching vehicles:", e);
      } finally {
        setLoadingVehicles(false);
      }
    };
    fetchVehicles();
  }, [loading, isAuthed]);

  // clear vehicle when category changes
  useEffect(() => {
    setSelectedVehicle("");
  }, [selectedCategory]);

  const reportIssue = async () => {
    if (!isValid) {
      Alert.alert(
        "Missing info",
        "Please complete all fields before submitting."
      );
      return;
    }
    try {
      setSubmitting(true);
      const v = normalizedVehicles.find((x) => x.id === selectedVehicle);
      const reporterName =
        employee?.name ||
        employee?.displayName ||
        user?.displayName ||
        "Unknown";
      const reporterCode = employee?.userCode || "N/A";
      const reporterUid = user?.uid || "N/A";

      await addDoc(collection(db, "vehicleIssues"), {
        vehicleId: v.id,
        vehicleName: v.name || "Unnamed Vehicle",
        category: v.category || "Other",
        description: issueText.trim(),
        // reporter meta (matches provider pattern)
        reporterName,
        reporterCode,
        reporterUid,
        status: "open", // simple workflow
        createdAt: serverTimestamp(), // server time
      });

      Alert.alert(
        "✅ Issue reported",
        `Thanks! We logged an issue for ${v.name || "vehicle"}.`,
        [
          {
            text: "OK",
            onPress: () => {
              // clear form
              setIssueText("");
              setSelectedVehicle("");
              setSelectedCategory("");
              // go home
              router.replace("/(protected)/screens/homescreen");
            },
          },
        ]
      );
    } catch (err) {
      console.error("Error reporting issue:", err);
      Alert.alert("❌ Error", "Failed to report the issue. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // follow me.js: render nothing while resolving or unauthenticated (protected route)
  if (loading || !isAuthed) return null;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >
          {/* Header */}
          <View style={styles.headerWrap}>
            <Text style={[styles.title, { color: colors.text }]}>
              Report Vehicle Issues
            </Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>
              Log problems quickly so the team can action them.
            </Text>
          </View>

          {/* Loading / Empty */}
          {loadingVehicles ? (
            <View
              style={[
                styles.loadingCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <ActivityIndicator size="large" color={colors.accent} />
              <Text
                style={[styles.loadingText, { color: colors.textMuted }]}
              >
                Loading vehicles…
              </Text>
            </View>
          ) : vehicles.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <Icon name="truck" size={22} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No vehicles found
              </Text>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                Add vehicles in the admin area, then report issues here.
              </Text>
            </View>
          ) : (
            <>
              {/* Category */}
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Icon name="tag" size={16} color={colors.textMuted} />
                  <Text
                    style={[
                      styles.cardHeaderText,
                      { color: colors.text },
                    ]}
                  >
                    Category
                  </Text>
                </View>

                <Select
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  placeholder="Select Category"
                  disabled={submitting}
                  items={categories.map((cat) => ({
                    label: cat,
                    value: cat,
                  }))}
                  testID="category-select"
                  colors={colors}
                />
              </View>

              {/* Vehicle */}
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Icon name="truck" size={16} color={colors.textMuted} />
                  <Text
                    style={[
                      styles.cardHeaderText,
                      { color: colors.text },
                    ]}
                  >
                    Vehicle
                  </Text>
                </View>

                <Select
                  value={selectedVehicle}
                  onChange={setSelectedVehicle}
                  placeholder="Select Vehicle"
                  disabled={!selectedCategory || submitting}
                  items={filteredVehicles.map((v) => ({
                    label: v.name || "Unnamed Vehicle",
                    value: v.id,
                  }))}
                  testID="vehicle-select"
                  colors={colors}
                />

                {selectedVehicle ? (
                  <View style={styles.metaRow}>
                    <Text
                      style={[styles.meta, { color: colors.textMuted }]}
                    >
                      ID:{" "}
                      <Text
                        style={[
                          styles.metaValue,
                          { color: colors.text },
                        ]}
                      >
                        {selectedVehicle}
                      </Text>
                    </Text>
                    <Text
                      style={[styles.metaDot, { color: colors.textMuted }]}
                    >
                      •
                    </Text>
                    <Text
                      style={[styles.meta, { color: colors.textMuted }]}
                    >
                      Cat:{" "}
                      <Text
                        style={[
                          styles.metaValue,
                          { color: colors.text },
                        ]}
                      >
                        {selectedCategory || "Other"}
                      </Text>
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Issue description */}
              <View
                style={[
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Icon
                    name="alert-triangle"
                    size={16}
                    color={colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.cardHeaderText,
                      { color: colors.text },
                    ]}
                  >
                    Describe the issue
                  </Text>
                </View>

                <TextInput
                  editable={!!selectedVehicle && !submitting}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                      color: colors.text,
                    },
                  ]}
                  placeholder="e.g. Brakes squeaking above 40mph, warning light on, tyre low…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  value={issueText}
                  onChangeText={(t) =>
                    setIssueText(
                      t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t
                    )
                  }
                />
                <View style={styles.counterRow}>
                  <Text
                    style={[
                      styles.counterText,
                      { color: colors.textMuted },
                    ]}
                  >
                    {charCount}/{MAX_CHARS}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.button,
                    {
                      backgroundColor: colors.accent,
                      borderColor: colors.accent,
                    },
                    (!isValid || submitting) && styles.buttonDisabled,
                  ]}
                  onPress={reportIssue}
                  disabled={!isValid || submitting}
                  activeOpacity={0.9}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      { color: colors.surface },
                    ]}
                  >
                    {submitting ? "Submitting…" : "Report Issue"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },

  headerWrap: { alignItems: "center", marginBottom: 12 },
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  subtitle: { marginTop: 6, fontSize: 13, textAlign: "center" },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  cardHeaderText: { fontSize: 14, fontWeight: "700" },

  // Android inline shell
  pickerShellAndroid: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },

  // iOS tap field
  selectField: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  selectFieldText: {},

  // iOS modal sheet
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 24,
  },
  sheetToolbar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  doneText: { fontWeight: "700" },

  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  meta: { fontSize: 12 },
  metaValue: { fontWeight: "700" },
  metaDot: {},

  input: {
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  counterRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 6,
  },
  counterText: { fontSize: 12 },

  button: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 12,
    borderWidth: 1,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { fontSize: 16, fontWeight: "800" },

  loadingCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    marginTop: 16,
  },
  loadingText: { marginTop: 10 },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    marginTop: 16,
    gap: 8,
  },
  emptyTitle: { fontWeight: "800" },
  emptyText: { textAlign: "center" },
});
