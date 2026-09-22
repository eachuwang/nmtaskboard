import { describe, expect, it } from "vitest";
import { taskMatchesSearch } from "./BoardSearch.jsx";

const task = {
  id: "14",
  title: "支付模块重构",
  description: "拆分 payment-gateway 网关适配层，统一回调签名\n支持多渠道对账",
  tags: ["后端", "重构"]
};

describe("taskMatchesSearch", () => {
  it("空查询放行全部任务", () => {
    expect(taskMatchesSearch(task, "")).toBe(true);
    expect(taskMatchesSearch(task, "   ")).toBe(true);
    expect(taskMatchesSearch(task, null)).toBe(true);
  });

  it("命中标题、描述正文、标签（不区分大小写）", () => {
    expect(taskMatchesSearch(task, "支付")).toBe(true);
    expect(taskMatchesSearch(task, "对账")).toBe(true);
    expect(taskMatchesSearch(task, "后端")).toBe(true);
    expect(taskMatchesSearch(task, "PAYMENT")).toBe(true);
    expect(taskMatchesSearch(task, "Gateway")).toBe(true);
  });

  it("未命中的关键词过滤掉任务", () => {
    expect(taskMatchesSearch(task, "登录页")).toBe(false);
  });

  it("空格分组多个关键词：全部命中才保留", () => {
    expect(taskMatchesSearch(task, "支付 重构")).toBe(true);
    expect(taskMatchesSearch(task, "支付 对账 后端")).toBe(true);
    expect(taskMatchesSearch(task, "支付 登录页")).toBe(false);
  });

  it("# 前缀精确匹配任务编号：#14 命中、#1 或 #114 不命中", () => {
    expect(taskMatchesSearch(task, "#14")).toBe(true);
    expect(taskMatchesSearch(task, "#1")).toBe(false);
    expect(taskMatchesSearch(task, "#114")).toBe(false);
    expect(taskMatchesSearch(task, "#")).toBe(false);
  });

  it("编号与其他关键词可组合", () => {
    expect(taskMatchesSearch(task, "#14 支付")).toBe(true);
    expect(taskMatchesSearch(task, "#14 前端")).toBe(false);
  });

  it("缺省字段不抛错且按空字符串处理", () => {
    expect(taskMatchesSearch({ id: "9" }, "任意词")).toBe(false);
    expect(taskMatchesSearch({ id: "9" }, "#9")).toBe(true);
  });
});
