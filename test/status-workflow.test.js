import test from "node:test";
import assert from "node:assert/strict";
import { createTask, applyStatusTransition } from "../lib/tasks.js";
import { defaultWorkflow, completionStats, withStatusDefinition, statusLabel } from "../shared/task-statuses.js";
import { previewWorkflow, applyWorkflow, workflowFromBackup } from "../lib/status-workflow.js";
import { buildReportSummary, templateForType } from "../lib/report.js";
import { startServer } from "./helpers.js";
const column = (id, lifecycle = "pending", outcome = null) => ({ id: `cs_${id}`, value: id, name: id, lifecycle, outcome, color: "#8b5cf6" });
const custom = () => ({ mode: "custom", revision: 1, custom: [column("queue"), column("dev", "active"), column("test", "active"), column("waiting", "blocked"), column("shipped", "terminal", "completed"), column("stopped", "terminal", "abandoned")], deleted: [] });
const commit = (old, tasks, input) => applyWorkflow(old, tasks, { ...input, previewToken: previewWorkflow(old, tasks, input).token }, "管理员");

test("自定义生命周期：开工不重复，阻塞不补开工，终止后可重开", () => {
  const flow = custom();
  const task = createTask({ title: "开发任务", assigneeIdentityIds: ["one"] }, [], "我", flow);
  assert.equal(task.status, "cs_queue");
  applyStatusTransition(task, "waiting", { workflow: flow });
  assert.equal(task.startedAt, null);
  applyStatusTransition(task, "dev", { workflow: flow, effectiveAt: "2026-09-01T00:00:00Z" });
  applyStatusTransition(task, "test", { workflow: flow, effectiveAt: "2026-09-02T00:00:00Z" });
  assert.equal(task.startedAt, "2026-09-01T00:00:00Z");
  applyStatusTransition(task, "shipped", { workflow: flow });
  assert.ok(task.endedAt); assert.ok(task.completedAt);
  applyStatusTransition(task, "dev", { workflow: flow });
  assert.equal(task.endedAt, null); assert.equal(task.completedAt, null);
  assert.equal(task.startedAt, "2026-09-01T00:00:00Z");
});

test("删除多列按原顺序迁到最近保留列；首列向后迁；最后一列不可删除", () => {
  const flow = custom();
  const tasks = ["queue", "dev", "test"].map((status) => createTask({ title: status, status }, [], "我", flow));
  const next = { ...flow, custom: flow.custom.filter((s) => !["cs_dev", "cs_test"].includes(s.id)) };
  const result = commit(flow, tasks, next);
  assert.deepEqual(result.tasks.map((t) => t.status), ["cs_queue", "cs_queue", "cs_queue"]);
  assert.equal(statusLabel("cs_dev", result.workflow), "dev（已删除）");
  const firstRemoved = commit(flow, tasks, { ...flow, custom: flow.custom.slice(1) });
  assert.equal(firstRemoved.tasks[0].status, "cs_dev");
  assert.throws(() => previewWorkflow(flow, tasks, { mode: "custom", custom: [] }), /至少/);
});

test("切换方案：同类多目标必须选择，预览变化需重做；保留未启用方案", () => {
  const old = defaultWorkflow(), next = custom();
  const tasks = [createTask({ title: "开发", status: "in_progress" })];
  assert.equal(previewWorkflow(old, tasks, next).ready, false);
  const input = { ...next, mappings: { in_progress: "cs_test" } };
  assert.equal(commit(old, tasks, input).tasks[0].status, "cs_test");
  const preview = previewWorkflow(old, tasks, input);
  assert.throws(() => applyWorkflow(old, [{ ...tasks[0], updatedAt: "changed" }], { ...input, previewToken: preview.token }, "我"), /重新预览/);
  assert.throws(() => applyWorkflow(old, tasks, { ...input, custom: [...next.custom, column("extra")], previewToken: preview.token }, "我"), /重新预览/);
  const inactive = commit(old, tasks, { mode: "default", custom: next.custom });
  assert.equal(inactive.tasks[0].status, "in_progress");
  assert.equal(inactive.workflow.custom.length, 6);
});

