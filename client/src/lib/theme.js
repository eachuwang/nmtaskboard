export const THEME_KEY = "tb-theme";
export const THEMES = ["system", "dark", "light"];

export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : "system";
}

export function getStoredTheme(storage = globalThis.localStorage) {
  try {
    return normalizeTheme(storage.getItem(THEME_KEY));
  } catch {
    return "system";
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

export function isDarkTheme(theme, systemDark) {
  return theme === "dark" || (theme === "system" && systemDark);
}
