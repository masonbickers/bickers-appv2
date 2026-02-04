// lib/notificationInbox.js
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@bickers_notifications_v1";
const MAX_ITEMS = 200;

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

export async function setInbox(list) {
  const trimmed = Array.isArray(list) ? list.slice(0, MAX_ITEMS) : [];
  await AsyncStorage.setItem(KEY, JSON.stringify(trimmed));
  return trimmed;
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
  const next = [payload, ...list].slice(0, MAX_ITEMS);
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
  return [];
}
