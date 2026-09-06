import { AppText, StateView } from "../../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../../lib/design/semantics";
import { useLocalSearchParams,
  useRouter } from "expo-router";
import { useMemo } from "react";
import {
    ActivityIndicator,
  Image,
  StyleSheet,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import PageShell from "../../../../components/layout/PageShell";
import { useTheme } from "../../../../providers/ThemeProvider";
import { staticColors } from "../../../../lib/design/staticColors";
import { designTokens as t } from "../../../../lib/design/tokens";

export default function FileViewerScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams();

  const url = useMemo(() => {
    if (!params?.url) return null;
    return Array.isArray(params.url) ? params.url[0] : params.url;
  }, [params]);

  const name = useMemo(() => {
    if (!params?.name) return "";
    return Array.isArray(params.name) ? params.name[0] : params.name;
  }, [params]);

  const isImage = useMemo(() => {
    if (!url) return false;
    const lower = url.split("?")[0].toLowerCase();
    return (
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".png") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".heic") ||
      lower.endsWith(".heif")
    );
  }, [url]);

  return (
    <PageShell
      mode="static"
      width="full"
      header={{
        variant: "compact",
        title: name || "Attachment",
        subtitle: "Vehicle attachment",
        onBack: router.back,
      }}
    >
      <View style={[styles.viewer, { backgroundColor: colors.background || COLORS.background }]}>
        {!url ? (
          <StateView
            state="error"
            title="Attachment unavailable"
            message="No file URL was provided."
          />
        ) : isImage ? (
          <View style={styles.imageWrapper}>
            <Image
              source={{ uri: url }}
              style={styles.image}
              resizeMode="contain"
            />
          </View>
        ) : (
          <WebView
            source={{ uri: url }}
            style={{ flex: 1 }}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.center}>
                <ActivityIndicator size="large" color={staticColors.hex_ed1c25_4py4qa} />
                <AppText variant="bodySmall" tone="secondary" layoutStyle={styles.loadingText}>
                  Loading file…
                </AppText>
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
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  imageWrapper: {
    flex: 1,
    backgroundColor: staticColors.hex_000_yhlkvq,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
