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
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { auth, db, storage } from "../../firebaseConfig";
import { useAuth } from "../providers/AuthProvider";
import { useTheme } from "../providers/ThemeProvider";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");

  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `rgba(255,255,255,${safeAlpha})`;
  }

  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);

  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, employee, loading: authLoading, reloadSession } = useAuth();
  const { colors } = useTheme();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [userCode, setUserCode] = useState("");
  const [role, setRole] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const employeeDocId = employee?.employeeId || employee?.id || null;

  useEffect(() => {
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
          setAvatarUrl(data.avatarUrl || data.photoURL || user?.photoURL || "");
        } else if (user) {
          setName(user.displayName || employee?.displayName || "");
          setEmail(user.email || employee?.email || "");
          setAvatarUrl(user.photoURL || "");
        }
      } else if (user) {
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

      const storageRef = ref(storage, `profilePictures/${uid}.jpg`);
      await uploadBytes(storageRef, blob);

      const url = await getDownloadURL(storageRef);

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
      await AsyncStorage.multiRemove([
        "sessionRole",
        "sessionIsService",
        "sessionUserAccess",
        "sessionServiceAccess",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
        "timesheetYardStart",
        "timesheetYardEnd",
        "timesheetOfficeStart",
        "timesheetOfficeEnd",
        "timesheetDefaultType",
      ]);

      if (reloadSession) {
        await reloadSession();
      }

      await signOut(auth).catch(() => {});

      router.replace("/");
    } catch (err) {
      console.error("Error logging out:", err);
      Alert.alert("Error", "There was a problem logging you out.");
    }
  };

  const stillLoading = authLoading || loading;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      {stillLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Loading your profile…
          </Text>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity
              style={[
                styles.backButton,
                {
                  backgroundColor: withAlpha(colors.surfaceAlt, 0.6),
                },
              ]}
              onPress={() => router.back()}
            >
              <Icon name="arrow-left" size={18} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.headerTextWrap}>
              <Text style={[styles.pageTitle, { color: colors.text }]}>
                Edit Profile
              </Text>
              <Text style={[styles.pageSubtitle, { color: colors.textMuted }]}>
                Manage your profile details.
              </Text>
            </View>
          </View>

          <View style={styles.profileTop}>
            <TouchableOpacity
              style={[
                styles.avatarCircle,
                {
                  backgroundColor: colors.surfaceAlt,
                },
              ]}
              onPress={handleChangePhoto}
              disabled={uploadingAvatar}
              activeOpacity={0.85}
            >
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={[styles.avatarInitial, { color: colors.text }]}>
                  {avatarInitial}
                </Text>
              )}

              <View
                style={[
                  styles.cameraBadge,
                  {
                    backgroundColor: colors.accent,
                  },
                ]}
              >
                <Icon name="camera" size={13} color="#fff" />
              </View>
            </TouchableOpacity>

            <View style={styles.profileText}>
              <Text style={[styles.nameText, { color: colors.text }]}>
                {name || "Unnamed User"}
              </Text>

              <Text style={[styles.roleText, { color: colors.textMuted }]}>
                {role ? role.toString() : "Employee"}
              </Text>

              {userCode ? (
                <Text style={[styles.codeText, { color: colors.textMuted }]}>
                  Code {userCode}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Account Details
            </Text>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Name</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.lockedInput,
                  {
                    backgroundColor: colors.surfaceAlt,
                    color: colors.textMuted,
                  },
                ]}
                value={name}
                editable={false}
                placeholder="Name"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Email</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.lockedInput,
                  {
                    backgroundColor: colors.surfaceAlt,
                    color: colors.textMuted,
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
                    backgroundColor: colors.surfaceAlt,
                    color: colors.textMuted,
                  },
                ]}
                value={userCode}
                editable={false}
                placeholder="User Code"
                placeholderTextColor={colors.textMuted}
              />
            </View>

            <Text style={[styles.helperText, { color: colors.textMuted }]}>
              Name, email and user code are managed by your admin.
            </Text>
          </View>

          <View style={styles.section}>
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
                    backgroundColor: colors.inputBackground || colors.surfaceAlt,
                    color: colors.text,
                    borderColor: withAlpha(colors.border, 0.5),
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

          <TouchableOpacity
            style={[
              styles.saveButton,
              {
                backgroundColor: colors.accent,
              },
              saving && styles.disabledButton,
            ]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Icon name="save" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.logoutButton,
              {
                backgroundColor: withAlpha(colors.surfaceAlt, 0.65),
              },
            ]}
            onPress={handleLogout}
          >
            <Icon name="log-out" size={18} color={colors.text} style={{ marginRight: 8 }} />
            <Text style={[styles.logoutButtonText, { color: colors.text }]}>
              Logout
            </Text>
          </TouchableOpacity>

          <Text style={[styles.bottomNote, { color: colors.textMuted }]}>
            Your profile details help keep bookings, timesheets and communication accurate.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "600",
  },

  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },

  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  headerTextWrap: {
    flex: 1,
  },

  pageTitle: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.4,
  },

  pageSubtitle: {
    marginTop: 3,
    fontSize: 13,
    fontWeight: "600",
  },

  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
  },

  avatarCircle: {
    width: 82,
    height: 82,
    borderRadius: 41,
    justifyContent: "center",
    alignItems: "center",
    overflow: "visible",
    marginRight: 16,
  },

  avatarImage: {
    width: 82,
    height: 82,
    borderRadius: 41,
    resizeMode: "cover",
  },

  avatarInitial: {
    fontSize: 30,
    fontWeight: "900",
  },

  cameraBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
  },

  profileText: {
    flex: 1,
  },

  nameText: {
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 3,
  },

  roleText: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },

  codeText: {
    fontSize: 13,
    fontWeight: "600",
  },

  section: {
    marginBottom: 18,
  },

  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 10,
  },

  fieldGroup: {
    marginBottom: 10,
  },

  label: {
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 6,
  },

  input: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: "600",
    borderWidth: 1,
  },

  lockedInput: {
    borderWidth: 0,
    opacity: 0.9,
  },

  helperText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    marginTop: 0,
  },

  saveButton: {
    height: 48,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },

  disabledButton: {
    opacity: 0.7,
  },

  saveButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },

  logoutButton: {
    height: 48,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },

  logoutButtonText: {
    fontSize: 15,
    fontWeight: "900",
  },

  bottomNote: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 12,
  },
});