test("取消不计分母，默认取消统计兼容；结束迁移不冒充工作完成", () => {
  const flow = custom();
  const tasks = ["shipped", "stopped"].map((status) => createTask({ title: status, status }, [], "我", flow));
  assert.equal(completionStats(tasks).progress, 100);
  assert.equal(completionStats([tasks[1]]).progress, null);
  assert.equal(completionStats([createTask({ title: "取消", status: "cancelled" })]).progress, 100);
  const today = new Date().toISOString().slice(0,10);
  const pending = [createTask({ title: "旧任务", status: "queue" }, [], "我", flow)];
  const result = commit(flow, pending, { ...flow, custom: flow.custom.map((s) => s.id === "cs_queue" ? { ...s, lifecycle: "terminal", outcome: "completed" } : s) });
  const report = buildReportSummary(result.tasks, today, today, { workflow: result.workflow, timeZone: "UTC" });
  assert.equal(report.stats.completed, 0);
  assert.equal(report.diagnostics.excluded.length, 0);
  assert.match(templateForType(report, "weekly", today, today), /状态流程变更/);
});

test("改名称和值保留 ID 与历史语义；备份恢复保留删除目录", () => {
  const flow = custom(), task = createTask({ title: "任务", status: "dev" }, [], "我", flow);
  const result = commit(flow, [task], { ...flow, custom: flow.custom.map((s) => s.id === "cs_dev" ? { ...s, name: "开发中", value: "coding" } : s) });
  assert.equal(result.tasks[0].status, task.status);
  assert.equal(result.tasks[0].statusValue, "coding");
  assert.equal(statusLabel(task.status, result.workflow), "开发中");
  assert.equal(result.tasks[0].history[0].toDefinition.name, "dev");
  const removed = commit(result.workflow, result.tasks, { ...result.workflow, custom: result.workflow.custom.filter((s) => s.id !== task.status) });
  assert.equal(statusLabel(task.status, workflowFromBackup(removed.workflow, 8)), "开发中（已删除）");
});

test("HTTP：默认→自定义、创建/移动/改名/删除、导出导入全链路", async (t) => {
  const server = await startServer(); t.after(() => server.close());
  const call = async (path, body, method = "POST") => {
    const response = await fetch(`${server.baseUrl}/api/${path}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  const flow = custom();
  const preview = await call("status-workflow/preview", flow);
  await call("status-workflow", { ...flow, previewToken: preview.token }, "PUT");
  const { task } = await call("tasks", { title: "上线检查", status: "dev" });
  assert.equal(task.status, "cs_dev");
  await call(`tasks/${task.id}`, { status: "shipped" }, "PUT");
  const report = await call("report/summary", { type: "weekly", range: { start: "2026-01-01", end: "2026-12-31" } });
  const before = await call("export", null, "GET");
  assert.equal(before.statusWorkflow.mode, "custom");
  const imported = await call("import", before);
  assert.equal(imported.imported, 1); assert.equal(imported.skipped, 0);
  const { tasks } = await call("tasks", null, "GET");
  assert.equal(tasks[0].status, "cs_shipped");
  assert.equal(tasks[0].history[0].toDefinition.id, "cs_dev");
  const cleared = await call("tasks?status=shipped", null, "DELETE");
  assert.equal(cleared.removed, 1);
});

test("HTTP：成员不能保存方案，旧助手草稿在方案变化后失效", async (t) => {
  const server = await startServer({ appOptions: { resolveRequestContext: () => ({ actor: { id: "member", displayName: "成员" }, workspace: { id: "workspace", type: "workspace", role: "member" } }) } });
  t.after(() => server.close());
  for (const [path,method] of [["status-workflow/preview","POST"],["status-workflow","PUT"]]) {
    const response = await fetch(`${server.baseUrl}/api/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(custom()) });
    assert.equal(response.status, 403);
  }
  const { createAgentDraft, confirmAgentDraft } = await import("../lib/agent-drafts.js");
  const flow = custom();
  const draft = createAgentDraft({ tasks: [{ title: "助手任务" }] }, [], "建任务", flow);
  assert.equal(draft.tasks[0].status, "cs_queue");
  const { createAgentActionDraft } = await import("../lib/agent-actions.js");
  const context = { actor: { id: "owner", displayName: "我" }, workspace: { id: "workspace", type: "workspace", role: "owner" }, statusWorkflow: flow };
  const task = createTask({ title: "助手目标", creatorIdentityId: "owner" }, [], "我", flow);
  const action = createAgentActionDraft({ actions: [{ taskId: task.id, targetStatus: "dev" }] }, [task], context, "开始");
  assert.equal(action.actions[0].targetStatus, "cs_dev");
  assert.equal(action.workflowRevision, flow.revision);
  const staleContext = { persistence: {
    settings: { load: async () => ({}) },
    statusWorkflow: { load: async () => ({ ...flow, revision: flow.revision + 1 }) }
  } };
  await assert.rejects(confirmAgentDraft(staleContext, context, draft), { code: "AGENT_PLAN_STALE" });
  const { confirmAgentActionDraft } = await import("../lib/agent-actions.js");
  await assert.rejects(confirmAgentActionDraft(staleContext, context, action), { code: "AGENT_PLAN_STALE" });
});

