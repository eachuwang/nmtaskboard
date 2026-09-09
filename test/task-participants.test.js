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

test("参与人派生：来自本任务子树的负责人，展示与权限同口径", async () => {
  const s = await startServer();
  try {
    // 父任务（无负责人）+ 两个子任务：一个分配给 local-user，一个未分派
    const parent = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "父任务" }) });
    const parentId = parent.body.task.id;
    const child = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "子任务A", parentTaskId: parentId, assigneeIdentityIds: ["local-user"] }) });
    assert.equal(child.status, 201);
    await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "子任务B", parentTaskId: parentId }) });

    // 父任务的参与人 = 子树负责人（含显示名）；本任务负责人被排除
    const detail = await json(s, "/api/tasks");
    const parentDetail = detail.body.tasks.find((task) => task.id === parentId);
    assert.deepEqual(parentDetail.participantIdentityIds, ["local-user"]);
    assert.equal(parentDetail.participantDisplayNames.length, 1);

    // 显式写入 participantIdentityIds 已被忽略（不再是显式字段）
    const ignored = await json(s, `/api/tasks/${parentId}`, { method: "PUT", body: JSON.stringify({ participantIdentityIds: ["ghost-user"] }) });
    assert.equal(ignored.status, 200);
    assert.deepEqual(ignored.body.task.participantIdentityIds, ["local-user"]);

    // 孙任务负责人同样计入（任意深度）：先移除子任务 A 的负责人，靠孙任务仍派生出 local-user
    await json(s, `/api/tasks/${child.body.task.id}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityIds: [] }) });
    await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "孙任务", parentTaskId: child.body.task.id, assigneeIdentityIds: ["local-user"] }) });
    const again = await json(s, "/api/tasks");
    assert.deepEqual(again.body.tasks.find((task) => task.id === parentId).participantIdentityIds, ["local-user"]);

    // 本任务负责人不计入参与人：把父任务也分给 local-user 后，参与人变空
    const own = await json(s, `/api/tasks/${parentId}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityIds: ["local-user"] }) });
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.task.participantIdentityIds, []);
  } finally {
    await s.close();
  }
});
