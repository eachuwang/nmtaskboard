import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, SORT_KEYS, normalizeSort, sortTasks } from "./taskSorting.js";

const task = (overrides) => ({ id: "t", order: 0, createdAt: "2026-01-01T00:00:00Z", ...overrides });

describe("sortTasks 优先级", () => {
  it("默认从高到低（urgent → low）", () => {
    const sorted = sortTasks([
      task({ id: "low", priority: "low" }),
      task({ id: "urgent", priority: "urgent" }),
      task({ id: "medium", priority: "medium" }),
      task({ id: "high", priority: "high" })
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("从低到高翻转方向", () => {
    const sorted = sortTasks([
      task({ id: "urgent", priority: "urgent" }),
      task({ id: "low", priority: "low" })
    ], "priority:asc");
    expect(sorted.map((item) => item.id)).toEqual(["low", "urgent"]);
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

describe("sortTasks 截止日期与创建时间", () => {
  it("默认由近及远，无截止最后且不随方向翻转", () => {
    const sorted = sortTasks([
      task({ id: "none", priority: "high" }),
      task({ id: "far", dueDate: "2026-12-01" }),
      task({ id: "near", dueDate: "2026-01-15" })
    ], "due");
    expect(sorted.map((item) => item.id)).toEqual(["near", "far", "none"]);
  });

  it("由远及近翻转有截止的部分，无截止仍在最后", () => {
    const sorted = sortTasks([
      task({ id: "none" }),
      task({ id: "far", dueDate: "2026-12-01" }),
      task({ id: "near", dueDate: "2026-01-15" })
    ], "due:desc");
    expect(sorted.map((item) => item.id)).toEqual(["far", "near", "none"]);
  });

  it("创建时间默认由新到旧，可翻转为由旧到新", () => {
    const input = [
      task({ id: "old", createdAt: "2026-01-01T00:00:00Z" }),
      task({ id: "new", createdAt: "2026-02-01T00:00:00Z" })
    ];
    expect(sortTasks(input, "created").map((item) => item.id)).toEqual(["new", "old"]);
    expect(sortTasks(input, "created:asc").map((item) => item.id)).toEqual(["old", "new"]);
  });
});

describe("sortTasks 手动排序", () => {
  it("manual 维持 order，不受优先级影响", () => {
    const sorted = sortTasks([
      task({ id: "urgent", priority: "urgent", order: 5 }),
      task({ id: "low", priority: "low", order: 1 })
    ], "manual");
    expect(sorted.map((item) => item.id)).toEqual(["low", "urgent"]);
  });
});

describe("normalizeSort", () => {
  it("非法值回落默认优先级从高到低", () => {
    expect(normalizeSort("bogus")).toBe(DEFAULT_SORT);
    expect(normalizeSort(null)).toBe(DEFAULT_SORT);
    expect(normalizeSort("priority")).toBe("priority:desc"); // 旧版省略方向兼容
    expect(normalizeSort("priority:asc")).toBe("priority:asc");
    expect(normalizeSort("manual")).toBe("manual");
  });

  it("方向非法时回落该键的默认方向", () => {
    expect(normalizeSort("due:sideways")).toBe("due:asc");
  });

  it("排序键集合唯一且包含手动排序", () => {
    expect(new Set(SORT_KEYS.map((option) => option.key)).size).toBe(SORT_KEYS.length);
    expect(SORT_KEYS.some((option) => option.key === "manual")).toBe(true);
  });
});
