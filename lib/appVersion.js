export function compareAppVersions(a = "0.0.0", b = "0.0.0") {
  const left = String(a)
    .split(".")
    .map((part) => Number(part) || 0);
  const right = String(b)
    .split(".")
    .map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return difference;
  }

  return 0;
}

export function isAppUpdateRequired(currentVersion, minimumVersion) {
  const minimum = String(minimumVersion || "").trim();
  if (!minimum) return false;
  return compareAppVersions(currentVersion, minimum) < 0;
}
