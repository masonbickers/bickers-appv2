import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { getDownloadURL, getMetadata, listAll, ref } from "firebase/storage";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { SafeAreaView } from "react-native-safe-area-context";

import { auth, storage } from "../../firebaseConfig";
import { useTheme } from "../../providers/ThemeProvider"; // 👈 theme

// ✅ trailing slash avoids ambiguous matches and mirrors console pathing
const FOLDER_PATH = "spec sheets/";

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const kb = (bytes) =>
  typeof bytes === "number" ? `${(bytes / 1024).toFixed(2)} KB` : "—";

function withAlpha(hex, alpha) {
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const raw = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return `rgba(255,255,255,${safeAlpha})`;
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${safeAlpha})`;
}

export default function SpecSheetsScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  const [files, setFiles] = useState([]); // [{name,size,updated,contentType,url}]
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    let unsub = () => {};

    const load = async () => {
      try {
        setLoading(true);
        setErr("");

        // 🔐 ensure user is signed-in before listing (matches common Storage rules)
        await new Promise((resolve) => {
          unsub = onAuthStateChanged(
            auth,
            () => resolve(),
            () => resolve()
          );
        });

        const folderRef = ref(storage, FOLDER_PATH);
        const res = await listAll(folderRef);

        const details = await Promise.all(
          res.items.map(async (itemRef) => {
            const [meta, url] = await Promise.all([
              getMetadata(itemRef),
              getDownloadURL(itemRef),
            ]);
            return {
              name: meta.name,
              size: meta.size || 0,
              contentType: meta.contentType || "application/pdf",
              updated: meta.updated || meta.timeCreated || "",
              url,
            };
          })
        );

        details.sort((a, b) => a.name.localeCompare(b.name));
        if (alive) setFiles(details);
      } catch (e) {
        console.log("SPEC SHEETS ERROR:", e?.code, e?.message);
        if (alive)
          setErr(
            `${e?.code || "error"} ${
              e?.message ||
              "Couldn’t load spec sheets. Check Storage rules and folder path."
            }`
          );
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    return () => {
      alive = false;
      unsub && unsub();
    };
  }, []);

  const filtered = useMemo(() => {
    const v = q.trim().toLowerCase();
    if (!v) return files;
    return files.filter((f) => f.name.toLowerCase().includes(v));
  }, [files, q]);

  const openPdf = async (url) => {
    try {
      const res = await WebBrowser.openBrowserAsync(url);
      if (res.type === "cancel") {
        // user closed
      }
    } catch (e) {
      console.log("Open failed", e);
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
      onPress={() => openPdf(item.url)}
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
        <Text style={[styles.badgeText, { color: colors.accent }]}>PDF</Text>
      </View>

      <View style={styles.itemTextWrap}>
        <Text
          style={[styles.itemText, { color: colors.text }]}
          numberOfLines={1}
        >
          {item.name.replace(/\.pdf$/i, "")}
        </Text>
        <Text style={[styles.itemSubText, { color: colors.textMuted }]}>
          {kb(item.size)} · {item.contentType} · {fmtDate(item.updated)}
        </Text>
      </View>

      <View style={styles.itemAction}>
        <Text style={[styles.viewBtnText, { color: colors.accent }]}>View</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.wrap, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
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
                <Text style={[styles.heroTitle, { color: colors.text }]}>Spec Sheets</Text>
              </View>

              <View style={styles.heroSpacer} />
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search e.g. ‘Silverado’, ‘Cheyenne’, ‘2025’…"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.search,
              {
                backgroundColor: colors.surfaceAlt,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
          />
        </View>

        <View style={styles.sectionCard}>
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Loading spec sheets…
              </Text>
            </View>
          ) : err ? (
            <View style={[styles.errorBox, { backgroundColor: colors.danger + "22" }]}>
              <Text style={[styles.errorText, { color: colors.danger }]}>{err}</Text>
            </View>
          ) : filtered.length === 0 ? (
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
                No spec sheets match “{q}”.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.url}
              renderItem={renderItem}
              scrollEnabled={false}
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
  search: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loadingBox: { paddingTop: 24, alignItems: "center", gap: 8 },
  loadingText: {},
  errorBox: {
    padding: 14,
    borderRadius: 12,
    marginTop: 14,
  },
  errorText: {},
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
