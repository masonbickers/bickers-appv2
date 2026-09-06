const DASHBOARD_SIDE_PADDING = 14;
const DASHBOARD_MAX_WIDTH = 1080;

export function getDashboardGridColumns(width, fontScale = 1) {
  const windowWidth = Math.max(0, Number(width) || 0);
  const textScale = Math.max(1, Math.min(Number(fontScale) || 1, 1.6));
  const contentWidth = Math.max(
    0,
    Math.min(windowWidth, DASHBOARD_MAX_WIDTH) - DASHBOARD_SIDE_PADDING * 2
  );

  if (contentWidth >= 330 * textScale) return 3;
  if (contentWidth >= 290 * textScale) return 2;
  return 1;
}
