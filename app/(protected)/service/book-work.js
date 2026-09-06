import { AppButton, AppText as Text, AppPressable as TouchableOpacity, FormField } from "../../../components/ui/AppPrimitives";
import {
  servicePalette as COLORS } from "../../../lib/design/semantics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect,
  useMemo,
  useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import PageShell from "../../../components/layout/PageShell";

import { designTokens as t } from "../../../lib/design/tokens";
import {
  findVehicleRecord,
  getBookingVehicleReferences,
  getVehicleManufacturer,
  getVehicleName,
  getVehicleNextService,
  getVehicleRegistration,
} from "../../../lib/fleetSchema";
import { useServiceCollectionReader } from "../../../hooks/useServiceData";
import { useTheme } from "../../../providers/ThemeProvider";
import { staticColors } from "../../../lib/design/staticColors";

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "completed", label: "Completed" },
  { key: "all", label: "All" },
];

const INITIAL_TASKS = [
  {
    id: "seed-1",
    title: "Book MOT for overdue vehicles",
    type: "MOT",
    hint: "Tap any 'Overdue' vehicle in Service due to start a job.",
    completed: false,
  },
  {
    id: "seed-2",
    title: "Schedule services due within 30 days",
    type: "Service",
    hint: "Use the 'Due in next 30 days' list to plan workshop slots.",
    completed: false,
  },
  {
    id: "seed-3",
    title: "Review open defects and assign workshop slots",
    type: "Defects",
    hint: "Use: Service → Defects & Issues page.",
    completed: false,
  },
  {
    id: "seed-4",
    title: "Book PMI / Brake test for heavy vehicles",
    type: "Inspection",
    hint: "Check PMI, brake test, tacho inspection dates.",
    completed: false,
  },
  {
    id: "seed-5",
    title: "Plan tyre changes & alignment work",
    type: "Tyres",
    hint: "Prioritise vehicles flagged with uneven wear or low tread.",
    completed: false,
  },
  {
    id: "seed-6",
    title: "Schedule tail-lift / LOLER inspections",
    type: "LOLER",
    hint: "Check next LOLER and tail-lift inspection dates.",
    completed: false,
  },
];

// 🔑 multi-draft key (object: { [formId]: draft })
const SERVICE_DRAFTS_KEY = "serviceFormDrafts_v1";

// Helper to pull numeric timestamp from ids like "svc-<vehicleId>-<timestamp>"
function getDraftTimestampFromId(id) {
  if (!id) return 0;
  const parts = String(id).split("-");
  const last = parts[parts.length - 1];
  const n = Number(last);
  return Number.isNaN(n) ? 0 : n;
}

/* -------- date helpers for prep window -------- */

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// normalise Firestore / string / Date into Date
function toJsDate(value) {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === "function") {
    return value.toDate();
  }
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    // allow plain "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return new Date(y, m - 1, d, 12, 0, 0, 0);
    }
    return new Date(value);
  }

  return new Date(value);
}

function formatDateShort(value) {
  const d = toJsDate(value);
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

// turn any booking into an array of per-day dates within a window
function getBookingDaysWithinWindow(booking, from, to) {
  const days = [];
  const fromDay = startOfDay(from);
  const toDay = startOfDay(to);

  // 1) explicit bookingDates array "YYYY-MM-DD"
  if (Array.isArray(booking.bookingDates) && booking.bookingDates.length > 0) {
    booking.bookingDates.forEach((ds) => {
      const d = startOfDay(toJsDate(ds));
      if (!Number.isNaN(d.getTime()) && d >= fromDay && d <= toDay) {
        days.push(d);
      }
    });
    return days;
  }

  // 2) range via date / startDate / endDate
  const startRaw = booking.startDate || booking.date;
  const endRaw = booking.endDate || booking.startDate || booking.date;

  if (!startRaw) return days;

  let start = startOfDay(toJsDate(startRaw));
  let end = endRaw ? startOfDay(toJsDate(endRaw)) : start;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return days;

  if (end < fromDay || start > toDay) return days; // no overlap

  if (start < fromDay) start = fromDay;
  if (end > toDay) end = toDay;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  return days;
}

function normalizeMaintenanceBookingForPrep(docData) {
  const data = docData || {};
  const date =
    data.appointmentDateISO ||
    data.startDateISO ||
    data.endDateISO ||
    data.completedAtISO ||
    "";

  return {
    ...data,
    // Compatibility adapter while the wider app still reads legacy bookings.
    status: data.status === "Booked" ? "Confirmed" : data.status,
    date,
    startDate: data.startDateISO || data.appointmentDateISO || date,
    endDate: data.endDateISO || data.startDateISO || data.appointmentDateISO || date,
    bookingDates: [data.startDateISO, data.appointmentDateISO, data.endDateISO]
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index),
    vehicles: data.vehicleId
      ? [
          {
            id: data.vehicleId,
            name: data.vehicleLabel || "Vehicle",
            vehicleName: data.vehicleLabel || "Vehicle",
          },
        ]
      : [],
  };
}

