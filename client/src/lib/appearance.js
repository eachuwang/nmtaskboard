export const APPEARANCE_KEY = "tb-appearance";
export const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
export const DEFAULT_APPEARANCE = Object.freeze({
  glassEnabled: false,
  glassTransparency: 0.58,
  glassBlur: 22,
  backgroundImage: "",
  backgroundName: ""
});

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function normalizeAppearance(value) {
  const source = value && typeof value === "object" ? value : {};
  const backgroundImage = typeof source.backgroundImage === "string" && source.backgroundImage.startsWith("data:image/") ? source.backgroundImage : "";
  return {
    glassEnabled: source.glassEnabled === true,
    glassTransparency: Math.round(clamp(source.glassTransparency, 0.1, 0.8, DEFAULT_APPEARANCE.glassTransparency) * 100) / 100,
    glassBlur: Math.round(clamp(source.glassBlur, 0, 32, DEFAULT_APPEARANCE.glassBlur)),
    backgroundImage,
    backgroundName: backgroundImage && typeof source.backgroundName === "string" ? source.backgroundName.slice(0, 120) : ""
  };
}

export function getStoredAppearance(storage = globalThis.localStorage) {
  try {
    return normalizeAppearance(JSON.parse(storage.getItem(APPEARANCE_KEY) || "null"));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function setStoredAppearance(value, storage = globalThis.localStorage) {
  const next = normalizeAppearance(value);
  try {
    storage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    // Keep the current session usable when storage is unavailable or full.
  }
  return next;
}
