import { getVehicleAvailability } from "./vehicleAvailability";

const now = new Date("2026-06-24T12:00:00Z");
const selectedDates = ["2026-07-02", "2026-07-03"];

const availableVehicle = {
  id: "vehicle-1",
  name: "Camera Car",
  reg: "BK01 OK",
  operationalStatus: "Active",
  nextMOT: "2027-01-10",
  taxStatus: "Taxed",
  insuranceStatus: "Insured",
  insuredUntil: "2027-02-01",
  nextServiceDate: "2026-12-15",
};

const unavailableVehicle = {
  id: "vehicle-2",
  vehicleName: "Tracking Van",
  registrationNumber: "BK02 BAD",
  active: true,
  nextMotDate: "2026-05-20",
  taxStatus: "Taxed",
  insuranceStatus: "Insured",
  insuranceExpiryDate: "2026-12-01",
  serviceDueDate: "2026-07-20",
};

const warningVehicle = {
  id: "vehicle-3",
  name: "Rig Truck",
  registration: "BK03 WRN",
  fleetStatus: "Active",
  motExpiryDate: "2026-07-10",
  taxStatus: "Taxed",
  insuranceStatus: "Insured",
  insuranceUntil: "2026-07-15",
  nextService: "2026-07-18",
};

const defectReports = [
  {
    id: "defect-critical-1",
    vehicleId: "vehicle-2",
    status: "open",
    severity: "Critical",
    description: "Brake failure",
  },
  {
    id: "defect-medium-1",
    registration: "BK03 WRN",
    status: "open",
    severity: "Medium",
    description: "Slow puncture",
  },
];

const maintenanceBookings = [
  {
    id: "maint-1",
    vehicleId: "vehicle-2",
    status: "Booked",
    startDateISO: "2026-07-02",
    endDateISO: "2026-07-03",
  },
];

const bookings = [
  {
    id: "booking-1",
    status: "Confirmed",
    bookingDates: ["2026-07-03"],
    vehicles: [{ id: "vehicle-3", name: "Rig Truck" }],
  },
];

export const vehicleAvailabilityDemoCases = [
  {
    label: "Available vehicle",
    result: getVehicleAvailability(availableVehicle, {
      selectedDates,
      defectReports,
      maintenanceBookings,
      bookings,
      now,
    }),
  },
  {
    label: "Unavailable vehicle",
    result: getVehicleAvailability(unavailableVehicle, {
      selectedDates,
      defectReports,
      maintenanceBookings,
      bookings,
      now,
    }),
  },
  {
    label: "Warning vehicle with booking clash",
    result: getVehicleAvailability(warningVehicle, {
      selectedDates,
      defectReports,
      maintenanceBookings,
      bookings,
      now,
    }),
  },
];

vehicleAvailabilityDemoCases.forEach(({ label, result }) => {
  console.log(label, result);
});
