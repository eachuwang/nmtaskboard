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

test("任务参与人：可添加、校验成员身份、可移除并随序列化下发", async () => {
  const s = await startServer();
  try {
    const created = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "参与人测试任务" }) });
    assert.equal(created.status, 201);
    const id = created.body.task.id;
    assert.deepEqual(created.body.task.participantIdentityIds, []);

    // 非工作区成员：400
    const invalid = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ participantIdentityIds: ["ghost-user"] }) });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "TASK_PARTICIPANT_INVALID");

    // 合法成员（免鉴权模式下唯一成员为 local-user）：200 并回显显示名
    const added = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ participantIdentityIds: ["local-user"] }) });
    assert.equal(added.status, 200);
    assert.deepEqual(added.body.task.participantIdentityIds, ["local-user"]);
    assert.ok(Array.isArray(added.body.task.participantDisplayNames));
    assert.equal(added.body.task.participantDisplayNames.length, 1);

    // 列表序列化同样携带
    const list = await json(s, "/api/tasks");
    const found = list.body.tasks.find((task) => task.id === id);
    assert.deepEqual(found.participantIdentityIds, ["local-user"]);

    // 清空
    const cleared = await json(s, `/api/tasks/${id}`, { method: "PUT", body: JSON.stringify({ participantIdentityIds: [] }) });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.task.participantIdentityIds, []);
  } finally { await s.close(); }
});
