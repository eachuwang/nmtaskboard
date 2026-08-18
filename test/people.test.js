import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { ensureTaskExtras } from "../lib/tasks.js";

const api = async (s, path, opts = {}) => {
  const res = await fetch(s.baseUrl + path, {
    headers: { "Content-Type": "application/json" }, ...opts
  });
  return { status: res.status, body: await res.json() };
};

test("创建人/负责人：创建时记录创建人，负责人去重", async () => {
  const s = await startServer();
  try {
    const { status, body } = await api(s, "/api/tasks", {
      method: "POST", body: JSON.stringify({ title: "人员测试", actor: "张三", assignees: ["李四", "王五", "李四"] })
    });
    assert.equal(status, 201);
    assert.equal(body.task.creator, "张三");
    assert.deepEqual(body.task.assignees, ["李四", "王五"]);

    const b2 = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "无负责人", actor: "赵六" }) });
    assert.equal(b2.body.task.creator, "赵六");
    assert.deepEqual(b2.body.task.assignees, []);
  } finally { await s.close(); }
});

test("更新任务：可改负责人且保留创建人", async () => {
  const s = await startServer();
  try {
    const { body } = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "改负责人", actor: "张三" }) });
    const id = body.task.id;
    const upd = await api(s, "/api/tasks/" + id, {
      method: "PUT", body: JSON.stringify({ title: "改负责人", actor: "张三", assignees: ["李四"] })
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.task.creator, "张三");
    assert.deepEqual(upd.body.task.assignees, ["李四"]);
  } finally { await s.close(); }
});

test("ensureTaskExtras 老数据兜底：从创建轨迹取创建人", () => {
  const t = { id: "x", history: [{ action: "created", actor: "张三" }] };
  ensureTaskExtras(t);
  assert.equal(t.creator, "张三");
  assert.deepEqual(t.assignees, []);
  assert.deepEqual(t.comments, []);

  const t2 = { id: "y" };
  ensureTaskExtras(t2);
  assert.equal(t2.creator, "我");
  assert.deepEqual(t2.assignees, []);
});
