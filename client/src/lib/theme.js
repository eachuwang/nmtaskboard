export const THEME_KEY = "tb-theme";
export const THEMES = ["light", "dark"];
export const DEFAULT_THEME = "light";

function prefersDark() {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

export function normalizeTheme(value) {
  if (value === "dark" || value === "light") return value;
  if (value === "system") return prefersDark() ? "dark" : DEFAULT_THEME;
  return DEFAULT_THEME;
}

export function getStoredTheme(storage = globalThis.localStorage) {
  try {
    const next = normalizeTheme(storage.getItem(THEME_KEY));
    if (storage.getItem(THEME_KEY) !== next) storage.setItem(THEME_KEY, next);
    return next;
  } catch {
    return DEFAULT_THEME;
  }
}

export function setStoredTheme(value, storage = globalThis.localStorage) {
  const next = normalizeTheme(value);
  try {
    storage.setItem(THEME_KEY, next);
  } catch {
    // Keep the current session usable when storage is unavailable.
  }
  return next;
}

export function isDarkTheme(theme) {
  return theme === "dark";
}
