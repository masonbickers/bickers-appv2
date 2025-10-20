import * as WebBrowser from "expo-web-browser";
import { onAuthStateChanged } from "firebase/auth";
import { getDownloadURL, getMetadata, listAll, ref } from "firebase/storage";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    SafeAreaView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";

// ✅ make sure this path is correct for your project structure
// If this file is app/spec-sheets/index.js, this is likely ../../firebaseConfig
import { auth, storage } from "../firebaseConfig";

// ✅ trailing slash avoids ambiguous matches and mirrors console pathing
const FOLDER_PATH = "spec sheets/"; 

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const kb = (bytes) => (typeof bytes === "number" ? `${(bytes / 1024).toFixed(2)} KB` : "—");

export default function SpecSheetsScreen() {
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
          unsub = onAuthStateChanged(auth, () => resolve(), () => resolve());
        });

        const folderRef = ref(storage, FOLDER_PATH);
        const res = await listAll(folderRef);

        // Optional: prove path works with one known file (temporarily enable for debugging)
        // const testUrl = await getDownloadURL(ref(storage, "spec sheets/Cheyenne Elite Spec 2025.pdf"));
        // console.log("TEST OK:", testUrl);

        const details = await Promise.all(
          res.items.map(async (itemRef) => {
            const [meta, url] = await Promise.all([getMetadata(itemRef), getDownloadURL(itemRef)]);
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
        if (alive) setErr(`${e?.code || "error"} ${e?.message || "Couldn’t load spec sheets. Check Storage rules and folder path."}`);
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
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => openPdf(item.url)}>
      <View style={styles.badge}><Text style={styles.badgeText}>PDF</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>{item.name.replace(/\.pdf$/i, "")}</Text>
        <Text style={styles.meta}>
          {kb(item.size)} · {item.contentType} · {fmtDate(item.updated)}
        </Text>
      </View>
      <View style={styles.viewBtn}><Text style={styles.viewBtnText}>View</Text></View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.wrap}>
      {/* Header + Search */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Spec Sheets</Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search e.g. ‘Silverado’, ‘Cheyenne’, ‘2025’…"
          placeholderTextColor="#8e8e8e"
          style={styles.search}
        />
      </View>

      {/* Content */}
      <View style={{ flex: 1, paddingHorizontal: 14 }}>
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.loadingText}>Loading spec sheets…</Text>
          </View>
        ) : err ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{err}</Text></View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyBox}><Text style={styles.emptyText}>No spec sheets match “{q}”.</Text></View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(i) => i.url}
            renderItem={renderItem}
            contentContainerStyle={{ paddingBottom: 16 }}
          />
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>© {new Date().getFullYear()} Bickers Booking — Spec Sheets</Text>
        <Text style={styles.footerSub}>Firebase Storage · Folder: {FOLDER_PATH}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0a0a0a" },
  header: {
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)",
  },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 8 },
  search: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: "#fff",
  },
  loadingBox: { paddingTop: 24, alignItems: "center", gap: 8 },
  loadingText: { color: "#cfcfcf" },
  errorBox: { padding: 14, borderRadius: 12, backgroundColor: "#3a0d0d", marginTop: 14 },
  errorText: { color: "#ffb3b3" },
  emptyBox: {
    padding: 18, borderRadius: 12, borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)", alignItems: "center", marginTop: 14,
  },
  emptyText: { color: "#bdbdbd" },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", marginTop: 10,
  },
  badge: { borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: "#e6e6e6", fontSize: 10, fontWeight: "700" },
  title: { color: "#fff", fontWeight: "700", fontSize: 15 },
  meta: { color: "#bdbdbd", fontSize: 12, marginTop: 2 },
  viewBtn: {
    marginLeft: "auto", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
  },
  viewBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  footer: {
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14, paddingVertical: 10,
  },
  footerText: { color: "#bdbdbd", fontSize: 12 },
  footerSub: { color: "#8e8e8e", fontSize: 11, marginTop: 2 },
});
