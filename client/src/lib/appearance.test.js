import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, getStoredAppearance, normalizeAppearance, setStoredAppearance } from "./appearance.js";

describe("appearance preferences", () => {
  it("normalizes glass controls and rejects non-image backgrounds", () => {
    expect(normalizeAppearance({
      glassTransparency: 9,
      glassBlur: -4,
      backgroundImage: "https://example.com/background.jpg",
      backgroundName: "remote.jpg"
    })).toEqual({
      glassEnabled: false,
      glassTransparency: 0.8,
      glassBlur: 0,
      backgroundImage: "",
      backgroundName: ""
    });
  });

  it("persists normalized local appearance settings", () => {
    const storage = new Map();
    const adapter = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    };
    const image = "data:image/png;base64,AAAA";
    const saved = setStoredAppearance({ glassEnabled: true, glassTransparency: 0.62, glassBlur: 7, backgroundImage: image, backgroundName: "desk.png" }, adapter);

    expect(getStoredAppearance(adapter)).toEqual(saved);
    expect(saved).toEqual({ glassEnabled: true, glassTransparency: 0.62, glassBlur: 7, backgroundImage: image, backgroundName: "desk.png" });
    expect(getStoredAppearance({ getItem: () => "not json" })).toEqual(DEFAULT_APPEARANCE);
  });
});
