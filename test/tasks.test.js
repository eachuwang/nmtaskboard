import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

async function create(s, body) {
  const res = await fetch(s.baseUrl + "/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

test("手动创建：默认待整理，可直接选择任一规范状态", async () => {
  const s = await startServer();
  try {
    const ok = await create(s, { title: "写周报", priority: "high", tags: ["汇报", "汇报", "周会"], dueDate: "2026-08-20" });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.task.status, "backlog");
    assert.equal(ok.body.task.priority, "high");
    assert.deepEqual(ok.body.task.tags, ["汇报", "周会"]);
    assert.equal(ok.body.task.dueDate, "2026-08-20");
    assert.ok(ok.body.task.id && ok.body.task.createdAt);

    const bad = await create(s, { title: "   " });
    assert.equal(bad.status, 400);

    const todo = await create(s, { title: "明确待办", status: "todo" });
    assert.equal(todo.status, 201);
    const inProgress = await create(s, { title: "直接进行中", status: "in_progress" });
    assert.equal(inProgress.status, 201);
    const illegal = await create(s, { title: "非法状态", status: "nope" });
    assert.equal(illegal.status, 400);
  } finally { await s.close(); }
});

test("批量创建默认待整理，校验失败时不产生部分数据", async () => {
  const s = await startServer();
  try {
    const r = await fetch(s.baseUrl + "/api/tasks/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [{ title: "AI 一" }, { title: "AI 二", status: "todo" }] })
    });
    assert.equal(r.status, 201);
    const created = (await r.json()).tasks;
    assert.equal(created[0].status, "backlog");
    assert.equal(created[1].status, "todo");

    const bad = await fetch(s.baseUrl + "/api/tasks/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [{ title: "有效" }, { title: "   " }] })
    });
    assert.equal(bad.status, 400);
    const list = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.deepEqual(list.tasks.map((task) => task.title).sort(), ["AI 一", "AI 二"]);
  } finally { await s.close(); }
});

test("批量创建：≤50 成功、51 拒绝", async () => {
  const s = await startServer();
  try {
    const items = Array.from({ length: 3 }, (_, i) => ({ title: "批量任务 " + i }));
    const ok = await fetch(s.baseUrl + "/api/tasks/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: items })
    });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).tasks.length, 3);

    const tooMany = Array.from({ length: 51 }, (_, i) => ({ title: "t" + i }));
    const bad = await fetch(s.baseUrl + "/api/tasks/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: tooMany })
    });
    assert.equal(bad.status, 400);
  } finally { await s.close(); }
});

test("更新任务：字段变更、非法状态 400、404", async () => {
  const s = await startServer();
  try {
    const { body } = await create(s, { title: "原始标题" });
    const id = body.task.id;
    const upd = await fetch(s.baseUrl + "/api/tasks/" + id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新标题", priority: "low", dueDate: null })
    });
    assert.equal(upd.status, 200);
    const t = (await upd.json()).task;
    assert.equal(t.title, "新标题");
    assert.equal(t.priority, "low");
    assert.equal(t.dueDate, null);

    const badStatus = await fetch(s.baseUrl + "/api/tasks/" + id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "nope" })
    });
    assert.equal(badStatus.status, 400);

    const missing = await fetch(s.baseUrl + "/api/tasks/no-such-id", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x" })
    });
    assert.equal(missing.status, 404);
  } finally { await s.close(); }
});

test("状态可直接跳转，原因可选", async () => {
  const s = await startServer();
  try {
    const { body } = await create(s, { title: "流转任务" });
    const id = body.task.id;
    const put = async (payload) => {
      const r = await fetch(s.baseUrl + "/api/tasks/" + id, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      return { status: r.status, task: (await r.json()).task };
    };
    let result = await put({ status: "in_progress" });
    assert.equal(result.status, 200);
    assert.ok(result.task.startedAt);
    result = await put({ status: "blocked", reason: "等接口" });
    assert.equal(result.task.blockReason, "等接口");
    result = await put({ status: "done" });
    assert.equal(result.status, 200);
    assert.ok(result.task.completedAt);
    assert.equal(result.task.blockReason, null);
  } finally { await s.close(); }
});

test("删除父任务会解除子任务关系而不是级联删除", async () => {
  const s = await startServer();
  try {
    const parent = (await create(s, { title: "父任务" })).body.task;
    const child = (await create(s, { title: "子任务", parentTaskId: parent.id })).body.task;
    assert.equal(child.parentTaskId, parent.id);
    const del = await fetch(s.baseUrl + "/api/tasks/" + parent.id, { method: "DELETE" });
    assert.equal(del.status, 200);
    const body = await del.json();
    assert.equal(body.removed, 1);
    assert.equal(body.detachedChildren, 1);
    const list = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.equal(list.tasks.some((task) => task.id === parent.id), false);
    assert.equal(list.tasks.find((task) => task.id === child.id).parentTaskId, null);
  } finally { await s.close(); }
});

test("持久化：同一实例多次读取一致", async () => {
  const s = await startServer();
  try {
    await create(s, { title: "持久化任务" });
    const one = await (await fetch(s.baseUrl + "/api/tasks")).json();
    const two = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.equal(one.tasks.length, 1);
    assert.deepEqual(one.tasks.map(t => t.id), two.tasks.map(t => t.id));
  } finally { await s.close(); }
});

test("同状态编辑或列内排序不重写状态生效时间", async () => {
  const s = await startServer();
  try {
    const created = (await create(s, { title: "计时任务", status: "todo" })).body.task;
    const move = async (status) => fetch(s.baseUrl + "/api/tasks/" + created.id, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status })
    });
    await move("in_progress");
    await move("done");
    let task = (await (await fetch(s.baseUrl + "/api/tasks")).json()).tasks.find((item) => item.id === created.id);
    const completedAt = task.completedAt;

    await fetch(s.baseUrl + "/api/tasks/" + created.id, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "只改标题" })
    });
    await fetch(s.baseUrl + "/api/tasks/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves: [{ status: "done", orderedIds: [created.id] }] })
    });
    task = (await (await fetch(s.baseUrl + "/api/tasks")).json()).tasks.find((item) => item.id === created.id);
    assert.equal(task.completedAt, completedAt);
  } finally { await s.close(); }
});

test("普通编辑不能覆盖不可变状态轨迹", async () => {
  const s = await startServer();
  try {
    const created = (await create(s, { title: "审计任务" })).body.task;
    const response = await fetch(s.baseUrl + "/api/tasks/" + created.id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "允许改标题", history: [], createdAt: "2000-01-01T00:00:00.000Z" })
    });
    assert.equal(response.status, 200);
    const task = (await response.json()).task;
    assert.equal(task.title, "允许改标题");
    assert.equal(task.history.length, 1);
    assert.equal(task.history[0].action, "created");
    assert.equal(task.createdAt, created.createdAt);
  } finally { await s.close(); }
});
