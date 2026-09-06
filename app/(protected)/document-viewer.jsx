import { useLocalSearchParams, useRouter } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";

import PageShell from "../../components/layout/PageShell";
import { StateView } from "../../components/ui/AppPrimitives";
import { designTokens as t } from "../../lib/design/tokens";
import { useTheme } from "../../providers/ThemeProvider";

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeDocumentUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function cacheKey(value) {
  let hash = 0;
  for (const character of String(value || "")) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

export default function DocumentViewerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [localUrl, setLocalUrl] = useState("");
  const [useRemotePdfFallback, setUseRemotePdfFallback] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const url = useMemo(() => safeDocumentUrl(firstParam(params.url)), [params.url]);
  const name = String(firstParam(params.name) || "Document")
    .replace(/\.pdf$/i, "")
    .replace(/\s*\.+$/, "");
  const contentType = String(firstParam(params.contentType) || "");
  const isPdf = contentType.includes("pdf") || /\.pdf(?:$|\?)/i.test(url);
  const viewerUrl = useMemo(
    () =>
      Platform.OS === "ios" && isPdf
        ? useRemotePdfFallback
          ? url
          : localUrl
        : Platform.OS === "android" && isPdf
        ? `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(url)}`
        : url,
    [isPdf, localUrl, url, useRemotePdfFallback]
  );

  useEffect(() => {
    let active = true;
    if (!url || !isPdf || Platform.OS !== "ios") {
      setLocalUrl("");
      setPreparing(false);
      return () => {
        active = false;
      };
    }

    const downloadPdf = async () => {
      setPreparing(true);
      setFailed(false);
      setUseRemotePdfFallback(false);
      try {
        const directory = `${FileSystem.cacheDirectory}document-viewer/`;
        const destination = `${directory}${cacheKey(url)}.pdf`;
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        await FileSystem.deleteAsync(destination, { idempotent: true });
        const result = await FileSystem.downloadAsync(url, destination);
        if (result.status >= 400) throw new Error(`Document download failed (${result.status}).`);
        if (active) setLocalUrl(result.uri);
      } catch (error) {
        console.warn("[document-viewer] PDF download failed:", error?.message || error);
        // WKWebView can render Firebase's HTTPS URL directly when its local-file
        // route is unavailable, so a cache failure should not block the document.
        if (active) setUseRemotePdfFallback(true);
      } finally {
        if (active) setPreparing(false);
      }
    };

    void downloadPdf();
    return () => {
      active = false;
    };
  }, [isPdf, reloadKey, url]);

  const retry = () => {
    setFailed(false);
    setLocalUrl("");
    setUseRemotePdfFallback(false);
    setReloadKey((value) => value + 1);
  };

  const handleViewerFailure = () => {
    if (Platform.OS === "ios" && isPdf && localUrl && !useRemotePdfFallback) {
      console.warn("[document-viewer] Local PDF render failed; retrying from HTTPS.");
      setUseRemotePdfFallback(true);
      return;
    }
    setFailed(true);
  };

  return (
    <PageShell
      mode="static"
      width="full"
      header={{
        variant: "compact",
        eyebrow: isPdf ? "PDF Document" : "Document",
        title: name,
        onBack: router.back,
      }}
    >
      <View style={[styles.viewer, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.border }]}> 
        {!url ? (
          <StateView
            state="error"
            title="Document unavailable"
            message="This document does not have a valid viewing link."
          />
        ) : preparing ? (
          <StateView state="loading" title="Preparing document…" compact />
        ) : failed || !viewerUrl ? (
          <StateView
            state="error"
            title="Document could not be opened"
            message="Check your connection and try loading it again."
            actionLabel="Try again"
            onAction={retry}
          />
        ) : (
          <WebView
            key={`${viewerUrl}-${reloadKey}`}
            source={{ uri: viewerUrl }}
            style={styles.webView}
            originWhitelist={["https://*", "http://*", "file://*"]}
            startInLoadingState
            setSupportMultipleWindows={false}
            allowFileAccess
            allowingReadAccessToURL={FileSystem.cacheDirectory || undefined}
            onError={handleViewerFailure}
            onHttpError={(event) => {
              if (event.nativeEvent.statusCode >= 400) handleViewerFailure();
            }}
            renderLoading={() => (
              <View style={[styles.loading, { backgroundColor: colors.background }]}> 
                <StateView state="loading" title="Opening document…" compact />
              </View>
            )}
          />
        )}
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  viewer: {
    flex: 1,
    minHeight: t.layout.compactBreakpoint,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  webView: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
