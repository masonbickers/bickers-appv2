const text = (value) => String(value ?? "").trim();

const dateKey = (value) => text(value).slice(0, 10);

const bookingId = (booking = {}) => text(booking.id || booking.bookingId);

const bookingHasDate = (booking = {}, targetDate = "") =>
  (Array.isArray(booking.bookingDates) ? booking.bookingDates : [])
    .some((value) => dateKey(value) === targetDate);

const bookingDayNote = (booking = {}, targetDate = "") => {
  const notes = booking.notesByDate || {};
  const raw = notes[targetDate];
  const value = typeof raw === "object" && raw
    ? raw.label || raw.value || raw.note
    : raw;
  if (text(value).toLowerCase() === "other") return text(notes[`${targetDate}-other`]);
  return text(value);
};

const payableDayPriority = (booking = {}, targetDate = "") => {
  const note = bookingDayNote(booking, targetDate).toLowerCase();
  if (/\bon\s*set\s*travel\b|\btravel\b|\bjourney\b|\bto\s*and\s*from\b/.test(note)) return 1;
  if (/\bon[\s-]?set\b|\bshoot\s*day\b|\bonsite\b|\bon\s*shoot\b/.test(note)) return 2;
  return 0;
};

const linkedJobLabel = (source = {}, target = {}) => {
  const from = text(source.jobNumber || target.linkedContinuation?.fromJobNumber);
  const to = text(target.jobNumber);
  if (from && to) return `${from} → ${to}`;
  return to || from;
};

/**
 * Collapse the one shared handover date for a linked continuation into one
 * user-facing job card. The underlying bookings remain separate everywhere
 * else, including persistence, availability and timesheets.
 */
export function collapseLinkedJobsForDay(jobs = [], day = "") {
  const targetDate = dateKey(day);
  const list = Array.isArray(jobs) ? jobs.filter(Boolean) : [];
  if (!targetDate || list.length < 2) return list;

  const byId = new Map(list.map((job) => [bookingId(job), job]).filter(([id]) => id));
  const hiddenSourceIds = new Set();
  const linkedTargets = new Map();

  list.forEach((target) => {
    const link = target?.linkedContinuation;
    const sourceId = text(link?.fromBookingId);
    if (!sourceId || dateKey(link?.handoverDate) !== targetDate) return;

    const source = byId.get(sourceId);
    if (!source || !bookingHasDate(source, targetDate) || !bookingHasDate(target, targetDate)) return;

    const primary = payableDayPriority(source, targetDate) > payableDayPriority(target, targetDate)
      ? source
      : target;
    hiddenSourceIds.add(sourceId);
    linkedTargets.set(bookingId(target), {
      ...primary,
      linkedHandoverJobs: [source, target],
      linkedJobNumberLabel: linkedJobLabel(source, target),
    });
  });

  return list
    .filter((job) => !hiddenSourceIds.has(bookingId(job)))
    .map((job) => linkedTargets.get(bookingId(job)) || job);
}

export function displayJobNumber(job = {}) {
  return text(job.linkedJobNumberLabel || job.jobNumber) || "N/A";
}

export function expandLinkedHandoverJobs(jobs = []) {
  return (Array.isArray(jobs) ? jobs : []).flatMap((job) =>
    Array.isArray(job?.linkedHandoverJobs) && job.linkedHandoverJobs.length
      ? job.linkedHandoverJobs
      : [job]
  );
}
