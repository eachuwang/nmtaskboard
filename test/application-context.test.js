import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCAL_ACTOR_ID,
  DEFAULT_PERSONAL_WORKSPACE_ID,
  defaultRequestContext
} from "../lib/application.js";
import { startServer } from "./helpers.js";

function memoryPersistence() {
  const state = {
    tasks: [],
    settings: {
      providers: [],
      defaultProviderId: "",
      temperature: 0.7,
      tags: [],
      reportTimeZone: "Asia/Shanghai"
    }
  };
  const contexts = [];
  const aggregate = (key) => ({
    async load(context) {
      contexts.push({ operation: `${key}.load`, context });
      return structuredClone(state[key]);
    },
    async save(context, value) {
      contexts.push({ operation: `${key}.save`, context });
      state[key] = structuredClone(value);
    }
  });
  return {
    state,
    contexts,
    adapter: { tasks: aggregate("tasks"), settings: aggregate("settings") }
  };
}

test("默认请求上下文保持当前本地个人空间语义", () => {
  const context = defaultRequestContext({ body: { actor: "  当前用户  " } });

  assert.deepEqual(context, {
    actor: { id: DEFAULT_LOCAL_ACTOR_ID, displayName: "当前用户" },
    workspace: { id: DEFAULT_PERSONAL_WORKSPACE_ID, type: "personal" }
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(defaultRequestContext({ body: {} }).actor.displayName, "我");
});

test("HTTP 路由统一使用注入的操作者、空间上下文和持久化 Adapter", async (t) => {
  const memory = memoryPersistence();
  const requestContext = Object.freeze({
    actor: Object.freeze({ id: "user-context", displayName: "上下文用户" }),
    workspace: Object.freeze({ id: "workspace-context", type: "personal" })
  });
  const server = await startServer({
    appOptions: {
      persistence: memory.adapter,
      resolveRequestContext: () => requestContext
    }
  });
  t.after(() => server.close());

  const createdResponse = await fetch(`${server.baseUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "上下文任务", actor: "请求体用户" })
  });
  assert.equal(createdResponse.status, 201);
  const { task } = await createdResponse.json();
  assert.equal(task.creator, "上下文用户");
  assert.equal(task.history[0].actor, "上下文用户");

  const settingsResponse = await fetch(`${server.baseUrl}/api/settings`);
  assert.equal(settingsResponse.status, 200);
  assert.equal((await settingsResponse.json()).reportTimeZone, "Asia/Shanghai");

  const reportResponse = await fetch(`${server.baseUrl}/api/report/summary`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "weekly", range: { start: "2026-08-24", end: "2026-08-28" } })
  });
  assert.equal(reportResponse.status, 200);

  const exportedResponse = await fetch(`${server.baseUrl}/api/export`);
  assert.equal(exportedResponse.status, 200);
  assert.equal((await exportedResponse.json()).tasks.length, 1);

  assert.ok(memory.contexts.some(({ operation }) => operation === "tasks.load"));
  assert.ok(memory.contexts.some(({ operation }) => operation === "tasks.save"));
  assert.ok(memory.contexts.some(({ operation }) => operation === "settings.load"));
  assert.ok(memory.contexts.every(({ context }) => context === requestContext));
});

test("团队管理员创建待规划父任务，普通成员的越权维护被拒绝", async (t) => {
  const memory = memoryPersistence();
  const contextFor = (req) => Object.freeze({
    actor: Object.freeze({ id: req.headers["x-test-role"] === "member" ? "member-1" : "owner-1", displayName: req.headers["x-test-role"] === "member" ? "成员" : "所有者" }),
    workspace: Object.freeze({ id: "team-1", type: "team", role: req.headers["x-test-role"] === "member" ? "member" : "owner", visibilityScope: "team", operationScope: "assigned" })
  });
  const server = await startServer({ appOptions: { persistence: memory.adapter, resolveRequestContext: contextFor } });
  t.after(() => server.close());

  const createdResponse = await fetch(`${server.baseUrl}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "团队父任务", description: "完整描述", priority: "high", tags: ["交付"], dueDate: "2026-09-04", status: "todo" })
  });
  assert.equal(createdResponse.status, 201);
  const { task } = await createdResponse.json();
  assert.equal(task.status, "planned");
  assert.equal(task.taskType, "parent");
  assert.deepEqual({ description: task.description, priority: task.priority, tags: task.tags, dueDate: task.dueDate }, {
    description: "完整描述", priority: "high", tags: ["交付"], dueDate: "2026-09-04"
  });
  assert.equal(task.history[0].action, "created");

  const denied = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
    method: "PUT", headers: { "content-type": "application/json", "x-test-role": "member" }, body: JSON.stringify({ title: "越权修改" })
  });
  assert.equal(denied.status, 403);
  const invalidMove = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "todo" })
  });
  assert.equal(invalidMove.status, 400);
});
