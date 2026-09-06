// lib/notificationInbox.js
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@bickers_notifications_v1";
const MAX_ITEMS = 200;
const listeners = new Set();

function publishInbox(list) {
  listeners.forEach((listener) => {
    try {
      listener(list);
    } catch (error) {
      console.warn("notification inbox listener failed:", error);
    }
  });
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

export async function getInbox() {
  const raw = await AsyncStorage.getItem(KEY);
  const list = safeJsonParse(raw, []);
  return Array.isArray(list) ? list : [];
}

function inboxDisplayKey(item = {}) {
  const data = item?.data || {};
  return JSON.stringify([
    String(item?.title || "").trim().toLowerCase(),
    String(item?.body || "").trim().replace(/\s+/g, " ").toLowerCase(),
    String(data.bookingId || ""),
    String(data.holidayId || ""),
    String(data.weekStartISO || data.weekStart || ""),
    String(data.dateISO || data.jobDate || ""),
  ]);
}

export function collapseInboxDuplicates(list) {
  const result = [];
  const keys = new Set();

  (Array.isArray(list) ? list : []).forEach((item) => {
    const key = inboxDisplayKey(item);
    if (keys.has(key)) return;
    keys.add(key);
    result.push(item);
  });

  return result;
}

export async function setInbox(list) {
  const trimmed = Array.isArray(list) ? list.slice(0, MAX_ITEMS) : [];
  await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  publishInbox(trimmed);
  return trimmed;
}

export function subscribeToInbox(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function addToInbox(item) {
  const now = Date.now();
  const payload = {
    id: item?.id || `${now}-${Math.random().toString(16).slice(2)}`,
    title: String(item?.title || "Notification"),
    body: String(item?.body || ""),
    data: item?.data || {},
    createdAt: Number(item?.createdAt || now),
    read: !!item?.read,
  };

  const list = await getInbox();
  const existing = list.find((entry) => entry?.id === payload.id);
  if (existing?.read) payload.read = true;
  const next = [payload, ...list.filter((existing) => existing?.id !== payload.id)].slice(
    0,
    MAX_ITEMS
  );
  await setInbox(next);
  return payload;
}

export async function markRead(id) {
  const list = await getInbox();
  const next = list.map((n) => (n.id === id ? { ...n, read: true } : n));
  await setInbox(next);
  return next;
}

export async function markAllRead() {
  const list = await getInbox();
  const next = list.map((n) => ({ ...n, read: true }));
  await setInbox(next);
  return next;
}

export async function clearInbox() {
  await AsyncStorage.removeItem(KEY);
  publishInbox([]);
  return [];
}
