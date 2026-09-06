const normaliseHex = (value) => {
  const hex = String(value || "").replace("#", "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return hex.split("").map((character) => character.repeat(2)).join("");
  }
  return /^[0-9a-f]{6}$/i.test(hex) ? hex : null;
};

const luminance = (value) => {
  const hex = normaliseHex(value);
  if (!hex) return null;
  const channels = hex.match(/../g).map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

export function getContrastRatio(foreground, background) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  if (foregroundLuminance == null || backgroundLuminance == null) return 0;
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
