import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { getDownloadURL, getMetadata, listAll, ref } from "firebase/storage";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { storage } from "../../firebaseConfig";
import { useTheme } from "../providers/ThemeProvider";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

function formatBytes(bytes = 0) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatUpdated(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function InsuranceScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchFiles = useCallback(async () => {
    try {
      setError("");
      const folderRef = ref(storage, "insurance");
      const res = await listAll(folderRef);

      const rows = await Promise.all(
        res.items.map(async (itemRef) => {
          const [meta, url] = await Promise.all([
            getMetadata(itemRef).catch(() => ({})),
            getDownloadURL(itemRef),
          ]);
          return {
            name: itemRef.name,
            path: itemRef.fullPath,
            size: meta?.size || 0,
            url,
            contentType: meta?.contentType || "application/octet-stream",
            updated: meta?.updated || null,
          };
        })
      );

      rows.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(rows);
    } catch (e) {
      console.warn("insurance list error:", e);
      setError("Could not load insurance documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchFiles();
    setRefreshing(false);
  }, [fetchFiles]);

  const openDoc = async (url) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (e) {
      console.warn("open error:", e);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={[
        styles.itemRow,
        {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
        },
      ]}
      activeOpacity={0.85}
      onPress={() => openDoc(item.url)}
    >
      <View
        style={[
          styles.itemIconWrap,
          {
            backgroundColor: withAlpha(colors.accent, 0.12),
            borderColor: withAlpha(colors.accent, 0.35),
          },
        ]}
      >
        <Text style={[styles.badgeText, { color: colors.accent }]}>
          {item.contentType?.includes("pdf") ? "PDF" : "DOC"}
        </Text>
      </View>

      <View style={styles.itemTextWrap}>
        <Text style={[styles.itemText, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.itemSubText, { color: colors.textMuted }]}>
          {item.contentType?.includes("pdf") ? "PDF" : item.contentType} · {formatBytes(item.size)}
          {item.updated ? ` · Updated ${formatUpdated(item.updated)}` : ""}
        </Text>
      </View>

      <View style={styles.itemAction}>
        <Text style={[styles.viewBtnText, { color: colors.accent }]}>View</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <View style={styles.heroContent}>
            <View style={styles.heroTopRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                activeOpacity={0.85}
                style={[
                  styles.backBtn,
                  {
                    backgroundColor: withAlpha(colors.surfaceAlt, 0.75),
                    borderColor: withAlpha(colors.border, 0.75),
                  },
                ]}
              >
                <Icon name="arrow-left" size={15} color={colors.text} />
              </TouchableOpacity>

              <View style={styles.heroTitleWrap}>
                <Text style={[styles.heroEyebrow, { color: colors.textMuted }]}>
                  Technical Library
                </Text>
                <Text style={[styles.heroTitle, { color: colors.text }]}>
                  Insurance & Compliance
                </Text>
              </View>

              <View style={styles.heroSpacer} />
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Loading documents…
              </Text>
            </View>
          ) : error ? (
            <View style={[styles.errorBox, { backgroundColor: colors.danger + "22" }]}>
              <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
              <TouchableOpacity
                onPress={fetchFiles}
                style={[
                  styles.retryButton,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text style={[styles.retryText, { color: colors.text }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : files.length === 0 ? (
            <View
              style={[
                styles.emptyBox,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.surfaceAlt,
                },
              ]}
            >
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No insurance documents found.
              </Text>
            </View>
          ) : (
            <FlatList
              data={files}
              keyExtractor={(item) => item.path}
              renderItem={renderItem}
              scrollEnabled={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={colors.text}
                />
              }
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingBottom: 24, paddingTop: 8 },
  heroCard: {
    position: "relative",
    marginBottom: 8,
  },
  heroContent: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitleWrap: {
    flex: 1,
    paddingTop: 1,
    alignItems: "center",
  },
  heroSpacer: {
    width: 34,
    height: 34,
  },
  heroEyebrow: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontWeight: "800",
    textAlign: "center",
  },
  heroTitle: {
    marginTop: 2,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
    textAlign: "center",
  },
  sectionCard: {
    marginBottom: 12,
  },
  loadingBox: { paddingTop: 24, alignItems: "center", gap: 8 },
  loadingText: {},
  errorBox: {
    padding: 14,
    borderRadius: 12,
    marginTop: 14,
  },
  errorText: {},
  retryButton: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
  },
  retryText: { fontWeight: "700" },
  emptyBox: {
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  emptyText: {},
  listContent: { paddingBottom: 8 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  itemIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontSize: 10, fontWeight: "700" },
  itemTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  itemText: { fontSize: 14, fontWeight: "800", lineHeight: 18 },
  itemSubText: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  itemAction: {
    width: 52,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  viewBtnText: { fontWeight: "800", fontSize: 12 },
});
