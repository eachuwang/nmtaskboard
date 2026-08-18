import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

async function create(s, body) {
  const r = await fetch(s.baseUrl + "/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return (await r.json()).task;
}
async function reorder(s, moves) {
  const r = await fetch(s.baseUrl + "/api/tasks/reorder", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moves })
  });
  assert.equal(r.status, 200);
}
async function list(s) {
  return (await (await fetch(s.baseUrl + "/api/tasks")).json()).tasks;
}

test("跨列移动：状态更新 + startedAt 落值", async () => {
  const s = await startServer();
  try {
    const a = await create(s, { title: "A", status: "todo" });
    const b = await create(s, { title: "B", status: "todo" });
    await reorder(s, [{ status: "in_progress", orderedIds: [b.id, a.id] }]);
    const tasks = await list(s);
    const t = tasks.find((x) => x.id === b.id);
    assert.equal(t.status, "in_progress");
    assert.ok(t.startedAt, "进入进行中应写 startedAt");
    assert.equal(t.order, 0);
    const t2 = tasks.find((x) => x.id === a.id);
    assert.equal(t2.status, "in_progress");
    assert.equal(t2.order, 1);
  } finally { await s.close(); }
});

test("拖进阻塞中可携带原因，拖出清空原因", async () => {
  const s = await startServer();
  try {
    const a = await create(s, { title: "A", status: "todo" });
    await reorder(s, [{ status: "blocked", orderedIds: [a.id], blockReason: "等依赖方接口" }]);
    let t = (await list(s)).find((x) => x.id === a.id);
    assert.equal(t.status, "blocked");
    assert.equal(t.blockReason, "等依赖方接口");

    await reorder(s, [{ status: "todo", orderedIds: [a.id] }]);
    t = (await list(s)).find((x) => x.id === a.id);
    assert.equal(t.blockReason, null, "离开阻塞中应清空原因");
  } finally { await s.close(); }
});

test("列内排序持久化：不在列表中的同列任务排到末尾", async () => {
  const s = await startServer();
  try {
    const a = await create(s, { title: "A", status: "todo" });
    const b = await create(s, { title: "B", status: "todo" });
    const c = await create(s, { title: "C", status: "todo" });
    // 只提交 b、a，c 应排到末尾
    await reorder(s, [{ status: "todo", orderedIds: [b.id, a.id] }]);
    const tasks = (await list(s)).filter((x) => x.status === "todo").sort((x, y) => x.order - y.order);
    assert.deepEqual(tasks.map((x) => x.id), [b.id, a.id, c.id]);
  } finally { await s.close(); }
});

test("拖出已完成清空 completedAt；非法状态 400", async () => {
  const s = await startServer();
  try {
    const a = await create(s, { title: "A", status: "done" });
    assert.ok(a.completedAt);
    await reorder(s, [{ status: "in_progress", orderedIds: [a.id] }]);
    const t = (await list(s)).find((x) => x.id === a.id);
    assert.equal(t.completedAt, null);
    assert.ok(t.startedAt);

    const bad = await fetch(s.baseUrl + "/api/tasks/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves: [{ status: "nope", orderedIds: [a.id] }] })
    });
    assert.equal(bad.status, 400);
  } finally { await s.close(); }
});
