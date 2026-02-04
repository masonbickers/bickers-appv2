import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { auth, db, storage } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider"; // ✅ use shared auth context
import { useTheme } from "../providers/ThemeProvider"; // ✅ theme

export default function ProfilePage() {
  const router = useRouter();
  const { user, employee, loading: authLoading, reloadSession } = useAuth(); // ✅ now includes reloadSession
  const { colors, colorScheme } = useTheme(); // ✅ theme values

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [userCode, setUserCode] = useState("");
  const [role, setRole] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Resolve employee doc ID in a way that tolerates both shapes
  const employeeDocId = employee?.employeeId || employee?.id || null;

  useEffect(() => {
    // Wait for auth to settle before loading
    if (!authLoading) {
      loadProfile();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, employeeDocId, user?.uid]);

  const avatarInitial = useMemo(() => {
    if (!name) return "U";
    return name.trim().charAt(0).toUpperCase();
  }, [name]);

  const loadProfile = async () => {
    try {
      setLoading(true);

      if (employeeDocId) {
        const docRef = doc(db, "employees", employeeDocId);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
          const data = snap.data();
          setName(data.name || employee?.displayName || "");
          setPhone(data.phone || "");
          setUserCode(data.userCode || employee?.userCode || "");
          setRole(data.role || employee?.role || "");
          setEmail(user?.email ?? data.email ?? employee?.email ?? "");
          setAvatarUrl(
            data.avatarUrl || data.photoURL || user?.photoURL || ""
          );
        } else if (user) {
          // Employee record missing but Firebase user exists
          setName(user.displayName || employee?.displayName || "");
          setEmail(user.email || employee?.email || "");
          setAvatarUrl(user.photoURL || "");
        }
      } else if (user) {
        // No employee session, fall back to raw Firebase user
        setName(user.displayName || employee?.displayName || "");
        setEmail(user.email || employee?.email || "");
        setAvatarUrl(user.photoURL || "");
      }
    } catch (err) {
      console.error("Error loading profile:", err);
      Alert.alert("Error", "There was a problem loading your profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!employeeDocId) {
      Alert.alert("No profile", "No employee profile found to update.");
      return;
    }

    try {
      setSaving(true);
      const docRef = doc(db, "employees", employeeDocId);

      await updateDoc(docRef, {
        phone: phone.trim() || "",
      });

      Alert.alert("Saved", "Your profile has been updated.");
    } catch (err) {
      console.error("Error saving profile:", err);
      Alert.alert("Error", "There was a problem saving your profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePhoto = async () => {
    if (!employeeDocId) {
      Alert.alert("No profile", "No employee profile found to update.");
      return;
    }

    const uid = user?.uid;
    if (!uid) {
      Alert.alert("Error", "You must be logged in to change your profile picture.");
      return;
    }

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your photos to update your profile picture."
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      setUploadingAvatar(true);

      const response = await fetch(asset.uri);
      const blob = await response.blob();

      // Upload to storage using auth uid
      const storageRef = ref(storage, `profilePictures/${uid}.jpg`);
      await uploadBytes(storageRef, blob);
      const url = await getDownloadURL(storageRef);

      // Save URL to Firestore
      const docRef = doc(db, "employees", employeeDocId);
      await updateDoc(docRef, { avatarUrl: url });

      setAvatarUrl(url);
      Alert.alert("Updated", "Your profile picture has been updated.");
    } catch (err) {
      console.error("Error updating profile picture:", err);
      Alert.alert("Error", "There was a problem updating your profile picture.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLogout = async () => {
    try {
      // Clear local session keys (same as homescreen)
      await AsyncStorage.multiRemove([
        "sessionRole",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
      ]);

      if (reloadSession) {
        await reloadSession();
      }

      await signOut(auth).catch(() => {});

      // Optionally send back to login
      router.replace("/"); // or "/login" depending on your routing
    } catch (err) {
      console.error("Error logging out:", err);
      Alert.alert("Error", "There was a problem logging you out.");
    }
  };

  const stillLoading = authLoading || loading;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      {/* Header / Back */}
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Icon name="arrow-left" size={22} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </TouchableOpacity>

        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Edit Profile
        </Text>
        <View style={{ width: 56 }} />
      </View>

      {stillLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Loading your profile…
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Avatar + quick info */}
          <View
            style={[
              styles.avatarCard,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <View style={styles.avatarLeft}>
              <View
                style={[
                  styles.avatarCircle,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                {avatarUrl ? (
                  <Image
                    source={{ uri: avatarUrl }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text
                    style={[styles.avatarInitial, { color: colors.text }]}
                  >
                    {avatarInitial}
                  </Text>
                )}
              </View>
            </View>

            <View style={styles.avatarInfo}>
              <Text style={[styles.nameText, { color: colors.text }]}>
                {name || "Unnamed User"}
              </Text>
              <Text style={[styles.roleText, { color: colors.textMuted }]}>
                {role ? role.toString() : "Employee"}
              </Text>
              {userCode ? (
                <Text style={[styles.metaText, { color: colors.textMuted }]}>
                  Code: {userCode}
                </Text>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.changePhotoButton,
                  { backgroundColor: colors.accent },
                ]}
                onPress={handleChangePhoto}
                disabled={uploadingAvatar}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator size="small" color={colors.surface} />
                ) : (
                  <>
                    <Icon
                      name="camera"
                      size={14}
                      color={colors.surface}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        styles.changePhotoText,
                        { color: colors.surface },
                      ]}
                    >
                      Change photo
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Account info (locked) */}
          <View
            style={[
              styles.section,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Account
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>
                Name
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.lockedInput,
                  {
                    backgroundColor: colors.surface,
                    color: colors.textMuted,
                    borderColor: colors.inputBorder,
                  },
                ]}
                value={name}
                editable={false}
                placeholder="Name"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>
                Email
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.lockedInput,
                  {
                    backgroundColor: colors.surface,
                    color: colors.textMuted,
                    borderColor: colors.inputBorder,
                  },
                ]}
                value={email}
                editable={false}
                placeholder="Email"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>
                User Code
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.lockedInput,
                  {
                    backgroundColor: colors.surface,
                    color: colors.textMuted,
                    borderColor: colors.inputBorder,
                  },
                ]}
                value={userCode}
                editable={false}
                placeholder="User Code"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <Text style={[styles.helperText, { color: colors.textMuted }]}>
              For changes to your name, email, or user code, please contact your
              manager/admin.
            </Text>
          </View>

          {/* Contact details (editable) */}
          <View
            style={[
              styles.section,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Contact Details
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>
                Phone Number
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.inputBorder,
                  },
                ]}
                value={phone}
                onChangeText={setPhone}
                placeholder="Enter your phone number"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                editable={!saving}
              />
            </View>
          </View>

          {/* Save + Logout buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[
                styles.saveButton,
                {
                  backgroundColor: colors.accent,
                },
                saving && styles.saveButtonDisabled,
              ]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.surface} />
              ) : (
                <>
                  <Icon
                    name="save"
                    size={18}
                    color={colors.surface}
                    style={{ marginRight: 8 }}
                  />
                  <Text
                    style={[
                      styles.saveButtonText,
                      { color: colors.surface },
                    ]}
                  >
                    Save Changes
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoutButton}
              onPress={handleLogout}
            >
              <Icon
                name="log-out"
                size={18}
                color="#fff"
                style={{ marginRight: 8 }}
              />
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.bottomNote, { color: colors.textMuted }]}>
            Your profile details help us keep bookings, timesheets, and
            communication accurate.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#000" },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: "space-between",
  },
  backButton: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  backText: { color: "#fff", fontSize: 16, marginLeft: 6 },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },

  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  loadingText: {
    marginTop: 12,
    color: "#aaa",
    fontSize: 14,
  },

  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },

  avatarCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#121212",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#222",
    marginBottom: 20,
  },
  avatarLeft: {
    marginRight: 16,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#1f1f1f",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
    overflow: "hidden",
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  avatarInitial: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "700",
  },
  avatarInfo: {
    flex: 1,
  },
  nameText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 4,
  },
  roleText: {
    color: "#bbb",
    fontSize: 14,
    marginBottom: 2,
  },
  metaText: {
    color: "#777",
    fontSize: 13,
    marginBottom: 8,
  },
  changePhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#333",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  changePhotoText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
  },

  section: {
    backgroundColor: "#111",
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#222",
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 10,
  },

  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    color: "#aaa",
    fontSize: 13,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#1a1a1a",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#333",
  },
  lockedInput: {
    backgroundColor: "#191919",
    color: "#777",
  },
  helperText: {
    color: "#666",
    fontSize: 12,
    marginTop: 4,
  },

  buttonRow: {
    marginTop: 4,
    marginBottom: 10,
    gap: 10,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
    paddingVertical: 12,
    borderRadius: 999,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "600",
  },

  logoutButton: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f44336",
    paddingVertical: 12,
    borderRadius: 999,
  },
  logoutButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },

  bottomNote: {
    color: "#666",
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 20,
  },
});
