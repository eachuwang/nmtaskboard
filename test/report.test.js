import test from "node:test";
import assert from "node:assert/strict";
import { defaultWeekRange, buildReportSummary, templateReport, buildReportForType, buildHandoverSummary, templateForType, defaultRangeFor, periodDays, REPORT_TYPES, dayString, parseDay, addDays } from "../lib/report.js";
import { startServer } from "./helpers.js";

const now = new Date(2026, 7, 12); // 2026-08-12 周三
// 引擎按日期字符串截断比较，用本地日期语义构造时间戳（不带 Z 的 ISO）
const iso = (d) => dayString(d) + "T10:00:00";

test("默认范围：周三求本周一~周五；含周末延伸至周日", () => {
  const r = defaultWeekRange(now, false);
  assert.equal(r.start, "2026-08-10");
  assert.equal(r.end, "2026-08-14");
  const w = defaultWeekRange(now, true);
  assert.equal(w.start, "2026-08-10");
  assert.equal(w.end, "2026-08-16");
  // 周一当天
  const mon = defaultWeekRange(new Date(2026, 7, 10), false);
  assert.equal(mon.start, "2026-08-10");
  // 周日当天应归到上一周
  const sun = defaultWeekRange(new Date(2026, 7, 16), false);
  assert.equal(sun.start, "2026-08-10");
});

const before = (value) => new Date(new Date(value).getTime() - 60_000).toISOString();
const validHistory = (task) => {
  const created = { action: "created", toStatus: task.status === "backlog" || task.status === "planned" ? "backlog" : "todo", at: task.createdAt };
  if (task.status === "planned" || task.status === "backlog" || task.status === "todo") return [{ ...created, toStatus: task.status === "planned" ? "backlog" : task.status }];
  if (task.status === "in_progress") return [created, { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: task.startedAt || task.updatedAt }];
  if (task.status === "blocked") return [
    created,
    { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: before(task.updatedAt) },
    { action: "moved", fromStatus: "in_progress", toStatus: "blocked", at: task.updatedAt, reason: task.blockReason || "等待依赖" }
  ];
  if (task.status === "done") return [
    created,
    { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: before(task.completedAt || task.updatedAt) },
    { action: "moved", fromStatus: "in_progress", toStatus: "done", at: task.completedAt || task.updatedAt }
  ];
  return [created, { action: "moved", fromStatus: "todo", toStatus: "cancelled", at: task.cancelledAt || task.updatedAt, reason: "不再处理" }];
};
const mk = (id, o) => {
  const task = { id, title: "任务" + id, description: "", status: "todo", priority: "medium", tags: [], dueDate: null, blockReason: null, subtasks: [], order: 0, createdAt: iso(parseDay("2026-08-10")), updatedAt: iso(now), startedAt: null, completedAt: null, cancelledAt: null, ...o };
  return { ...task, history: o?.history ?? validHistory(task) };
};

test("分节归集与去重优先级：完成 > 阻塞 > 进行中 > 新建", () => {
  const tasks = [
    mk("a", { status: "done", completedAt: iso(parseDay("2026-08-11")), createdAt: iso(parseDay("2026-08-10")) }), // 完成+新建 → 完成
    mk("b", { status: "blocked", blockReason: "等接口" }),
    mk("c", { status: "in_progress" }),
    mk("d", { status: "todo", createdAt: iso(parseDay("2026-08-12")) }), // 本周新增
    mk("e", { status: "todo", createdAt: iso(parseDay("2026-08-03")) }), // 上周新建，不属于任何节
    mk("f", { status: "done", completedAt: iso(parseDay("2026-07-30")), createdAt: iso(parseDay("2026-07-28")) }) // 上周完成、上周新建，不入任何节
  ];
  const s = buildReportSummary(tasks, "2026-08-10", "2026-08-14");
  assert.deepEqual(s.sections.completed.map(t => t.id), ["a"]);
  assert.deepEqual(s.sections.blocked.map(t => t.id), ["b"]);
  assert.deepEqual(s.sections.inProgress.map(t => t.id), ["c"]);
  assert.deepEqual(s.sections.created.map(t => t.id), ["d"]);
  assert.deepEqual(s.stats, { completed: 1, inProgress: 1, blocked: 1, created: 1 });
  assert.equal(s.sections.blocked[0].blockReason, "等接口");
});

