// app/_layout.tsx
import { Slot, usePathname, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import Footer from "./components/footer"; // app/components/footer.js
import useEnsureAuth from "./hooks/useEnsureAuth"; // app/hooks/useEnsureAuth.ts

const FOOTER_HEIGHT = 64;
try { SplashScreen.preventAutoHideAsync(); } catch {}

function Shell() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Hide footer only on the public login route
  const hideFooter = pathname === "/login";

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#000",
        paddingBottom: (hideFooter ? 0 : FOOTER_HEIGHT) + insets.bottom,
      }}
    >
      <StatusBar style="light" backgroundColor="#000" />
      <Slot />
      {!hideFooter && (
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: insets.bottom,
            backgroundColor: "transparent",
          }}
        >
          <Footer />
        </View>
      )}
    </View>
  );
}

function AuthGate() {
  const { user, loading } = useEnsureAuth();
  const segments = useSegments(); // e.g. ["(auth)","login"] or ["(protected)","index"]
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    try { SplashScreen.hideAsync(); } catch {}

    const group = Array.isArray(segments) && segments.length > 0 ? segments[0] : undefined;
    const inAuthGroup = group === "(auth)";

    // Use group-less redirects so URLs are stable
    if (!user && !inAuthGroup) router.replace("../login");
    if (user && inAuthGroup) router.replace("/");
  }, [loading, user, segments]);

  return <Shell />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthGate />
    </SafeAreaProvider>
  );
}
