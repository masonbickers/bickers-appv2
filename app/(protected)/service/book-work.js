import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";

import { collection, getDocs } from "firebase/firestore";
import { db } from "../../../firebaseConfig";

import { useTheme } from "../../providers/ThemeProvider";

const COLORS = {
  background: "#0D0D0D",
  card: "#1A1A1A",
  border: "#333333",
  textHigh: "#FFFFFF",
  textMid: "#E0E0E0",
  textLow: "#888888",
  primaryAction: "#FF3B30", // 🔴 align with service home
  recceAction: "#FF3B30",
  inputBg: "#2a2a2a",
  lightGray: "#4a4a4a",
};

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

// normalise vehicles on booking to attach full DB record where possible
function normalizeVehicles(list, vehiclesData) {
  if (!Array.isArray(list)) return [];
  return list.map((vRaw) => {
    if (
      vRaw &&
      typeof vRaw === "object" &&
      (vRaw.name || vRaw.registration || vRaw.id)
    ) {
      return vRaw;
    }
    const needle = String(vRaw ?? "").trim();
    const match =
      vehiclesData.find((x) => x.id === needle) ||
      vehiclesData.find(
        (x) =>
          String(x.registration ?? "").trim().toUpperCase() ===
          needle.toUpperCase()
      ) ||
      vehiclesData.find(
        (x) =>
          String(x.name ?? "").trim().toLowerCase() === needle.toLowerCase()
      );
    return match || { name: needle };
  });
}