test("时间型报告按区间结束日截面归集完成、进行中与阻塞任务", () => {
  const created = (day) => ({ action: "created", toStatus: "todo", at: iso(parseDay(day)) });
  const moved = (fromStatus, toStatus, day, reason) => ({ action: "moved", fromStatus, toStatus, at: iso(parseDay(day)), ...(reason ? { reason } : {}) });
  const tasks = [
    mk("done-in", { status: "done", completedAt: iso(parseDay("2026-08-03")), history: [created("2026-08-01"), moved("todo", "in_progress", "2026-08-02"), moved("in_progress", "done", "2026-08-12")] }),
    mk("done-out", { status: "done", completedAt: iso(parseDay("2026-08-03")), history: [created("2026-08-01"), moved("todo", "in_progress", "2026-08-02"), moved("in_progress", "done", "2026-08-03")] }),
    mk("doing-in", { status: "in_progress", startedAt: iso(parseDay("2026-08-13")), history: [created("2026-08-01"), moved("todo", "in_progress", "2026-08-13")] }),
    mk("doing-out", { status: "in_progress", startedAt: iso(parseDay("2026-08-03")), history: [created("2026-08-01"), moved("todo", "in_progress", "2026-08-03")] }),
    mk("blocked-in", { status: "blocked", history: [created("2026-08-01"), moved("todo", "in_progress", "2026-08-02"), moved("in_progress", "blocked", "2026-08-03", "首次阻塞"), moved("blocked", "in_progress", "2026-08-05", "依赖已到位"), moved("in_progress", "blocked", "2026-08-14", "等待复核")] }),
    mk("blocked-out", { status: "blocked", history: [created("2026-08-01"), moved("todo", "in_progress", "2026-08-02"), moved("in_progress", "blocked", "2026-08-03", "等待依赖")] })
  ];

  const summary = buildReportSummary(tasks, "2026-08-10", "2026-08-14");

  assert.deepEqual(summary.sections.completed.map((task) => task.id), ["done-in"]);
  assert.equal(summary.sections.completed[0].completedAt, iso(parseDay("2026-08-12")));
  assert.deepEqual(summary.sections.inProgress.map((task) => task.id), ["doing-in", "doing-out"]);
  assert.deepEqual(summary.sections.blocked.map((task) => task.id), ["blocked-in", "blocked-out"]);
  assert.deepEqual(summary.sections.created, []);
});

test("历史周报使用区间结束日的可信状态截面，不受后续返工改写", () => {
  const reopenedOnMonday = mk("reopened-on-monday", {
    status: "in_progress",
    completedAt: iso(parseDay("2026-08-24")),
    history: [
      { action: "created", toStatus: "todo", at: iso(parseDay("2026-08-18")) },
      { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: iso(parseDay("2026-08-19")) },
      { action: "moved", fromStatus: "in_progress", toStatus: "done", at: iso(parseDay("2026-08-21")) },
      { action: "moved", fromStatus: "done", toStatus: "in_progress", at: iso(parseDay("2026-08-25")), reason: "验收发现问题，需要返工" }
    ]
  });

  const previousWeek = buildReportSummary([reopenedOnMonday], "2026-08-17", "2026-08-21");
  const currentWeek = buildReportSummary([reopenedOnMonday], "2026-08-24", "2026-08-28");

  assert.deepEqual(previousWeek.sections.completed.map((task) => task.id), ["reopened-on-monday"]);
  assert.equal(previousWeek.sections.completed[0].completedAt, iso(parseDay("2026-08-21")));
  assert.deepEqual(currentWeek.sections.inProgress.map((task) => task.id), ["reopened-on-monday"]);
});