// normalise vehicles on booking to attach full DB record where possible
function normalizeVehicles(list, vehiclesData) {
  if (!Array.isArray(list)) return [];
  return list
    .map((vehicleRef) => {
      const match = findVehicleRecord(vehicleRef, vehiclesData);
      if (match) return match;
      return vehicleRef && typeof vehicleRef === "object" ? vehicleRef : null;
    })
    .filter(Boolean);
}

export default function BookWorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const readServiceCollection = useServiceCollectionReader();

  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [filter, setFilter] = useState("open");
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("");

  // 👇 in-progress service form drafts (deduped: max 1 per vehicle)
  const [serviceDrafts, setServiceDrafts] = useState([]);

  // 🔍 service due lists
  const [serviceLoading, setServiceLoading] = useState(true);
  const [overdueServices, setOverdueServices] = useState([]);
  const [dueSoonServices, setDueSoonServices] = useState([]);

  // 👇 data for vehicle prep list
  const [bookings, setBookings] = useState([]);
  const [vehiclesData, setVehiclesData] = useState([]);
  const [prepLoading, setPrepLoading] = useState(true);

  /* ---------------- LOAD ALL SERVICE DRAFTS (DEDUPED PER VEHICLE) ---------------- */
  useEffect(() => {
    const loadDrafts = async () => {
      try {
        const raw = await AsyncStorage.getItem(SERVICE_DRAFTS_KEY);
        if (!raw) {
          setServiceDrafts([]);
          return;
        }

        const obj = JSON.parse(raw) || {};
        const arr = Object.entries(obj).map(([id, draft]) => ({
          id,
          ...draft,
        }));

        // 🔒 Deduplicate: only ONE in-progress form per vehicle
        const byVehicle = new Map(); // selectedVehicleId -> draft
        const noVehicleDrafts = [];

        for (const draft of arr) {
          const vid = draft.selectedVehicleId;
          if (!vid) {
            noVehicleDrafts.push(draft);
            continue;
          }

          const existing = byVehicle.get(vid);
          if (!existing) {
            byVehicle.set(vid, draft);
          } else {
            const currentTs = getDraftTimestampFromId(existing.id);
            const incomingTs = getDraftTimestampFromId(draft.id);
            if (incomingTs > currentTs) {
              byVehicle.set(vid, draft);
            }
          }
        }

        const deduped = [...noVehicleDrafts, ...byVehicle.values()];

        const cleanedStore = {};
        for (const d of deduped) {
          const { id, ...rest } = d;
          cleanedStore[id] = rest;
        }
        await AsyncStorage.setItem(
          SERVICE_DRAFTS_KEY,
          JSON.stringify(cleanedStore)
        );

        setServiceDrafts(deduped);
      } catch (err) {
        console.error("Failed to load service drafts:", err);
        setServiceDrafts([]);
      }
    };

    loadDrafts();
  }, [readServiceCollection]);

  /* ---------------- LOAD VEHICLES & FIND SERVICE DUE ---------------- */
  useEffect(() => {
    const fetchServiceDueVehicles = async () => {
      setServiceLoading(true);
      try {
        const vehicleRows = await readServiceCollection("vehicles");

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const msPerDay = 1000 * 60 * 60 * 24;

        const overdue = [];
        const soon = [];
        const allVehicles = [];

        vehicleRows.forEach((vehicle) => {
          const data = vehicle || {};
          const id = vehicle.id;

          allVehicles.push({ id, ...data });

          const name = getVehicleName(data) || "Unnamed vehicle";
          const reg = getVehicleRegistration(data) || "";
          const nextService = getVehicleNextService(data);

          if (!nextService) return;

          const serviceDate = new Date(nextService);
          if (Number.isNaN(serviceDate.getTime())) return;

          const serviceDateOnly = new Date(
            serviceDate.getFullYear(),
            serviceDate.getMonth(),
            serviceDate.getDate(),
            0,
            0,
            0,
            0
          );

          const diffMs = serviceDateOnly.getTime() - today.getTime();
          const diffDays = Math.round(diffMs / msPerDay);

          if (diffDays < 0) {
            overdue.push({
              id,
              name,
              reg,
              nextService,
              daysOverdue: Math.abs(diffDays),
            });
          } else if (diffDays <= 30) {
            soon.push({
              id,
              name,
              reg,
              nextService,
              daysUntil: diffDays,
            });
          }
        });

        overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
        soon.sort((a, b) => a.daysUntil - b.daysUntil);

        setOverdueServices(overdue);
        setDueSoonServices(soon);
        setVehiclesData(allVehicles);
      } catch (err) {
        console.error("Failed to load vehicles for service due list:", err);
      } finally {
        setServiceLoading(false);
      }
    };

    fetchServiceDueVehicles();
  }, [readServiceCollection]);

  /* ---------------- LOAD BOOKINGS FOR VEHICLE PREP LIST ---------------- */
  useEffect(() => {
    const fetchBookings = async () => {
      try {
        setPrepLoading(true);
        const [legacyData, maintenanceRows] = await Promise.all([
          readServiceCollection("bookings"),
          readServiceCollection("maintenanceBookings"),
        ]);
        const maintenanceData = maintenanceRows.map((booking) => ({
          id: booking.id,
          ...normalizeMaintenanceBookingForPrep(booking),
        }));
        const data = [...legacyData, ...maintenanceData];
        setBookings(data);
      } catch (err) {
        console.error("Failed to load bookings for vehicle prep:", err);
      } finally {
        setPrepLoading(false);
      }
    };

    fetchBookings();
  }, [readServiceCollection]);

  const hasAnyServiceDue =
    overdueServices.length > 0 || dueSoonServices.length > 0;

  // 🧠 hide drafts that are *already represented* in the service-due list
  const serviceDueIds = useMemo(
    () => new Set([...overdueServices, ...dueSoonServices].map((v) => v.id)),
    [overdueServices, dueSoonServices]
  );

  const visibleDrafts = useMemo(
    () =>
      serviceDrafts.filter(
        (d) => !d.selectedVehicleId || !serviceDueIds.has(d.selectedVehicleId)
      ),
    [serviceDrafts, serviceDueIds]
  );

  /* ---------------- SMART SUGGESTION TEXT ---------------- */

  const primarySuggestion = useMemo(() => {
    if (serviceLoading) {
      return "We’re checking your fleet for overdue and upcoming services…";
    }

    if (overdueServices.length > 0) {
      const v = overdueServices[0];
      const reg = v.reg ? ` · ${v.reg}` : "";
      return `Start with the most overdue service: ${v.name}${reg} (${v.daysOverdue} day${
        v.daysOverdue === 1 ? "" : "s"
      } overdue). Tap it in “Service due” below to open a service form.`;
    }

    if (dueSoonServices.length > 0) {
      const v = dueSoonServices[0];
      const reg = v.reg ? ` · ${v.reg}` : "";
      return `Next priority: plan a service for ${v.name}${reg}, due in ${
        v.daysUntil
      } day${v.daysUntil === 1 ? "" : "s"}. Tap it in “Service due” to book a slot.`;
    }

    if (visibleDrafts.length > 0) {
      return "Finish your in-progress service forms so vehicles are fully up to date. Tap any row under “In-progress forms”.";
    }

    return "No urgent services showing. Add today’s MOT, service or defect tasks below and tick them off as you go.";
  }, [serviceLoading, overdueServices, dueSoonServices, visibleDrafts]);

  const filteredTasks = useMemo(() => {
    if (filter === "all") return tasks;
    if (filter === "open") return tasks.filter((t) => !t.completed);
    if (filter === "completed") return tasks.filter((t) => t.completed);
    return tasks;
  }, [tasks, filter]);

  /* ---------------- VEHICLE PREP LIST (NEXT 3 DAYS, CONFIRMED ONLY, NO TODAY) ---------------- */

  const prepItems = useMemo(() => {
    if (!bookings.length) return [];

    const today = startOfDay(new Date());
    const windowStart = startOfDay(addDays(today, 1)); // tomorrow
    const windowEnd = startOfDay(addDays(today, 3)); // tomorrow + 2 days = 3 days ahead

    const validStatuses = new Set(["Confirmed"]); // ✅ confirmed jobs only

    const items = [];

    bookings.forEach((b) => {
      const status = b.status || "Confirmed";
      if (!validStatuses.has(status)) return;

      const days = getBookingDaysWithinWindow(b, windowStart, windowEnd);
      if (!days.length) return;

      const normVehicles = normalizeVehicles(
        getBookingVehicleReferences(b),
        vehiclesData
      );
      if (!normVehicles.length) return;

      days.forEach((day) => {
        const dateKey = day.toISOString().split("T")[0];

        normVehicles.forEach((v) => {
          const name =
            getVehicleName(v) ||
            [getVehicleManufacturer(v), v.model].filter(Boolean).join(" ") ||
            "Vehicle";
          const reg = getVehicleRegistration(v) || "";

          const taxStatus = v.taxStatus || "";
          const insuranceStatus = v.insuranceStatus || "";

          const tax = String(taxStatus).toLowerCase();
          const ins = String(insuranceStatus).toLowerCase();

          const isSornOrUntaxed = ["sorn", "untaxed", "no tax"].includes(tax);
          const isUninsured = ["not insured", "uninsured", "no insurance"].includes(
            ins
          );

          items.push({
            key: `${b.id}-${v.id || name}-${dateKey}`,
            date: dateKey,
            dateObj: day,
            vehicleId: v.id || reg || name,
            vehicleName: name,
            registration: reg,
            taxStatus,
            insuranceStatus,
            isSornOrUntaxed,
            isUninsured,
          });
        });
      });
    });

    items.sort((a, b) => {
      if (a.dateObj.getTime() !== b.dateObj.getTime()) {
        return a.dateObj - b.dateObj;
      }
      return (a.vehicleName || "").localeCompare(b.vehicleName || "");
    });

    return items;
  }, [bookings, vehiclesData]);

  const prepByDate = useMemo(() => {
    if (!prepItems.length) return [];
    const map = new Map();
    prepItems.forEach((item) => {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date).push(item);
    });

    return Array.from(map.entries())
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([date, items]) => ({ date, items }));
  }, [prepItems]);

  const toggleTask = (id) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const addTask = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    const task = {
      id: `local-${Date.now()}`,
      title: trimmed,
      type: newType.trim() || "General",
      hint: "Custom task",
      completed: false,
    };

    setTasks((prev) => [task, ...prev]);
    setNewTitle("");
    setNewType("");
  };

  // 🔁 continue a specific draft
  const handleContinueServiceForm = (formId) => {
    router.push(`/service/service-form/${formId}`);
  };

  // ⚙️ when starting a service from this page for a specific vehicle
  const handleStartServiceForVehicle = async (vehicle) => {
    try {
      const name = getVehicleName(vehicle) || "Unnamed vehicle";
      const reg = getVehicleRegistration(vehicle) || "";

      const existingDraft = serviceDrafts.find(
        (d) => d.selectedVehicleId === vehicle.id
      );
      if (existingDraft) {
        router.push(`/service/service-form/${existingDraft.id}`);
        return;
      }

      const formId = `svc-${vehicle.id}-${Date.now()}`;

      const newDraft = {
        selectedVehicleId: vehicle.id,
        vehicleName: name,
        registration: reg,
        serviceType: "Full service",
        serviceDate: undefined,
        serviceTime: undefined,
        odometer: "",
        workSummary: "",
        partsUsed: "",
        extraNotes: "",
        signedBy: "",
        checks: {},
        checkRatings: {},
        checkNA: {},
        photoURIs: [],
      };

      const raw = await AsyncStorage.getItem(SERVICE_DRAFTS_KEY);
      const allDrafts = raw ? JSON.parse(raw) || {} : {};

      allDrafts[formId] = newDraft;
      await AsyncStorage.setItem(
        SERVICE_DRAFTS_KEY,
        JSON.stringify(allDrafts)
      );

      setServiceDrafts((prev) => [...prev, { id: formId, ...newDraft }]);

      router.push(`/service/service-form/${formId}`);
    } catch (err) {
      console.error("Failed to prep draft for service form:", err);
      router.push("/service/service-form/error");
    }
  };

  return (
    <PageShell
      header={{
        variant: "hero",
        eyebrow: "Workshop",
        title: "Workshop To-Do",
        subtitle: "The system suggests where to start. Tap a row to open the right form.",
      }}
    >
        {/* INFO CARD – SMART SUGGESTION */}
        <View
          style={[
            styles.infoCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <Text
            style={[
              styles.infoTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Today’s suggested next step
          </Text>
          <Text
            style={[
              styles.infoSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            {primarySuggestion}
          </Text>
          <Text
            style={[
              styles.infoHint,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Then work down the lists below:{" "}
            <Text style={{ fontWeight: "600" }}>
              Vehicle prep → Service due → In-progress forms → Tasks.
            </Text>
          </Text>
        </View>

        {/* 🚚 VEHICLE PREP – NEXT 3 DAYS (CONFIRMED, EXCLUDING TODAY) */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Vehicle prep — next 3 days
          </Text>
          <Text
            style={[
              styles.sectionSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Confirmed jobs only · starts from tomorrow.
          </Text>
        </View>

        <View
          style={[
            styles.prepCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          {prepLoading ? (
            <View style={styles.serviceLoadingRow}>
              <ActivityIndicator
                size="small"
                color={colors.danger || COLORS.primaryAction}
              />
              <Text
                style={[
                  styles.serviceLoadingText,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Pulling vehicles for the next 3 days…
              </Text>
            </View>
          ) : prepByDate.length === 0 ? (
            <View style={styles.emptyServiceState}>
              <Icon
                name="truck"
                size={18}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text
                style={[
                  styles.emptyServiceText,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                No confirmed vehicles going out in the next 3 days.
              </Text>
            </View>
          ) : (
            prepByDate.map((group) => {
              const label = new Date(group.date).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              });

              return (
                <View key={group.date} style={{ marginBottom: t.spacing.xs }}>
                  <Text
                    style={[
                      styles.prepDateLabel,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {label}
                  </Text>
                  {group.items.map((item) => (
                    <VehiclePrepRow key={item.key} item={item} />
                  ))}
                </View>
              );
            })
          )}
        </View>

        {/* 🔧 SERVICE DUE SECTION */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Service due
          </Text>
          {hasAnyServiceDue && (
            <Text
              style={[
                styles.sectionSubtitle,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Tap a vehicle to start or continue its service form.
            </Text>
          )}
        </View>

        <View
          style={[
            styles.serviceCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          {serviceLoading ? (
            <View style={styles.serviceLoadingRow}>
              <ActivityIndicator
                size="small"
                color={colors.danger || COLORS.primaryAction}
              />
              <Text
                style={[
                  styles.serviceLoadingText,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Checking service dates…
              </Text>
            </View>
          ) : !hasAnyServiceDue ? (
            <View style={styles.emptyServiceState}>
              <Icon
                name="check"
                size={18}
                color={colors.textMuted || COLORS.textMid}
              />
              <Text
                style={[
                  styles.emptyServiceText,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                No services overdue or due in the next 30 days.
              </Text>
            </View>
          ) : (
            <>
              {overdueServices.length > 0 && (
                <View style={{ marginBottom: t.spacing.xs }}>
                  <Text
                    style={[
                      styles.serviceGroupTitle,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    Overdue
                  </Text>
                  {overdueServices.map((v, idx) => {
                    const existingDraft = serviceDrafts.find(
                      (d) => d.selectedVehicleId === v.id
                    );
                    const isDraftVehicle = !!existingDraft;

                    const isTopRecommended = idx === 0;

                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[
                          styles.serviceRow,
                          isTopRecommended && styles.serviceRowRecommended,
                          { borderTopColor: colors.border || COLORS.border },
                        ]}
                        onPress={() =>
                          isDraftVehicle
                            ? handleContinueServiceForm(existingDraft.id)
                            : handleStartServiceForVehicle(v)
                        }
                        activeOpacity={0.9}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row" }}>
                            <Text
                              style={[
                                styles.serviceVehicle,
                                { color: colors.text || COLORS.textHigh },
                              ]}
                            >
                              {v.name}
                              {v.reg ? ` · ${v.reg}` : ""}
                            </Text>
                            {isTopRecommended && (
                              <Text
                                style={[
                                  styles.recommendedTag,
                                  {
                                    color:
                                      colors.danger || COLORS.primaryAction,
                                  },
                                ]}
                              >
                                Start here
                              </Text>
                            )}
                          </View>
                          <Text
                            style={[
                              styles.serviceMeta,
                              { color: colors.textMuted || COLORS.textMid },
                            ]}
                          >
                            Next service was due {formatDateShort(v.nextService) || v.nextService} ·{" "}
                            {v.daysOverdue} day
                            {v.daysOverdue === 1 ? "" : "s"} overdue
                          </Text>
                        </View>
                        <View style={styles.serviceBadgeOverdue}>
                          <Text style={styles.serviceBadgeText}>
                            {isDraftVehicle ? "In progress" : "Service"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {dueSoonServices.length > 0 && (
                <View style={{ marginTop: overdueServices.length ? 4 : 0 }}>
                  <Text
                    style={[
                      styles.serviceGroupTitle,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    Due in next 30 days
                  </Text>
                  {dueSoonServices.map((v, idx) => {
                    const existingDraft = serviceDrafts.find(
                      (d) => d.selectedVehicleId === v.id
                    );
                    const isDraftVehicle = !!existingDraft;
                    const isNextPriority = idx === 0;

                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[
                          styles.serviceRow,
                          { borderTopColor: colors.border || COLORS.border },
                        ]}
                        onPress={() =>
                          isDraftVehicle
                            ? handleContinueServiceForm(existingDraft.id)
                            : handleStartServiceForVehicle(v)
                        }
                        activeOpacity={0.9}
                      >
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: "row" }}>
                            <Text
                              style={[
                                styles.serviceVehicle,
                                { color: colors.text || COLORS.textHigh },
                              ]}
                            >
                              {v.name}
                              {v.reg ? ` · ${v.reg}` : ""}
                            </Text>
                            {isNextPriority && (
                              <Text style={styles.nextPriorityTag}>
                                Next up
                              </Text>
                            )}
                          </View>
                          <Text
                            style={[
                              styles.serviceMeta,
                              { color: colors.textMuted || COLORS.textMid },
                            ]}
                          >
                            Next service {formatDateShort(v.nextService) || v.nextService} · due in {v.daysUntil}{" "}
                            day{v.daysUntil === 1 ? "" : "s"}
                          </Text>
                        </View>
                        <View style={styles.serviceBadgeSoon}>
                          <Text style={styles.serviceBadgeText}>
                            {isDraftVehicle ? "In progress" : "Service"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </>
          )}
        </View>

        {/* 🔴 IN-PROGRESS FORMS SECTION */}
        {visibleDrafts.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.text || COLORS.textHigh },
                ]}
              >
                In-progress forms
              </Text>
              <Text
                style={[
                  styles.sectionSubtitle,
                  { color: colors.textMuted || COLORS.textMid },
                ]}
              >
                Continue a saved workshop record.
              </Text>
            </View>

            {visibleDrafts.map((draft) => (
              <TouchableOpacity
                key={draft.id}
                style={[
                  styles.draftCard,
                  {
                    backgroundColor: colors.surfaceAlt || COLORS.card,
                    borderColor:
                      colors.danger || COLORS.primaryAction,
                  },
                ]}
                activeOpacity={0.9}
                onPress={() => handleContinueServiceForm(draft.id)}
              >
                <View style={styles.draftIconWrap}>
                  <Icon name="file-text" size={18} color={COLORS.textHigh} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[
                      styles.draftTitle,
                      { color: colors.text || COLORS.textHigh },
                    ]}
                  >
                    {draft.vehicleName || "Vehicle not selected yet"}
                    {draft.registration ? ` · ${draft.registration}` : ""}
                  </Text>
                  <Text
                    style={[
                      styles.draftMeta,
                      { color: colors.textMuted || COLORS.textMid },
                    ]}
                  >
                    {(draft.serviceType || "Full service") +
                      " · " +
                      (draft.serviceDate || "In progress")}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* FILTERS */}
        <View style={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[
                  styles.filterChip,
                  {
                    borderColor: active
                      ? colors.accent || COLORS.primaryAction
                      : colors.border || COLORS.border,
                    backgroundColor: active
                      ? colors.accentSoft || staticColors.rgba_mxgb9x
                      : colors.surfaceAlt || COLORS.card,
                  },
                ]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.filterText,
                    {
                      color: active
                        ? colors.accent || COLORS.primaryAction
                        : colors.textMuted || COLORS.textMid,
                    },
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ADD TASK */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Add workshop task
          </Text>
          <Text
            style={[
              styles.sectionSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            For things that aren’t in the system yet.
          </Text>
        </View>

        <View
          style={[
            styles.addTaskCard,
            {
              backgroundColor: colors.surfaceAlt || COLORS.card,
              borderColor: colors.border || COLORS.border,
            },
          ]}
        >
          <FormField
            label="Task title"
            placeholder="e.g. Investigate noise on Amarok"
            value={newTitle}
            onChangeText={setNewTitle}
          />

          <FormField
            label="Category"
            style={{ marginTop: t.spacing.xs }}
            placeholder="e.g. MOT, Service, Tyres, Defect…"
            value={newType}
            onChangeText={setNewType}
          />

          <AppButton
            label="Add to list"
            icon="plus"
            onPress={addTask}
            disabled={newTitle.trim().length === 0}
            fullWidth
          />
        </View>

        {/* TASK LIST */}
        <View style={styles.sectionHeaderRow}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Tasks
          </Text>
          <Text
            style={[
              styles.sectionSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Select a row to mark it complete or reopen it.
          </Text>
        </View>

        {filteredTasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon
              name="check-circle"
              size={28}
              color={colors.textMuted || COLORS.textMid}
            />
            <Text
              style={[
                styles.emptyTitle,
                { color: colors.text || COLORS.textHigh },
              ]}
            >
              No tasks in this view
            </Text>
            <Text
              style={[
                styles.emptySubtitle,
                { color: colors.textMuted || COLORS.textMid },
              ]}
            >
              Try adding a new task above or switch filter to “All”.
            </Text>
          </View>
        ) : (
          filteredTasks.map((task) => (
            <TaskRow key={task.id} task={task} onToggle={toggleTask} />
          ))
        )}

    </PageShell>
  );
}

/* ---------- ROW COMPONENTS ---------- */

function VehiclePrepRow({ item }) {
  const router = useRouter();
  const { colors } = useTheme();

  const dateText = new Date(item.date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const showComplianceWarning = item.isSornOrUntaxed || item.isUninsured;

  const onPress = () => {
    const base = `/service/vehicle-prep/${encodeURIComponent(
      item.vehicleId || "vehicle"
    )}`;
    const params = new URLSearchParams({
      date: item.date,
      vehicleName: item.vehicleName || "",
      registration: item.registration || "",
    });
    router.push(`${base}?${params.toString()}`);
  };

  return (
    <TouchableOpacity
      style={[
        styles.prepRow,
        { borderTopColor: colors.border || COLORS.border },
      ]}
      activeOpacity={0.9}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.prepVehicleMain,
            { color: colors.text || COLORS.textHigh },
          ]}
        >
          {item.vehicleName}
          {item.registration ? ` · ${item.registration}` : ""}
        </Text>
        <Text
          style={[
            styles.prepGoingOutText,
            { color: colors.textMuted || COLORS.textMid },
          ]}
        >
          Going out: {dateText}
        </Text>

        <View style={styles.prepBadgeRow}>
          {showComplianceWarning ? (
            <View style={styles.prepComplianceBad}>
              <Icon name="alert-triangle" size={12} color={staticColors.hex_fff_yhjmu8} />
              <Text style={styles.prepComplianceText}>CHECK TAX / INS</Text>
            </View>
          ) : (
            <View style={styles.prepComplianceOk}>
              <Icon name="check" size={12} color={staticColors.hex_0b0b0b_9v81ck} />
              <Text style={styles.prepComplianceOkText}>Compliance OK</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

function TaskRow({ task, onToggle }) {
  const { colors } = useTheme();
  const completed = task.completed;

  let typeColour = colors.textMuted || staticColors.hex_999_yhltsv;
  const typeLower = task.type.toLowerCase();
  if (typeLower.includes("mot")) typeColour = colors.danger || staticColors.hex_ed1c25_4py4qa;
  else if (typeLower.includes("service"))
    typeColour = colors.success || staticColors.hex_34c759_8tm7fd;
  else if (typeLower.includes("defect")) typeColour = staticColors.hex_ff9500_5c3jxm;
  else if (typeLower.includes("tyre")) typeColour = staticColors.hex_ffcc00_5c6g4m;
  else if (typeLower.includes("loler")) typeColour = staticColors.hex_5ac8fa_60jr0u;

  return (
    <TouchableOpacity
      style={[
        styles.taskRow,
        {
          opacity: completed ? 0.55 : 1,
          borderBottomColor: colors.border || COLORS.border,
        },
      ]}
      activeOpacity={0.85}
      onPress={() => onToggle(task.id)}
    >
      <View style={styles.taskCheckWrap}>
        {completed ? (
          <View
            style={[
              styles.taskCheckFilled,
              { backgroundColor: colors.danger || COLORS.primaryAction },
            ]}
          >
            <Icon name="check" size={14} color={COLORS.textHigh} />
          </View>
        ) : (
          <View
            style={[
              styles.taskCheckEmpty,
              { borderColor: colors.textMuted || COLORS.textMid },
            ]}
          />
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Text
          style={[
            styles.taskTitle,
            {
              color: colors.text || COLORS.textHigh,
            },
            completed && {
              textDecorationLine: "line-through",
              color: colors.textMuted || COLORS.textMid,
            },
          ]}
        >
          {task.title}
        </Text>
        <View
          style={{ flexDirection: "row", alignItems: "center", marginTop: t.spacing.xxs }}
        >
          <View
            style={[
              styles.taskTypePill,
              { borderColor: typeColour },
            ]}
          >
            <Text
              style={[
                styles.taskTypeText,
                { color: typeColour },
              ]}
            >
              {task.type}
            </Text>
          </View>
          {!!task.hint && (
            <Text
              style={[
                styles.taskHint,
                { color: colors.textMuted || COLORS.textLow },
              ]}
            >
              {task.hint}
            </Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

/* ---------- STYLES ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerCard: {
    marginHorizontal: t.spacing.md,
    marginTop: t.spacing.xs,
    marginBottom: t.spacing.none,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  backButton: {
    paddingRight: t.spacing.xs,
  },
  pageTitle: {
    fontSize: t.typography.titleSmall.fontSize,
    fontWeight: "800",
  },
  pageSubtitle: {
    fontSize: t.typography.metadata.fontSize,
    marginTop: t.spacing.none,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: t.spacing.md,
    paddingTop: t.spacing.xxs,
    paddingBottom: 140,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    borderWidth: 1,
  },
  infoTitle: {
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
    marginBottom: t.spacing.xxs,
  },
  infoSubtitle: {
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  infoHint: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },

  /* VEHICLE PREP */
  prepCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    borderWidth: 1,
  },
  prepDateLabel: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "700",
    color: COLORS.textMid,
    marginBottom: t.spacing.xxs,
  },
  prepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  prepVehicleMain: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  prepGoingOutText: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
  prepBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: t.spacing.xxs,
    marginTop: t.spacing.xxs,
  },
  prepComplianceBad: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_e53935_rjwrqy,
    borderWidth: 1,
    borderColor: staticColors.hex_0b0b0b_9v81ck,
    gap: t.spacing.xxs,
  },
  prepComplianceText: {
    fontSize: t.typography.micro.fontSize,
    fontWeight: "800",
    color: staticColors.hex_fff_yhjmu8,
  },
  prepComplianceOk: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.hex_7afe6e_78gdcw,
    borderWidth: 1,
    borderColor: staticColors.hex_0b0b0b_9v81ck,
    gap: t.spacing.xxs,
  },
  prepComplianceOkText: {
    fontSize: t.typography.micro.fontSize,
    fontWeight: "800",
    color: staticColors.hex_0b0b0b_9v81ck,
  },

  /* SERVICE DUE */
  serviceCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    borderWidth: 1,
  },
  serviceLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  serviceLoadingText: {
    marginLeft: t.spacing.xs,
    fontSize: t.typography.bodySmall.fontSize,
    color: COLORS.textMid,
  },
  emptyServiceState: {
    flexDirection: "row",
    alignItems: "center",
  },
  emptyServiceText: {
    marginLeft: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
  },
  serviceGroupTitle: {
    fontSize: t.typography.bodySmall.fontSize,
    fontWeight: "700",
    color: COLORS.textMid,
    marginBottom: t.spacing.xxs,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: t.spacing.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  serviceRowRecommended: {
    backgroundColor: staticColors.rgba_mxgb83,
  },
  serviceVehicle: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  serviceMeta: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
    marginTop: t.spacing.none,
  },
  serviceBadgeOverdue: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_mxgb17,
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
  },
  serviceBadgeSoon: {
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_1boderh,
    borderWidth: 1,
    borderColor: staticColors.hex_ffcc00_5c6g4m,
  },
  serviceBadgeText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  recommendedTag: {
    marginLeft: t.spacing.xs,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
    color: COLORS.primaryAction,
  },
  nextPriorityTag: {
    marginLeft: t.spacing.xs,
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
    color: staticColors.hex_ffcc00_5c6g4m,
  },

  /* DRAFT CARD */
  draftCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    minHeight: 72,
    padding: t.spacing.sm,
    marginBottom: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
  },
  draftIconWrap: {
    width: 32,
    height: 32,
    borderRadius: t.radius.pill,
    backgroundColor: staticColors.rgba_mxgb9x,
    alignItems: "center",
    justifyContent: "center",
    marginRight: t.spacing.xs,
  },
  draftTitle: {
    fontSize: t.typography.body.fontSize,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  draftMeta: {
    marginTop: t.spacing.none,
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  draftHint: {
    marginTop: t.spacing.none,
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
  },
  filterRow: {
    flexDirection: "row",
    marginBottom: t.spacing.xs,
  },
  filterChip: {
    minHeight: t.controls.chipMinHeight,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xxs,
    borderRadius: t.radius.pill,
    borderWidth: 1,
    marginRight: t.spacing.xs,
  },
  filterText: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
  },
  sectionHeaderRow: {
    alignItems: "flex-start",
    gap: t.spacing.xxs,
  },
  sectionTitle: {
    fontSize: t.typography.sectionTitle.fontSize,
    fontWeight: "800",
  },
  sectionSubtitle: {
    fontSize: t.typography.metadata.fontSize,
    color: COLORS.textMid,
  },
  addTaskCard: {
    backgroundColor: COLORS.card,
    borderRadius: t.radius.md,
    padding: t.spacing.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addLabel: {
    fontSize: t.typography.metadata.fontSize,
    fontWeight: "600",
    color: COLORS.textMid,
    marginBottom: t.spacing.xxs,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    color: COLORS.textHigh,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.xs,
    fontSize: t.typography.body.fontSize,
  },
  addButton: {
    marginTop: t.spacing.sm,
    borderRadius: t.radius.pill,
    minHeight: t.controls.buttonHeight,
    paddingVertical: t.spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xxs,
  },
  addButtonText: {
    color: COLORS.textHigh,
    fontWeight: "700",
    fontSize: t.typography.body.fontSize,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: t.spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  taskCheckWrap: {
    paddingRight: t.spacing.xs,
    paddingTop: t.spacing.xxs,
  },
  taskCheckEmpty: {
    width: 20,
    height: 20,
    borderRadius: t.radius.pill,
    borderWidth: 1.5,
    borderColor: COLORS.textMid,
  },
  taskCheckFilled: {
    width: 20,
    height: 20,
    borderRadius: t.radius.pill,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  taskTitle: {
    fontSize: t.typography.body.fontSize,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  taskTypePill: {
    borderRadius: t.radius.pill,
    borderWidth: 1,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.none,
    marginRight: t.spacing.xs,
  },
  taskTypeText: {
    fontSize: t.typography.caption.fontSize,
    fontWeight: "700",
  },
  taskHint: {
    fontSize: t.typography.caption.fontSize,
    color: COLORS.textLow,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing.xl,
    paddingHorizontal: t.spacing.xl,
  },
  emptyTitle: {
    marginTop: t.spacing.xs,
    fontSize: t.typography.bodyLarge.fontSize,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: t.spacing.xxs,
    fontSize: t.typography.bodySmall.fontSize,
    textAlign: "center",
    color: COLORS.textMid,
  },
});
