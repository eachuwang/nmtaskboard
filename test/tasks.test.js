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

test("转移所有权：旧所有者默认退出负责人，显式保留除外", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { createApp } = await import("../server.js");
  const { loadConfig } = await import("../lib/config.js");
  const { createJsonPersistence } = await import("../lib/persistence.js");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tb-transfer-"));
  const dataDir = path.join(parent, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const config = loadConfig({ PORT: "0", HOST: "127.0.0.1", DATA_DIR: dataDir, CONFIG_FILE: path.join(dataDir, "config.json") });
  const base = createJsonPersistence(config);
  // 注入双成员目录：local-user（本机身份=创建者/所有者）与 member-b
  const persistence = { ...base, auth: { listWorkspaceMembers: async () => [
    { id: "local-user", displayName: "我", role: "owner" },
    { id: "member-b", displayName: "成员乙", role: "member" }
  ] } };
  const app = await createApp(config, { auth: false, log: () => {}, persistence });
  const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const json = async (p, options = {}) => {
    const response = await fetch(baseUrl + p, { headers: { "Content-Type": "application/json" }, ...options });
    return { status: response.status, body: await response.json() };
  };
  try {
    const created = await json("/api/tasks", { method: "POST", body: JSON.stringify({ title: "转移测试任务", assigneeIdentityIds: ["local-user", "member-b"] }) });
    assert.equal(created.status, 201);
    const taskId = created.body.task.id;

    // 转移所有权给成员乙（不带负责人列表）→ 旧所有者自动移出负责人
    const transfer = await json(`/api/tasks/${taskId}`, { method: "PUT", body: JSON.stringify({ ownerIdentityId: "member-b" }) });
    assert.equal(transfer.status, 200);
    assert.equal(transfer.body.task.ownerIdentityId, "member-b");
    assert.deepEqual(transfer.body.task.assigneeIdentityIds, ["member-b"]);
    const transferEntry = transfer.body.task.history.at(-1);
    assert.equal(transferEntry.action, "owner_transferred");
    assert.equal(transferEntry.exitedOwner, true);

    // 「默认不参与」的权限边界：转移并退出后，旧所有者不再是所有者/负责人，无权再改负责人
    const outsider = await json(`/api/tasks/${taskId}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityIds: [] }) });
    assert.equal(outsider.status, 403);

    // 显式保留：转移时负责人列表明确包含旧所有者 → 不移出
    const kept = await json("/api/tasks", { method: "POST", body: JSON.stringify({ title: "显式保留任务", assigneeIdentityIds: ["local-user", "member-b"] }) });
    const keep = await json(`/api/tasks/${kept.body.task.id}`, { method: "PUT", body: JSON.stringify({ ownerIdentityId: "member-b", assigneeIdentityIds: ["local-user", "member-b"] }) });
    assert.equal(keep.status, 200);
    assert.equal(keep.body.task.ownerIdentityId, "member-b");
    assert.deepEqual(keep.body.task.assigneeIdentityIds.slice().sort(), ["local-user", "member-b"].sort());
    assert.equal(keep.body.task.history.at(-1).exitedOwner, undefined);

    // 取消指派对所有者对称可用：清空全部负责人 → 200
    const clear = await json(`/api/tasks/${taskId}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityIds: ["local-user"] }) }).catch(() => null);
    const mine = await json("/api/tasks", { method: "POST", body: JSON.stringify({ title: "清空指派任务", assigneeIdentityIds: ["local-user"] }) });
    const emptied = await json(`/api/tasks/${mine.body.task.id}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityIds: [] }) });
    assert.equal(emptied.status, 200);
    assert.deepEqual(emptied.body.task.assigneeIdentityIds, []);
    void clear;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await persistence.close?.();
  }
});