test("历史阻塞截面保留当时的阻塞原因，不读取后来已清空的卡片字段", () => {
  const task = mk("historical-block", {
    status: "in_progress",
    blockReason: null,
    history: [
      { action: "created", toStatus: "todo", at: iso(parseDay("2026-08-10")) },
      { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: iso(parseDay("2026-08-11")) },
      { action: "moved", fromStatus: "in_progress", toStatus: "blocked", at: iso(parseDay("2026-08-12")), reason: "等待接口联调" },
      { action: "moved", fromStatus: "blocked", toStatus: "in_progress", at: iso(parseDay("2026-08-17")), reason: "接口已就绪" }
    ]
  });

  const summary = buildReportSummary([task], "2026-08-10", "2026-08-14");

  assert.equal(summary.sections.blocked[0].blockReason, "等待接口联调");
});

test("无状态轨迹的任务不进入时间型报告并返回诊断", () => {
  const summary = buildReportSummary([
    mk("missing-history", {
      status: "done",
      completedAt: iso(parseDay("2026-08-12")),
      history: []
    })
  ], "2026-08-10", "2026-08-14");

  assert.deepEqual(summary.sections.completed, []);
  assert.deepEqual(summary.diagnostics, {
    excluded: [{
      id: "missing-history",
      title: "任务missing-history",
      status: "done",
      code: "missing_history",
      reason: "缺少状态轨迹"
    }]
  });
});

test("删除恢复与进展修订等非状态轨迹不破坏可信状态快照", () => {
  const task = mk("restored", {
    status: "todo",
    history: [
      { action: "created", toStatus: "todo", at: iso(parseDay("2026-08-11")) },
      { action: "deleted", at: iso(parseDay("2026-08-12")) },
      { action: "restored", at: iso(parseDay("2026-08-13")) },
      { action: "updated", at: iso(parseDay("2026-08-14")), reason: "补充进展" }
    ]
  });

  const summary = buildReportSummary([task], "2026-08-10", "2026-08-14");

  assert.deepEqual(summary.sections.created.map((item) => item.id), ["restored"]);
  assert.deepEqual(summary.diagnostics.excluded, []);
});

test("存在 from/to 不一致的任务不进入时间型报告", () => {
  const summary = buildReportSummary([
    mk("skipped-in-progress", {
      status: "done",
      history: [
        { action: "created", toStatus: "todo", at: iso(parseDay("2026-08-11")) },
        { action: "moved", fromStatus: "in_progress", toStatus: "done", at: iso(parseDay("2026-08-12")) }
      ]
    })
  ], "2026-08-10", "2026-08-14");

  assert.deepEqual(summary.sections.completed, []);
  assert.equal(summary.diagnostics.excluded[0].code, "invalid_transition");
  assert.equal(summary.diagnostics.excluded[0].reason, "存在非法状态跳转");
});

test("旧任务缺少创建事件但具有从合法初始状态开始的完整移动链时仍可归入报告", () => {
  const task = mk("legacy-legal-chain", {
    status: "done",
    history: [
      { action: "moved", fromStatus: "planned", toStatus: "todo", at: "2026-08-24T10:31:06.622Z" },
      { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: "2026-08-24T10:31:08.389Z" },
      { action: "moved", fromStatus: "in_progress", toStatus: "done", at: "2026-08-24T10:31:11.291Z" }
    ]
  });

  const summary = buildReportSummary([task], "2026-08-24", "2026-08-28", { timeZone: "Asia/Shanghai" });

  assert.deepEqual(summary.sections.completed.map((item) => item.id), ["legacy-legal-chain"]);
  assert.deepEqual(summary.diagnostics.excluded, []);
});

test("当前状态与最后轨迹不一致时返回明确诊断", () => {
  const tasks = [
    mk("status-mismatch", {
      status: "done",
      history: [{ action: "created", toStatus: "todo", at: iso(parseDay("2026-08-10")) }]
    })
  ];

  const summary = buildReportSummary(tasks, "2026-08-10", "2026-08-14");

  assert.deepEqual(summary.diagnostics.excluded.map((item) => item.code), [
    "status_mismatch"
  ]);
});

