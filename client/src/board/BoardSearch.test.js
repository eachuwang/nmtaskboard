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

describe("taskMatchesSearch 卡片字段匹配域", () => {
  const options = {
    priorityLabels: { urgent: "紧急", high: "高", medium: "中", low: "低", none: "无" },
    statusLabels: { in_progress: "进行中", todo: "待办", backlog: "待整理", cs_design: "设计" },
    memberNames: new Map([["u-1", "邱明"], ["u-2", "王策"]]),
    today: "2026-09-21",
    tasks: [{ id: "p-1", title: "支付模块重构" }]
  };
  const card = {
    id: "14",
    title: "子任务A",
    description: "",
    status: "in_progress",
    priority: "urgent",
    tags: [],
    assigneeIdentityIds: ["u-1", "u-2"],
    assigneeDisplayName: "邱明、王策",
    participantDisplayNames: ["李剑"],
    projectName: "支付网关",
    parentTaskId: "p-1",
    dueDate: "2026-09-20"
  };

  it("按负责人姓名匹配（含其中一人姓氏）", () => {
    expect(taskMatchesSearch(card, "邱", options)).toBe(true);
    expect(taskMatchesSearch(card, "王策", options)).toBe(true);
    expect(taskMatchesSearch(card, "周", options)).toBe(false);
  });

  it("负责人缺省时用成员目录解析，仍未分派时匹配「未分派」", () => {
    const noName = { ...card, assigneeDisplayName: undefined, assigneeIdentityIds: ["u-1"] };
    expect(taskMatchesSearch(noName, "邱", options)).toBe(true);
    const unassigned = { ...card, assigneeDisplayName: undefined, assigneeIdentityIds: [], dueDate: null };
    expect(taskMatchesSearch(unassigned, "未分派", options)).toBe(true);
  });

  it("按优先级、状态名（含自定义状态）匹配", () => {
    expect(taskMatchesSearch(card, "紧急", options)).toBe(true);
    expect(taskMatchesSearch(card, "进行中", options)).toBe(true);
    expect(taskMatchesSearch({ ...card, status: "cs_design" }, "设计", options)).toBe(true);
    expect(taskMatchesSearch(card, "待办", options)).toBe(false);
  });

  it("按逾期状态、截止日期、项目名、参与人、父任务标题匹配", () => {
    expect(taskMatchesSearch(card, "逾期", options)).toBe(true);
    expect(taskMatchesSearch(card, "已逾期", options)).toBe(true);
    expect(taskMatchesSearch({ ...card, dueDate: "2026-12-31" }, "逾期", options)).toBe(false);
    expect(taskMatchesSearch(card, "2026-09-20", options)).toBe(true);
    expect(taskMatchesSearch(card, "支付网关", options)).toBe(true);
    expect(taskMatchesSearch(card, "李剑", options)).toBe(true);
    expect(taskMatchesSearch(card, "支付模块重构", options)).toBe(true);
  });

  it("卡片字段与标题关键词可组合", () => {
    expect(taskMatchesSearch(card, "邱 紧急", options)).toBe(true);
    expect(taskMatchesSearch(card, "邱 待办", options)).toBe(false);
  });
});
