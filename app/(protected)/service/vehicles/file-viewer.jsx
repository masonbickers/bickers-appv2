import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import {
    ActivityIndicator,
    Image,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { WebView } from "react-native-webview";

import { useTheme } from "../../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
};

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

  if (!url) {
    return (
      <SafeAreaView
        style={[
          styles.container,
          { backgroundColor: colors.background || COLORS.background },
        ]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Icon name="chevron-left" size={20} color={COLORS.textHigh} />
          </TouchableOpacity>
          <Text style={styles.title}>Attachment</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>No file URL provided.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Icon
            name="chevron-left"
            size={20}
            color={colors.text || COLORS.textHigh}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.title,
              { color: colors.text || COLORS.textHigh },
            ]}
            numberOfLines={1}
          >
            {name || "Attachment"}
          </Text>
          <Text
            style={[
              styles.subtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
            numberOfLines={1}
          >
            Tap back to return to vehicle overview.
          </Text>
        </View>
      </View>

      {/* CONTENT */}
      <View style={{ flex: 1 }}>
        {isImage ? (
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
                <ActivityIndicator size="large" color="#FF3B30" />
                <Text style={styles.loadingText}>Loading file…</Text>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  subtitle: {
    fontSize: 11,
    marginTop: 2,
    color: COLORS.textMid,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: COLORS.textMid,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.textMid,
  },
  imageWrapper: {
    flex: 1,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
