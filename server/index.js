import { createWorkshopSubmissionHandler } from "./workshopSubmission.js";
import axios from "axios";
import { Buffer } from "node:buffer";
import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import { createWorkingTermsResolver } from "./workingTermsIdentity.js";
import { createStagedPasswordTransition } from "./stagedPasswordTransition.js";
import admin from "firebase-admin";
import { createReceiptProxy, receiptUpdateRequired } from "./receiptProxy.js";
import {
  anonymousDeviceIdentityMatches,
  canonicalNotificationUid,
  decodedTokenIsAnonymous,
} from "./deviceTokenIdentity.js";

// Local development secrets live in the gitignored root .env.local file.
// Hosted environments continue to use their injected process variables.
dotenv.config({ path: ".env.local" });
const firebaseAdminEnvPath = String(
  process.env.FIREBASE_ADMIN_ENV_PATH || ""
).trim();
if (process.env.NODE_ENV !== "production" && firebaseAdminEnvPath) {
  dotenv.config({ path: firebaseAdminEnvPath });
}
dotenv.config();

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

const DVLA_API_KEY = process.env.DVLA_API_KEY;
const DVLA_VES_URL =
  process.env.DVLA_VES_URL ||
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;
const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "bickers-action";
const MIN_APP_VERSION = process.env.MIN_APP_VERSION || "5.0.4";
const MIN_ANDROID_SDK = Number(process.env.MIN_ANDROID_SDK || 24);

function getFirebaseAdminApp() {
  if (admin.apps.length) return admin.app();

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID || "bickers-booking";
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.FIREBASE_SERVICE_ACCOUNT_CLIENT_EMAIL;
  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");

  if (serviceAccountJson) {
    return admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
    });
  }

  if (projectId && clientEmail && privateKey) {
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
  });
}

const adminApp = getFirebaseAdminApp();
const db = admin.firestore(adminApp);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "bickers-api" });
});

app.post("/workshop/submissions", createWorkshopSubmissionHandler({ db, verifyIdToken: (token, revoked) => admin.auth().verifyIdToken(token, revoked) }));

app.use("/receipts/v2", createReceiptProxy());
app.post("/receipt-groups/:groupId/transition", receiptUpdateRequired);
app.post("/receipts/:receiptId/resubmit", receiptUpdateRequired);

async function authenticatedReceiptUser(req) {
  const idToken = bearerToken(req);
  if (!idToken) {
    const error = new Error("Missing auth token.");
    error.status = 401;
    throw error;
  }
  const decoded = await admin.auth().verifyIdToken(idToken);
  if (decodedTokenIsAnonymous(decoded)) {
    const error = new Error("A verified account is required.");
    error.status = 403;
    throw error;
  }
  const userSnap = await db.collection("users").doc(decoded.uid).get();
  const userData = userSnap.data() || {};
  if (!userSnap.exists || userData.isEnabled !== true || userData.disabled === true || userData.active === false) {
    const error = new Error("Your account is not enabled.");
    error.status = 403;
    throw error;
  }
  return {
    uid: decoded.uid,
    name: userData.displayName || userData.name || decoded.name || decoded.email || "User",
    companyId: String(userData.companyId || DEFAULT_COMPANY_ID),
  };
}

