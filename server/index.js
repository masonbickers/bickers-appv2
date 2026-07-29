import axios from "axios";
import cors from "cors";
import "dotenv/config";
import express from "express";
import admin from "firebase-admin";

const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

const DVLA_API_KEY = process.env.DVLA_API_KEY;
const DVLA_VES_URL =
  process.env.DVLA_VES_URL ||
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";
const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || "bickers-action";
const MIN_APP_VERSION = process.env.MIN_APP_VERSION || "5.0.4";
const MIN_ANDROID_SDK = Number(process.env.MIN_ANDROID_SDK || 24);

function getFirebaseAdminApp() {
  if (admin.apps.length) return admin.app();

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

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
  });
}

const adminApp = getFirebaseAdminApp();
const db = admin.firestore(adminApp);

function normaliseVRM(vrm = "") {
  return vrm.replace(/\s+/g, "").toUpperCase();
}

function normaliseEmail(value = "") {
  return String(value).trim().toLowerCase();
}

function normaliseCode(value = "") {
  const digits = String(value).replace(/\D/g, "");
  return digits ? digits.padStart(4, "0") : "";
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

    res.json({
      employee: {
        id: employee.id,
        name: employee.name || employee.displayName || "Employee",
        email: employee.email || emailStr,
        companyId: employee.companyId || DEFAULT_COMPANY_ID,
        role: employee.role || "user",
        appAccess: employee.appAccess || null,
        authUid: employee.authUid || employee.uid || employee.auth?.uid || "",
        uid: employee.uid || employee.authUid || employee.auth?.uid || "",
        auth: {
          uid: employee.auth?.uid || employee.authUid || employee.uid || "",
          email: employee.auth?.email || employee.email || emailStr,
          passwordEnabled:
            employee.auth?.passwordEnabled === true ||
            employee.passwordEnabled === true ||
            !!employee.authUid ||
            !!employee.uid ||
            !!employee.auth?.uid,
        },
        passwordEnabled:
          employee.auth?.passwordEnabled === true ||
          employee.passwordEnabled === true ||
          !!employee.authUid ||
          !!employee.uid ||
          !!employee.auth?.uid,
      },
      sessionData: buildSessionData(employee, codeStr, emailStr),
      emailStr,
    });
  } catch (err) {
    console.error("Employee setup lookup error:", err);
    res.status(500).json({ error: "Unable to check employee setup." });
  }
});

app.post("/auth/sync-employee-auth", async (req, res) => {
  try {
    const idToken = String(req.body?.idToken || "").trim();
    const employeeId = String(req.body?.employeeId || "").trim();
    if (!idToken) return res.status(401).json({ error: "Missing auth token." });

    const decoded = await admin.auth().verifyIdToken(idToken);
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

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`DVLA server listening on http://localhost:${port}`);
});
