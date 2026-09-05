import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const json = async (s, path, options = {}) => {
  const response = await fetch(s.baseUrl + path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  return { status: response.status, body: await response.json() };
};

test("人工校准可建立任意可信状态并保留旧轨迹", async () => {
  const s = await startServer();
  try {
    const created = await json(s, "/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "历史数据", actor: "张三" })
    });
    const id = created.body.task.id;
    const effectiveAt = new Date(Date.now() - 60_000).toISOString();
    const calibrated = await json(s, `/api/tasks/${id}/calibrate`, {
      method: "POST",
      body: JSON.stringify({ status: "done", reason: "从旧系统核对完成记录", actor: "管理员", effectiveAt })
    });
    assert.equal(calibrated.status, 200);
    assert.equal(calibrated.body.task.status, "done");
    assert.equal(calibrated.body.task.history.length, 2);
    const event = calibrated.body.task.history.at(-1);
    assert.equal(event.action, "calibrated");
    assert.equal(event.toStatus, "done");
    assert.equal(event.reason, "从旧系统核对完成记录");
    assert.equal(event.actor, "管理员");
    assert.equal(event.at, effectiveAt);
    assert.ok(event.recordedAt);
  } finally { await s.close(); }
});

test("人工校准要求原因和非未来生效时间，操作人来自服务端上下文", async () => {
  const s = await startServer();
  try {
    const created = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "待校准" }) });
    const id = created.body.task.id;
    for (const payload of [
      { status: "done", actor: "管理员", effectiveAt: new Date().toISOString() },
      { status: "done", reason: "核对", actor: "管理员", effectiveAt: new Date(Date.now() + 60_000).toISOString() }
    ]) {
      const result = await json(s, `/api/tasks/${id}/calibrate`, { method: "POST", body: JSON.stringify(payload) });
      assert.equal(result.status, 400);
    }
    const task = (await json(s, "/api/tasks")).body.tasks.find((item) => item.id === id);
    assert.equal(task.status, "backlog");
    assert.equal(task.history.length, 1);
  } finally { await s.close(); }
});
