export function getResponsiveLayout(width) {
  const safeWidth = Number.isFinite(Number(width)) ? Number(width) : 0;
  const isCompact = safeWidth > 0 && safeWidth < 480;
  const isTablet = safeWidth >= 768;
  const isWide = safeWidth >= 1180;
  return {
    width: safeWidth,
    isCompact,
    isTablet,
    isWide,
    columns: isTablet ? 2 : 1,
    pageGutter: isWide ? 32 : isTablet ? 24 : 16,
    maxContentWidth: 1080,
    maxFormWidth: 760,
  };
}
