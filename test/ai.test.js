import test from "node:test";
import assert from "node:assert/strict";
import { createLlmStub } from "./llm-stub.js";
import { startServer } from "./helpers.js";

async function configure(s, baseUrl) {
  await fetch(s.baseUrl + "/api/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providers: [{ id: "stub", name: "Stub", baseUrl, protocol: "openai-chat-completions", apiKey: "k", defaultModelId: "stub", models: [{ id: "stub" }] }],
      defaultProviderId: "stub"
    })
  });
}
function jsonOk(tasks) {
  return { status: 200, body: { choices: [{ message: { content: JSON.stringify({ tasks }) } }] } };
}
async function parse(s, text) {
  const r = await fetch(s.baseUrl + "/api/ai/parse", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text })
  });
  return { status: r.status, body: await r.json() };
}

test("解析成功：多条草稿 + 字段规范化", async () => {
  const stub = await createLlmStub({
    handler: () => jsonOk([
      { title: "明天下午3点前完成报告", description: "发给老板", priority: "high", tags: ["汇报"], dueDate: "2026-08-15", suggestedStatus: "todo" },
      { title: "考虑下季度的学习计划", description: "", priority: "low", tags: [], dueDate: null, suggestedStatus: "planned" },
      { title: "   ", description: "", priority: "medium", tags: [], dueDate: null, suggestedStatus: "todo" },
      { title: "已经在做的重构", description: "", priority: "medium", tags: [], dueDate: "坏日期", suggestedStatus: "in_progress" }
    ])
  });
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl);
    const { status, body } = await parse(s, "帮我建几个任务：明天下午3点前完成报告发给老板，高优先级；再想想下季度的学习计划");
    assert.equal(status, 200);
    assert.equal(body.tasks.length, 3, "空标题条目被剔除");
    const t = body.tasks[0];
    assert.equal(t.title, "明天下午3点前完成报告");
    assert.equal(t.priority, "high");
    assert.equal(t.dueDate, "2026-08-15");
    assert.equal(t.status, "todo");
    assert.equal(body.tasks[1].status, "planned");
    assert.equal(body.tasks[2].dueDate, null, "非法日期置 null");
    assert.equal(body.tasks[2].status, "in_progress");
    // 确认走的是 jsonMode
    assert.deepEqual(stub.calls[0].response_format, { type: "json_object" });
  } finally { await s.close(); await stub.close(); }
});

test("非法 JSON → 502 中文错误", async () => {
  const stub = await createLlmStub({ handler: () => ({ status: 200, body: { choices: [{ message: { content: "不是 JSON" } }] } }) });
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl);
    const { status, body } = await parse(s, "建个任务");
    assert.equal(status, 502);
    assert.ok(/JSON/.test(body.error));
  } finally { await s.close(); await stub.close(); }
});

test("未配置 Key → 400 引导设置", async () => {
  const s = await startServer();
  try {
    const { status, body } = await parse(s, "建个任务");
    assert.equal(status, 400);
    assert.ok(/设置/.test(body.error));
  } finally { await s.close(); }
});

test("空文本与超长文本 → 400", async () => {
  const s = await startServer();
  try {
    assert.equal((await parse(s, "   ")).status, 400);
    assert.equal((await parse(s, "x".repeat(2001))).status, 400);
  } finally { await s.close(); }
});

test("端到端：解析 → 批量入库 → 看板可见", async () => {
  const stub = await createLlmStub({
    handler: () => jsonOk([
      { title: "写周报", description: "", priority: "medium", tags: ["汇报"], dueDate: null, suggestedStatus: "todo" },
      { title: "预约会议室", description: "", priority: "high", tags: [], dueDate: "2026-08-15", suggestedStatus: "todo" }
    ])
  });
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl);
    const parsed = (await parse(s, "写周报，预约会议室")).body.tasks;
    const batch = await fetch(s.baseUrl + "/api/tasks/batch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tasks: parsed })
    });
    assert.equal(batch.status, 201);
    const { tasks } = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.equal(tasks.length, 2);
    assert.equal(tasks.find((t) => t.title === "预约会议室").priority, "high");
  } finally { await s.close(); await stub.close(); }
});
