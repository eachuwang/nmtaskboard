import { describe, expect, it } from "vitest";
import { cycleRange, defaultRangeFor, normalizeReportType } from "./range.js";

describe("report range interface", () => {
  it("matches the backend weekly range and weekend extension", () => {
    const anchor = new Date(2026, 7, 19);

    expect(defaultRangeFor("weekly", anchor)).toEqual({ start: "2026-08-17", end: "2026-08-21" });
    expect(defaultRangeFor("weekly", anchor, true)).toEqual({ start: "2026-08-17", end: "2026-08-23" });
  });

  it("moves monthly and quarterly periods by their calendar boundaries", () => {
    expect(cycleRange("monthly", { start: "2026-02-01", end: "2026-02-28" }, 1)).toEqual({ start: "2026-03-01", end: "2026-03-31" });
    expect(cycleRange("quarterly", { start: "2026-01-01", end: "2026-03-31" }, 1)).toEqual({ start: "2026-04-01", end: "2026-06-30" });
  });

  it("falls back to weekly for an unknown report type", () => {
    expect(normalizeReportType("unknown")).toBe("weekly");
  });
});
