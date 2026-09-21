import test from "node:test";
import assert from "node:assert/strict";
import { createLlmStub, sseDelta } from "./llm-stub.js";
import { startServer } from "./helpers.js";
import { skeletonReportPrompt } from "../lib/prompts.js";

async function configure(s, baseUrl, model = "stub") {
  await fetch(s.baseUrl + "/api/admin/llm", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providers: [{ id: "stub", name: "Stub", baseUrl, protocol: "openai-chat-completions", apiKey: "k", defaultModelId: model, models: [{ id: model }] }],
      defaultProviderId: "stub"
    })
  });
}

// 解析 SSE 响应为事件数组
async function readSse(res) {
  assert.equal(res.headers.get("content-type").startsWith("text/event-stream"), true);
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (event === "delta" || event === "error" || event === "done" || event === "meta") {
        events.push({ event, data: data ? JSON.parse(data) : {} });
      }
    }
  }
  return events;
}

test("AI 润色：流式返回、空草稿 400", async () => {
  const stub = await createLlmStub({
    handler: () => ({ stream: [sseDelta("润色后"), sseDelta("的周报")] })
  });
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: "# 本周工作周报\n- 完成A" })
    });
    const events = await readSse(res);
    const text = events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
    assert.equal(text, "润色后的周报");
    assert.equal(events[events.length - 1].event, "done");
    // 系统提示要求先学习草稿作者的语气与格式习惯
    const sysMsg = stub.calls[0].messages.find((m) => m.role === "system").content;
    assert.ok(/学习草稿作者/.test(sysMsg) && /语气/.test(sysMsg) && /格式/.test(sysMsg));

    const empty = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: "   " })
    });
    assert.equal(empty.status, 400);
  } finally { await s.close(); await stub.close(); }
});

const EVIDENCE = {
  schemaVersion: "report-evidence/v1",
  reportType: "weekly",
  range: { start: "2026-08-24", end: "2026-08-28" },
  timeZone: "Asia/Shanghai",
  scope: { subject: "personal" },
  summary: {
    stats: { completed: 2, inProgress: 0, blocked: 0, created: 0 },
    sections: { completed: [{ id: "t1", title: "完成功能A" }], inProgress: [], blocked: [], created: [] },
    nextWeek: [],
    diagnostics: { excluded: [] }
  }
};

test("生成材料不重复发送进展，仍保留完整内容和评论回复关系", () => {
  const progress = "优化后实测准确率达到83%，尚未上线";
  const evidence = structuredClone(EVIDENCE);
  evidence.summary.sections.completed[0].evidence = {
    facts: {},
    progressRecords: [{ text: progress }],
    comments: [{ id: "c1", text: "建议下周上线" }, { id: "c2", parentId: "c1", text: "需要先审批" }]
  };
  const messages = skeletonReportPrompt(evidence, "# 自定义分节\n1. {内容}", "weekly");
  const input = JSON.stringify(messages);
  assert.equal(input.split(progress).length - 1, 1);
  assert.ok(input.includes("建议下周上线"));
  assert.ok(input.includes("需要先审批"));
  const trees = JSON.parse(messages[0].content.slice(messages[0].content.indexOf("[")));
  assert.equal(trees[0].tasks[0].comments[1].parentId, "c1");
  assert.ok(messages[1].content.includes("# 自定义分节\n1. {内容}"));
});

function reportPersistence(comments = []) {
  let settings = { providers: [], defaultProviderId: "", temperature: 0.7, tags: [], reportTimeZone: "Asia/Shanghai" };
  let instance = { providers: [], defaultProviderId: "", temperature: 0.7 };
  const task = {
    id: "t1", title: "完成功能A", description: "降低首页加载时间", status: "done", priority: "high", tags: [],
    assignees: ["小王"], dueDate: "2026-08-28", blockReason: "", cancelReason: "", progressRecords: [], comments,
    history: [
      { id: "h1", action: "created", toStatus: "todo", at: "2026-08-24T01:00:00.000Z", actor: "小王" },
      { id: "h2", action: "moved", fromStatus: "todo", toStatus: "in_progress", at: "2026-08-25T01:00:00.000Z", actor: "小王" },
      { id: "h3", action: "moved", fromStatus: "in_progress", toStatus: "done", at: "2026-08-26T01:00:00.000Z", actor: "小王" }
    ]
  };
  return {
    tasks: { async load() { return structuredClone([task]); }, async save() {} },
    settings: {
      async load() { return structuredClone(settings); },
      async save(_context, next) { settings = structuredClone(next); },
      async loadInstance() { return structuredClone(instance); },
      async saveInstance(next) { instance = structuredClone(next); }
    }
  };
}

