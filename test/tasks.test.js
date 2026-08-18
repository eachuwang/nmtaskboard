import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

async function create(s, body) {
  const res = await fetch(s.baseUrl + "/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

test("创建任务：默认状态待办、标题必填", async () => {
  const s = await startServer();
  try {
    const ok = await create(s, { title: "写周报", priority: "high", tags: ["汇报", "汇报", "周会"], dueDate: "2026-08-20" });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.task.status, "todo");
    assert.equal(ok.body.task.priority, "high");
    assert.deepEqual(ok.body.task.tags, ["汇报", "周会"]);
    assert.equal(ok.body.task.dueDate, "2026-08-20");
    assert.ok(ok.body.task.id && ok.body.task.createdAt);

    const bad = await create(s, { title: "   " });
    assert.equal(bad.status, 400);
  } finally { await s.close(); }
});

test("创建在 done 列时 completedAt 落值", async () => {
  const s = await startServer();
  try {
    const r = await create(s, { title: "已完成的事", status: "done" });
    assert.equal(r.status, 201);
    assert.ok(r.body.task.completedAt);
    assert.equal(r.body.task.startedAt, null);
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

test("状态流转：进入进行中写 startedAt，转出清空；完成写 completedAt", async () => {
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
    let t = await put({ status: "in_progress" });
    assert.ok(t.startedAt);
    t = await put({ status: "blocked", blockReason: "等接口" });
    assert.equal(t.startedAt, null, "离开进行中应清空 startedAt");
    assert.equal(t.blockReason, "等接口");
    t = await put({ status: "done" });
    assert.ok(t.completedAt);
    assert.equal(t.blockReason, null, "离开阻塞中应清空阻塞原因");
  } finally { await s.close(); }
});

test("删除：单条删除与按状态清空", async () => {
  const s = await startServer();
  try {
    const a = (await create(s, { title: "A", status: "cancelled" })).body.task;
    await create(s, { title: "B" });
    const del = await fetch(s.baseUrl + "/api/tasks/" + a.id, { method: "DELETE" });
    assert.equal(del.status, 200);
    const notFound = await fetch(s.baseUrl + "/api/tasks/" + a.id, { method: "DELETE" });
    assert.equal(notFound.status, 404);

    await create(s, { title: "C1", status: "cancelled" });
    await create(s, { title: "C2", status: "cancelled" });
    const clear = await fetch(s.baseUrl + "/api/tasks?status=cancelled", { method: "DELETE" });
    assert.equal(clear.status, 200);
    assert.equal((await clear.json()).removed, 2);
    const list = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.ok(list.tasks.every((t) => t.status !== "cancelled"));

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