test("HTTP 助手读取自定义目录并确认创建和流转，而非使用旧七列", async (t) => {
  const { createLlmStub } = await import("./llm-stub.js");
  let taskId, generatedPrompt = "";
  const llm = await createLlmStub({ handler: (body, { calls }) => {
    const count = calls.length;
    if (count === 4) generatedPrompt = JSON.stringify(body.messages);
    const content = count === 1 ? { intent: "创建任务", tool: "draftTasks", arguments: {} }
      : count === 2 ? { tasks: [{ title: "助手验收任务", priority: "medium", tags: [] }], newTags: [] }
      : count === 3 ? { intent: "任务上线", tool: "draftTaskActions", arguments: {} }
      : { actions: [{ taskId, targetStatus: "cs_shipped", reason: null, progressText: null }] };
    return { body: { choices: [{ message: { content: JSON.stringify(content) } }] } };
  } });
  const server = await startServer(); t.after(async () => { await server.close(); await llm.close(); });
  const json = async (path, body = {}, method = "POST") => {
    const response = await fetch(`${server.baseUrl}/api/${path}`, { method, headers: { "content-type": "application/json", "idempotency-key": `status-test-${path}` }, body: JSON.stringify(body) });
    const data = await response.json(); assert.ok(response.ok, JSON.stringify(data)); return data;
  };
  await json("settings", { providers: [{ id: "stub", name: "Stub", baseUrl: llm.baseUrl, protocol: "openai-chat-completions", apiKey: "local-test", defaultModelId: "stub", models: [{ id: "stub" }] }], defaultProviderId: "stub" }, "PUT");
  const flow = custom(); const preview = await json("status-workflow/preview", flow);
  await json("status-workflow", { ...flow, previewToken: preview.token }, "PUT");
  const { session } = await json("agent/sessions");
  const message = async (text) => {
    const response = await fetch(`${server.baseUrl}/api/agent/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    return (await response.text()).split("\n\n").map((block) => {
      const raw = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      return raw ? JSON.parse(raw) : null;
    }).filter(Boolean);
  };
  const createEvents = await message("创建助手验收任务");
  const draft = createEvents.find((event) => event.draft)?.draft;
  assert.ok(draft, JSON.stringify(createEvents)); assert.equal(draft.tasks[0].status, "cs_queue");
  await json(`agent/sessions/${session.id}/drafts/${draft.id}/confirm`);
  let body = await fetch(`${server.baseUrl}/api/tasks`).then((r) => r.json()); taskId = body.tasks[0].id;
  const events = await message("将助手验收任务移到 shipped");
  const action = events.find((event) => event.draft)?.draft;
  assert.ok(action, JSON.stringify(events)); assert.match(generatedPrompt, /cs_shipped/);
  await json(`agent/sessions/${session.id}/actions/${action.id}/confirm`);
  body = await fetch(`${server.baseUrl}/api/tasks`).then((r) => r.json());
  assert.equal(body.tasks[0].status, "cs_shipped");
  assert.equal(body.tasks[0].statusDefinition.outcome, "completed");
});