export default function BookWorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();

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
  }, []);

  /* ---------------- LOAD VEHICLES & FIND SERVICE DUE ---------------- */
  useEffect(() => {
    const fetchServiceDueVehicles = async () => {
      setServiceLoading(true);
      try {
        const snap = await getDocs(collection(db, "vehicles"));

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const msPerDay = 1000 * 60 * 60 * 24;

        const overdue = [];
        const soon = [];
        const allVehicles = [];

        snap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const id = docSnap.id;

          allVehicles.push({ id, ...data });

          const name = data.name || data.vehicleName || "Unnamed vehicle";
          const reg = data.registration || data.reg || "";
          const nextService = data.nextService;

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
  }, []);

  /* ---------------- LOAD BOOKINGS FOR VEHICLE PREP LIST ---------------- */
  useEffect(() => {
    const fetchBookings = async () => {
      try {
        setPrepLoading(true);
        const snap = await getDocs(collection(db, "bookings"));
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setBookings(data);
      } catch (err) {
        console.error("Failed to load bookings for vehicle prep:", err);
      } finally {
        setPrepLoading(false);
      }
    };

    fetchBookings();
  }, []);

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

      const normVehicles = normalizeVehicles(b.vehicles || [], vehiclesData);
      if (!normVehicles.length) return;

      days.forEach((day) => {
        const dateKey = day.toISOString().split("T")[0];

        normVehicles.forEach((v) => {
          const name =
            v.name ||
            [v.manufacturer, v.model].filter(Boolean).join(" ") ||
            "Vehicle";
          const reg =
            v.registration || v.reg || v.plate || v.license || "";

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
      const name = vehicle.name || "Unnamed vehicle";
      const reg = vehicle.reg || "";

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
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colors.background || COLORS.background },
      ]}
    >
      {/* HEADER */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border || COLORS.border },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.pageTitle,
              { color: colors.text || COLORS.textHigh },
            ]}
          >
            Workshop To-Do
          </Text>
          <Text
            style={[
              styles.pageSubtitle,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            The system suggests where to start. Tap a row to open the right
            form.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
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
                <View key={group.date} style={{ marginBottom: 10 }}>
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
                <View style={{ marginBottom: 10 }}>
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

                    const isTopRecommended = idx === overdueServices.length - 1;

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
                            Next service was due {v.nextService} ·{" "}
                            {v.daysOverdue} day
                            {v.daysOverdue === 1 ? "" : "s"} overdue
                          </Text>
                        </View>
                        <View style={styles.serviceBadgeOverdue}>
                          <Text style={styles.serviceBadgeText}>
                            {isDraftVehicle ? "In progress" : "Service"}
                          </Text>
                        </View>
                        <Icon
                          name="chevron-right"
                          size={18}
                          color={colors.textMuted || COLORS.textMid}
                          style={{ marginLeft: 6 }}
                        />
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
                            Next service {v.nextService} · due in {v.daysUntil}{" "}
                            day{v.daysUntil === 1 ? "" : "s"}
                          </Text>
                        </View>
                        <View style={styles.serviceBadgeSoon}>
                          <Text style={styles.serviceBadgeText}>
                            {isDraftVehicle ? "In progress" : "Service"}
                          </Text>
                        </View>
                        <Icon
                          name="chevron-right"
                          size={18}
                          color={colors.textMuted || COLORS.textMid}
                          style={{ marginLeft: 6 }}
                        />
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
                Tap to jump back into a saved job.
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
                  <Text
                    style={[
                      styles.draftHint,
                      { color: colors.textMuted || COLORS.textLow },
                    ]}
                  >
                    Finish this record so the vehicle’s history is complete.
                  </Text>
                </View>
                <Icon
                  name="chevron-right"
                  size={18}
                  color={colors.textMuted || COLORS.textMid}
                  style={{ marginLeft: 8 }}
                />
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
                      ? colors.accentSoft || "rgba(255,59,48,0.16)"
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
          <Text
            style={[
              styles.addLabel,
              { color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Task title
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor:
                  colors.inputBackground || COLORS.inputBg,
                borderColor:
                  colors.inputBorder || COLORS.lightGray,
                color: colors.text || COLORS.textHigh,
              },
            ]}
            placeholder="e.g. Investigate noise on Amarok"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={newTitle}
            onChangeText={setNewTitle}
          />

          <Text
            style={[
              styles.addLabel,
              { marginTop: 10, color: colors.textMuted || COLORS.textMid },
            ]}
          >
            Category
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor:
                  colors.inputBackground || COLORS.inputBg,
                borderColor:
                  colors.inputBorder || COLORS.lightGray,
                color: colors.text || COLORS.textHigh,
              },
            ]}
            placeholder="e.g. MOT, Service, Tyres, Defect…"
            placeholderTextColor={colors.textMuted || COLORS.textLow}
            value={newType}
            onChangeText={setNewType}
          />

          <TouchableOpacity
            style={[
              styles.addButton,
              {
                backgroundColor:
                  newTitle.trim().length === 0
                    ? COLORS.lightGray
                    : colors.danger || COLORS.primaryAction,
              },
            ]}
            onPress={addTask}
            disabled={newTitle.trim().length === 0}
            activeOpacity={0.9}
          >
            <Icon name="plus" size={16} color={COLORS.textHigh} />
            <Text style={styles.addButtonText}>Add to list</Text>
          </TouchableOpacity>
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
            Tap a row to mark complete / reopen.
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

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
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
              <Icon name="alert-triangle" size={12} color="#fff" />
              <Text style={styles.prepComplianceText}>CHECK TAX / INS</Text>
            </View>
          ) : (
            <View style={styles.prepComplianceOk}>
              <Icon name="check" size={12} color="#0b0b0b" />
              <Text style={styles.prepComplianceOkText}>Compliance OK</Text>
            </View>
          )}
        </View>
      </View>
      <Icon
        name="chevron-right"
        size={18}
        color={colors.textMuted || COLORS.textMid}
        style={{ marginLeft: 6 }}
      />
    </TouchableOpacity>
  );
}

