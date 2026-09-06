import { AppButton, AppText as Text, AppPressable as TouchableOpacity, FormField } from "../../components/ui/AppPrimitives";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import {
  useRouter } from "expo-router";
import { signOut } from "firebase/auth";
import { doc,
  getDoc,
  updateDoc } from "firebase/firestore";
import { getDownloadURL,
  ref,
  uploadBytes } from "firebase/storage";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { auth, db, storage } from "../../firebaseConfig";
import { useAuth } from "../../providers/AuthProvider";
import { useDataCache } from "../../providers/DataCacheProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { staticColors } from "../../lib/design/staticColors";
import { designTokens as t } from "../../lib/design/tokens";
import PageShell from "../../components/layout/PageShell";



export default function ProfilePage() {
  const router = useRouter();
  const { user, employee, loading: authLoading, reloadSession } = useAuth();
  const { invalidate } = useDataCache();
  const { colors } = useTheme();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [initialPhone, setInitialPhone] = useState("");
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
  const displayRole = useMemo(() => {
    const value = String(role || "").trim();
    if (!value || ["user", "employee"].includes(value.toLowerCase())) return "Employee";
    return value;
  }, [role]);
  const hasChanges = phone.trim() !== initialPhone.trim();

  const loadProfile = async () => {
    try {
      setLoading(true);

      if (employeeDocId) {
        const docRef = doc(db, "employees", employeeDocId);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
          const data = snap.data();

          setName(data.name || employee?.displayName || "");
          const contactNumber = data.mobile || data.phone || "";
          setPhone(contactNumber);
          setInitialPhone(contactNumber);
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
        mobile: phone.trim() || "",
      });
      await Promise.all([
        invalidate("collection:employees"),
        invalidate("me-dashboard:"),
      ]);
      setInitialPhone(phone.trim());

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
      await uploadBytes(storageRef, blob, {
        contentType: blob.type || "image/jpeg",
      });

      const url = await getDownloadURL(storageRef);

      const docRef = doc(db, "employees", employeeDocId);
      await updateDoc(docRef, { avatarUrl: url });
      await Promise.all([
        invalidate("collection:employees"),
        invalidate("me-dashboard:"),
      ]);

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
        "sessionCompanyId",
        "displayName",
        "employeeId",
        "employeeEmail",
        "employeeUserCode",
        "userCode",
        "timesheetYardStart",
        "timesheetYardEnd",
        "timesheetOfficeStart",
        "timesheetOfficeEnd",
        "timesheetWorkshopStart",
        "timesheetWorkshopEnd",
        "timesheetDefaultType",
      ]);

      global.employee = null;
      await signOut(auth);
      if (reloadSession) await reloadSession();
      router.replace("/(auth)/login");
    } catch (err) {
      console.error("Error logging out:", err);
      Alert.alert("Error", "There was a problem logging you out.");
    }
  };

  const confirmLogout = () => {
    Alert.alert("Log out?", "You will need to sign in again to use the app.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: handleLogout },
    ]);
  };

  const stillLoading = authLoading || loading;

  return (
    <PageShell mode="form" width="form" header={{ variant: "compact", title: "Edit Profile", subtitle: "Manage your profile details.", onBack: router.back }}>
      {stillLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>
            Loading your profile…
          </Text>
        </View>
      ) : (
        <View style={styles.content}>
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
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              accessibilityState={{ disabled: uploadingAvatar, busy: uploadingAvatar }}
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
                  styles.imageBadge,
                  {
                    backgroundColor: colors.accent,
                  },
                ]}
              >
                <Icon name="image" size={13} color={staticColors.hex_fff_yhjmu8} />
              </View>
            </TouchableOpacity>

            <View style={styles.profileText}>
              <Text style={[styles.nameText, { color: colors.text }]}>
                {name || "Unnamed User"}
              </Text>

              <Text style={[styles.roleText, { color: colors.textMuted }]}>
                {displayRole}
              </Text>

              {userCode ? (
                <Text style={[styles.codeText, { color: colors.textMuted }]}>
                  Code {userCode}
                </Text>
              ) : null}
              <AppButton
                label="Change photo"
                icon="camera"
                variant="ghost"
                size="small"
                onPress={handleChangePhoto}
                disabled={uploadingAvatar}
                accessibilityRole="button"
                accessibilityLabel="Change profile photo"
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Account
            </Text>
            <View style={[styles.accountCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {[
                { icon: "user", label: "Name", value: name || "Not set" },
                { icon: "mail", label: "Email", value: email || "Not set" },
                { icon: "hash", label: "Employee code", value: userCode || "Not set" },
              ].map((item, index) => (
                <View
                  key={item.label}
                  style={[
                    styles.accountRow,
                    index > 0 && {
                      borderTopColor: colors.border,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View style={[styles.accountIcon, { backgroundColor: colors.surfaceAlt }]}>
                    <Icon name={item.icon} size={15} color={colors.textMuted} />
                  </View>
                  <View style={styles.accountCopy}>
                    <Text style={[styles.accountLabel, { color: colors.textMuted }]}>{item.label}</Text>
                    <Text style={[styles.accountValue, { color: colors.text }]} numberOfLines={1}>
                      {item.value}
                    </Text>
                  </View>
                  <Icon name="lock" size={13} color={colors.textMuted} />
                </View>
              ))}
            </View>
            <Text style={[styles.helperText, { color: colors.textMuted }]}>Managed by your administrator.</Text>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Contact number
            </Text>

            <View style={styles.fieldGroup}>
              <FormField
                label="Phone number"
                value={phone}
                onChangeText={setPhone}
                placeholder="Enter your phone number"
                disabled={saving}
                hint="Used by the crew directory and booking team."
                inputProps={{ keyboardType: "phone-pad", textContentType: "telephoneNumber" }}
              />
            </View>
          </View>

          <AppButton
            label={hasChanges ? "Save phone number" : "No changes"}
            icon="save"
            onPress={handleSave}
            disabled={!hasChanges || saving}
            loading={saving}
            fullWidth
            accessibilityLabel="Save phone number"
          />

          <View style={[styles.accountActionsSection, { borderTopColor: colors.border }]}>
            <Text style={[styles.accountActionsTitle, { color: colors.textMuted }]}>Account access</Text>
            <AppButton
              label="Log out"
              icon="log-out"
              variant="danger"
              onPress={confirmLogout}
              fullWidth
              accessibilityLabel="Log out"
            />
          </View>
        </View>
      )}
    </PageShell>
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
    paddingHorizontal: t.spacing.lg,
  },

  loadingText: {
    marginTop: t.spacing.sm,
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
  },

  content: {
    flex: 1,
    paddingHorizontal: t.spacing.none,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing.md,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.md,
  },

  backButton: {
    width: 40,
    height: 40,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
    marginRight: t.spacing.sm,
  },

  headerTextWrap: {
    flex: 1,
  },

  pageTitle: {
    fontSize: t.typography.pageTitle.fontSize,
    fontWeight: "900",
    letterSpacing: -0.4,
  },

  pageSubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "600",
  },

  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: t.spacing.md,
  },

  avatarCircle: {
    width: t.controls.buttonHeightLg + t.spacing.lg,
    height: t.controls.buttonHeightLg + t.spacing.lg,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
    overflow: "visible",
    marginRight: t.spacing.md,
  },

  avatarImage: {
    width: t.controls.buttonHeightLg + t.spacing.lg,
    height: t.controls.buttonHeightLg + t.spacing.lg,
    borderRadius: t.radius.pill,
    resizeMode: "cover",
  },

  avatarInitial: {
    fontSize: t.typography.display.fontSize,
    fontWeight: "900",
  },

  imageBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: t.radius.pill,
    justifyContent: "center",
    alignItems: "center",
  },

  profileText: {
    flex: 1,
  },

  nameText: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "900",
    marginBottom: t.spacing.xxs,
  },

  roleText: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    marginBottom: t.spacing.none,
  },

  codeText: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "600",
  },

  section: {
    marginBottom: t.spacing.md,
  },

  sectionTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "900",
    marginBottom: t.spacing.xs,
  },

  fieldGroup: {
    marginBottom: t.spacing.xs,
  },

  accountCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: t.radius.lg,
    paddingHorizontal: t.spacing.sm,
  },
  accountRow: {
    minHeight: t.controls.buttonHeightLg + t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  accountIcon: {
    width: 32,
    height: 32,
    borderRadius: t.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  accountCopy: { flex: 1, minWidth: 0 },
  accountLabel: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  accountValue: {
    marginTop: t.spacing.none,
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "800",
  },

  helperText: {
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "600",
    marginTop: t.spacing.none,
  },
  accountActionsSection: {
    marginTop: t.spacing.lg,
    paddingTop: t.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  accountActionsTitle: {
    marginBottom: t.spacing.xs,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  bottomNote: {
    fontSize: t.typography.metadata.fontSize,
    lineHeight: t.typography.metadata.lineHeight,
    fontWeight: "600",
    textAlign: "center",
    marginTop: t.spacing.sm,
  },
});
