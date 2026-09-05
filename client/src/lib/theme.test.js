import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, getStoredTheme, isDarkTheme, normalizeTheme, setStoredTheme } from "./theme.js";

function memoryStorage(initial = {}) {
  const storage = new Map(Object.entries(initial));
  return {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    data: storage
  };
}

describe("theme preferences", () => {
  it("only accepts explicit light or dark values", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme("dark")).toBe("dark");
    expect(["light", "dark"]).toContain(normalizeTheme("system"));
    expect(isDarkTheme("dark")).toBe(true);
    expect(isDarkTheme("light")).toBe(false);
    expect(isDarkTheme("system")).toBe(false);
  });

  it("migrates stored system theme to an explicit color mode", () => {
    const adapter = memoryStorage({ "tb-theme": "system" });
    const next = getStoredTheme(adapter);
    expect(["light", "dark"]).toContain(next);
    expect(adapter.getItem("tb-theme")).toBe(next);
    expect(setStoredTheme("system", adapter)).toBe(next);
  });

  it("defaults missing storage to light", () => {
    const adapter = memoryStorage();
    expect(getStoredTheme(adapter)).toBe("light");
    expect(adapter.getItem("tb-theme")).toBe("light");
    expect(DEFAULT_THEME).toBe("light");
  });
});
