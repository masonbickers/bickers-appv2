import { AppText as Text } from "../../../components/ui/AppPrimitives";
// app/(protected)/bookings/[id].jsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  View,
} from "react-native";
import { db } from "../../../firebaseConfig";
import { isBookingVisibleToEmployee } from "../../../lib/bookingVisibility";
import { useAuth } from "../../../providers/AuthProvider";
import PageShell from "../../../components/layout/PageShell";

export default function BookingView() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { employee } = useAuth();
  const [booking, setBooking] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, "bookings", id));
      const nextBooking = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      if (nextBooking && isBookingVisibleToEmployee(nextBooking, employee)) {
        setBooking(nextBooking);
        setUnavailable(false);
      } else {
        setBooking(null);
        setUnavailable(true);
      }
    }
    load();
  }, [employee, id]);

  if (unavailable) {
    return (
      <PageShell header={{ variant: "compact", title: "Booking", onBack: router.back }}>
        <View>
        <Text>This booking is not currently available in your employee app.</Text>
        <Text onPress={() => router.back()}>Go back</Text>
        </View>
      </PageShell>
    );
  }

  return (
    <PageShell
      header={{ variant: "compact", title: booking?.jobNumber || "Booking", onBack: router.back }}
      state={{ resources: [{ isInitialLoading: !booking }], hasContent: Boolean(booking), loadingLabel: "Loading booking…" }}
    >
      {booking ? (
        <View>
          <Text>{booking.jobNumber}</Text>
          <Text>{booking.client}</Text>
          <Text>{JSON.stringify(booking, null, 2)}</Text>
        </View>
      ) : null}
    </PageShell>
  );
}