test("状态轨迹按真实时间先后校验，不受时间戳偏移格式影响", () => {
  const task = mk("offset-order", {
    status: "in_progress",
    history: [
      { action: "created", toStatus: "todo", at: "2026-08-10T10:00:00+08:00" },
      { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: "2026-08-10T03:00:00Z" }
    ]
  });

  const summary = buildReportSummary([task], "2026-08-10", "2026-08-14", { timeZone: "Asia/Shanghai" });

  assert.deepEqual(summary.sections.inProgress.map((item) => item.id), ["offset-order"]);
  assert.deepEqual(summary.diagnostics.excluded, []);
});

test("报告归期使用用户设置的时区，而不是服务器所在时区", () => {
  const task = mk("timezone-boundary", {
    status: "done",
    completedAt: "2026-08-20T16:30:00.000Z",
    history: [
      { action: "created", toStatus: "todo", at: "2026-08-20T14:00:00.000Z" },
      { action: "moved", fromStatus: "todo", toStatus: "in_progress", at: "2026-08-20T15:00:00.000Z" },
      { action: "moved", fromStatus: "in_progress", toStatus: "done", at: "2026-08-20T16:30:00.000Z" }
    ]
  });

  const shanghai = buildReportSummary([task], "2026-08-21", "2026-08-21", { timeZone: "Asia/Shanghai" });
  const utc = buildReportSummary([task], "2026-08-21", "2026-08-21", { timeZone: "UTC" });

  assert.deepEqual(shanghai.sections.completed.map((item) => item.id), ["timezone-boundary"]);
  assert.equal(shanghai.sections.completed[0].completedDay, "2026-08-21");
  assert.match(templateReport(shanghai, "2026-08-21", "2026-08-21"), /完成于 08\.21/);
  assert.deepEqual(utc.sections.completed, []);
});

test("下周计划：截止在下周或高优先级，且未被前四节收录", () => {
  const tasks = [
    mk("g", { status: "backlog", dueDate: "2026-08-18", priority: "low", createdAt: iso(parseDay("2026-08-01")) }), // 截止下周二 → 入选
    mk("h", { status: "todo", priority: "high", createdAt: iso(parseDay("2026-08-01")) }), // 高优先级 → 入选
    mk("i", { status: "todo", dueDate: "2026-09-30", priority: "low", createdAt: iso(parseDay("2026-08-01")) }), // 不在下周也不高 → 不入选
    mk("j", { status: "done", completedAt: iso(parseDay("2026-08-12")), priority: "high", dueDate: "2026-08-18", createdAt: iso(parseDay("2026-08-01")) }), // 已完成 → 不入选
    mk("k", { status: "cancelled", priority: "high", createdAt: iso(parseDay("2026-08-01")) }) // 已取消 → 不入选
  ];
  const s = buildReportSummary(tasks, "2026-08-10", "2026-08-14");
  assert.deepEqual(s.nextWeek.map(t => t.id).sort(), ["g", "h"]);
});

test("模板：第一人称 + MM.DD 日期 + 分节 + 统计行", () => {
  const tasks = [
    mk("a", { title: "完成报告", status: "done", completedAt: iso(parseDay("2026-08-11")) }),
    mk("c", { title: "写代码", status: "in_progress" }),
    mk("b", { title: "卡住的事", status: "blocked", blockReason: "等接口" })
  ];
  const s = buildReportSummary(tasks, "2026-08-10", "2026-08-14");
  const md = templateReport(s, "2026-08-10", "2026-08-14");
  assert.ok(md.includes("# 本周工作周报（2026.08.10 - 2026.08.14）"), "标题与日期格式");
  assert.ok(md.includes("本周完成 1 项、进行中 1 项、阻塞 1 项。"), "统计行");
  assert.ok(md.includes("## 本周完成") && md.includes("## 进行中") && md.includes("## 风险与阻塞"));
  assert.ok(md.includes("本周我完成了以下工作："), "第一人称");
  assert.ok(md.includes("- 完成报告（完成于 08.11）"));
  assert.ok(md.includes("- 卡住的事（阻塞原因：等接口）"));
});

