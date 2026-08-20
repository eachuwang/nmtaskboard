import { describe, expect, it } from "vitest";
import { composeReport } from "./compose.js";

describe("report composition interface", () => {
  it("keeps the selected task out of the editable report", () => {
    const summary = {
      sections: {
        completed: [{ id: "done", title: "完成登录改造", completedAt: "2026-08-18T09:00:00.000Z" }],
        inProgress: [{ id: "doing", title: "推进报告迁移" }],
        blocked: [],
        created: []
      },
      nextWeek: []
    };

    const report = composeReport(summary, "weekly", { start: "2026-08-17", end: "2026-08-21" }, new Set(["done"]));

    expect(report).toContain("完成 0 项、进行中 1 项、阻塞 0 项。");
    expect(report).not.toContain("完成登录改造");
    expect(report).toContain("推进报告迁移");
  });
});
