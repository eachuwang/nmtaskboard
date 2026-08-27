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
