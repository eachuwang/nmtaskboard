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

test("多负责人与成员级授予：创建、编辑、序列化与成员校验", async () => {
  const s = await startServer();
  try {
    // 数组负责人创建
    const created = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "多负责人任务", assigneeIdentityIds: ["local-user"] }) });
    assert.equal(created.status, 201);
    const id = created.body.task.id;
    assert.deepEqual(created.body.task.assigneeIdentityIds, ["local-user"]);
    assert.equal(created.body.task.assigneeIdentityId, "local-user");

    // 非法负责人：400
    const invalid = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityIds: ["ghost-user"] }) });
    assert.equal(invalid.status, 400);

    // 旧单值入参归一为数组
    const legacy = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityId: "" }) });
    assert.equal(legacy.status, 200);
    assert.deepEqual(legacy.body.task.assigneeIdentityIds, []);

    // 重新指派 + 设置授予（创建者）：序列化回显
    const assigned = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ assigneeIdentityIds: ["local-user"], memberGrants: { "local-user": { assign: true, edit: false } } }) });
    assert.equal(assigned.status, 200);
    assert.deepEqual(assigned.body.task.memberGrants, { "local-user": { assign: true, edit: false } });
    const list = await json(s, "/api/tasks");
    assert.deepEqual(list.body.tasks.find((task) => task.id === id).memberGrants, { "local-user": { assign: true, edit: false } });

    // 授予键按身份 id 生效（派生参与人无法在校验期预知集合，不做剔除）
    const scrubbed = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ memberGrants: { "ghost-user": { edit: true } } }) });
    assert.equal(scrubbed.status, 200);
    assert.deepEqual(scrubbed.body.task.memberGrants, { "ghost-user": { edit: true } });

    // 授予值只保留白名单能力
    const capped = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ memberGrants: { "local-user": { assign: true, delete: true, edit: "yes" } } }) });
    assert.equal(capped.status, 200);
    assert.deepEqual(capped.body.task.memberGrants, { "local-user": { assign: true } });

    // assign 端点支持数组整体替换
    const viaAssign = await json(s, `/api/tasks/${id}/assign`, { method: "POST", body: JSON.stringify({ identityIds: ["local-user"] }) });
    assert.equal(viaAssign.status, 200);
    assert.deepEqual(viaAssign.body.task.assigneeIdentityIds, ["local-user"]);
    const cleared = await json(s, `/api/tasks/${id}/assign`, { method: "POST", body: JSON.stringify({ identityIds: [] }) });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.task.assigneeIdentityIds, []);
  } finally {
    await s.close();
  }
});
