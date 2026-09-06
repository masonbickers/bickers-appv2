export const PAGE_DENSITIES = Object.freeze({
  employee: "standard",
  workshop: "compact",
});

const isWorkshopPath = (pathname) =>
  /^\/(?:\(protected\)\/)?service(?:\/|$)/.test(String(pathname || ""));

export function resolvePageDensity(pathname, override) {
  if (override === "standard" || override === "compact") return override;
  return isWorkshopPath(pathname)
    ? PAGE_DENSITIES.workshop
    : PAGE_DENSITIES.employee;
}
