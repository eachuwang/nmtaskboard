import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

function memoryPersistence() {
  let tasks = [];
  const events = [];
  return {
    events,
    adapter: {
      tasks: {
        async load() { return structuredClone(tasks); },
        async save(context, value) { tasks = structuredClone(value); }
      },
      settings: { async load() { return { providers: [], tags: [] }; }, async save() {} },
      audit: {
        async append(event) { events.push(structuredClone(event)); },
        async list() { return structuredClone(events); }
      }
    }
  };
}

test("高价值 HTTP 写操作产生稳定、脱敏的追加式审计事件", async (t) => {
  const memory = memoryPersistence();
  const context = Object.freeze({
    actor: Object.freeze({ id: "actor-1", displayName: "审计用户" }),
    workspace: Object.freeze({ id: "workspace-1", type: "personal", role: "owner" })
  });
  const server = await startServer({ appOptions: {
    persistence: memory.adapter,
    resolveRequestContext: () => context
  } });
  t.after(() => server.close());
  const response = await fetch(`${server.baseUrl}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-action-source": "ui" },
    body: JSON.stringify({ title: "审计任务", apiKey: "secret-key", token: "secret-token", prompt: "完整提示文本" })
  });
  assert.equal(response.status, 201);
  for (let index = 0; index < 20 && memory.events.length === 0; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(memory.events.length, 1);
  assert.deepEqual(memory.events[0], {
    actor: context.actor,
    workspace: context.workspace,
    source: "ui",
    action: "task.create",
    target: { type: "task", id: null },
    outcome: "success",
    summary: { method: "POST", statusCode: 201 }
  });
  assert.equal(JSON.stringify(memory.events[0]).includes("secret"), false);
  assert.equal(JSON.stringify(memory.events[0]).includes("完整提示文本"), false);

  const listed = await fetch(`${server.baseUrl}/api/audit`);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).events.length, 1);
  const mutation = await fetch(`${server.baseUrl}/api/audit/${memory.events[0].id || "event"}`, { method: "DELETE" });
  assert.equal(mutation.status, 404);
});