test("API：summary 与 template，非法范围 400", async () => {
  const s = await startServer();
  try {
    const range = defaultWeekRange(new Date(), true); // 当前周（含周末），避免日期漂移
    const t = await fetch(s.baseUrl + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "完成A", status: "todo" })
    });
    assert.equal(t.status, 201);
    const taskId = (await t.json()).task.id;
    for (const status of ["in_progress", "done"]) {
      const moved = await fetch(`${s.baseUrl}/api/tasks/${taskId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      assert.equal(moved.status, 200);
    }
    const sum = await fetch(s.baseUrl + "/api/report/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range })
    });
    assert.equal(sum.status, 200);
    const sj = await sum.json();
    assert.equal(sj.summary.stats.completed, 1); // 完整状态轨迹在当前范围内，验证完成归集
    const tp = await fetch(s.baseUrl + "/api/report/template", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range })
    });
    assert.equal(tp.status, 200);
    assert.ok((await tp.json()).report.includes("本周工作周报"));

    const bad = await fetch(s.baseUrl + "/api/report/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range: { start: "08-10", end: "2026-08-14" } })
    });
    assert.equal(bad.status, 400);
    const bad2 = await fetch(s.baseUrl + "/api/report/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range: { start: "2026-08-14", end: "2026-08-10" } })
    });
    assert.equal(bad2.status, 400);
  } finally { await s.close(); }
});


test("报告类型：defaultRangeFor 各类型默认范围", () => {
  const now = new Date(2026, 7, 12); // 2026-08-12 周三
  assert.deepEqual(defaultRangeFor("daily", now), { start: "2026-08-12", end: "2026-08-12" });
  assert.deepEqual(defaultRangeFor("weekly", now), { start: "2026-08-10", end: "2026-08-14" });
  assert.deepEqual(defaultRangeFor("biweekly", now), { start: "2026-08-10", end: "2026-08-23" });
  assert.deepEqual(defaultRangeFor("monthly", now), { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(defaultRangeFor("quarterly", now), { start: "2026-07-01", end: "2026-09-30" });
  assert.deepEqual(defaultRangeFor("yearly", now), { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(defaultRangeFor("handover", now), null);
  assert.equal(defaultRangeFor("不存在", now), null);
  assert.deepEqual(REPORT_TYPES, ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly", "handover"]);
});

test("报告类型：periodDays 周期步长", () => {
  assert.equal(periodDays("daily"), 1);
  assert.equal(periodDays("weekly"), 7);
  assert.equal(periodDays("biweekly"), 14);
  assert.equal(periodDays("monthly"), 30);
  assert.equal(periodDays("quarterly"), 91);
  assert.equal(periodDays("yearly"), 365);
  assert.equal(periodDays("handover"), 7);
});

test("交接报告：状态分组 + 到期高风险 + 已完成开关", () => {
  const base = { description: "", priority: "medium", tags: [], dueDate: null, blockReason: null, order: 0 };
  const tasks = [
    mk("h1", { status: "in_progress", description: "把轮询改成推送" }),
    mk("h2", { status: "blocked", blockReason: "等接口" }),
    mk("h3", { status: "todo", dueDate: dayString(addDays(new Date(), 3)) }),
    mk("h4", { status: "backlog" }),
    mk("h5", { status: "done", completedAt: iso(parseDay("2026-08-10")), createdAt: iso(parseDay("2026-08-01")) }),
    mk("h6", { status: "cancelled" })
  ];
  const s = buildHandoverSummary(tasks, false);
  assert.deepEqual(s.sections.inProgress.map(t => t.id), ["h1"]);
  assert.deepEqual(s.sections.blocked.map(t => t.id), ["h2"]);
  assert.deepEqual(s.sections.urgent.map(t => t.id), ["h3"]);
  assert.deepEqual(s.sections.todo.map(t => t.id), ["h4"]);
  assert.deepEqual(s.sections.reference, []);
  assert.deepEqual(s.stats, { inProgress: 1, todo: 1, blocked: 1 });
  const s2 = buildHandoverSummary(tasks, true);
  assert.deepEqual(s2.sections.reference.map(t => t.id), ["h5"]);
  assert.deepEqual(s2.sections.inProgress[0].description, "把轮询改成推送");
});

test("交接报告模板：第三人称分节 + 阻塞原因 + 下一步 + 空位", () => {
  const tasks = [
    mk("k1", { status: "in_progress", description: "继续联调" }),
    mk("k2", { status: "blocked", blockReason: "等接口" }),
    mk("k3", { status: "todo" })
  ];
  const s = buildHandoverSummary(tasks, false);
  const t = templateForType(s, "handover", null, null);
  assert.ok(t.startsWith("# 离职交接报告"));
  assert.ok(t.includes("进行中 1 项、待办 1 项、阻塞 1 项"));
  assert.ok(t.includes("## 进行中的工作"));
  assert.ok(t.includes("## 待办事项"));
  assert.ok(t.includes("## 关键信息补充"));
  assert.ok(t.includes("## 接手人"));
  assert.ok(t.includes("（阻塞原因：等接口）"));
  assert.ok(t.includes("（下一步：继续联调）"));
  assert.ok(!t.includes("## 已完成事项"));
});

test("时间型模板标题与日期精度：月/季/年不带任务日期，周报带下周计划", () => {
  const tasks = [
    mk("m1", { status: "done", completedAt: iso(parseDay("2026-08-11")), createdAt: iso(parseDay("2026-08-10")) }),
    mk("m2", { status: "todo", dueDate: "2026-08-18", createdAt: iso(parseDay("2026-08-01")) })
  ];
  const sum = buildReportSummary(tasks, "2026-08-10", "2026-08-14");
  const w = templateForType(sum, "weekly", "2026-08-10", "2026-08-14");
  assert.ok(w.startsWith("# 本周工作周报（2026.08.10 - 2026.08.14）"), "周报标题年月日写全");
  assert.ok(w.includes("（完成于 08.11）"));
  const d = templateForType(sum, "daily", "2026-08-12", "2026-08-12");
  assert.ok(d.startsWith("# 今日工作日报（2026.08.12）"), "日报标题年月日写全");
  assert.ok(w.includes("- **Plan for next week**"), "周报使用四段式模板");
  assert.ok(w.includes("- **Highlights**"), "周报含 Highlights 段");
  assert.ok(w.includes("- **Details**"), "周报含 Details 段");
  const m = templateForType(sum, "monthly", "2026-08-01", "2026-08-31");
  assert.ok(m.startsWith("# 本月工作月报（2026.08）"));
  assert.ok(!m.includes("完成于"));
  assert.ok(!m.includes("## 下周计划"));
  const q = templateForType(sum, "quarterly", "2026-07-01", "2026-09-30");
  assert.ok(q.startsWith("# 本季度工作季报（2026 Q3）"));
  const y = templateForType(sum, "yearly", "2026-01-01", "2026-12-31");
  assert.ok(y.startsWith("# 年度工作年报（2026）"));
});

test("API：type 参数缺省 weekly；handover 跳过范围校验", async () => {
  const s = await startServer();
  try {
    const t = await fetch(s.baseUrl + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "交接任务", status: "todo" })
    });
    assert.equal(t.status, 201);
    const task = (await t.json()).task;
    const moved = await fetch(s.baseUrl + "/api/tasks/" + task.id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" })
    });
    assert.equal(moved.status, 200);
    // 无 type → weekly 且标题为周报
    const tp = await fetch(s.baseUrl + "/api/report/template", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range: { start: "2026-08-10", end: "2026-08-14" } })
    });
    assert.equal(tp.status, 200);
    assert.ok((await tp.json()).report.includes("本周工作周报"));
    // handover 不带 range 也应 200
    const ho = await fetch(s.baseUrl + "/api/report/template", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "handover" })
    });
    assert.equal(ho.status, 200);
    const hj = await ho.json();
    assert.ok(hj.report.includes("离职交接报告"));
    assert.ok(hj.summary.sections.inProgress.some(t => t.title === "交接任务"));
    // 未知 type 回退 weekly
    const un = await fetch(s.baseUrl + "/api/report/template", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "bogus", range: { start: "2026-08-10", end: "2026-08-14" } })
    });
    assert.equal(un.status, 200);
    assert.equal((await un.json()).type, "weekly");
  } finally { await s.close(); }
});
