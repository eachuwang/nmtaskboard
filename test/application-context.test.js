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

test("默认请求上下文保持统一工作区语义", () => {
  const context = defaultRequestContext({ body: { actor: "  当前用户  " } });

  assert.deepEqual(context, {
    actor: { id: DEFAULT_LOCAL_ACTOR_ID, displayName: "当前用户" },
    workspace: { id: DEFAULT_PERSONAL_WORKSPACE_ID, type: "workspace", name: "默认工作区", role: "owner" }
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(defaultRequestContext({ body: {} }).actor.displayName, "我");
});

test("HTTP 路由统一使用注入的操作者、空间上下文和持久化 Adapter", async (t) => {
  const memory = memoryPersistence();
  const requestContext = Object.freeze({
    actor: Object.freeze({ id: "user-context", displayName: "上下文用户" }),
    workspace: Object.freeze({ id: "workspace-context", type: "workspace", role: "owner" })
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

test("成员可创建任务；非自己负责的任务他人只读，创建者全权维护", async (t) => {
  const memory = memoryPersistence();
  const contextFor = (req) => Object.freeze({
    actor: Object.freeze({ id: req.headers["x-test-role"] === "member" ? "member-1" : "owner-1", displayName: req.headers["x-test-role"] === "member" ? "成员" : "所有者" }),
    workspace: Object.freeze({ id: "team-1", type: "workspace", role: req.headers["x-test-role"] === "member" ? "member" : "owner" })
  });
  const server = await startServer({ appOptions: { persistence: memory.adapter, resolveRequestContext: contextFor } });
  t.after(() => server.close());

  const createdResponse = await fetch(`${server.baseUrl}/api/tasks`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "工作区任务", description: "完整描述", priority: "high", tags: ["交付"], dueDate: "2026-09-04", status: "todo" })
  });
  assert.equal(createdResponse.status, 201);
  const { task } = await createdResponse.json();
  assert.equal(task.status, "todo");
  assert.deepEqual({ description: task.description, priority: task.priority, tags: task.tags, dueDate: task.dueDate }, {
    description: "完整描述", priority: "high", tags: ["交付"], dueDate: "2026-09-04"
  });
  assert.equal(task.history[0].action, "created");

  // 其他成员对非自己负责的任务只读
  const memberEdit = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
    method: "PUT", headers: { "content-type": "application/json", "x-test-role": "member" }, body: JSON.stringify({ title: "成员不可修改" })
  });
  assert.equal(memberEdit.status, 403);
  const moved = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "done" })
  });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).task.status, "done");

  const memberDelete = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
    method: "DELETE", headers: { "x-test-role": "member" }
  });
  assert.equal(memberDelete.status, 403);
  const deleted = await fetch(`${server.baseUrl}/api/tasks/${task.id}`, {
    method: "DELETE"
  });
  assert.equal(deleted.status, 200);
});

test("取消父任务不会级联改变子任务状态", async (t) => {
  const memory = memoryPersistence();
  memory.state.tasks = [
    { id: "parent-1", title: "提交本周工作周报", creator: "创建人", creatorIdentityId: "creator-1", status: "backlog", priority: "medium", tags: [], comments: [], history: [], createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" },
    { id: "child-todo", title: "成员甲子任务", parentTaskId: "parent-1", assigneeIdentityId: "member-1", status: "todo", priority: "medium", tags: [], comments: [], history: [], createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z" },
    { id: "child-done", title: "成员乙子任务", parentTaskId: "parent-1", assigneeIdentityId: "member-2", status: "done", priority: "medium", tags: [], comments: [], history: [], createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z", completedAt: "2026-09-01T09:00:00.000Z" }
  ];
  const contextFor = (req) => {
    const role = req.headers["x-test-role"];
    const creator = role === "creator";
    const member = role === "member";
    return {
      actor: { id: creator ? "creator-1" : member ? "member-1" : "owner-1", displayName: creator ? "创建人" : member ? "成员甲" : "所有者" },
      workspace: { id: "team-1", type: "workspace", role: creator || member ? "member" : "owner" }
    };
  };
  const server = await startServer({ appOptions: { persistence: memory.adapter, resolveRequestContext: contextFor } });
  t.after(() => server.close());

  const cancelled = await fetch(`${server.baseUrl}/api/tasks/reorder`, {
    method: "POST", headers: { "content-type": "application/json", "x-test-role": "creator" },
    body: JSON.stringify({ moves: [{ status: "cancelled", orderedIds: ["parent-1"], reason: "项目终止" }] })
  });
  assert.equal(cancelled.status, 200);
  const parent = memory.state.tasks.find(({ id }) => id === "parent-1");
  const unfinished = memory.state.tasks.find(({ id }) => id === "child-todo");
  const completed = memory.state.tasks.find(({ id }) => id === "child-done");
  assert.equal(parent.status, "cancelled");
  assert.equal(parent.cancelReason, "项目终止");
  assert.equal(unfinished.status, "todo");
  assert.equal(completed.status, "done");
  assert.equal(completed.completedAt, "2026-09-01T09:00:00.000Z");
});

test("永久删除父任务会解除子任务关系而不是删除子任务", async (t) => {
  const memory = memoryPersistence();
  memory.state.tasks = [
    { id: "parent-1", title: "工作区任务", status: "backlog", priority: "medium", tags: [], comments: [], history: [], createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" },
    { id: "child-1", title: "子任务", parentTaskId: "parent-1", assigneeIdentityId: "member-1", status: "todo", priority: "medium", tags: [], comments: [], history: [], createdAt: "2026-08-28T08:00:00.000Z", updatedAt: "2026-08-28T08:00:00.000Z" }
  ];
  const contextFor = (req) => ({
    actor: { id: req.headers["x-test-role"] === "member" ? "member-1" : "owner-1", displayName: req.headers["x-test-role"] === "member" ? "成员" : "所有者" },
    workspace: { id: "team-1", type: "workspace", role: req.headers["x-test-role"] === "member" ? "member" : "owner" }
  });
  const server = await startServer({ appOptions: { persistence: memory.adapter, resolveRequestContext: contextFor } });
  t.after(() => server.close());

  const deleted = await fetch(`${server.baseUrl}/api/tasks/parent-1`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(memory.state.tasks.find((task) => task.id === "parent-1"), undefined);
  assert.equal(memory.state.tasks.find((task) => task.id === "child-1").parentTaskId, null);
  assert.equal(memory.state.tasks.find((task) => task.id === "child-1").deletedAt || null, null);

  const listed = await (await fetch(`${server.baseUrl}/api/tasks`, { headers: { "x-test-role": "member" } })).json();
  assert.equal(listed.tasks.some((task) => task.id === "child-1"), true);
  const trash = await fetch(`${server.baseUrl}/api/tasks/trash`);
  assert.equal([403, 404].includes(trash.status), true);
});