app.post("/receipt-groups/:groupId/transition", async (req, res) => {
  try {
    const actor = await authenticatedReceiptUser(req);
    const groupId = String(req.params.groupId || "");
    const action = String(req.body?.action || "");
    const groupRef = db.collection("receiptGroups").doc(groupId);
    const groupSnap = await groupRef.get();
    let group = groupSnap.exists ? groupSnap.data() : null;

    if (!group) {
      const companyId = String(req.body?.companyId || actor.companyId);
      const monthKey = String(req.body?.monthKey || "");
      const expectedId = [companyId, actor.uid, monthKey].map((value) => encodeURIComponent(value)).join("__");
      if (groupId !== expectedId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
        return res.status(400).json({ error: "Invalid receipt statement." });
      }
      group = {
        companyId,
        submitterUid: actor.uid,
        submitterName: actor.name,
        monthKey,
        status: "draft",
        declaredNoReceipts: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
    }

    if (group.submitterUid !== actor.uid || group.companyId !== actor.companyId) {
      return res.status(403).json({ error: "Receipt statement access denied." });
    }
    if (!["submit", "declare_none"].includes(action)) {
      return res.status(400).json({ error: "Unknown statement action." });
    }
    if (group.status === "closed") {
      return res.status(409).json({ error: "This statement has already been closed." });
    }

    const receiptsSnap = await db.collection("receipts").where("groupId", "==", groupId).get();
    const receipts = receiptsSnap.docs.map((item) => item.data());
    if (receipts.some((item) => item.status === "queried")) {
      return res.status(409).json({ error: "Correct queried receipts before submitting." });
    }
    if (action === "submit" && receipts.length === 0) {
      return res.status(409).json({ error: "Add a receipt or declare no receipts." });
    }
    if (action === "declare_none" && receipts.length > 0) {
      return res.status(409).json({ error: "A statement with receipts cannot be declared empty." });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    await groupRef.set({
      ...group,
      status: "submitted",
      declaredNoReceipts: action === "declare_none",
      submittedAt: now,
      submittedByUid: actor.uid,
      submittedByName: actor.name,
      updatedAt: now,
    }, { merge: true });
    res.json({ ok: true });
  } catch (error) {
    console.error("Receipt statement transition failed:", error);
    res.status(error.status || 500).json({ error: error.message || "Statement could not be submitted." });
  }
});

app.post("/receipts/:receiptId/resubmit", async (req, res) => {
  try {
    const actor = await authenticatedReceiptUser(req);
    const receiptRef = db.collection("receipts").doc(String(req.params.receiptId || ""));
    const receiptSnap = await receiptRef.get();
    if (!receiptSnap.exists) return res.status(404).json({ error: "Receipt not found." });
    const receipt = receiptSnap.data();
    if (receipt.submitterUid !== actor.uid || receipt.companyId !== actor.companyId || receipt.status !== "queried") {
      return res.status(403).json({ error: "This receipt cannot be resubmitted." });
    }
    const purpose = String(req.body?.purpose || "").trim();
    const valuePence = Number(req.body?.valuePence);
    if (!purpose || !Number.isInteger(valuePence) || valuePence <= 0) {
      return res.status(400).json({ error: "Purpose and gross value are required." });
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const receiptPatch = {
      purpose,
      valuePence,
      suggestedVatPence: Math.round(valuePence / 6),
      status: "pending",
      resubmittedAt: now,
      updatedAt: now,
    };
    for (const key of ["storagePath", "fileName", "fileType", "fileSize"]) {
      if (req.body?.[key] != null) receiptPatch[key] = req.body[key];
    }
    const batch = db.batch();
    batch.update(receiptRef, receiptPatch);
    const groupReceiptsSnap = await db.collection("receipts").where("groupId", "==", receipt.groupId).get();
    const otherQueryExists = groupReceiptsSnap.docs.some((item) => item.id !== receiptSnap.id && item.data().status === "queried");
    if (!otherQueryExists) {
      batch.update(db.collection("receiptGroups").doc(receipt.groupId), {
        status: "submitted",
        resubmittedAt: now,
        updatedAt: now,
      });
    }
    await batch.commit();
    res.json({ ok: true });
  } catch (error) {
    console.error("Receipt resubmission failed:", error);
    res.status(error.status || 500).json({ error: error.message || "Receipt could not be resubmitted." });
  }
});

function normaliseVRM(vrm = "") {
  return vrm.replace(/\s+/g, "").toUpperCase();
}

function normalisePhone(phone = "") {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (!raw.startsWith("+") && digits.startsWith("0")) {
    return `+44${digits.slice(1)}`;
  }
  return `+${digits}`;
}

function validatePhone(phone = "") {
  const normalised = normalisePhone(phone);
  const digits = normalised.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? normalised : "";
}

function ensureTwilioVerifyConfigured() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SERVICE_SID) {
    const missing = [
      !TWILIO_ACCOUNT_SID ? "TWILIO_ACCOUNT_SID" : null,
      !TWILIO_AUTH_TOKEN ? "TWILIO_AUTH_TOKEN" : null,
      !TWILIO_VERIFY_SERVICE_SID ? "TWILIO_VERIFY_SERVICE_SID" : null,
    ].filter(Boolean);
    const error = new Error(
      `SMS verification is not configured: ${missing.join(", ")}`
    );
    error.status = 500;
    throw error;
  }
}

async function twilioVerifyRequest(path, params) {
  ensureTwilioVerifyConfigured();

  const credentials = Buffer.from(
    `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`
  ).toString("base64");
  const body = new URLSearchParams(params);
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(
      TWILIO_VERIFY_SERVICE_SID
    )}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || "Twilio Verify request failed");
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

function normaliseEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function normaliseCode(value = "") {
  const digits = String(value).replace(/\D/g, "");
  return digits ? digits.padStart(4, "0") : "";
}

