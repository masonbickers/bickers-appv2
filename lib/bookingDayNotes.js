function cleanNote(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Resolve the note attached to one booking day across the supported booking
 * schemas. `notesByDate[date] === "Other"` stores its free text separately.
 */
export function getBookingDayNote(booking, dateISO) {
  if (!booking || !dateISO) return null;

  const direct =
    booking?.dayNotesByDate?.[dateISO] ??
    booking?.notesByDate?.[dateISO] ??
    booking?.dayNotes?.[dateISO];

  if (direct === "Other") {
    return cleanNote(
      booking?.notesByDate?.[`${dateISO}-other`] ??
        booking?.dayNotesByDate?.[`${dateISO}-other`]
    );
  }

  if (direct && typeof direct === "object") {
    return cleanNote(direct.note ?? direct.notes ?? direct.text ?? direct.value);
  }

  return cleanNote(direct);
}
