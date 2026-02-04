// app/(protected)/bookings/[id].jsx
import { useLocalSearchParams } from "expo-router";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { db } from "../../../firebaseConfig";

export default function BookingView() {
  const { id } = useLocalSearchParams();
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    async function load() {
      const snap = await getDoc(doc(db, "bookings", id));
      if (snap.exists()) setBooking(snap.data());
    }
    load();
  }, [id]);

  if (!booking) return <Text>Loading booking…</Text>;

  return (
    <View>
      <Text>{booking.jobNumber}</Text>
      <Text>{booking.client}</Text>
      <Text>{JSON.stringify(booking, null, 2)}</Text>
    </View>
  );
}
