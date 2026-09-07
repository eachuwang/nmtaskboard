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

test("子任务创建与编辑时始终继承父任务的项目归属", async () => {
  const s = await startServer();
  try {
    const projectA = (await json(s, "/api/projects", { method: "POST", body: JSON.stringify({ name: "项目A" }) })).body.project;
    const projectB = (await json(s, "/api/projects", { method: "POST", body: JSON.stringify({ name: "项目B" }) })).body.project;
    const parentRes = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "父任务", projectId: projectA.id }) });
    assert.equal(parentRes.status, 201);
    const parent = parentRes.body.task;
    assert.equal(parent.projectId, projectA.id);

    // 创建子任务不传 projectId：自动继承父任务项目
    const child1 = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "子任务1", parentTaskId: parent.id }) });
    assert.equal(child1.status, 201);
    assert.equal(child1.body.task.projectId, projectA.id);

    // 创建子任务显式传其他项目：仍被强制继承父任务项目
    const child2 = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "子任务2", parentTaskId: parent.id, projectId: projectB.id }) });
    assert.equal(child2.status, 201);
    assert.equal(child2.body.task.projectId, projectA.id);

    // 编辑子任务试图改到其他项目：服务端强制保持父任务项目
    const edited = await json(s, `/api/tasks/${child1.body.task.id}`, { method: "PUT", body: JSON.stringify({ projectId: projectB.id }) });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.task.projectId, projectA.id);

    // 批量创建子任务同样继承
    const batch = await json(s, "/api/tasks/batch", { method: "POST", body: JSON.stringify({ tasks: [{ title: "批量子任务", parentTaskId: parent.id }] }) });
    assert.equal(batch.status, 201);
    assert.equal(batch.body.tasks[0].projectId, projectA.id);
  } finally { await s.close(); }
});

test("无项目父任务的子任务不归属任何项目，普通任务不受影响", async () => {
  const s = await startServer();
  try {
    const project = (await json(s, "/api/projects", { method: "POST", body: JSON.stringify({ name: "项目" }) })).body.project;
    const parent = (await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "无项目父任务" }) })).body.task;

    const child = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "子任务", parentTaskId: parent.id, projectId: project.id }) });
    assert.equal(child.status, 201);
    assert.equal(child.body.task.projectId, null);

    // 非子任务仍可自由指定项目
    const standalone = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "普通任务", projectId: project.id }) });
    assert.equal(standalone.status, 201);
    assert.equal(standalone.body.task.projectId, project.id);
  } finally { await s.close(); }
});

test("子任务创建时默认继承父任务优先级，显式传入则尊重", async () => {
  const s = await startServer();
  try {
    const parentRes = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "高优父任务", priority: "high" }) });
    assert.equal(parentRes.status, 201);
    const parent = parentRes.body.task;

    // 不传优先级：默认继承父任务的 high
    const inherit = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "默认子任务", parentTaskId: parent.id }) });
    assert.equal(inherit.status, 201);
    assert.equal(inherit.body.task.priority, "high");

    // 显式传优先级：尊重客户端选择
    const explicit = await json(s, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "低优子任务", parentTaskId: parent.id, priority: "low" }) });
    assert.equal(explicit.status, 201);
    assert.equal(explicit.body.task.priority, "low");

    // 批量创建不传优先级同样继承
    const batch = await json(s, "/api/tasks/batch", { method: "POST", body: JSON.stringify({ tasks: [{ title: "批量子任务", parentTaskId: parent.id }] }) });
    assert.equal(batch.status, 201);
    assert.equal(batch.body.tasks[0].priority, "high");

    // 继承后仍可自由改优先级（只在创建时默认）
    const edited = await json(s, `/api/tasks/${inherit.body.task.id}`, { method: "PUT", body: JSON.stringify({ priority: "urgent" }) });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.task.priority, "urgent");
  } finally { await s.close(); }
});
