import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBiKz88kMEAB5C-oRn3qN6E7KooDcmYTWE",
  authDomain: "bickers-booking.firebaseapp.com",
  databaseURL: "https://bickers-booking-default-rtdb.firebaseio.com",
  projectId: "bickers-booking",
  storageBucket: "bickers-booking.appspot.com",
  messagingSenderId: "784506946068",
  appId: "1:784506946068:web:7a86167b5f7f4b0b249d01"
};

// ✅ Only initialise once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { auth, db, storage };