function TaskRow({ task, onToggle }) {
  const { colors } = useTheme();
  const completed = task.completed;

  let typeColour = colors.textMuted || "#999";
  const typeLower = task.type.toLowerCase();
  if (typeLower.includes("mot")) typeColour = colors.danger || "#FF3B30";
  else if (typeLower.includes("service"))
    typeColour = colors.success || "#34C759";
  else if (typeLower.includes("defect")) typeColour = "#FF9500";
  else if (typeLower.includes("tyre")) typeColour = "#FFCC00";
  else if (typeLower.includes("loler")) typeColour = "#5AC8FA";

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
          style={{ flexDirection: "row", alignItems: "center", marginTop: 4 }}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    paddingRight: 10,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: "800",
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 2,
    color: COLORS.textMid,
  },
  scrollContent: {
    padding: 16,
  },
  infoCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: 13,
    color: COLORS.textMid,
  },
  infoHint: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.textMid,
  },

  /* VEHICLE PREP */
  prepCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  prepDateLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.textMid,
    marginBottom: 4,
  },
  prepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  prepVehicleMain: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  prepGoingOutText: {
    fontSize: 12,
    color: COLORS.textMid,
    marginTop: 2,
  },
  prepBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  prepComplianceBad: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#e53935",
    borderWidth: 1,
    borderColor: "#0b0b0b",
    gap: 4,
  },
  prepComplianceText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
  },
  prepComplianceOk: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#7AFE6E",
    borderWidth: 1,
    borderColor: "#0b0b0b",
    gap: 4,
  },
  prepComplianceOkText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#0b0b0b",
  },

  /* SERVICE DUE */
  serviceCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  serviceLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  serviceLoadingText: {
    marginLeft: 8,
    fontSize: 13,
    color: COLORS.textMid,
  },
  emptyServiceState: {
    flexDirection: "row",
    alignItems: "center",
  },
  emptyServiceText: {
    marginLeft: 6,
    fontSize: 13,
  },
  serviceGroupTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.textMid,
    marginBottom: 4,
  },
  serviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  serviceRowRecommended: {
    backgroundColor: "rgba(255,59,48,0.10)",
  },
  serviceVehicle: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.textHigh,
  },
  serviceMeta: {
    fontSize: 12,
    color: COLORS.textMid,
    marginTop: 2,
  },
  serviceBadgeOverdue: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,59,48,0.18)",
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
  },
  serviceBadgeSoon: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,204,0,0.18)",
    borderWidth: 1,
    borderColor: "#FFCC00",
  },
  serviceBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  recommendedTag: {
    marginLeft: 8,
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.primaryAction,
  },
  nextPriorityTag: {
    marginLeft: 8,
    fontSize: 11,
    fontWeight: "700",
    color: "#FFCC00",
  },

  /* DRAFT CARD */
  draftCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.primaryAction,
  },
  draftIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,59,48,0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  draftTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.textHigh,
  },
  draftMeta: {
    marginTop: 2,
    fontSize: 12,
    color: COLORS.textMid,
  },
  draftHint: {
    marginTop: 2,
    fontSize: 11,
    color: COLORS.textLow,
  },

  filterRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
  },
  filterText: {
    fontSize: 12,
    fontWeight: "600",
  },
  sectionHeaderRow: {
    marginTop: 6,
    marginBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  sectionSubtitle: {
    fontSize: 12,
    color: COLORS.textMid,
  },
  addTaskCard: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textMid,
    marginBottom: 4,
  },
  input: {
    backgroundColor: COLORS.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    color: COLORS.textHigh,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  addButton: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  addButtonText: {
    color: COLORS.textHigh,
    fontWeight: "700",
    fontSize: 14,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  taskCheckWrap: {
    paddingRight: 10,
    paddingTop: 4,
  },
  taskCheckEmpty: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.textMid,
  },
  taskCheckFilled: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.primaryAction,
    alignItems: "center",
    justifyContent: "center",
  },
  taskTitle: {
    fontSize: 14,
    color: COLORS.textHigh,
    fontWeight: "600",
  },
  taskTypePill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 8,
  },
  taskTypeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  taskHint: {
    fontSize: 11,
    color: COLORS.textLow,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "700",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: 13,
    textAlign: "center",
    color: COLORS.textMid,
  },
});
