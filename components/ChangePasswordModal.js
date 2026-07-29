import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export default function ChangePasswordModal({
  visible,
  colors,
  values,
  saving,
  onChange,
  onClose,
  onSubmit,
  onForgotPassword,
}) {
  const palette = {
    background: colors?.background || "#000000",
    surface: colors?.surface || "#0B0B0C",
    surfaceAlt: colors?.surfaceAlt || "#151517",
    border: colors?.border || "#2B2B31",
    text: colors?.text || "#F5F5F5",
    textMuted: colors?.textMuted || "#A1A1AA",
    accent: colors?.accent || "#ED1C25",
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
            },
          ]}
        >
          <View style={styles.handle} />

          <Text style={[styles.title, { color: palette.text }]}>Change Password</Text>
          <Text style={[styles.subtitle, { color: palette.textMuted }]}>
            Enter your current password first, then choose a new one.
          </Text>

          <PasswordField
            label="Current password"
            value={values.currentPassword}
            onChangeText={(text) => onChange("currentPassword", text)}
            colors={palette}
            textContentType="password"
          />
          <PasswordField
            label="New password"
            value={values.newPassword}
            onChangeText={(text) => onChange("newPassword", text)}
            colors={palette}
            textContentType="newPassword"
          />
          <PasswordField
            label="Confirm new password"
            value={values.confirmPassword}
            onChangeText={(text) => onChange("confirmPassword", text)}
            colors={palette}
            textContentType="newPassword"
          />

          <TouchableOpacity
            style={[
              styles.primaryButton,
              {
                backgroundColor: palette.accent,
                opacity: saving ? 0.72 : 1,
              },
            ]}
            onPress={onSubmit}
            activeOpacity={0.9}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Icon name="lock" size={16} color="#FFFFFF" />
            )}
            <Text style={styles.primaryButtonText}>
              {saving ? "Updating" : "Update password"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryButton,
              {
                backgroundColor: palette.surfaceAlt,
                borderColor: palette.border,
              },
            ]}
            onPress={onForgotPassword}
            activeOpacity={0.9}
            disabled={saving}
          >
            <Text style={[styles.secondaryButtonText, { color: palette.text }]}>
              Forgotten current password?
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            activeOpacity={0.9}
            disabled={saving}
          >
            <Text style={[styles.cancelButtonText, { color: palette.textMuted }]}>
              Cancel
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PasswordField({ label, value, onChangeText, colors, textContentType }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType={textContentType}
        placeholder="Password"
        placeholderTextColor={withAlpha(colors.textMuted, 0.58)}
        style={[
          styles.input,
          {
            backgroundColor: colors.surfaceAlt,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  sheet: {
    width: "92%",
    maxWidth: 430,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 99,
    backgroundColor: "rgba(148,163,184,0.45)",
    alignSelf: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 5,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  fieldWrap: {
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.35,
    marginBottom: 5,
  },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    fontWeight: "700",
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginTop: 8,
    paddingHorizontal: 12,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "900",
  },
  cancelButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "900",
  },
});
