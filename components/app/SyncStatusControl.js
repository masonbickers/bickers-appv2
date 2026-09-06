import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { resolveSyncStatus } from "../../lib/sync/status";
import { designTokens as t } from "../../lib/design/tokens";
import { useSyncStatus } from "../../providers/SyncStatusProvider";
import { useTheme } from "../../providers/ThemeProvider";
import { AppButton, AppModal, AppText } from "../ui/AppPrimitives";

const friendlyEntity = (item) => {
  const explicit = String(item?.meta?.label || item?.entityType || "").trim();
  const pathCollection = String(item?.docPath || "").split("/").filter(Boolean).at(-2) || "change";
  return (explicit || pathCollection)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
};

const formatDateTime = (value) => {
  if (!value) return "Not synced on this device yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

export default function SyncStatusControl() {
  const { colors } = useTheme();
  const {
    isOnline,
    syncing,
    outboxCount,
    outboxItems,
    lastSyncedAt,
    lastError,
    triggerSync,
  } = useSyncStatus();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const status = resolveSyncStatus({ isOnline, syncing, outboxCount, lastError });
  const foreground = colors[status.tone] || colors.info;
  const background = colors[`${status.tone}Soft`] || colors.infoSoft;
  const canRetry = isOnline === true && !syncing;
  const isCompact = status.key === "synced";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${status.label}. Open sync details.`}
        onPress={() => setDetailsVisible(true)}
        style={({ pressed, focused }) => [
          styles.chip,
          isCompact && styles.compactChip,
          {
            backgroundColor: background,
            borderColor: focused ? colors.focusRing : foreground,
            opacity: pressed ? 0.78 : 1,
          },
        ]}
      >
        {syncing ? (
          <ActivityIndicator size="small" color={foreground} />
        ) : (
          <Icon name={status.icon} size={t.iconSize.sm} color={foreground} />
        )}
        {!isCompact ? (
          <>
            <AppText variant="metadata" style={[styles.chipText, { color: foreground }]}> 
              {status.label}
            </AppText>
            <Icon name="chevron-up" size={t.iconSize.xs} color={foreground} />
          </>
        ) : null}
      </Pressable>

      <AppModal
        visible={detailsVisible}
        onRequestClose={() => setDetailsVisible(false)}
        title="Sync status"
        keyboardAvoiding={false}
        actions={
          <>
            <AppButton label="Close" variant="secondary" onPress={() => setDetailsVisible(false)} />
            <AppButton
              label={syncing ? "Syncing…" : "Sync now"}
              icon="refresh-cw"
              disabled={!canRetry}
              loading={syncing}
              onPress={() => triggerSync("manual")}
            />
          </>
        }
      >
        <View style={styles.modalContent}>
          <View style={[styles.statusRow, { backgroundColor: background, borderColor: foreground }]}>
            <Icon name={status.icon} size={t.iconSize.md} color={foreground} />
            <View style={styles.statusCopy}>
              <AppText variant="bodyStrong" style={{ color: foreground }}>{status.label}</AppText>
              <AppText variant="bodySmall" tone="secondary">
                {isOnline === false
                  ? "You can keep working. Saved changes will retry automatically when the connection returns."
                  : outboxCount > 0
                    ? "These saved changes are waiting to be sent."
                    : "This device has no changes waiting to be sent."}
              </AppText>
            </View>
          </View>

          <View>
            <AppText variant="metadata" tone="secondary">Last successful sync</AppText>
            <AppText variant="body">{formatDateTime(lastSyncedAt)}</AppText>
          </View>

          {outboxItems.length ? (
            <View style={styles.queueSection}>
              <AppText variant="bodyStrong">Waiting to sync ({outboxItems.length})</AppText>
              <ScrollView style={styles.queueList} nestedScrollEnabled>
                {outboxItems.map((item) => (
                  <View key={item.id} style={[styles.queueItem, { borderColor: colors.border }]}>
                    <View style={styles.queueItemCopy}>
                      <AppText variant="bodySmall" style={styles.queueTitle}>{friendlyEntity(item)}</AppText>
                      <AppText variant="caption" tone="secondary">
                        Saved {formatDateTime(item.createdAt)}
                      </AppText>
                    </View>
                    <Icon name="clock" size={t.iconSize.sm} color={colors.warning} />
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {lastError ? (
            <AppText variant="bodySmall" tone="danger">{lastError}</AppText>
          ) : null}
        </View>
      </AppModal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: t.controls.buttonHeight,
    maxWidth: 260,
    borderWidth: 1,
    borderRadius: t.radius.pill,
    paddingHorizontal: t.spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    ...t.shadows.md,
  },
  chipText: { flexShrink: 1, fontWeight: "800" },
  compactChip: {
    width: t.controls.buttonHeight,
    paddingHorizontal: t.spacing.none,
    justifyContent: "center",
  },
  modalContent: { gap: t.spacing.md },
  statusRow: {
    borderWidth: 1,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.sm,
  },
  statusCopy: { flex: 1, gap: t.spacing.xxs },
  queueSection: { gap: t.spacing.xs },
  queueList: { maxHeight: 220 },
  queueItem: {
    minHeight: t.controls.buttonHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },
  queueItemCopy: { flex: 1 },
  queueTitle: { fontWeight: "700" },
});
