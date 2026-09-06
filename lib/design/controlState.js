export function resolveInteractionState({
  error = false,
  focused = false,
  selected = false,
  disabled = false,
  loading = false,
  pressed = false,
} = {}) {
  const visual = error
    ? "error"
    : focused
      ? "focused"
      : selected
        ? "selected"
        : "default";
  const inactive = disabled || loading;
  return {
    visual,
    inactive,
    opacity: inactive ? 0.55 : pressed ? 0.78 : 1,
  };
}

export function normalizeSelectOptions(options = []) {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => option && option.value != null && String(option.label || "").trim())
    .map((option) => ({
      ...option,
      label: String(option.label).trim(),
      description: String(option.description || "").trim(),
      keywords: Array.isArray(option.keywords)
        ? option.keywords.map((keyword) => String(keyword).trim()).filter(Boolean)
        : String(option.keywords || "").trim()
          ? [String(option.keywords).trim()]
          : [],
      disabled: option.disabled === true,
    }));
}

export function filterSelectOptions(options, query) {
  const normalized = normalizeSelectOptions(options);
  const needle = String(query || "").trim().toLocaleLowerCase();
  if (!needle) return normalized;
  return normalized.filter((option) =>
    [option.label, option.description, ...option.keywords]
      .join(" ")
      .toLocaleLowerCase()
      .includes(needle)
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value) {
  const candidate = String(value || "");
  if (!ISO_DATE.test(candidate)) return false;
  const [year, month, day] = candidate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isDateSelectable(value, { minDate, maxDate, disabledDates = [] } = {}) {
  if (!isISODate(value)) return false;
  if (isISODate(minDate) && value < minDate) return false;
  if (isISODate(maxDate) && value > maxDate) return false;
  return !new Set(Array.isArray(disabledDates) ? disabledDates : []).has(value);
}

export async function runConfirmation(action, onError) {
  try {
    await action?.();
    return { error: null, message: "" };
  } catch (error) {
    onError?.(error);
    return {
      error,
      message: error?.message || "The action could not be completed. Please try again.",
    };
  }
}
