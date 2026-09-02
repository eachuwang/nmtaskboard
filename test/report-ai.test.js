import test from "node:test";
import assert from "node:assert/strict";
import { createLlmStub, sseDelta } from "./llm-stub.js";
import { startServer } from "./helpers.js";

async function configure(s, baseUrl) {
  await fetch(s.baseUrl + "/api/admin/llm", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providers: [{ id: "stub", name: "Stub", baseUrl, protocol: "openai-chat-completions", apiKey: "k", defaultModelId: "stub", models: [{ id: "stub" }] }],
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
      if (event === "delta" || event === "error" || event === "done") {
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

function reportPersistence() {
  let settings = { providers: [], defaultProviderId: "", temperature: 0.7, tags: [], reportTimeZone: "Asia/Shanghai" };
  let instance = { providers: [], defaultProviderId: "", temperature: 0.7 };
  const task = {
    id: "t1", title: "完成功能A", description: "降低首页加载时间", status: "done", priority: "high", tags: [],
    assignees: ["小王"], dueDate: "2026-08-28", blockReason: "", cancelReason: "", progressRecords: [],
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
    assert.ok(/归纳成果/.test(sysMsg));
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
