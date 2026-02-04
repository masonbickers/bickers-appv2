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

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`DVLA server listening on http://localhost:${port}`);
});
