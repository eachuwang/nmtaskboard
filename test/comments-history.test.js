import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const api = async (s, path, opts = {}) => {
  const res = await fetch(s.baseUrl + path, {
    headers: { "Content-Type": "application/json" }, ...opts
  });
  return { status: res.status, body: await res.json() };
};

test("创建任务：初始轨迹含「创建」事件，评论区为空", async () => {
  const s = await startServer();
  try {
    const { status, body } = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "新卡", actor: "张三" }) });
    assert.equal(status, 201);
    const t = body.task;
    assert.deepEqual(t.comments, []);
    assert.equal(t.history.length, 1);
    assert.equal(t.history[0].action, "created");
    assert.equal(t.history[0].toStatus, "planned");
    assert.equal(t.history[0].actor, "张三");
  } finally { await s.close(); }
});

test("状态变更：移动记录「移动」轨迹，带操作人", async () => {
  const s = await startServer();
  try {
    const { body } = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "流转", actor: "张三" }) });
    const id = body.task.id;
    await api(s, "/api/tasks/" + id, { method: "PUT", body: JSON.stringify({ status: "todo", actor: "李四" }) });
    const { body: updated } = await api(s, "/api/tasks/" + id, { method: "PUT", body: JSON.stringify({ status: "in_progress", actor: "李四" }) });
    const t = updated.task;
    assert.equal(t.history.length, 3);
    const last = t.history[2];
    assert.equal(last.action, "moved");
    assert.equal(last.fromStatus, "todo");
    assert.equal(last.toStatus, "in_progress");
    assert.equal(last.actor, "李四");
  } finally { await s.close(); }
});

test("同状态更新不产生移动轨迹", async () => {
  const s = await startServer();
  try {
    const { body } = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "不动" }) });
    const id = body.task.id;
    const { body: updated } = await api(s, "/api/tasks/" + id, { method: "PUT", body: JSON.stringify({ title: "改名而已" }) });
    assert.equal(updated.task.history.length, 1, "只改标题不记轨迹");
  } finally { await s.close(); }
});

test("拖拽排序跨列移动记录轨迹", async () => {
  const s = await startServer();
  try {
    const { body } = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "拖", actor: "王五" }) });
    const id = body.task.id;
    await api(s, "/api/tasks/" + id, { method: "PUT", body: JSON.stringify({ status: "todo", actor: "王五" }) });
    const { status } = await api(s, "/api/tasks/reorder", { method: "POST", body: JSON.stringify({ actor: "王五", moves: [{ status: "in_progress", orderedIds: [id] }] }) });
    assert.equal(status, 200);
    const list = (await api(s, "/api/tasks")).body.tasks;
    const t = list.find((x) => x.id === id);
    assert.equal(t.history.length, 3);
    assert.equal(t.history[2].action, "moved");
    assert.equal(t.history[2].toStatus, "in_progress");
  } finally { await s.close(); }
});

test("评论：新增、读取、删除", async () => {
  const s = await startServer();
  try {
    const { body } = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "评论卡" }) });
    const id = body.task.id;
    const add = await api(s, "/api/tasks/" + id + "/comments", { method: "POST", body: JSON.stringify({ text: "这里有个坑", actor: "赵六" }) });
    assert.equal(add.status, 201);
    assert.equal(add.body.comments.length, 1);
    assert.equal(add.body.comments[0].text, "这里有个坑");
    assert.equal(add.body.comments[0].author, "赵六");
    assert.ok(add.body.comments[0].createdAt);

    const empty = await api(s, "/api/tasks/" + id + "/comments", { method: "POST", body: JSON.stringify({ text: "   " }) });
    assert.equal(empty.status, 400);

    const list = (await api(s, "/api/tasks")).body.tasks.find((x) => x.id === id);
    assert.equal(list.comments.length, 1);

    const cid = add.body.comments[0].id;
    const del = await api(s, "/api/tasks/" + id + "/comments/" + cid, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(del.body.comments.length, 0);

    const noTask = await api(s, "/api/tasks/nope/comments", { method: "POST", body: JSON.stringify({ text: "x" }) });
    assert.equal(noTask.status, 404);
  } finally { await s.close(); }
});

test("老数据读取时补齐扩展字段和当前取消原因", async () => {
  const s = await startServer();
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(s.dataDir, { recursive: true });
    fs.writeFileSync(path.join(s.dataDir, "tasks.json"), JSON.stringify({ tasks: [
      { id: "old-1", title: "老任务", status: "todo", createdAt: new Date().toISOString() },
      { id: "old-2", title: "已取消任务", status: "cancelled", history: [{ action: "moved", fromStatus: "todo", toStatus: "cancelled", reason: "历史原因" }] }
    ] }));
    const list = (await api(s, "/api/tasks")).body.tasks;
    assert.deepEqual(list[0].comments, []);
    assert.deepEqual(list[0].history, []);
    assert.equal(list[1].cancelReason, "历史原因");
  } finally { await s.close(); }
});

test("评论回复：嵌套与级联删除", async () => {
  const s = await startServer();
  try {
    const { body } = await api(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "回复卡", actor: "张三" }) });
    const id = body.task.id;
    const post = (text, parentId) => api(s, "/api/tasks/" + id + "/comments", { method: "POST", body: JSON.stringify({ text, parentId }) });

    const a = await post("顶层评论");
    assert.equal(a.status, 201);
    const aid = a.body.comment.id;

    const b = await post("回复顶层", aid);
    assert.equal(b.status, 201);
    assert.equal(b.body.comment.parentId, aid);

    const c = await post("再回复", b.body.comment.id);
    assert.equal(c.status, 201);
    assert.equal(c.body.comment.parentId, b.body.comment.id);

    // 非法父评论 400
    const bad = await post("回复不存在的", "no-such-comment");
    assert.equal(bad.status, 400);

    // 树结构：3 条
    const list = (await api(s, "/api/tasks")).body.tasks.find((x) => x.id === id).comments;
    assert.equal(list.length, 3);

    // 级联删除顶层 → 三条全删
    const del = await api(s, "/api/tasks/" + id + "/comments/" + aid, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(del.body.comments.length, 0);

    // 删除不存在的评论 404
    const noDel = await api(s, "/api/tasks/" + id + "/comments/nope", { method: "DELETE" });
    assert.equal(noDel.status, 404);
  } finally { await s.close(); }
});
