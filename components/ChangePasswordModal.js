import { View } from "react-native";

import { designTokens as t } from "../lib/design/tokens";
import {
  AppButton,
  AppModal,
  AppText,
  FormField,
} from "./ui/AppPrimitives";

export default function ChangePasswordModal({
  visible,
  values,
  saving,
  onChange,
  onClose,
  onSubmit,
  onForgotPassword,
}) {
  return (
    <AppModal
      visible={visible}
      onRequestClose={onClose}
      title="Change password"
      actions={
        <>
          <AppButton label="Cancel" variant="ghost" onPress={onClose} disabled={saving} />
          <AppButton
            label={saving ? "Updating" : "Update password"}
            icon="lock"
            onPress={onSubmit}
            loading={saving}
          />
        </>
      }
    >
      <View style={{ gap: t.spacing.md }}>
        <AppText tone="secondary">
          Enter your current password first, then choose a new one.
        </AppText>
        <PasswordField
          label="Current password"
          value={values.currentPassword}
          onChangeText={(text) => onChange("currentPassword", text)}
          textContentType="password"
        />
        <PasswordField
          label="New password"
          value={values.newPassword}
          onChangeText={(text) => onChange("newPassword", text)}
          textContentType="newPassword"
        />
        <PasswordField
          label="Confirm new password"
          value={values.confirmPassword}
          onChangeText={(text) => onChange("confirmPassword", text)}
          textContentType="newPassword"
        />
        <AppButton
          label="Forgotten current password?"
          variant="secondary"
          onPress={onForgotPassword}
          disabled={saving}
          fullWidth
        />
      </View>
    </AppModal>
  );
}

function PasswordField({ label, value, onChangeText, textContentType }) {
  return (
    <FormField
      label={label}
      value={value}
      onChangeText={onChangeText}
      inputProps={{
        secureTextEntry: true,
        autoCapitalize: "none",
        autoCorrect: false,
        textContentType,
        placeholder: "Password",
      }}
    />
  );
}
