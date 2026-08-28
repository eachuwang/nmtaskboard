import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

async function create(s, body) {
  const res = await fetch(s.baseUrl + "/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

test("手动创建：默认待规划，仅允许待规划或待办", async () => {
  const s = await startServer();
  try {
    const ok = await create(s, { title: "写周报", priority: "high", tags: ["汇报", "汇报", "周会"], dueDate: "2026-08-20" });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.task.status, "planned");
    assert.equal(ok.body.task.priority, "high");
    assert.deepEqual(ok.body.task.tags, ["汇报", "周会"]);
    assert.equal(ok.body.task.dueDate, "2026-08-20");
    assert.ok(ok.body.task.id && ok.body.task.createdAt);

    const bad = await create(s, { title: "   " });
    assert.equal(bad.status, 400);

    const todo = await create(s, { title: "明确待办", status: "todo" });
    assert.equal(todo.status, 201);
    const illegal = await create(s, { title: "不能直接进行中", status: "in_progress" });
    assert.equal(illegal.status, 400);
  } finally { await s.close(); }
});

test("AI 批量创建强制进入待规划且校验失败时不产生部分数据", async () => {
  const s = await startServer();
  try {
    const r = await fetch(s.baseUrl + "/api/tasks/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: [{ title: "AI 一" }, { title: "AI 二", status: "todo" }] })
    });
    assert.equal(r.status, 201);
    assert.ok((await r.json()).tasks.every((task) => task.status === "planned"));

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

test("状态流转：仅允许相邻路径，必填原因写入不可变轨迹", async () => {
  const s = await startServer();
  try {
    const { body } = await create(s, { title: "流转任务" });
    const id = body.task.id;
    const put = async (payload) => {
      const r = await fetch(s.baseUrl + "/api/tasks/" + id, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      return (await r.json()).task;
    };
    let t = await put({ status: "todo" });
    t = await put({ status: "in_progress" });
    assert.ok(t.startedAt);
    const missingReason = await fetch(s.baseUrl + "/api/tasks/" + id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "blocked" })
    });
    assert.equal(missingReason.status, 400);

    t = await put({ status: "blocked", reason: "等接口" });
    assert.equal(t.startedAt, null, "离开进行中应清空 startedAt");
    assert.equal(t.blockReason, "等接口");
    assert.equal(t.history.at(-1).reason, "等接口");

    const illegal = await fetch(s.baseUrl + "/api/tasks/" + id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", reason: "绕过进行中" })
    });
    assert.equal(illegal.status, 400);

    t = await put({ status: "in_progress", reason: "依赖已恢复" });
    assert.equal(t.history.at(-1).reason, "依赖已恢复");
    t = await put({ status: "done" });
    assert.ok(t.completedAt);
    assert.equal(t.blockReason, null, "离开阻塞中应清空阻塞原因");

    const reopenWithoutReason = await fetch(s.baseUrl + "/api/tasks/" + id, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" })
    });
    assert.equal(reopenWithoutReason.status, 400);
    t = await put({ status: "in_progress", reason: "验收发现回归" });
    assert.equal(t.history.at(-1).reason, "验收发现回归");
  } finally { await s.close(); }
});

test("删除：进入回收站、保留期内可原样恢复，按状态清空也不物理删除", async () => {
  const s = await startServer();
  try {
    const a = (await create(s, { title: "A" })).body.task;
    await fetch(s.baseUrl + "/api/tasks/" + a.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled", reason: "不再处理" }) });
    await create(s, { title: "B" });
    const del = await fetch(s.baseUrl + "/api/tasks/" + a.id, { method: "DELETE" });
    assert.equal(del.status, 200);
    const deleted = (await del.json()).task;
    assert.ok(deleted.deletedAt);
    assert.ok(Date.parse(deleted.purgeAfter) > Date.parse(deleted.deletedAt));
    assert.equal(deleted.history.at(-1).action, "deleted");
    const notFound = await fetch(s.baseUrl + "/api/tasks/" + a.id, { method: "DELETE" });
    assert.equal(notFound.status, 404);
    const hidden = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.equal(hidden.tasks.some((task) => task.id === a.id), false);
    const trash = await (await fetch(s.baseUrl + "/api/tasks/trash")).json();
    assert.equal(trash.tasks[0].id, a.id);
    const tooEarly = await fetch(s.baseUrl + "/api/tasks/trash/" + a.id, { method: "DELETE" });
    assert.equal(tooEarly.status, 409);
    const restoredResponse = await fetch(s.baseUrl + "/api/tasks/trash/" + a.id + "/restore", { method: "POST" });
    assert.equal(restoredResponse.status, 200);
    const restored = (await restoredResponse.json()).task;
    assert.equal(restored.id, a.id);
    assert.equal(restored.deletedAt, null);
    assert.equal(restored.history.at(-1).action, "restored");
    assert.equal((await (await fetch(s.baseUrl + "/api/tasks")).json()).tasks.some((task) => task.id === a.id), true);
    await fetch(s.baseUrl + "/api/tasks/" + a.id, { method: "DELETE" });

    const c1 = (await create(s, { title: "C1" })).body.task;
    const c2 = (await create(s, { title: "C2" })).body.task;
    for (const task of [c1, c2]) {
      await fetch(s.baseUrl + "/api/tasks/" + task.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "cancelled", reason: "清理" }) });
    }
    const clear = await fetch(s.baseUrl + "/api/tasks?status=cancelled", { method: "DELETE" });
    assert.equal(clear.status, 200);
    assert.equal((await clear.json()).removed, 2);
    const list = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.ok(list.tasks.every((t) => t.status !== "cancelled"));
    const trashAfterClear = await (await fetch(s.baseUrl + "/api/tasks/trash")).json();
    assert.equal(trashAfterClear.tasks.filter((task) => [c1.id, c2.id].includes(task.id)).length, 2);

    const bad = await fetch(s.baseUrl + "/api/tasks?status=whatever", { method: "DELETE" });
    assert.equal(bad.status, 400);
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
