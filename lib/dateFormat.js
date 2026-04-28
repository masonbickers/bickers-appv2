export function toDateSafe(value) {
  if (!value) return null;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (match) {
      const [, y, m, d] = match;
      return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateDDMMYYYY(value) {
  const date = toDateSafe(value);
  if (!date) return "";
  return date.toLocaleDateString("en-GB");
}

export function formatDateRangeDDMMYYYY(start, end) {
  const startText = formatDateDDMMYYYY(start);
  const endText = formatDateDDMMYYYY(end);

  if (!startText) return endText;
  if (!endText || startText === endText) return startText;

  return `${startText} - ${endText}`;
}