test("报告生成与润色均使用非思考模式，仍返回完整流和事实校验结果", async (t) => {
  const stub = await createLlmStub({ handler: () => ({ stream: [sseDelta("# 周报\n- 完成功能A")] }) });
  const s = await startServer({ appOptions: { persistence: reportPersistence() } });
  const nativeFetch = globalThis.fetch;
  const provider = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  t.mock.method(globalThis, "fetch", (url, init) => nativeFetch(
    String(url).startsWith(provider) ? `${stub.baseUrl}/chat/completions` : url, init
  ));
  try {
    await configure(s, provider, "deepseek-v4-flash-0731");
    for (const operation of ["fill", "polish"]) {
      const res = await fetch(`${s.baseUrl}/api/report/${operation}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "weekly", range: EVIDENCE.range, draft: "# 周报\n- 完成功能A" })
      });
      const events = await readSse(res);
      assert.equal(events.at(-1).event, "done");
      assert.equal(events.filter((e) => e.event === "delta").map((e) => e.data.text).join(""), "# 周报\n- 完成功能A");
    }
    assert.equal(stub.calls.length, 2);
    for (const body of stub.calls) assert.equal(body.enable_thinking, false);
  } finally { await s.close(); await stub.close(); }
});

test("AI 优化：保留事实不变量（标题/日期/数量）时通过并采用", async () => {
  const stub = await createLlmStub({
    handler: () => ({ stream: [sseDelta("# 周报\n## 本周完成\n- 完成功能A（2026-08-24 至 2026-08-28，共 1 项）")] })
  });
  const s = await startServer({ appOptions: { persistence: reportPersistence() } });
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: "# 周报\n- 完成功能A", type: "weekly", range: EVIDENCE.range, evidence: { forged: "CLIENT" } })
    });
    const events = await readSse(res);
    assert.equal(events[events.length - 1].event, "done");
    const sysMsg = stub.calls[0].messages.find((m) => m.role === "system").content;
    assert.ok(sysMsg.includes("完成功能A"));
    assert.ok(sysMsg.includes("降低首页加载时间"));
    assert.ok(sysMsg.includes("小王"));
    assert.equal(sysMsg.includes("CLIENT"), false);
    assert.ok(/只润色文字表达/.test(sysMsg));
    assert.ok(/结构与版式/.test(sysMsg));
  } finally { await s.close(); await stub.close(); }
});

test("AI 优化：篡改任务标题时拒绝并保留原稿", async () => {
  const stub = await createLlmStub({
    handler: () => ({ stream: [sseDelta("# 周报\n## 完成\n- 完成功能B（篡改标题，删除原事实）")] })
  });
  const s = await startServer({ appOptions: { persistence: reportPersistence() } });
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: "# 周报\n- 完成功能A", type: "weekly", range: EVIDENCE.range, evidence: EVIDENCE })
    });
    const events = await readSse(res);
    const last = events[events.length - 1];
    assert.equal(last.event, "error");
    assert.ok(/事实不变量/.test(last.data.message));
    assert.ok(last.data.violations.some((v) => v.kind === "missing-fact" && v.value === "完成功能A"));
  } finally { await s.close(); await stub.close(); }
});

test("AI 优化：篡改负责人或新增证据外日期时拒绝", async () => {
  const stub = await createLlmStub({
    handler: () => ({ stream: [sseDelta("# 周报\n- 完成功能A，负责人小李，计划 2026-09-30 验收")] })
  });
  const s = await startServer({ appOptions: { persistence: reportPersistence() } });
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draft: "# 周报\n- 完成功能A，负责人小王",
        type: "weekly", range: EVIDENCE.range
      })
    });
    const events = await readSse(res);
    const last = events[events.length - 1];
    assert.equal(last.event, "error");
    assert.ok(last.data.violations.some((v) => v.kind === "missing-fact" && v.value === "小王"));
    assert.ok(last.data.violations.some((v) => v.kind === "invented-date" && v.value === "2026-09-30"));
  } finally { await s.close(); await stub.close(); }
});

test("AI 优化：未配置 LLM 时不影响确定性报告", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: "# 周报\n- 完成A", type: "weekly", evidence: EVIDENCE })
    });
    assert.equal(res.status, 400);
  } finally { await s.close(); }
});


test("模板生成把卡片普通评论及回复传到模型，排除已删除评论", async () => {
  const comments = [
    { id: "c1", type: "comment", text: "准确率优化到30%", createdAt: "2026-08-25T01:00:00Z" },
    { id: "c2", type: "comment", parentId: "c1", text: "继续优化到80%", createdAt: "2026-08-25T02:00:00Z" },
    { id: "c3", type: "comment", text: "已删除的错误结论", deletedAt: "2026-08-25T03:00:00Z" }
  ];
  const stub = await createLlmStub({ handler: (body) => {
    const input = JSON.stringify(body.messages);
    const available = input.includes("准确率优化到30%") && input.includes("继续优化到80%");
    return { stream: [sseDelta(available ? "# 进展\n- 完成功能A：准确率从30%提升至80%" : "# 进展\n- 完成功能A：已完成")] };
  } });
  const s = await startServer({ appOptions: { persistence: reportPersistence(comments) } });
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/fill", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "weekly", range: EVIDENCE.range, skeleton: "# 进展\n- {任务及进展}" })
    });
    const events = await readSse(res);
    assert.equal(events.at(-1).event, "done");
    const output = events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
    assert.match(output, /准确率从30%提升至80%/);
    assert.equal(JSON.stringify(stub.calls[0].messages).includes("已删除的错误结论"), false);
  } finally { await s.close(); await stub.close(); }
});

test("fill 首个事件为 meta：携带与看板同源的任务清单与时区", async () => {
  const stub = await createLlmStub({
    handler: () => ({ stream: [sseDelta("# 周报\n- 完成功能A")] })
  });
  const s = await startServer({ appOptions: { persistence: reportPersistence() } });
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/fill", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "weekly", range: EVIDENCE.range })
    });
    const events = await readSse(res);
    const meta = events[0];
    assert.equal(meta.event, "meta");
    assert.equal(meta.data.timeZone, "Asia/Shanghai");
    assert.ok(JSON.stringify(meta.data.summary).includes("完成功能A"));
    assert.equal(events.at(-1).event, "done");
  } finally { await s.close(); await stub.close(); }
});


test("模板生成证据跨节聚合：子任务一律挂父下，父标题跨节作组头", () => {
  const item = (id, title, parentTaskId, parentTitle) => ({
    id, title, parentTaskId: parentTaskId || null, parentTitle: parentTitle || null,
    evidence: { facts: {}, comments: [] }
  });
  const evidence = {
    summary: {
      sections: {
        inProgress: [item("p1", "支付模块重构"), item("c2", "支付宝接入", "p1"), item("s1", "测试交互逻辑")],
        completed: [item("c1", "微信支付功能接入", "p1"), item("g1", "无证据父的子任务", "p-ghost", "幽灵父任务")]
      },
      nextWeek: [item("c3", "信用卡支付接入", "p1"), item("c4", "零钱提现功能实现", "p1")]
    }
  };
  const messages = skeletonReportPrompt(evidence, "## 本周进展\n\n1. {父任务}\n  a. {子任务}\n    - {细节}", "weekly");
  const trees = JSON.parse(messages[0].content.slice(messages[0].content.indexOf("[")));

  // 完成节：父不在本节 → 占位组头（仅标题），子任务仍挂父下
  const done = trees.find((tree) => tree.section === "本期内完成");
  assert.deepEqual(done.tasks.map((task) => task.title), ["支付模块重构", "幽灵父任务"]);
  assert.equal(done.tasks[0].groupingOnly, true);
  assert.equal(done.tasks[0].status, undefined);
  assert.deepEqual(done.tasks[0].children.map((child) => child.title), ["微信支付功能接入"]);
  assert.deepEqual(done.tasks[1].children.map((child) => child.title), ["无证据父的子任务"]);

  // 进行中节：父在本节 → 实节点带素材；无父任务的任务作顶层条目
  const doing = trees.find((tree) => tree.section === "进行中");
  const payGroup = doing.tasks.find((task) => task.title === "支付模块重构");
  assert.equal(payGroup.groupingOnly, undefined);
  assert.equal(payGroup.status, "");
  assert.deepEqual(payGroup.children.map((child) => child.title), ["支付宝接入"]);
  assert.deepEqual(doing.tasks.find((task) => task.title === "测试交互逻辑").children, undefined);

  // 下周计划节：同一父任务再次作占位组头，各节挂各自的子任务
  const plan = trees.find((tree) => tree.section === "下周计划");
  assert.equal(plan.tasks[0].title, "支付模块重构");
  assert.equal(plan.tasks[0].groupingOnly, true);
  assert.deepEqual(plan.tasks[0].children.map((child) => child.title), ["信用卡支付接入", "零钱提现功能实现"]);

  // 层级契约写入提示词
  assert.ok(messages[0].content.includes("有父任务的任务一律挂在父任务下"));
  assert.ok(messages[0].content.includes("groupingOnly 的节点仅作分组标题"));
  assert.ok(messages[0].content.includes("注明当前状态"));
});

test("fill 把跨节父子树传给模型：父任务跨节作组头", async () => {
  const day = (offset) => `2026-08-${String(24 + offset).padStart(2, "0")}T01:00:00.000Z`;
  const task = (id, title, status, parentTaskId, dueDate = null, description = "") => ({
    id, title, description, status, priority: "medium", tags: [], assignees: [],
    dueDate, blockReason: "", progressRecords: [], comments: [], parentTaskId: parentTaskId || null,
    history: [
      // 创建时间：本周任务在窗口内；下周任务移到窗口外，避免被「本期内创建」节收录
      { id: `h-${id}-1`, action: "created", toStatus: status === "backlog" ? "backlog" : "todo", at: status === "backlog" ? "2026-08-10T01:00:00.000Z" : day(0), actor: "小王" },
      ...(status === "in_progress" || status === "done"
        ? [{ id: `h-${id}-2`, action: "moved", fromStatus: "todo", toStatus: "in_progress", at: day(1), actor: "小王" }]
        : []),
      ...(status === "done"
        ? [{ id: `h-${id}-3`, action: "moved", fromStatus: "in_progress", toStatus: "done", at: day(2), actor: "小王" }]
        : [])
    ]
  });
  const persistence = reportPersistence();
  persistence.tasks = {
    async load() {
      return structuredClone([
        task("p1", "支付模块重构", "in_progress"),
        task("c1", "微信支付功能接入", "done", "p1", null, "支付服务接入"),
        task("c2", "支付宝接入", "in_progress", "p1", null, "对接支付宝接口"),
        task("c3", "信用卡支付接入", "backlog", "p1", "2026-09-01"),
        task("c4", "零钱提现功能实现", "backlog", "p1", "2026-09-02"),
        task("s1", "测试交互逻辑", "in_progress")
      ]);
    },
    async save() {}
  };
  const stub = await createLlmStub({ handler: () => ({ stream: [sseDelta("# 周报\n## 本周进展\n1. 支付模块重构\n  a. 微信支付功能接入\n  b. 支付宝接入\n2. 测试交互逻辑\n\n## 下周计划\n1. 支付模块重构\n  a. 信用卡支付接入\n  b. 零钱提现功能实现")] }) });
  const s = await startServer({ appOptions: { persistence } });
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/fill", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "weekly", range: EVIDENCE.range, skeleton: "## 本周进展\n\n1. {父任务}\n  a. {子任务}\n    - {细节}\n\n## 下周计划\n\n1. {父任务}\n  a. {子任务}" })
    });
    const events = await readSse(res);
    assert.equal(events.at(-1).event, "done");
    const system = stub.calls[0].messages.find((m) => m.role === "system").content;
    const trees = JSON.parse(system.slice(system.indexOf("[")));
    // 完成节：微信支付挂在占位父组头下
    const done = trees.find((t) => t.section === "本期内完成");
    assert.equal(done.tasks[0].title, "支付模块重构");
    assert.equal(done.tasks[0].groupingOnly, true);
    assert.deepEqual(done.tasks[0].children.map((c) => c.title), ["微信支付功能接入"]);
    // 进行中节：支付宝挂在实父节点下；测试交互逻辑作顶层
    const doing = trees.find((t) => t.section === "进行中");
    const payGroup = doing.tasks.find((t) => t.title === "支付模块重构");
    assert.equal(payGroup.groupingOnly, undefined);
    assert.deepEqual(payGroup.children.map((c) => c.title), ["支付宝接入"]);
    assert.ok(doing.tasks.some((t) => t.title === "测试交互逻辑" && !t.children));
    // 下周计划节：信用卡/零钱挂同一父任务占位组头
    const plan = trees.find((t) => t.section === "下周计划");
    assert.equal(plan.tasks[0].title, "支付模块重构");
    assert.deepEqual(plan.tasks[0].children.map((c) => c.title), ["信用卡支付接入", "零钱提现功能实现"]);
  } finally { await s.close(); await stub.close(); }
});
