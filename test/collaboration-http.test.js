import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { deliverNotification } from "../lib/notifications.js";

const api = async (server, path, opts = {}) => {
  const response = await fetch(server.baseUrl + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
};

test("附件只保存元数据，对象存储内容可下载且删除后不可再取", async () => {
  const server = await startServer();
  try {
    const created = await api(server, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "附件卡" }) });
    const uploaded = await api(server, `/api/tasks/${created.body.task.id}/attachments`, {
      method: "POST",
      body: JSON.stringify({ filename: "note.txt", contentType: "text/plain", content: Buffer.from("hello").toString("base64") })
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.attachment.filename, "note.txt");
    assert.equal(uploaded.body.attachment.objectKey, undefined);
    const download = await fetch(server.baseUrl + `/api/attachments/${uploaded.body.attachment.id}`);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), "hello");
    assert.equal((await api(server, `/api/attachments/${uploaded.body.attachment.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(server.baseUrl + `/api/attachments/${uploaded.body.attachment.id}`)).status, 404);
  } finally { await server.close(); }
});

test("通知可耐久创建、已读、归档，重连后仍能读取未读项", async () => {
  const server = await startServer();
  try {
    const context = server.app.locals.application.resolveRequestContext({ body: {} });
    await deliverNotification(server.app.locals.application.persistence, {
      context: { ...context, actor: { id: "someone-else", displayName: "他人" } },
      recipientId: context.actor.id,
      category: "assignment",
      entityType: "task",
      entityId: "task-1",
      payload: { title: "协作上线", body: "已分派给你" }
    });
    const listed = await api(server, "/api/notifications");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.notifications.length, 1);
    assert.equal(listed.body.notifications[0].readAt, null);
    const read = await api(server, `/api/notifications/${listed.body.notifications[0].id}/read`, { method: "POST" });
    assert.equal(read.status, 200);
    assert.ok(read.body.notification.readAt);
    const archived = await api(server, `/api/notifications/${listed.body.notifications[0].id}/archive`, { method: "POST" });
    assert.equal(archived.status, 200);
    assert.ok(archived.body.notification.archivedAt);
    const afterReconnect = await api(server, "/api/notifications");
    assert.equal(afterReconnect.body.notifications[0].archivedAt != null, true);
  } finally { await server.close(); }
});

test("任意深度父任务循环会被拒绝", async () => {
  const server = await startServer();
  try {
    const parent = await api(server, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "父" }) });
    const child = await api(server, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "子", parentTaskId: parent.body.task.id }) });
    const grandchild = await api(server, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "孙", parentTaskId: child.body.task.id }) });
    const cycle = await api(server, `/api/tasks/${parent.body.task.id}`, {
      method: "PUT",
      body: JSON.stringify({ parentTaskId: grandchild.body.task.id })
    });
    assert.equal(cycle.status, 400);
  } finally { await server.close(); }
});
