import axios from "axios";
import cors from "cors";
import "dotenv/config";
import express from "express";

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

function normalisePhone(phone = "") {
  const raw = String(phone || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (!raw.startsWith("+") && digits.startsWith("0")) {
    return `+44${digits.slice(1)}`;
  }
  return raw.startsWith("+") ? `+${digits}` : `+${digits}`;
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
    const err = new Error(`SMS verification is not configured: ${missing.join(", ")}`);
    err.status = 500;
    throw err;
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
    const err = new Error(data.message || "Twilio Verify request failed");
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}

function normaliseVRM(vrm = "") {
  return vrm.replace(/\s+/g, "").toUpperCase();
}

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
  } catch (err) {
    console.error("SMS start error:", err.details || err.message);
    res.status(err.status || 500).json({
      error: err.message || "Unable to send SMS verification code.",
      details: err.details,
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
  } catch (err) {
    console.error("SMS check error:", err.details || err.message);
    res.status(err.status || 500).json({
      error: err.message || "Unable to verify SMS code.",
      details: err.details,
    });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`DVLA server listening on http://localhost:${port}`);
});