function deviceTokenId(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 48);
}

function codeLoginUidForEmployee(employeeId = "") {
  const cleanEmployeeId = String(employeeId).trim();
  if (!cleanEmployeeId) throw new Error("Employee identity is missing.");

  const directUid = `employee_${cleanEmployeeId}`;
  if (directUid.length <= 128) return directUid;

  return `employee_${crypto
    .createHash("sha256")
    .update(cleanEmployeeId)
    .digest("hex")}`;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function employeeIsBlocked(employee = {}) {
  return (
    employee.status === "disabled" ||
    employee.isEnabled === false ||
    employee.archived === true ||
    employee.disabled === true ||
    employee.active === false
  );
}

function employeeEmailMatches(employee = {}, email = "") {
  const emailStr = normaliseEmail(email);
  const employeeEmail = normaliseEmail(employee.email);
  const employeeEmails = Array.isArray(employee.emails)
    ? employee.emails.map(normaliseEmail)
    : [];

  return (
    (!!employeeEmail && employeeEmail === emailStr) ||
    (employeeEmails.length > 0 && employeeEmails.includes(emailStr))
  );
}

function inferServiceAccess(employee = {}) {
  const access = employee.appAccess;
  if (access && typeof access === "object") {
    return access.service === true && access.user !== true;
  }

  const role = String(employee.role || employee.sessionRole || "")
    .trim()
    .toLowerCase();
  return role === "service" || role === "serviceuser" || employee.isService === true;
}

function toSecurityRole(value = "") {
  const role = String(value).trim();
  if (["platformAdmin", "admin", "user"].includes(role)) return role;
  return "user";
}

function buildSessionData(employee, codeStr, emailStr) {
  const isService = inferServiceAccess(employee);
  const appAccess = employee.appAccess || {
    user: !isService,
    service: isService,
  };

  return {
    role: toSecurityRole(employee.role),
    isService,
    appAccess,
    companyId: String(employee.companyId || DEFAULT_COMPANY_ID).trim(),
    displayName: employee.name || employee.displayName || "Employee",
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
      ["office", "workshop"].includes(
        String(
          employee?.timesheetDefaults?.defaultType ||
            employee?.timesheetDefaultType ||
            ""
        )
          .trim()
          .toLowerCase()
      )
        ? String(
            employee?.timesheetDefaults?.defaultType ||
              employee?.timesheetDefaultType
          )
            .trim()
            .toLowerCase()
        : "yard",
  };
}

async function findEmployeeByCodeAndEmail(codeStr, emailStr) {
  const companyId = DEFAULT_COMPANY_ID;
  const employees = db.collection("employees");
  let snap = await employees
    .where("companyId", "==", companyId)
    .where("userCode", "==", codeStr)
    .limit(1)
    .get();

  if (snap.empty) {
    snap = await employees
      .where("companyId", "==", companyId)
      .where("userCode", "==", Number(codeStr))
      .limit(1)
      .get();
  }

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function findEmployeeForUser(uid, emailStr, employeeId) {
  const cleanEmployeeId = String(employeeId || "").trim();
  if (cleanEmployeeId) {
    const snap = await db.collection("employees").doc(cleanEmployeeId).get();
    if (snap.exists) return { id: snap.id, ...snap.data() };
  }

  const fields = [
    ["authUid", uid],
    ["uid", uid],
    ["auth.uid", uid],
    ["email", emailStr],
  ];

  for (const [field, value] of fields) {
    if (!value) continue;
    const snap = await db
      .collection("employees")
      .where("companyId", "==", DEFAULT_COMPANY_ID)
      .where(field, "==", value)
      .limit(1)
      .get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  if (emailStr) {
    const snap = await db
      .collection("employees")
      .where("companyId", "==", DEFAULT_COMPANY_ID)
      .where("emails", "array-contains", emailStr)
      .limit(1)
      .get();
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  return null;
}

app.get("/app-config", (_req, res) => {
  res.json({
    minAppVersion: MIN_APP_VERSION,
    minAndroidSdk: MIN_ANDROID_SDK,
    updateMessage:
      process.env.UPDATE_REQUIRED_MESSAGE ||
      "Please update Bickers to continue signing in.",
  });
});

app.get("/employee-notifications", async (req, res) => {
  try {
    const idToken = bearerToken(req);
    const requestedEmployeeId = String(req.query?.employeeId || "").trim();
    const requestedEmployeeCode = String(req.query?.employeeCode || "").trim();
    const requestedEmail = normaliseEmail(req.query?.email);
    if (!idToken) return res.status(401).json({ error: "Missing auth token." });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const userSnap = await db.collection("users").doc(decoded.uid).get();
    const userData = userSnap.data() || {};
    const employee = await findEmployeeForUser(
      decoded.uid,
      normaliseEmail(decoded.email),
      userData.employeeId || requestedEmployeeId
    );
    if (!employee || employeeIsBlocked(employee)) {
      return res.status(403).json({ error: "No active employee record was found." });
    }

    if (
      decodedTokenIsAnonymous(decoded) &&
      !anonymousDeviceIdentityMatches(employee, {
        employeeId: requestedEmployeeId,
        employeeCode: requestedEmployeeCode,
        email: requestedEmail,
      })
    ) {
      return res.status(403).json({ error: "The employee session could not be verified." });
    }

    if (!decodedTokenIsAnonymous(decoded)) {
      const directUids = [
        employee.authUid,
        employee.uid,
        employee.userId,
        employee.auth?.uid,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const linkedByUser = String(userData.employeeId || "").trim() === employee.id;
      const linkedByUid = directUids.includes(decoded.uid);
      const linkedByEmail = employeeEmailMatches(employee, decoded.email);
      if (!linkedByUser && !linkedByUid && !linkedByEmail) {
        return res.status(403).json({ error: "The employee session could not be verified." });
      }
    }

    const snapshot = await db
      .collection("employeeNotifications")
      .where("employeeId", "==", employee.id)
      .limit(100)
      .get();
    const notifications = snapshot.docs
      .map((document) => {
        const data = document.data() || {};
        const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt || 0);
        return {
          id: document.id,
          title: data.title || "Notification",
          body: data.body || "",
          data: data.data || {},
          source: data.source || "web",
          createdAt: Number.isNaN(createdAt.getTime())
            ? new Date().toISOString()
            : createdAt.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, notifications });
  } catch (error) {
    console.error("Employee notifications error:", error);
    res.status(500).json({ error: "Unable to load notifications." });
  }
});

app.post("/device-tokens", async (req, res) => {
  try {
    const idToken = bearerToken(req);
    const token = String(req.body?.token || req.body?.expoPushToken || "").trim();
    const platform = String(req.body?.platform || "").trim().toLowerCase().slice(0, 40);
    const appVersion = String(req.body?.appVersion || "").trim().slice(0, 80);
    const requestedEmployeeId = String(req.body?.employeeId || "").trim();
    const requestedEmployeeCode = String(req.body?.employeeCode || "").trim();
    const requestedEmail = normaliseEmail(req.body?.email);

    if (!idToken) return res.status(401).json({ error: "Missing auth token." });
    if (!/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(token)) {
      return res.status(400).json({ error: "A valid Expo device token is required." });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const decodedUserRef = db.collection("users").doc(decoded.uid);
    const decodedUserSnap = await decodedUserRef.get();
    const decodedUser = decodedUserSnap.data() || {};
    if (decodedUser.isEnabled === false || decodedUser.disabled === true) {
      return res.status(403).json({ error: "Your account is not active." });
    }

    const employeeId = String(decodedUser.employeeId || requestedEmployeeId).trim();
    if (!employeeId) {
      return res.status(403).json({ error: "No employee is linked to this account." });
    }

    const employeeRef = db.collection("employees").doc(employeeId);
    const employeeSnap = await employeeRef.get();
    if (!employeeSnap.exists) {
      return res.status(403).json({ error: "No active employee record was found." });
    }

    const employee = { id: employeeSnap.id, ...employeeSnap.data() };
    if (employeeIsBlocked(employee)) {
      return res.status(403).json({ error: "Your account is not active." });
    }

    const isAnonymous = decodedTokenIsAnonymous(decoded);
    if (
      isAnonymous &&
      !anonymousDeviceIdentityMatches(employee, {
        employeeId: requestedEmployeeId,
        employeeCode: requestedEmployeeCode,
        email: requestedEmail,
      })
    ) {
      return res.status(403).json({ error: "The employee session could not be verified." });
    }

    if (!isAnonymous) {
      const directUids = [
        employee.authUid,
        employee.uid,
        employee.userId,
        employee.auth?.uid,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const linkedByUser = String(decodedUser.employeeId || "").trim() === employee.id;
      const linkedByUid = directUids.includes(decoded.uid);
      const linkedByEmail = employeeEmailMatches(employee, decoded.email);
      if (!linkedByUser && !linkedByUid && !linkedByEmail) {
        return res.status(403).json({ error: "The employee session could not be verified." });
      }
    }

    const registrationUid = isAnonymous
      ? canonicalNotificationUid(decoded.uid, employee)
      : decoded.uid;
    if (!registrationUid) {
      return res.status(403).json({ error: "No notification account is available." });
    }

    const userRef = db.collection("users").doc(registrationUid);
    const userSnap =
      registrationUid === decoded.uid ? decodedUserSnap : await userRef.get();
    const user = userSnap.data() || {};
    if (user.isEnabled === false || user.disabled === true) {
      return res.status(403).json({ error: "Your account is not active." });
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const deviceRef = db
      .collection("deviceTokens")
      .doc(registrationUid)
      .collection("tokens")
      .doc(deviceTokenId(token));
    const deviceSnap = await deviceRef.get();
    const batch = db.batch();
    batch.set(
      deviceRef,
      {
        uid: registrationUid,
        token,
        platform,
        appVersion,
        lastSeenAt: now,
        updatedAt: now,
        ...(deviceSnap.exists ? {} : { createdAt: now }),
      },
      { merge: true }
    );
    const legacyToken = String(decodedUser.expoPushToken || "").trim();
    if (
      legacyToken !== token &&
      /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/.test(legacyToken)
    ) {
      const legacyDeviceRef = db
        .collection("deviceTokens")
        .doc(registrationUid)
        .collection("tokens")
        .doc(deviceTokenId(legacyToken));
      batch.set(
        legacyDeviceRef,
        {
          uid: registrationUid,
          token: legacyToken,
          platform: "legacy",
          migratedFromLegacy: true,
          lastSeenAt: now,
          updatedAt: now,
          createdAt: now,
        },
        { merge: true }
      );
    }
    batch.set(
      userRef,
      {
        uid: registrationUid,
        employeeId: employee.id,
        companyId: employee.companyId || user.companyId || DEFAULT_COMPANY_ID,
        email: user.email || employee.email || decoded.email || requestedEmail,
        displayName: user.displayName || employee.name || employee.displayName || "",
        notificationUpdatedAt: now,
      },
      { merge: true }
    );
    if (
      isAnonymous &&
      !employee.authUid &&
      !employee.uid &&
      !employee.userId &&
      !employee.auth?.uid
    ) {
      batch.set(employeeRef, { userId: registrationUid }, { merge: true });
    }
    await batch.commit();

    res.json({ ok: true, id: deviceTokenId(token), uid: registrationUid });
  } catch (error) {
    console.error("Device token registration error:", error);
    res.status(500).json({ error: "Unable to register this device for notifications." });
  }
});

app.post("/auth/employee-setup-lookup", async (req, res) => {
  try {
    const codeStr = normaliseCode(req.body?.code);
    const emailStr = normaliseEmail(req.body?.email);

    if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return res.status(400).json({ error: "Enter a valid work email." });
    }

    if (!codeStr || codeStr.length !== 4) {
      return res.status(400).json({ error: "Employee code must be 4 digits." });
    }

    const employee = await findEmployeeByCodeAndEmail(codeStr, emailStr);
    if (!employee) {
      return res.status(404).json({ error: "No employee found with that code." });
    }
    const enrolled = await db.collection("mobilePasswordTransitions").where("employeeId", "==", employee.id).limit(1).get();
    if (!enrolled.empty) {
      return res.status(410).json({ error: "Sign in with your work email and password or finish securing your existing app session." });
    }

    if (employeeIsBlocked(employee)) {
      return res.status(403).json({ error: "Your account is disabled. Contact admin." });
    }

    if (!employeeEmailMatches(employee, emailStr)) {
      return res.status(403).json({
        error: employee.email || Array.isArray(employee.emails)
          ? "The email entered doesn't match the employee record."
          : "We don't have an email recorded for this employee. Please contact an admin.",
      });
    }

    const sessionData = buildSessionData(employee, codeStr, emailStr);
    // Code/email login gets a stable identity derived only from the employee
    // document. Legacy records may contain a shared uid, so reusing those
    // aliases can sign several employees into the same Firebase account.
    const authUid = codeLoginUidForEmployee(employee.id);
    const firebaseCustomToken = await admin.auth().createCustomToken(authUid, {
      employeeId: employee.id,
      employeeCode: codeStr,
      companyId: sessionData.companyId,
    });
    const batch = db.batch();
    batch.set(
      db.collection("employees").doc(employee.id),
      {
        userId: authUid,
        codeLoginUid: authUid,
        auth: {
          ...(employee.auth || {}),
          codeLoginUid: authUid,
          email: employee.email || emailStr,
          lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    batch.set(
      db.collection("users").doc(authUid),
      {
        email: employee.email || emailStr,
        employeeId: employee.id,
        authUid,
        uid: authUid,
        role: sessionData.role,
        companyId: sessionData.companyId,
        isEnabled: true,
        displayName: employee.name || employee.displayName || "Employee",
        appAccess: sessionData.appAccess,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();

    res.json({
      firebaseCustomToken,
      employee: {
        id: employee.id,
        name: employee.name || employee.displayName || "Employee",
        email: employee.email || emailStr,
        companyId: employee.companyId || DEFAULT_COMPANY_ID,
        role: employee.role || "user",
        appAccess: employee.appAccess || null,
        authUid: employee.authUid || employee.uid || employee.auth?.uid || "",
        uid: employee.uid || employee.authUid || employee.auth?.uid || "",
        userId: authUid,
        codeLoginUid: authUid,
        auth: {
          uid: employee.auth?.uid || employee.authUid || employee.uid || "",
          codeLoginUid: authUid,
          email: employee.auth?.email || employee.email || emailStr,
          passwordEnabled:
            employee.auth?.passwordEnabled === true ||
            employee.passwordEnabled === true ||
            !!employee.authUid ||
            !!employee.uid ||
            !!employee.userId ||
            !!employee.auth?.uid,
        },
        passwordEnabled:
          employee.auth?.passwordEnabled === true ||
          employee.passwordEnabled === true ||
          !!employee.authUid ||
          !!employee.uid ||
          !!employee.userId ||
          !!employee.auth?.uid,
      },
      sessionData,
      emailStr,
    });
  } catch (err) {
    console.error("Employee setup lookup error:", err);
    res.status(500).json({ error: "Unable to check employee setup." });
  }
});

async function findEmployeeForApprovedUid(uid) {
  const cleanUid = String(uid || "").trim();
  if (!cleanUid) return null;

  const matches = new Map();
  for (const field of ["authUid", "uid", "auth.uid"]) {
    const snap = await db
      .collection("employees")
      .where("companyId", "==", DEFAULT_COMPANY_ID)
      .where(field, "==", cleanUid)
      .limit(2)
      .get();
    for (const employeeDoc of snap.docs) {
      matches.set(employeeDoc.id, { id: employeeDoc.id, ...employeeDoc.data() });
    }
  }

  return matches.size === 1 ? [...matches.values()][0] : null;
}


const resolveWorkingTerms = createWorkingTermsResolver({
  db, auth: admin.auth(), findEmployeeForApprovedUid, employeeIsBlocked, employeeEmailMatches,
});

app.get("/auth/working-terms-acceptance", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const acceptance = await resolveWorkingTerms(bearerToken(req));
    return res.json({ acceptance });
  } catch (error) {
    const authFailure = String(error?.code || "").startsWith("auth/");
    return res.status(error?.status || (authFailure ? 401 : 503)).json({
      error: error?.status ? error.message : "We could not check your existing Working Terms. Please try again.",
    });
  }
});


function mobileAccessIsApproved(status) {
  return ["invited", "active"].includes(String(status || "").trim());
}

function employeeAuthError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function syncApprovedEmployeeAuth(idToken) {
  const decoded = await admin.auth().verifyIdToken(idToken, true);
  if (
    decodedTokenIsAnonymous(decoded) ||
    decoded?.firebase?.sign_in_provider !== "password"
  ) {
    throw employeeAuthError(403, "A Firebase password account is required.");
  }

  const emailStr = normaliseEmail(decoded.email);
  const userSnap = await db.collection("users").doc(decoded.uid).get();
  const userData = userSnap.exists ? userSnap.data() || {} : null;
  const employee = await findEmployeeForApprovedUid(decoded.uid);

  if (
    !userData ||
    employeeIsBlocked(userData) || userData.isArchived === true || userData.appDisabled === true ||
    !mobileAccessIsApproved(userData.mobileAccessStatus)
  ) {
    throw employeeAuthError(403, "Mobile app access has not been approved.");
  }

  if (
    !employee ||
    employeeIsBlocked(employee) || employee.isArchived === true || employee.appDisabled === true ||
    !mobileAccessIsApproved(employee?.mobileAccess?.status)
  ) {
    throw employeeAuthError(403, "Mobile app access has not been approved.");
  }

  const approvedEmail = normaliseEmail(employee?.mobileAccess?.approvedEmail);
  const linkedEmployeeId = String(userData.employeeId || "").trim();
  const userCompanyId = String(userData.companyId || "").trim();
  const employeeCompanyId = String(employee.companyId || "").trim();
  if (
    linkedEmployeeId !== employee.id ||
    userCompanyId !== employeeCompanyId ||
    !approvedEmail ||
    approvedEmail !== emailStr ||
    !employeeEmailMatches(employee, emailStr)
  ) {
    throw employeeAuthError(
      403,
      "The approved employee identity could not be verified."
    );
  }

  const sessionData = buildSessionData(
    employee,
    normaliseCode(employee.userCode || ""),
    emailStr
  );
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(
    db.collection("employees").doc(employee.id),
    {
      uid: decoded.uid,
      authUid: decoded.uid,
      auth: {
        ...(employee.auth || {}),
        uid: decoded.uid,
        email: decoded.email || employee.email || "",
        passwordEnabled: true,
        lastLoginAt: now,
      },
      mobileAccess: {
        ...(employee.mobileAccess || {}),
        status: "active",
        activatedAt: employee?.mobileAccess?.activatedAt || now,
        lastLoginAt: now,
      },
    },
    { merge: true }
  );
  batch.set(
    db.collection("users").doc(decoded.uid),
    {
      email: decoded.email || employee.email || "",
      employeeId: employee.id,
      authUid: decoded.uid,
      uid: decoded.uid,
      companyId: sessionData.companyId,
      isEnabled: userData.isEnabled !== false,
      mobileAccessStatus: "active",
      displayName: employee.name || decoded.name || "",
      appAccess: sessionData.appAccess,
      defaultWorkspace: employee.defaultWorkspace || null,
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();

  return {
    employee: {
      ...employee,
      uid: decoded.uid,
      authUid: decoded.uid,
      mobileAccess: { ...(employee.mobileAccess || {}), status: "active" },
      auth: {
        ...(employee.auth || {}),
        uid: decoded.uid,
        email: decoded.email || sessionData.email,
        passwordEnabled: true,
      },
    },
    sessionData,
  };
}


const passwordTransition = createStagedPasswordTransition({
  db, auth: admin.auth(), syncApprovedEmployeeAuth,
  async sendSetupEmail(email) {
    const apiKey = process.env.FIREBASE_API_KEY || process.env.EXPO_PUBLIC_FIREBASE_API_KEY
      || "AIzaSyBiKz88kMEAB5C-oRn3qN6E7KooDcmYTWE"; // Public Firebase project key already used by this app.
    if (!apiKey) throw employeeAuthError(503, "Password setup email is not configured. Contact an administrator.");
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Firebase-Locale": "en-GB" },
      body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
    });
    if (!response.ok) throw employeeAuthError(503, "Firebase could not send the setup email. Please try again later.");
  },
});
for (const [method, path, action] of [
  ["get", "/auth/password-transition", "status"],
  ["post", "/auth/password-transition/email", "sendEmail"],
  ["post", "/auth/password-transition/complete", "complete"],
]) {
  app[method](path, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await passwordTransition[action](bearerToken(req))); }
    catch (error) {
      // Do not log bearer tokens, email action codes or password material.
      res.status(error.status || 503).json({ error: error.status ? error.message : "Account setup is temporarily unavailable. Please retry." });
    }
  });
}


app.post("/auth/sync-employee-auth", async (req, res) => {
  const headerToken = bearerToken(req);
  if (headerToken) {
    try {
      return res.json(await syncApprovedEmployeeAuth(headerToken));
    } catch (error) {
      const authFailure = String(error?.code || "").startsWith("auth/");
      return res.status(error?.status || (authFailure ? 401 : 503)).json({
        error: error?.status ? error.message : "Unable to verify account access. Please try again.",
      });
    }
  }
  try {
    const idToken = String(req.body?.idToken || "").trim();
    const employeeId = String(req.body?.employeeId || "").trim();
    if (!idToken) return res.status(401).json({ error: "Missing auth token." });

    const decoded = await admin.auth().verifyIdToken(idToken, true);
    const enrolled = await db.collection("mobilePasswordTransitions").doc(decoded.uid).get();
    if (enrolled.exists) {
      return res.status(403).json({ error: "Sign in with your work email and password or finish securing your existing app session." });
    }
    const emailStr = normaliseEmail(decoded.email);
    const employee = await findEmployeeForUser(decoded.uid, emailStr, employeeId);

    if (!employee) {
      return res.status(404).json({ error: "No active employee record was found." });
    }

    if (employeeIsBlocked(employee)) {
      return res.status(403).json({ error: "Your account is disabled. Contact admin." });
    }

    if (!employeeEmailMatches(employee, emailStr)) {
      return res.status(403).json({ error: "This email does not match the employee record." });
    }

    const sessionData = buildSessionData(
      employee,
      normaliseCode(employee.userCode || ""),
      emailStr
    );
    const batch = db.batch();
    batch.set(
      db.collection("employees").doc(employee.id),
      {
        uid: decoded.uid,
        authUid: decoded.uid,
        auth: {
          ...(employee.auth || {}),
          uid: decoded.uid,
          email: decoded.email || employee.email || "",
          passwordEnabled: true,
          lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      { merge: true }
    );
    batch.set(
      db.collection("users").doc(decoded.uid),
      {
        email: decoded.email || employee.email || "",
        employeeId: employee.id,
        authUid: decoded.uid,
        uid: decoded.uid,
        role: sessionData.role,
        companyId: sessionData.companyId,
        isEnabled: true,
        displayName: employee.name || decoded.name || "",
        appAccess: sessionData.appAccess,
        defaultWorkspace: employee.defaultWorkspace || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    await batch.commit();

    res.json({
      employee: {
        ...employee,
        uid: decoded.uid,
        authUid: decoded.uid,
        auth: {
          ...(employee.auth || {}),
          uid: decoded.uid,
          email: decoded.email || sessionData.email,
          passwordEnabled: true,
        },
      },
      sessionData,
    });
  } catch (err) {
    console.error("Employee auth sync error:", err);
    res.status(500).json({ error: "Unable to finish employee login." });
  }
});

app.get("/dvla/vehicle", async (req, res) => {
  try {
    const { vrm } = req.query;
    if (!vrm) {
      return res.status(400).json({ error: "Missing vrm query parameter" });
    }

    const formattedVrm = normaliseVRM(vrm);

    const dvlaRes = await axios.post(
      DVLA_VES_URL,
      { registrationNumber: formattedVrm },
      {
        headers: {
          "x-api-key": DVLA_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const d = dvlaRes.data;

    res.json({
      vrm: formattedVrm,
      make: d.make,
      model: d.model,
      colour: d.colour,
      fuelType: d.fuelType,
      motStatus: d.motStatus,
      motExpiryDate: d.motExpiryDate,
      taxStatus: d.taxStatus,
      taxDueDate: d.taxDueDate,
      bodyType: d.bodyType,
      engineCapacity: d.engineCapacity,
      raw: d, // keep raw in case you want more later
    });
  } catch (err) {
    console.error("DVLA lookup error:", err.response?.data || err.message);

    if (err.response) {
      return res.status(err.response.status).json({
        error: "DVLA API error",
        details: err.response.data,
      });
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

// Retained during the 5.0.5 mixed-version rollout for older clients and
// integrations. These routes can be removed only after usage is confirmed at
// zero and the oldest supported app version no longer depends on them.
app.post("/auth/phone/start", async (req, res) => {
  try {
    const phoneNumber = validatePhone(req.body?.phoneNumber);
    if (!phoneNumber) {
      return res.status(400).json({ error: "Enter a valid phone number." });
    }

    const result = await twilioVerifyRequest("/Verifications", {
      To: phoneNumber,
      Channel: "sms",
    });

    res.json({
      ok: true,
      phoneNumber,
      status: result.status,
    });
  } catch (error) {
    console.error("SMS start error:", error.details || error.message);
    res.status(error.status || 500).json({
      error: error.message || "Unable to send SMS verification code.",
      details: error.details,
    });
  }
});

app.post("/auth/phone/check", async (req, res) => {
  try {
    const phoneNumber = validatePhone(req.body?.phoneNumber);
    const code = String(req.body?.code || "").replace(/\D/g, "");

    if (!phoneNumber) {
      return res.status(400).json({ error: "Enter a valid phone number." });
    }
    if (!/^\d{4,10}$/.test(code)) {
      return res.status(400).json({ error: "Enter the SMS code." });
    }

    const result = await twilioVerifyRequest("/VerificationCheck", {
      To: phoneNumber,
      Code: code,
    });

    res.json({
      ok: result.status === "approved",
      phoneNumber,
      status: result.status,
    });
  } catch (error) {
    console.error("SMS check error:", error.details || error.message);
    res.status(error.status || 500).json({
      error: error.message || "Unable to verify SMS code.",
      details: error.details,
    });
  }
});

const port = process.env.PORT || 3002;
app.listen(port, () => {
  console.log(`DVLA server listening on http://localhost:${port}`);
});
