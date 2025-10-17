// firebaseConfig.js
import { getApp, getApps, initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { Platform } from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBiKz88kMEAB5C-oRn3qN6E7KooDcmYTWE",
  authDomain: "bickers-booking.firebaseapp.com",
  projectId: "bickers-booking",
  storageBucket: "bickers-booking.firebasestorage.app",
  messagingSenderId: "784506946068",
  appId: "1:784506946068:web:7a86167b5f7f4b0b249d01",
  // databaseURL: "https://bickers-booking-default-rtdb.firebaseio.com", // ← only if you use RTDB
};

// Initialise the app once
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * Auth initialisation:
 * - On web: plain getAuth(app)
 * - On React Native (Expo): MUST call initializeAuth(...) first with AsyncStorage persistence.
 *   If hot reload already initialised it, fall back to getAuth(app).
 */
let auth;
if (Platform.OS === "web") {
  auth = getAuth(app);
} else {
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // If already initialised (e.g., after fast refresh), just grab it
    auth = getAuth(app);
  }
}

const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
