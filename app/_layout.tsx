import { Slot, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Footer from "./components/footer"; // adjust path if needed

const FOOTER_HEIGHT = 64;

function RootWithFixedFooter() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Add any auth routes here
  const HIDE_FOOTER_ON = [
    "/screens/login",
    "/login",
    "/screens/auth/login",
  ];

  const hideFooter = HIDE_FOOTER_ON.some((p) => pathname?.startsWith(p));

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#000",
        // only reserve space when footer is visible
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

export default function Layout() {
  return (
    <SafeAreaProvider>
      <RootWithFixedFooter />
    </SafeAreaProvider>
  );
}
