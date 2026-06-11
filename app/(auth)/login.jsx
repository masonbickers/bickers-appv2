//app/(auth)/login.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInAnonymously,
  signOut,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { auth, db } from "../../firebaseConfig";
import { inferServiceAccess, normaliseSessionRole } from "../../lib/access";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

const SETUP_STEP = "setup";
const INVITE_STEP = "invite";
const PHONE_STEP = "phone";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_COMPANY_ID = "bickers-action";
const EMPLOYEE_LOOKUP_PERMISSION_MESSAGE =
  "The app cannot read employee records during login. Firestore rules need to allow this employee lookup, or login must use a backend endpoint.";

function getNativeAuth() {
  if (Platform.OS === "web" || Constants?.appOwnership === "expo") return null;

  try {
    const mod = require("@react-native-firebase/auth");
    return mod.default || mod;
  } catch {
    return null;
  }
}

function smsVerificationUnavailableInExpoGo() {
  return Platform.OS !== "web" && Constants?.appOwnership === "expo";
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (!raw.startsWith("+") && digits.startsWith("0")) {
    return `+44${digits.slice(1)}`;
  }
  return `+${digits}`;
}

function phoneIsValid(value) {
  if (!String(value || "").trim().startsWith("+")) return false;
  const normalized = normalizePhone(value);
  const digitCount = normalized.replace(/\D/g, "").length;
  return digitCount >= 10 && digitCount <= 15;
}

function getEmployeePhoneCandidates(employee) {
  return [
    employee?.auth?.phoneNumber,
    employee?.phoneNumber,
    employee?.phone,
    employee?.mobile,
    employee?.mobileNumber,
    employee?.contactNumber,
    employee?.telephone,
  ]
    .map(normalizePhone)
    .filter(Boolean);
}

function phoneMatchesEmployee(employee, phoneNumber) {
  const normalizedPhone = normalizePhone(phoneNumber);
  const candidates = getEmployeePhoneCandidates(employee);
  return candidates.length > 0 && candidates.includes(normalizedPhone);
}

function employeeIsBlocked(employee) {
  return (
    employee?.status === "disabled" ||
    employee?.isEnabled === false ||
    employee?.archived === true ||
    employee?.disabled === true ||
    employee?.active === false
  );
}

function employeeEmailMatches(employee, email) {
  const emailStr = String(email || "").trim().toLowerCase();
  const empEmail = String(employee?.email || "").trim().toLowerCase();
  const empEmails = Array.isArray(employee?.emails)
    ? employee.emails.map((e) => String(e || "").trim().toLowerCase())
    : [];

  return (
    (!!empEmail && empEmail === emailStr) ||
    (empEmails.length > 0 && empEmails.includes(emailStr))
  );
}

function toSecurityRole(value) {
  const role = String(value || "").trim();
  if (["platformAdmin", "admin", "user"].includes(role)) return role;
  return "user";
}

function companyIdForEmployee(employee) {
  return String(employee?.companyId || DEFAULT_COMPANY_ID).trim();
}

function isFirebasePermissionError(err) {
  return (
    err?.code === "permission-denied" ||
    err?.code === "firestore/permission-denied" ||
    /missing or insufficient permissions/i.test(String(err?.message || ""))
  );
}

