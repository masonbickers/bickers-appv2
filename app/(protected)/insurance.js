import { useRouter } from "expo-router";
import { getDownloadURL, getMetadata, listAll, ref } from "firebase/storage";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import PageShell from "../../components/layout/PageShell";
import { AppText, ListRow } from "../../components/ui/AppPrimitives";
import { storage } from "../../firebaseConfig";
import { designTokens as t } from "../../lib/design/tokens";
import { useAuth } from "../../providers/AuthProvider";

function formatBytes(bytes = 0) {
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[index]}`;
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
  const { user, loading: authLoading } = useAuth();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchFiles = useCallback(async () => {
    try {
      setError("");
      const result = await listAll(ref(storage, "insurance"));
      const rows = await Promise.all(result.items.map(async (itemRef) => {
        const [metadata, url] = await Promise.all([
          getMetadata(itemRef).catch(() => ({})),
          getDownloadURL(itemRef),
        ]);
        return {
          name: itemRef.name,
          path: itemRef.fullPath,
          size: metadata?.size || 0,
          url,
          contentType: metadata?.contentType || "application/octet-stream",
          updated: metadata?.updated || null,
        };
      }));
      rows.sort((a, b) => a.name.localeCompare(b.name));
      setFiles(rows);
    } catch (fetchError) {
      console.warn("insurance list error:", fetchError);
      setError("Could not load insurance documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && user) void fetchFiles();
  }, [authLoading, fetchFiles, user]);

  const onRefresh = useCallback(async () => {
    if (files.length > 0) setRefreshing(true);
    else setLoading(true);
    await fetchFiles();
    setRefreshing(false);
  }, [fetchFiles, files.length]);

  const openDocument = (item) => {
    router.push({
      pathname: "/document-viewer",
      params: {
        url: item.url,
        name: item.name,
        contentType: item.contentType,
      },
    });
  };

  return (
    <PageShell
      header={{ variant: "compact", eyebrow: "Technical Library", title: "Insurance & Compliance", onBack: router.back }}
      state={{
        resources: [{ data: files, error, isInitialLoading: loading || authLoading, isRefreshing: refreshing }],
        hasContent: files.length > 0,
        onRetry: onRefresh,
        loadingLabel: "Loading documents…",
        errorTitle: "Insurance unavailable",
        errorMessage: "Could not load insurance documents. Please try again.",
        refreshErrorMessage: "Could not refresh insurance documents. Showing the saved list.",
        empty: { when: !loading && !authLoading && !error && files.length === 0, icon: "shield", title: "No insurance documents", message: "Insurance and compliance files will appear here when available." },
      }}
      refresh={{ refreshing, onRefresh }}
    >
      <View style={styles.list}>
        {files.map((item, index) => {
          const type = item.contentType?.includes("pdf") ? "PDF" : "DOC";
          const updated = item.updated ? ` · Updated ${formatUpdated(item.updated)}` : "";
          return (
            <ListRow
              key={item.path}
              title={item.name}
              subtitle={`${type === "PDF" ? "PDF" : item.contentType} · ${formatBytes(item.size)}${updated}`}
              leading={
                <AppText variant="metadata" tone="accent" numberOfLines={1}>
                  {type}
                </AppText>
              }
              onPress={() => openDocument(item)}
              divider={index < files.length - 1}
            />
          );
        })}
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  list: { gap: t.spacing.xxs, paddingBottom: t.spacing.xs },
});
