import { Stack } from 'expo-router';
import React from 'react';
import { StatusBar } from 'react-native';

export default function Layout() {
  return (
    <>
      {/* Set global status bar appearance */}
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <Stack
        screenOptions={{
          headerShown: false, // hide the default top header
        }}
      />
    </>
  );
}