async function getUserProfile(firebaseUser) {
  if (!firebaseUser?.uid || firebaseUser.isAnonymous) return null;

  try {
    const snap = await getDoc(doc(db, "users", firebaseUser.uid));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsSent, setSmsSent] = useState(false);
  const [smsConfirmation, setSmsConfirmation] = useState(null);
  const [loginStep, setLoginStep] = useState(null);
  const [pendingEmployee, setPendingEmployee] = useState(null);
  const [pendingSessionData, setPendingSessionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const migrationCheckedRef = useRef(false);

  const router = useRouter();
  const { reloadSession } = useAuth();
  const { colors } = useTheme();

  const setSession = async (data) => {
    await AsyncStorage.multiSet([
      ["sessionRole", data.role || ""],
      ["sessionIsService", data.isService ? "1" : "0"],
      ["sessionCompanyId", data.companyId || DEFAULT_COMPANY_ID],
      ["sessionUserAccess", data.appAccess?.user ? "1" : "0"],
      ["sessionServiceAccess", data.appAccess?.service ? "1" : "0"],
      ["displayName", data.displayName || ""],
      ["employeeId", data.employeeId || ""],
      ["employeeEmail", data.email || ""],
      ["employeeUserCode", data.userCode || ""],
      ["userCode", data.userCode || ""],
      ["timesheetYardStart", data.timesheetYardStart || ""],
      ["timesheetYardEnd", data.timesheetYardEnd || ""],
      ["timesheetOfficeStart", data.timesheetOfficeStart || ""],
      ["timesheetOfficeEnd", data.timesheetOfficeEnd || ""],
      ["timesheetWorkshopStart", data.timesheetWorkshopStart || ""],
      ["timesheetWorkshopEnd", data.timesheetWorkshopEnd || ""],
      ["timesheetDefaultType", data.timesheetDefaultType || ""],
    ]);
  };

  const clearCredentialFields = () => {
    setPassword("");
    setConfirmPassword("");
    setPhoneNumber("");
    setSmsCode("");
    setSmsSent(false);
    setSmsConfirmation(null);
  };

  const preparePasswordSetup = (employee, sessionData) => {
    setPendingEmployee(employee);
    setPendingSessionData(sessionData);
    setPassword("");
    setConfirmPassword("");
    setPhoneNumber(normalizePhone(getEmployeePhoneCandidates(employee)[0]));
    setSmsCode("");
    setSmsSent(false);
    setSmsConfirmation(null);
    setLoginStep(SETUP_STEP);
  };

  const resetLoginFlow = () => {
    setLoginStep(null);
    setPendingEmployee(null);
    setPendingSessionData(null);
    clearCredentialFields();
  };

  const buildSessionData = (employee, codeStr, emailStr) => {
    const sessionRole = normaliseSessionRole(employee);
    const isServiceUser = inferServiceAccess(employee);
    const appAccess = employee?.appAccess || {
      user: !isServiceUser,
      service: isServiceUser,
    };
    return {
      role: toSecurityRole(employee?.role || sessionRole),
      isService: isServiceUser,
      appAccess,
      companyId: companyIdForEmployee(employee),
      displayName: employee.name || "Employee",
      email: employee.email || emailStr,
      employeeId: employee.id,
      userCode: codeStr,
      timesheetYardStart:
        employee?.timesheetDefaults?.yardStart ||
        employee?.yardStartTime ||
        employee?.yardStart ||
        "",
      timesheetYardEnd:
        employee?.timesheetDefaults?.yardEnd ||
        employee?.yardEndTime ||
        employee?.yardEnd ||
        "",
      timesheetOfficeStart:
        employee?.timesheetDefaults?.officeStart ||
        employee?.officeStartTime ||
        employee?.officeStart ||
        "",
      timesheetOfficeEnd:
        employee?.timesheetDefaults?.officeEnd ||
        employee?.officeEndTime ||
        employee?.officeEnd ||
        "",
      timesheetWorkshopStart:
        employee?.timesheetDefaults?.workshopStart ||
        employee?.workshopStartTime ||
        employee?.workshopStart ||
        "",
      timesheetWorkshopEnd:
        employee?.timesheetDefaults?.workshopEnd ||
        employee?.workshopEndTime ||
        employee?.workshopEnd ||
        "",
      timesheetDefaultType:
        (() => {
          const raw = String(
          employee?.timesheetDefaults?.defaultType ||
            employee?.timesheetDefaultType ||
            ""
          )
            .trim()
            .toLowerCase();
          return raw === "office" || raw === "workshop" ? raw : "yard";
        })(),
    };
  };

  const completeLogin = async (sessionData, employee) => {
    global.employee = employee;
    await setSession(sessionData);

    if (reloadSession) {
      await reloadSession();
    }

    Alert.alert("Welcome", `Hello ${employee.name || sessionData.email}`);
    router.replace(sessionData.isService ? "/service/home" : "/screens/homescreen");
  };

  const completeExpoGoPasswordLogin = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser || firebaseUser.isAnonymous) {
      Alert.alert("Login failed", "Sign in with email and password first.");
      return;
    }

    const cleanPhone = normalizePhone(phoneNumber);
    await updateEmployeeAuthLink(firebaseUser, pendingEmployee, cleanPhone);
    await bootstrapUserAccess(firebaseUser, pendingEmployee, cleanPhone);

    await completeLogin(pendingSessionData, {
      ...pendingEmployee,
      uid: firebaseUser.uid,
      authUid: firebaseUser.uid,
      phone: cleanPhone,
      phoneNumber: cleanPhone,
      phoneVerified: true,
      auth: {
        ...(pendingEmployee.auth || {}),
        uid: firebaseUser.uid,
        email: firebaseUser.email || pendingSessionData.email,
        passwordEnabled: true,
        phoneNumber: cleanPhone,
        phoneVerified: true,
      },
    });
  };

  const sendResetPasswordEmail = async (email) => {
    const emailForReset = String(email || "").trim().toLowerCase();
    if (!emailForReset) {
      Alert.alert("Missing email", "Enter your work email first.");
      return;
    }

    try {
      await sendPasswordResetEmail(auth, emailForReset);
      Alert.alert(
        "Reset email sent",
        `Check ${emailForReset} for the Firebase password reset link.`
      );
    } catch (err) {
      Alert.alert(
        "Reset failed",
        err?.message || "Unable to send a password reset email."
      );
    }
  };

  const alertExistingFirebasePassword = (email) => {
    Alert.alert(
      "Password already set",
      "This email already has a Firebase password. Use the existing password or reset it now.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset password",
          onPress: () => sendResetPasswordEmail(email),
        },
      ]
    );
  };

  const queryOneEmployee = async (field, value, companyId) => {
    if (value === undefined || value === null || value === "") return null;
    const constraints = [where(field, "==", value)];
    if (companyId) constraints.push(where("companyId", "==", companyId));
    constraints.push(limit(1));

    const snap = await getDocs(query(collection(db, "employees"), ...constraints));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  };

  const ensureEmployeeAllowed = (employee, email) => {
    if (!employee) {
      Alert.alert(
        "Access blocked",
        "No active employee record was found for this account."
      );
      return false;
    }

    if (employeeIsBlocked(employee)) {
      Alert.alert("Access blocked", "Your account is disabled. Contact admin.");
      return false;
    }

    if (!employeeEmailMatches(employee, email)) {
      Alert.alert(
        "Email mismatch",
        "This email does not match the employee record."
      );
      return false;
    }

    return true;
  };

  const bootstrapUserAccess = async (firebaseUser, employee, cleanPhone) => {
    const sessionRole = normaliseSessionRole(employee);
    const isServiceUser = inferServiceAccess(employee);
    const appAccess = employee.appAccess || {
      user: !isServiceUser,
      service: isServiceUser,
    };
    const accessData = {
      email: firebaseUser.email || employee.email || "",
      employeeId: employee.id,
      authUid: firebaseUser.uid,
      uid: firebaseUser.uid,
      role: toSecurityRole(employee.role || sessionRole),
      companyId: companyIdForEmployee(employee),
      isEnabled: employee.isEnabled !== false && employee.disabled !== true,
      displayName: employee.name || firebaseUser.displayName || "",
      appAccess,
      defaultWorkspace: employee.defaultWorkspace || null,
      phone: cleanPhone,
      phoneNumber: cleanPhone,
      phoneVerified: true,
      phoneVerifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, "users", firebaseUser.uid), accessData, { merge: true });
  };

  const updateEmployeeAuthLink = async (firebaseUser, employee, cleanPhone) => {
    await updateDoc(doc(db, "employees", employee.id), {
      uid: firebaseUser.uid,
      authUid: firebaseUser.uid,
      phone: cleanPhone,
      phoneNumber: cleanPhone,
      phoneVerified: true,
      phoneVerifiedAt: employee?.phoneVerifiedAt || serverTimestamp(),
      "auth.uid": firebaseUser.uid,
      "auth.email": firebaseUser.email || employee.email || "",
      "auth.passwordEnabled": true,
      "auth.phoneNumber": cleanPhone,
      "auth.phoneVerified": true,
      "auth.phoneVerifiedAt": employee?.auth?.phoneVerifiedAt || serverTimestamp(),
      "auth.lastLoginAt": serverTimestamp(),
    });
  };

  const findEmployeeForFirebaseUser = async (firebaseUser, email) => {
    const uid = firebaseUser?.uid;
    const emailStr = String(email || firebaseUser?.email || "").trim().toLowerCase();
    const userProfile = await getUserProfile(firebaseUser);
    const companyId = String(userProfile?.companyId || DEFAULT_COMPANY_ID).trim();

    if (userProfile?.employeeId) {
      const employeeSnap = await getDoc(
        doc(db, "employees", String(userProfile.employeeId))
      ).catch(() => null);
      if (employeeSnap?.exists()) {
        return { id: employeeSnap.id, ...employeeSnap.data() };
      }
    }

    const lookups = [
      ["authUid", uid],
      ["uid", uid],
      ["auth.uid", uid],
      ["email", emailStr],
    ];

    for (const [field, value] of lookups) {
      const employee = await queryOneEmployee(field, value, companyId).catch(() => null);
      if (employee) return employee;
    }

    const emailsSnap = await getDocs(
      query(
        collection(db, "employees"),
        where("companyId", "==", companyId),
        where("emails", "array-contains", emailStr),
        limit(1)
      )
    ).catch(() => null);

    if (emailsSnap && !emailsSnap.empty) {
      return { id: emailsSnap.docs[0].id, ...emailsSnap.docs[0].data() };
    }

    return null;
  };

  const findEmployeeByCodeAndEmail = async (
    rawCode,
    rawEmail,
    { showAlerts = true } = {}
  ) => {
    const codeStr = String(rawCode).replace(/\D/g, "").padStart(4, "0");
    const emailStr = String(rawEmail).trim().toLowerCase();

    if (!codeStr || codeStr.length !== 4) {
      if (showAlerts) {
        Alert.alert("Invalid code", "Employee code must be 4 digits.");
      }
      return;
    }
    if (!emailStr) {
      if (showAlerts) {
        Alert.alert("Missing email", "Please enter your work email.");
      }
      return;
    }
    if (!EMAIL_RE.test(emailStr)) {
      if (showAlerts) {
        Alert.alert("Invalid email", "Please enter a valid work email address.");
      }
      return;
    }

    if (!auth.currentUser) await signInAnonymously(auth);

    const companyId = DEFAULT_COMPANY_ID;
    let snap;
    try {
      snap = await getDocs(
        query(
          collection(db, "employees"),
          where("companyId", "==", companyId),
          where("userCode", "==", codeStr),
          limit(1)
        )
      );
      if (snap.empty) {
        const codeNum = Number(codeStr);
        snap = await getDocs(
          query(
            collection(db, "employees"),
            where("companyId", "==", companyId),
            where("userCode", "==", codeNum),
            limit(1)
          )
        );
      }
    } catch (err) {
      if (isFirebasePermissionError(err)) {
        if (showAlerts) {
          Alert.alert("Login permissions blocked", EMPLOYEE_LOOKUP_PERMISSION_MESSAGE);
        }
        return;
      }
      throw err;
    }

    if (snap.empty) {
      if (showAlerts) {
        Alert.alert("Invalid code", "No employee found with that code.");
      }
      return;
    }

    const employee = { id: snap.docs[0].id, ...snap.docs[0].data() };

    if (employeeIsBlocked(employee)) {
      if (showAlerts) {
        Alert.alert("Access blocked", "Your account is disabled. Contact admin.");
      }
      return;
    }

    if (!employeeEmailMatches(employee, emailStr)) {
      if (showAlerts) {
        if (!employee?.email && !Array.isArray(employee?.emails)) {
          Alert.alert(
            "Email not on file",
            "We don't have an email recorded for this employee. Please contact an admin."
          );
        } else {
          Alert.alert(
            "Email mismatch",
            "The email entered doesn't match the employee record. Please check and try again."
          );
        }
      }
      return;
    }

    return {
      employee,
      sessionData: buildSessionData(employee, codeStr, emailStr),
      emailStr,
    };
  };

  const findEmployeeForSetupCode = async () =>
    findEmployeeByCodeAndEmail(employeeCode, employeeEmail);

  const handleFirebasePasswordLogin = async () => {
    if (loading) return;
    const emailStr = String(employeeEmail || "").trim().toLowerCase();
    if (!emailStr) {
      Alert.alert("Missing email", "Please enter your work email.");
      return;
    }
    if (!EMAIL_RE.test(emailStr)) {
      Alert.alert("Invalid email", "Please enter a valid work email address.");
      return;
    }
    if (!password) {
      Alert.alert("Missing password", "Please enter your password.");
      return;
    }

    setLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(
        auth,
        emailStr,
        password
      );
      const employee = await findEmployeeForFirebaseUser(
        userCredential.user,
        emailStr
      );

      if (!ensureEmployeeAllowed(employee, emailStr)) {
        await signOut(auth).catch(() => {});
        return;
      }

      const codeStr = String(employee.userCode || "").replace(/\D/g, "").padStart(4, "0");
      const verifiedPhone =
        employee?.auth?.phoneNumber ||
        employee?.phoneNumber ||
        employee?.phone ||
        getEmployeePhoneCandidates(employee)[0] ||
        "";

      setPendingEmployee(employee);
      setPendingSessionData(buildSessionData(employee, codeStr, emailStr));
      setPhoneNumber(normalizePhone(verifiedPhone));
      setConfirmPassword("");
      setSmsCode("");
      setSmsSent(false);
      setSmsConfirmation(null);
      setLoginStep(PHONE_STEP);
    } catch (err) {
      if (
        err?.code === "auth/invalid-credential" ||
        err?.code === "auth/wrong-password"
      ) {
        alertExistingFirebasePassword(emailStr);
      } else if (isFirebasePermissionError(err)) {
        await signOut(auth).catch(() => {});
        Alert.alert("Login permissions blocked", EMPLOYEE_LOOKUP_PERMISSION_MESSAGE);
      } else {
        Alert.alert("Login failed", err?.message || "Unable to sign in.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSetupStart = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const result = await findEmployeeForSetupCode();
      if (!result) return;

      preparePasswordSetup(result.employee, result.sessionData);
    } catch (err) {
      Alert.alert(
        isFirebasePermissionError(err) ? "Login permissions blocked" : "Setup failed",
        isFirebasePermissionError(err)
          ? EMPLOYEE_LOOKUP_PERMISSION_MESSAGE
          : err?.message || "Unable to start setup."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (migrationCheckedRef.current) return;
    migrationCheckedRef.current = true;

    let cancelled = false;

    const migrateOldCodeSession = async () => {
      const existingUser = auth.currentUser;
      if (existingUser && !existingUser.isAnonymous) return;

      const entries = await AsyncStorage.multiGet([
        "employeeEmail",
        "employeeUserCode",
        "userCode",
      ]);
      const stored = Object.fromEntries(entries);
      const storedEmail = String(stored.employeeEmail || "").trim().toLowerCase();
      const storedCode = String(stored.employeeUserCode || stored.userCode || "")
        .replace(/\D/g, "")
        .padStart(4, "0");

      if (!storedEmail || !storedCode || storedCode.length !== 4) return;

      setLoading(true);
      try {
        const result = await findEmployeeByCodeAndEmail(storedCode, storedEmail, {
          showAlerts: false,
        });
        if (cancelled) return;

        setEmployeeEmail(storedEmail);
        setEmployeeCode(storedCode);

        if (result) {
          preparePasswordSetup(result.employee, result.sessionData);
          Alert.alert(
            "Account update needed",
            "Create a password and verify your mobile number to keep using the app."
          );
        } else {
          setLoginStep(INVITE_STEP);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    migrateOldCodeSession().catch(() => {});

    return () => {
      cancelled = true;
    };
    // Run once on login screen load to upgrade old employee-code sessions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateCredentialInputs = ({ requireConfirmPassword = false } = {}) => {
    if (loading || !pendingEmployee || !pendingSessionData) return;

    const cleanPassword = String(password || "");
    const cleanPhone = normalizePhone(phoneNumber);

    if (loginStep !== PHONE_STEP && cleanPassword.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters for your password.");
      return;
    }
    if (requireConfirmPassword && cleanPassword !== confirmPassword) {
      Alert.alert("Password mismatch", "The passwords do not match.");
      return;
    }
    if (!phoneIsValid(phoneNumber)) {
      Alert.alert(
        "Invalid phone number",
        "Enter a valid phone number including the country code, for example +447700900123."
      );
      return;
    }
    if (!phoneMatchesEmployee(pendingEmployee, cleanPhone)) {
      Alert.alert(
        "Phone mismatch",
        "That phone number does not match the employee record. Please contact an admin."
      );
      return;
    }

    return { cleanPassword, cleanPhone };
  };

  const handleSendSmsCode = async () => {
    const validated = validateCredentialInputs({
      requireConfirmPassword: loginStep === SETUP_STEP,
    });
    if (!validated) return;

    setLoading(true);
    try {
      if (Platform.OS === "web") {
        throw new Error("Phone verification needs the iOS or Android app.");
      }
      const nativeAuth = getNativeAuth();
      if (!nativeAuth) {
        throw new Error(
          "Phone verification needs a development build. It is not available in Expo Go."
        );
      }
      const confirmation = await nativeAuth().signInWithPhoneNumber(
        validated.cleanPhone
      );
      setSmsCode("");
      setSmsConfirmation(confirmation);
      setSmsSent(true);
      Alert.alert("Code sent", "Check your phone for the SMS verification code.");
    } catch (err) {
      Alert.alert("SMS failed", err?.message || "Unable to send SMS code.");
    } finally {
      setLoading(false);
    }
  };

  const verifySmsCode = async (cleanPhone) => {
    const code = String(smsCode || "").replace(/\D/g, "");
    if (!/^\d{4,10}$/.test(code)) {
      Alert.alert("Missing SMS code", "Enter the SMS code sent to your phone.");
      return false;
    }

    if (!smsConfirmation) {
      Alert.alert("SMS failed", "Send a new SMS code first.");
      return false;
    }

    await smsConfirmation.confirm(code);
    const nativeAuth = getNativeAuth();
    if (!nativeAuth) return true;
    if (nativeAuth().currentUser) {
      await nativeAuth().signOut().catch(() => {});
    }

    return true;
  };

  const handleCredentialSetup = async () => {
    const validated = validateCredentialInputs({ requireConfirmPassword: true });
    if (!validated) return;
    if (!smsSent) {
      await handleSendSmsCode();
      return;
    }

    const { cleanPassword, cleanPhone } = validated;

    setLoading(true);
    try {
      const smsApproved = await verifySmsCode(cleanPhone);
      if (!smsApproved) return;

      const emailForAuth = pendingSessionData.email;
      let userCredential;

      try {
        userCredential = await createUserWithEmailAndPassword(
          auth,
          emailForAuth,
          cleanPassword
        );
        if (pendingSessionData.displayName) {
          await updateProfile(userCredential.user, {
            displayName: pendingSessionData.displayName,
          }).catch(() => {});
        }
      } catch (err) {
        if (err?.code !== "auth/email-already-in-use") throw err;
        try {
          userCredential = await signInWithEmailAndPassword(
            auth,
            emailForAuth,
            cleanPassword
          );
        } catch (signInErr) {
          if (
            signInErr?.code === "auth/invalid-credential" ||
            signInErr?.code === "auth/wrong-password"
          ) {
            alertExistingFirebasePassword(emailForAuth);
            resetLoginFlow();
            setEmployeeEmail(emailForAuth);
            setSmsSent(false);
            setSmsCode("");
            setSmsConfirmation(null);
            return;
          }
          throw signInErr;
        }
      }

      if (!userCredential) return;

      await updateEmployeeAuthLink(userCredential.user, pendingEmployee, cleanPhone);
      await updateDoc(doc(db, "employees", pendingEmployee.id), {
        "auth.setupCompletedAt": serverTimestamp(),
      }).catch(() => {});
      await bootstrapUserAccess(userCredential.user, pendingEmployee, cleanPhone);

      await completeLogin(pendingSessionData, {
        ...pendingEmployee,
        uid: userCredential.user.uid,
        authUid: userCredential.user.uid,
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        phoneVerified: true,
        auth: {
          ...(pendingEmployee.auth || {}),
          uid: userCredential.user.uid,
          email: emailForAuth,
          passwordEnabled: true,
          phoneNumber: cleanPhone,
          phoneVerified: true,
        },
      });
    } catch (err) {
      Alert.alert("Setup failed", err?.message || "Unable to set up credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handlePhoneVerificationLogin = async () => {
    if (loading || !pendingEmployee || !pendingSessionData) return;

    const validated = validateCredentialInputs();
    if (!validated) return;
    if (!smsSent) {
      if (smsVerificationUnavailableInExpoGo()) {
        setLoading(true);
        try {
          await completeExpoGoPasswordLogin();
        } catch (err) {
          Alert.alert("Login failed", err?.message || "Unable to sign in.");
        } finally {
          setLoading(false);
        }
        return;
      }
      await handleSendSmsCode();
      return;
    }

    const { cleanPhone } = validated;

    setLoading(true);
    try {
      const smsApproved = await verifySmsCode(cleanPhone);
      if (!smsApproved) return;

      const firebaseUser = auth.currentUser;
      if (!firebaseUser || firebaseUser.isAnonymous) {
        Alert.alert("Login failed", "Sign in with email and password first.");
        return;
      }

      if (
        (pendingEmployee?.authUid && pendingEmployee.authUid !== firebaseUser.uid) ||
        (pendingEmployee?.uid && pendingEmployee.uid !== firebaseUser.uid) ||
        (pendingEmployee?.auth?.uid && pendingEmployee.auth.uid !== firebaseUser.uid)
      ) {
        Alert.alert("Account mismatch", "This employee belongs to a different Firebase account.");
        await signOut(auth).catch(() => {});
        return;
      }

      await updateEmployeeAuthLink(firebaseUser, pendingEmployee, cleanPhone);
      await bootstrapUserAccess(firebaseUser, pendingEmployee, cleanPhone);

      await completeLogin(pendingSessionData, {
        ...pendingEmployee,
        uid: firebaseUser.uid,
        authUid: firebaseUser.uid,
        phone: cleanPhone,
        phoneNumber: cleanPhone,
        phoneVerified: true,
        auth: {
          ...(pendingEmployee.auth || {}),
          uid: firebaseUser.uid,
          email: firebaseUser.email || pendingSessionData.email,
          passwordEnabled: true,
          phoneNumber: cleanPhone,
          phoneVerified: true,
        },
      });
    } catch (err) {
      Alert.alert("Login failed", err?.message || "Unable to sign in.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Image
            source={require("../../assets/images/bickers-action-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />

          <Text style={[styles.title, { color: colors.text }]}>
            Welcome to Bickers Action
          </Text>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
      {loginStep === SETUP_STEP
                ? "Create Password"
                : loginStep === INVITE_STEP
                ? "First Time?"
                : loginStep === PHONE_STEP
                ? "Phone Check"
                : "Sign In"}
            </Text>

            {!loginStep ? (
              <>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.text,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                  placeholder="Work email"
                  placeholderTextColor={colors.textMuted}
                  value={employeeEmail}
                  onChangeText={setEmployeeEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.text,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                  placeholder="Password"
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  secureTextEntry
                />
                <TouchableOpacity
                  style={[
                    styles.buttonAlt,
                    { backgroundColor: colors.accent },
                  ]}
                  onPress={handleFirebasePasswordLogin}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      { color: colors.surface },
                    ]}
                  >
                    {loading ? "Please wait..." : "Sign In"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => sendResetPasswordEmail(employeeEmail)}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>
                    Forgotten password?
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    setLoginStep(INVITE_STEP);
                    setPassword("");
                    setConfirmPassword("");
                    setPhoneNumber("");
                    setSmsCode("");
                    setSmsSent(false);
                    setSmsConfirmation(null);
                  }}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>
                    First time? Set up account
                  </Text>
                </TouchableOpacity>
              </>
            ) : loginStep === INVITE_STEP ? (
              <>
                <Text style={[styles.helperText, { color: colors.textMuted }]}>
                  Enter your work email and employee code. You only need to do this once.
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.text,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                  placeholder="Employee code"
                  placeholderTextColor={colors.textMuted}
                  value={employeeCode}
                  onChangeText={setEmployeeCode}
                  keyboardType="number-pad"
                  maxLength={4}
                />
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.text,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                  placeholder="Work email"
                  placeholderTextColor={colors.textMuted}
                  value={employeeEmail}
                  onChangeText={setEmployeeEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TouchableOpacity
                  style={[styles.buttonAlt, { backgroundColor: colors.accent }]}
                  onPress={handleSetupStart}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.buttonText, { color: colors.surface }]}>
                    {loading ? "Please wait..." : "Next"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={resetLoginFlow}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>
                    Back to sign in
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.identityBox,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                >
                  <Text style={[styles.identityName, { color: colors.text }]}>
                    {pendingSessionData?.displayName || "Employee"}
                  </Text>
                  <Text style={[styles.identityMeta, { color: colors.textMuted }]}>
                    Code {pendingSessionData?.userCode} - {pendingSessionData?.email}
                  </Text>
                </View>

                {loginStep === SETUP_STEP ? (
                  <Text style={[styles.helperText, { color: colors.textMuted }]}>
                    Create a password, then enter the code sent to your phone.
                  </Text>
                ) : loginStep === PHONE_STEP ? (
                  <Text style={[styles.helperText, { color: colors.textMuted }]}>
                    Password accepted. We will text you a code to finish signing in.
                  </Text>
                ) : null}

                {loginStep === SETUP_STEP ? (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.inputBackground,
                        color: colors.text,
                        borderColor: colors.inputBorder,
                      },
                    ]}
                    placeholder="Create password"
                    placeholderTextColor={colors.textMuted}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                ) : null}

                {loginStep === SETUP_STEP ? (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.inputBackground,
                        color: colors.text,
                        borderColor: colors.inputBorder,
                      },
                    ]}
                    placeholder="Confirm password"
                    placeholderTextColor={colors.textMuted}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    autoCapitalize="none"
                    secureTextEntry
                  />
                ) : null}

                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.text,
                      borderColor: colors.inputBorder,
                    },
                  ]}
                  placeholder={
                    loginStep === SETUP_STEP
                      ? "Mobile number, e.g. +447700900123"
                      : "Mobile number"
                  }
                  placeholderTextColor={colors.textMuted}
                  value={phoneNumber}
                  onChangeText={(value) => {
                    setPhoneNumber(value);
                    setSmsSent(false);
                    setSmsCode("");
                    setSmsConfirmation(null);
                  }}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  editable={!smsSent && !loading}
                />

                {smsSent ? (
                  <TextInput
                    style={[
                      styles.input,
                      {
                        backgroundColor: colors.inputBackground,
                        color: colors.text,
                        borderColor: colors.inputBorder,
                      },
                    ]}
                    placeholder="SMS code"
                    placeholderTextColor={colors.textMuted}
                    value={smsCode}
                    onChangeText={setSmsCode}
                    keyboardType="number-pad"
                    maxLength={10}
                    textContentType="oneTimeCode"
                  />
                ) : null}

                <TouchableOpacity
                  style={[styles.buttonAlt, { backgroundColor: colors.accent }]}
                  onPress={
                    loginStep === SETUP_STEP
                      ? handleCredentialSetup
                      : handlePhoneVerificationLogin
                  }
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.buttonText, { color: colors.surface }]}>
                    {loading
                      ? "Please wait..."
                      : loginStep === PHONE_STEP &&
                        !smsSent &&
                        smsVerificationUnavailableInExpoGo()
                      ? "Finish sign in"
                      : !smsSent
                      ? "Text me a code"
                      : loginStep === SETUP_STEP
                      ? "Finish setup"
                      : "Finish sign in"}
                  </Text>
                </TouchableOpacity>

                {smsSent ? (
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleSendSmsCode}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>
                      Resend SMS code
                    </Text>
                  </TouchableOpacity>
                ) : null}

                {loginStep === SETUP_STEP ? (
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => {
                      alertExistingFirebasePassword(pendingSessionData?.email);
                    }}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>
                      I already have a password
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={resetLoginFlow}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.accent }]}>
                    Back to sign in
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 30,
    paddingVertical: 32,
  },
  logo: { width: 220, height: 80, marginBottom: 24 },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 28,
    textAlign: "center",
  },
  section: {
    width: "100%",
    maxWidth: 420,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 14,
    textAlign: "center",
  },
  input: {
    width: "100%",
    height: 50,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  buttonAlt: {
    width: "100%",
    height: 50,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 10,
  },
  buttonText: { fontWeight: "600", fontSize: 16 },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginTop: 12,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  helperText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: "center",
  },
  identityBox: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  identityName: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  identityMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
});
