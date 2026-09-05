import test from "node:test";
import assert from "node:assert/strict";
import { progressRecordsForViewer, projectTaskRelations, taskAccess, workspaceCapabilities } from "../lib/permissions.js";

  const context = (role = "member") => ({
  actor: { id: "member-a" },
  workspace: { id: "ws-1", type: "workspace", role }
});
const task = (assigneeIdentityId, extras = {}) => ({ assigneeIdentityId, status: "in_progress", ...extras });

test("工作区权限矩阵：角色只限制管理，活跃成员都能协作", () => {
  assert.equal(workspaceCapabilities(context("owner")).manage, true);
  assert.equal(workspaceCapabilities(context("admin")).create, true);
  assert.equal(workspaceCapabilities(context("member")).manage, false);
  assert.equal(workspaceCapabilities(context("member")).create, true);
  assert.equal(workspaceCapabilities(context("member")).edit, true);
  assert.equal(workspaceCapabilities(context("member")).delete, true);

  // 无创建者标识的历史任务：不锁定，保持旧行为
  assert.deepEqual(taskAccess(context("member"), task("member-a")), {
    read: true, edit: true, delete: true, changeStatus: true, addProgress: true, assign: true, createSubtask: true, access: "own"
  });
  // 有创建者标识的任务：创建者全权；负责人可改状态/评论；其他成员只读
  const owned = task("member-a", { creatorIdentityId: "creator-1" });
  const asCreator = taskAccess({ ...context("member"), actor: { id: "creator-1" } }, owned);
  assert.deepEqual(asCreator, {
    read: true, edit: true, delete: true, changeStatus: true, addProgress: true, assign: true, createSubtask: true, access: "workspace"
  });
  const asAssignee = taskAccess(context("member"), owned); // member-a 是负责人
  assert.deepEqual(asAssignee, {
    read: true, edit: false, delete: false, changeStatus: true, addProgress: true, assign: false, createSubtask: false, access: "own"
  });
  const asOther = taskAccess(context("member"), task("member-b", { creatorIdentityId: "creator-1" }));
  assert.deepEqual(asOther, {
    read: true, edit: false, delete: false, changeStatus: false, addProgress: false, assign: false, createSubtask: false, access: "workspace"
  });
});

test("软删除任务对任何普通看板视图都不可见", () => {
  const deleted = { ...task("member-a"), deletedAt: "2026-08-28T08:00:00.000Z" };
  assert.equal(taskAccess(context("owner"), deleted).access, "hidden");
  assert.equal(taskAccess(context("member"), deleted).read, false);
});

test("任务投影标注当前用户关系，不聚合父子状态", () => {
  const tasks = projectTaskRelations(context("member"), [
    { id: "parent-1", status: "backlog", assigneeIdentityId: null },
    { id: "child-a", parentTaskId: "parent-1", assigneeIdentityId: "member-a", status: "in_progress" },
    { id: "child-b", parentTaskId: "parent-1", assigneeIdentityId: "member-b", status: "todo" }
  ]);

  assert.equal(tasks[0].memberRelation, "unassigned");
  assert.equal(tasks[1].memberRelation, "responsible");
  assert.equal(tasks[2].memberRelation, "assigned");
  assert.equal(tasks[0].aggregateStatus, undefined);
});

test("可读任务的进展记录对所有成员可见", () => {
  const item = {
    comments: [],
    progressRecords: [
      { id: "mine", text: "我的记录", author: "成员甲", authorIdentityId: "member-a" },
      { id: "peer", text: "他人的记录", author: "成员乙", authorIdentityId: "member-b" }
    ]
  };
  assert.deepEqual(progressRecordsForViewer(context("member"), item).map(({ id }) => id), ["mine", "peer"]);
});
