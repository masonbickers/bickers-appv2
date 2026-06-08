export function toDateSafe(value) {
  if (!value) return null;
  if (value?.toDate && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === "string") {
    const raw = value.trim();
    const isoMatch = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(raw);
    if (isoMatch) {
      const [, y, m, d] = isoMatch;
      return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    }

    const ukMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
    if (ukMatch) {
      const [, d, m, y] = ukMatch;
      return new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0);
    }
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateDDMMYYYY(value) {
  const date = toDateSafe(value);
  if (!date) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDateRangeDDMMYYYY(start, end) {
  const startText = formatDateDDMMYYYY(start);
  const endText = formatDateDDMMYYYY(end);

  if (!startText) return endText;
  if (!endText || startText === endText) return startText;

  return `${startText} - ${endText}`;
}
