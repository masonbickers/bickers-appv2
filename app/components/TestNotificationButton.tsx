// app/components/TestNotificationButton.tsx
import * as Notifications from "expo-notifications";
import React from "react";
import { Platform, Pressable, Text } from "react-native";

export default function TestNotificationButton() {
  const onPress = async () => {
    // ask permission
    const { status: s1 } = await Notifications.getPermissionsAsync();
    if (s1 !== "granted") {
      const { status: s2 } = await Notifications.requestPermissionsAsync();
      if (s2 !== "granted") return;
    }

    // Android channel
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
      });
    }

    // ⬇️ cast to the right union type
    const trigger = {
      seconds: 3,
      channelId: "default",
    } as Notifications.TimeIntervalTriggerInput;

    const id = await Notifications.scheduleNotificationAsync({
      content: { title: "Test", body: "Local notification in 3s" },
      trigger,
    });
    console.log("Scheduled id:", id);
  };

  return (
    <Pressable onPress={onPress} style={{ padding: 12, backgroundColor: "#222", borderRadius: 8 }}>
      <Text style={{ color: "#fff" }}>Send Local Notification</Text>
    </Pressable>
  );
}
