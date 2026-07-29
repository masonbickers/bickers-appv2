//app/(auth)/login.jsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import {
  collection,
  doc,
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
import { lookupEmployeeSetup, syncEmployeeAuth } from "../../lib/authApi";
import { useAuth } from "../../providers/AuthProvider";
import { useTheme } from "../../providers/ThemeProvider";

const SETUP_STEP = "setup";
const INVITE_STEP = "invite";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_COMPANY_ID = "bickers-action";
const EMPLOYEE_LOOKUP_PERMISSION_MESSAGE =
  "The app cannot read employee records during login. Firestore rules need to allow this employee lookup, or login must use a backend endpoint.";

function employeeHasPasswordEnabled(employee) {
  return (
    employee?.auth?.passwordEnabled === true ||
    employee?.passwordEnabled === true ||
    !!employee?.authUid ||
    !!employee?.uid ||
    !!employee?.auth?.uid
  );
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

export default function LoginPage() {
  const [employeeEmail, setEmployeeEmail] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loginStep, setLoginStep] = useState(null);
  const [pendingEmployee, setPendingEmployee] = useState(null);
  const [pendingSessionData, setPendingSessionData] = useState(null);
  const [loading, setLoading] = useState(false);
  const migrationCheckedRef = useRef(false);

  const router = useRouter();
  const { reloadSession, loading: authLoading, user: authUser } = useAuth();
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
  };

  const preparePasswordSetup = (employee, sessionData) => {
    setPendingEmployee(employee);
    setPendingSessionData(sessionData);
    setPassword("");
    setConfirmPassword("");
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
    const rawDefaultType = String(
      employee?.timesheetDefaults?.defaultType ||
        employee?.timesheetDefaultType ||
        ""
    )
      .trim()
      .toLowerCase();

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
        rawDefaultType === "office" || rawDefaultType === "workshop"
          ? rawDefaultType
          : "yard",
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

  const bootstrapUserAccess = async (firebaseUser, employee) => {
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
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, "users", firebaseUser.uid), accessData, { merge: true });
  };

  const updateEmployeeAuthLink = async (firebaseUser, employee) => {
    await updateDoc(doc(db, "employees", employee.id), {
      uid: firebaseUser.uid,
      authUid: firebaseUser.uid,
      "auth.uid": firebaseUser.uid,
      "auth.email": firebaseUser.email || employee.email || "",
      "auth.passwordEnabled": true,
      "auth.lastLoginAt": serverTimestamp(),
    });
  };

  const lookupEmployeeDirectly = async (codeStr, emailStr, { showAlerts = true } = {}) => {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    let snap = await getDocs(
      query(
        collection(db, "employees"),
        where("companyId", "==", DEFAULT_COMPANY_ID),
        where("userCode", "==", codeStr),
        limit(1)
      )
    );

    if (snap.empty) {
      snap = await getDocs(
        query(
          collection(db, "employees"),
          where("companyId", "==", DEFAULT_COMPANY_ID),
          where("userCode", "==", Number(codeStr)),
          limit(1)
        )
      );
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
        Alert.alert(
          employee?.email || Array.isArray(employee?.emails)
            ? "Email mismatch"
            : "Email not on file",
          employee?.email || Array.isArray(employee?.emails)
            ? "The email entered doesn't match the employee record. Please check and try again."
            : "We don't have an email recorded for this employee. Please contact an admin."
        );
      }
      return;
    }

    return {
      employee,
      sessionData: buildSessionData(employee, codeStr, emailStr),
      emailStr,
    };
  };

  const findEmployeeByCodeAndEmail = async (
    rawCode,
    rawEmail,
    { showAlerts = true } = {}
  ) => {
    const codeDigits = String(rawCode).replace(/\D/g, "");
    const codeStr = codeDigits ? codeDigits.padStart(4, "0") : "";
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

    try {
      return await lookupEmployeeSetup({ email: emailStr, code: codeStr });
    } catch {}

    try {
      return await lookupEmployeeDirectly(codeStr, emailStr, { showAlerts });
    } catch (err) {
      if (showAlerts) {
        Alert.alert(
          isFirebasePermissionError(err) ? "Login permissions blocked" : "Login failed",
          isFirebasePermissionError(err)
            ? EMPLOYEE_LOOKUP_PERMISSION_MESSAGE
            : err?.message || "Unable to sign in with that employee code and email."
        );
      }
      return;
    }
  };

  const findEmployeeForSetupCode = async () =>
    findEmployeeByCodeAndEmail(employeeCode, employeeEmail);

  const handleCodeEmailLogin = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const result = await findEmployeeForSetupCode();
      if (!result) return;

      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }

      await completeLogin(result.sessionData, result.employee);
    } catch (err) {
      Alert.alert(
        "Login failed",
        err?.message || "Unable to sign in with that employee code and email."
      );
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

      if (employeeHasPasswordEnabled(result.employee)) {
        setEmployeeEmail(result.emailStr || result.sessionData?.email || "");
        setPassword("");
        setLoginStep(null);
        Alert.alert(
          "Password already set",
          "Use your existing password to sign in, or reset it if you need a new one."
        );
        return;
      }

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
    if (authLoading) return;
    if (migrationCheckedRef.current) return;
    migrationCheckedRef.current = true;

    let cancelled = false;

    const migrateOldCodeSession = async () => {
      const existingUser = authUser || auth.currentUser;
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
          if (!auth.currentUser) {
            await signInAnonymously(auth);
          }
          await completeLogin(result.sessionData, result.employee);
        } else {
          setLoginStep(null);
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
  }, [authLoading, authUser]);

  const validateCredentialInputs = ({ requireConfirmPassword = false } = {}) => {
    if (loading || !pendingEmployee || !pendingSessionData) return;

    const cleanPassword = String(password || "");

    if (cleanPassword.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters for your password.");
      return;
    }
    if (requireConfirmPassword && cleanPassword !== confirmPassword) {
      Alert.alert("Password mismatch", "The passwords do not match.");
      return;
    }

    return { cleanPassword };
  };

  const handleCredentialSetup = async () => {
    const validated = validateCredentialInputs({ requireConfirmPassword: true });
    if (!validated) return;

    const { cleanPassword } = validated;

    setLoading(true);
    try {
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
            return;
          }
          throw signInErr;
        }
      }

      if (!userCredential) return;

      try {
        const synced = await syncEmployeeAuth({
          idToken: await userCredential.user.getIdToken(),
          employeeId: pendingEmployee.id,
        });
        await completeLogin(synced.sessionData, synced.employee);
        return;
      } catch {}

      await updateEmployeeAuthLink(userCredential.user, pendingEmployee).catch(() => {});
      await updateDoc(doc(db, "employees", pendingEmployee.id), {
        "auth.setupCompletedAt": serverTimestamp(),
      }).catch(() => {});
      await bootstrapUserAccess(userCredential.user, pendingEmployee);

      await completeLogin(pendingSessionData, {
        ...pendingEmployee,
        uid: userCredential.user.uid,
        authUid: userCredential.user.uid,
        auth: {
          ...(pendingEmployee.auth || {}),
          uid: userCredential.user.uid,
          email: emailForAuth,
          passwordEnabled: true,
        },
      });
    } catch (err) {
      Alert.alert("Setup failed", err?.message || "Unable to set up credentials.");
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
                  style={[
                    styles.buttonAlt,
                    { backgroundColor: colors.accent },
                  ]}
                  onPress={handleCodeEmailLogin}
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
                    Create a password to finish setting up your account.
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

                <TouchableOpacity
                  style={[styles.buttonAlt, { backgroundColor: colors.accent }]}
                  onPress={handleCredentialSetup}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.buttonText, { color: colors.surface }]}>
                    {loading ? "Please wait..." : "Finish setup"}
                  </Text>
                </TouchableOpacity>

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
