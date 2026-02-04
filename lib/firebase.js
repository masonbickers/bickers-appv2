// lib/firebase.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  getReactNativePersistence,
  GoogleAuthProvider,
  initializeAuth,
  setPersistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBiKz88kMEAB5C-oRn3qN6E7KooDcmYTWE",
  authDomain: "bickers-booking.firebaseapp.com",
  projectId: "bickers-booking",
  storageBucket: "bickers-booking.firebasestorage.app",
  messagingSenderId: "784506946068",
  appId: "1:784506946068:web:7a86167b5f7f4b0b249d01",
};

// Reuse existing app if already initialised (avoids duplicate init in dev)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth;
if (Platform.OS === "web") {
  // Web: persist in localStorage
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence).catch(() => {});
} else {
  // Native (iOS/Android): persist in AsyncStorage
  try {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Fallback if auth was already initialised
    auth = getAuth(app);
  }
}

const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, googleProvider, storage };

