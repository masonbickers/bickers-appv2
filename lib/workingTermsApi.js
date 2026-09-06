import * as Application from "expo-application";
import { Platform } from "react-native";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  waitForPendingWrites,
} from "firebase/firestore";

import { db } from "../firebaseConfig";
import {
  WORKING_TERMS_EFFECTIVE_DATE,
  WORKING_TERMS_TITLE,
  WORKING_TERMS_VERSION,
} from "./workingTerms";

export function workingTermsAcceptanceRef(uid) {
  return doc(
    db,
    "workingTermsAcceptances",
    uid,
    "versions",
    WORKING_TERMS_VERSION
  );
}

export function isCurrentWorkingTermsAcceptance(data) {
  return (
    data?.accepted === true &&
    data?.documentVersion === WORKING_TERMS_VERSION &&
    data?.userId
  );
}

export async function loadWorkingTermsAcceptance(firebaseUser) {
  if (!firebaseUser || firebaseUser.isAnonymous) return null;
  const snapshot = await getDoc(workingTermsAcceptanceRef(firebaseUser.uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return isCurrentWorkingTermsAcceptance(data)
    ? { id: snapshot.id, ...data }
    : null;
}

export async function signWorkingTerms({ firebaseUser, employee, fullName, signatureSvgPath }) {
  if (!firebaseUser || firebaseUser.isAnonymous) {
    throw new Error("Your signed-in session is no longer available. Please sign in again.");
  }

  const cleanName = String(fullName || "").trim();
  const cleanSignature = String(signatureSvgPath || "").trim();
  if (cleanName.length < 2) throw new Error("Enter your full name.");
  if (!cleanSignature.startsWith("M ") || cleanSignature.length < 20) {
    throw new Error("Please draw your signature in the box.");
  }

  const ref = workingTermsAcceptanceRef(firebaseUser.uid);
  const existing = await getDoc(ref);
  if (existing.exists() && isCurrentWorkingTermsAcceptance(existing.data())) {
    return { id: existing.id, ...existing.data() };
  }

  await setDoc(ref, {
    accepted: true,
    acceptedAt: serverTimestamp(),
    companyId: String(employee?.companyId || "bickers-action"),
    documentEffectiveDate: WORKING_TERMS_EFFECTIVE_DATE,
    documentTitle: WORKING_TERMS_TITLE,
    documentVersion: WORKING_TERMS_VERSION,
    employeeId: String(employee?.employeeId || ""),
    email: String(firebaseUser.email || employee?.email || "").trim().toLowerCase(),
    fullName: cleanName,
    signatureSvgPath: cleanSignature,
    signedFromAppVersion: String(Application.nativeApplicationVersion || "unknown"),
    signedFromPlatform: Platform.OS,
    userId: firebaseUser.uid,
  });

  // Access remains locked until Firestore has confirmed the immutable record.
  await waitForPendingWrites(db);
  const confirmed = await getDoc(ref);
  if (!confirmed.exists() || !isCurrentWorkingTermsAcceptance(confirmed.data())) {
    throw new Error("Your signature could not be confirmed. Please try again.");
  }
  return { id: confirmed.id, ...confirmed.data() };
}
