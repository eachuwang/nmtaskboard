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

    // 四段式分节恒定输出；被排除的任务不出现在任何分节
    for (const section of ["- Highlights", "- Details", "- In-progress", "- Plan for next week"]) {
      expect(report).toContain(section);
    }
    expect(report).not.toContain("完成登录改造");
    expect(report).toContain("推进报告迁移");
  });
});
