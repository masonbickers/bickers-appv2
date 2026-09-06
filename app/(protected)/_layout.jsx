import { Stack } from "expo-router";

import { useEmployeeNotifications } from "../../hooks/useEmployeeNotifications";
import { useAuth } from "../../providers/AuthProvider";

export default function ProtectedLayout() {
  const { workingTermsAccepted } = useAuth();
  useEmployeeNotifications({ enabled: workingTermsAccepted });

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        animationMatchesGesture: true,
      }}
    >
      <Stack.Screen name="screens/homescreen" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="screens/schedule" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="job" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="contacts" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="me" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="service/home" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="service/work" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="service/book-work" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="service/service-list" options={{ animation: "none", gestureEnabled: false }} />
      <Stack.Screen name="service/issues" options={{ animation: "none", gestureEnabled: false }} />
    </Stack>
  );
}
