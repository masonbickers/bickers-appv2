const STATUS_ALIASES = Object.freeze({
  active: "bookingActive",
  confirmed: "bookingActive",
  "1st pencil": "firstPencil",
  "first pencil": "firstPencil",
  "2nd pencil": "secondPencil",
  "second pencil": "secondPencil",
  night: "nightShoot",
  "night shoot": "nightShoot",
  maintenance: "maintenance",
  paid: "holidayPaid",
  unpaid: "holidayUnpaid",
  weekend: "weekend",
  approved: "approved",
  submitted: "submitted",
  draft: "draft",
  query: "query",
  danger: "danger",
  warning: "warning",
  success: "success",
  info: "info",
  neutral: "neutral",
});

const PALETTES = {
  light: {
    bookingActive: { foreground: "#14532D", background: "#DCFCE7", border: "#16A34A" },
    firstPencil: { foreground: "#713F12", background: "#FEF3C7", border: "#D97706" },
    secondPencil: { foreground: "#991B1B", background: "#FEE2E2", border: "#DC2626" },
    nightShoot: { foreground: "#581C87", background: "#F3E8FF", border: "#9333EA" },
    maintenance: { foreground: "#7C2D12", background: "#FFEDD5", border: "#EA580C" },
    holidayPaid: { foreground: "#14532D", background: "#DCFCE7", border: "#16A34A" },
    holidayUnpaid: { foreground: "#713F12", background: "#FEF3C7", border: "#D97706" },
    weekend: { foreground: "#374151", background: "#F3F4F6", border: "#6B7280" },
    approved: { foreground: "#14532D", background: "#DCFCE7", border: "#16A34A" },
    submitted: { foreground: "#1E3A8A", background: "#DBEAFE", border: "#2563EB" },
    draft: { foreground: "#713F12", background: "#FEF3C7", border: "#D97706" },
    query: { foreground: "#7C2D12", background: "#FFEDD5", border: "#EA580C" },
    danger: { foreground: "#991B1B", background: "#FEE2E2", border: "#DC2626" },
    warning: { foreground: "#713F12", background: "#FEF3C7", border: "#D97706" },
    success: { foreground: "#14532D", background: "#DCFCE7", border: "#16A34A" },
    info: { foreground: "#1E3A8A", background: "#DBEAFE", border: "#2563EB" },
    neutral: { foreground: "#374151", background: "#F3F4F6", border: "#9CA3AF" },
  },
  dark: {
    bookingActive: { foreground: "#86EFAC", background: "#112A1B", border: "#22C55E" },
    firstPencil: { foreground: "#FDE68A", background: "#33280C", border: "#F59E0B" },
    secondPencil: { foreground: "#FCA5A5", background: "#3B1212", border: "#EF4444" },
    nightShoot: { foreground: "#D8B4FE", background: "#29143B", border: "#A855F7" },
    maintenance: { foreground: "#FDBA74", background: "#351A0C", border: "#F97316" },
    holidayPaid: { foreground: "#86EFAC", background: "#112A1B", border: "#22C55E" },
    holidayUnpaid: { foreground: "#FDE68A", background: "#33280C", border: "#F59E0B" },
    weekend: { foreground: "#D1D5DB", background: "#202124", border: "#6B7280" },
    approved: { foreground: "#86EFAC", background: "#112A1B", border: "#22C55E" },
    submitted: { foreground: "#93C5FD", background: "#14213D", border: "#3B82F6" },
    draft: { foreground: "#FDE68A", background: "#33280C", border: "#F59E0B" },
    query: { foreground: "#FDBA74", background: "#351A0C", border: "#F97316" },
    danger: { foreground: "#FCA5A5", background: "#3B1212", border: "#EF4444" },
    warning: { foreground: "#FDE68A", background: "#33280C", border: "#F59E0B" },
    success: { foreground: "#86EFAC", background: "#112A1B", border: "#22C55E" },
    info: { foreground: "#93C5FD", background: "#14213D", border: "#3B82F6" },
    neutral: { foreground: "#D1D5DB", background: "#202124", border: "#6B7280" },
  },
};

export function normalizeStatusTone(value) {
  const key = String(value || "neutral").trim().toLowerCase();
  return STATUS_ALIASES[key] || (PALETTES.light[key] ? key : "neutral");
}

export function getStatusColors(value, scheme = "light") {
  const tone = normalizeStatusTone(value);
  const palette = scheme === "dark" ? PALETTES.dark : PALETTES.light;
  return { tone, ...palette[tone] };
}

export function createActionLock() {
  let locked = false;
  return async function run(action) {
    if (locked || typeof action !== "function") return false;
    locked = true;
    try {
      await action();
      return true;
    } finally {
      locked = false;
    }
  };
}
