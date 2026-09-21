import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, SORT_OPTIONS, normalizeSort, sortTasks } from "./taskSorting.js";

const task = (overrides) => ({ id: "t", order: 0, createdAt: "2026-01-01T00:00:00Z", ...overrides });

describe("sortTasks 默认优先级降序", () => {
  it("优先级高的排上方（urgent → low）", () => {
    const sorted = sortTasks([
      task({ id: "low", priority: "low" }),
      task({ id: "urgent", priority: "urgent" }),
      task({ id: "medium", priority: "medium" }),
      task({ id: "high", priority: "high" })
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("未标记优先级视作最低", () => {
    const sorted = sortTasks([task({ id: "none" }), task({ id: "low", priority: "low" })]);
    expect(sorted.map((item) => item.id)).toEqual(["low", "none"]);
  });

  it("同级保持手动顺序（order 兜底）", () => {
    const sorted = sortTasks([
      task({ id: "b", priority: "high", order: 2 }),
      task({ id: "a", priority: "high", order: 1 })
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("不修改原数组", () => {
    const input = [task({ id: "low", priority: "low" }), task({ id: "urgent", priority: "urgent" })];
    sortTasks(input);
    expect(input.map((item) => item.id)).toEqual(["low", "urgent"]);
  });
});

describe("其他排序方式", () => {
  it("截止日期近的在上、无截止最后", () => {
    const sorted = sortTasks([
      task({ id: "none", priority: "high" }),
      task({ id: "far", priority: "low", dueDate: "2026-12-01" }),
      task({ id: "near", priority: "low", dueDate: "2026-01-15" })
    ], "due");
    expect(sorted.map((item) => item.id)).toEqual(["near", "far", "none"]);
  });

  it("创建时间新的在上", () => {
    const sorted = sortTasks([
      task({ id: "old", priority: "high", createdAt: "2026-01-01T00:00:00Z" }),
      task({ id: "new", priority: "low", createdAt: "2026-02-01T00:00:00Z" })
    ], "created");
    expect(sorted.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("手动排序维持 order", () => {
    const sorted = sortTasks([
      task({ id: "urgent", priority: "urgent", order: 5 }),
      task({ id: "low", priority: "low", order: 1 })
    ], "manual");
    expect(sorted.map((item) => item.id)).toEqual(["low", "urgent"]);
  });
});

describe("normalizeSort", () => {
  it("非法值回落默认优先级排序", () => {
    expect(normalizeSort("bogus")).toBe(DEFAULT_SORT);
    expect(normalizeSort(null)).toBe(DEFAULT_SORT);
    expect(normalizeSort("due")).toBe("due");
  });

  it("选项集合包含全部排序方式且值唯一", () => {
    expect(SORT_OPTIONS.map((option) => option.value)).toContain(DEFAULT_SORT);
    expect(new Set(SORT_OPTIONS.map((option) => option.value)).size).toBe(SORT_OPTIONS.length);
  });
});
