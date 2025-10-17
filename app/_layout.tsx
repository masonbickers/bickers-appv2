import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Footer from "./components/footer"; // adjust path if needed

const FOOTER_HEIGHT = 64;

function RootWithFixedFooter() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#000",
        // let content scroll above the fixed footer
        paddingBottom: FOOTER_HEIGHT + insets.bottom,
      }}
    >
      {/* Global status bar */}
      <StatusBar style="light" backgroundColor="#000" />

      {/* All pages render here */}
      <Slot />

      {/* Fixed footer */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          paddingBottom: insets.bottom, // iPhone home indicator
          backgroundColor: "transparent",
        }}
      >
        <Footer />
      </View>
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
