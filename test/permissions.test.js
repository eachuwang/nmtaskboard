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
  // 有创建者标识的任务：创建者全权；负责人可管理（编辑）但删除仍归创建者；其他成员只读
  const owned = task("member-a", { creatorIdentityId: "creator-1" });
  const asCreator = taskAccess({ ...context("member"), actor: { id: "creator-1" } }, owned);
  assert.deepEqual(asCreator, {
    read: true, edit: true, delete: true, changeStatus: true, addProgress: true, assign: true, createSubtask: true, access: "workspace"
  });
  const asAssignee = taskAccess(context("member"), owned); // member-a 是负责人：可管理与评论，删除仍归创建者；能编辑即可建子任务
  assert.deepEqual(asAssignee, {
    read: true, edit: true, delete: false, changeStatus: true, addProgress: true, assign: false, createSubtask: true, access: "own"
  });
  const asParticipant = taskAccess(context("member"), task("member-a", { creatorIdentityId: "creator-1", participantIdentityIds: ["member-a"] }));
  assert.deepEqual(asParticipant, {
    read: true, edit: true, delete: false, changeStatus: true, addProgress: true, assign: false, createSubtask: true, access: "own"
  });
  const asParticipantOnly = taskAccess(context("member"), task("member-c", { creatorIdentityId: "creator-1", participantIdentityIds: ["member-a"] }));
  assert.deepEqual(asParticipantOnly, {
    read: true, edit: false, delete: false, changeStatus: true, addProgress: true, assign: false, createSubtask: false, access: "workspace"
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

test("成员级授予：默认值按角色，创建者可按成员覆盖", () => {
  const base = { creatorIdentityId: "creator-1", assigneeIdentityIds: ["member-a"], participantIdentityIds: ["member-b"] };
  // 默认：负责人可编辑+评论不可指派；参与人仅评论
  assert.equal(taskAccess(context("member"), base).assign, false);
  assert.equal(taskAccess(context("member"), base).edit, true);
  assert.equal(taskAccess(context("member"), base).addProgress, true);
  const participantView = taskAccess({ ...context("member"), actor: { id: "member-b" } }, base);
  assert.deepEqual([participantView.edit, participantView.assign, participantView.addProgress], [false, false, true]);
  // 授予参与人编辑与指派
  const granted = { ...base, memberGrants: { "member-b": { edit: true, assign: true } } };
  const promoted = taskAccess({ ...context("member"), actor: { id: "member-b" } }, granted);
  assert.deepEqual([promoted.edit, promoted.assign, promoted.addProgress], [true, true, true]);
  // 收回负责人的编辑与评论
  const revoked = { ...base, memberGrants: { "member-a": { edit: false, comment: false } } };
  const demoted = taskAccess(context("member"), revoked);
  assert.deepEqual([demoted.edit, demoted.addProgress, demoted.changeStatus], [false, false, true]);
  // 授予只影响被授予者；状态变更仍按角色资格，不受授予影响
  const outsider = taskAccess({ ...context("member"), actor: { id: "member-c" } }, granted);
  assert.deepEqual([outsider.read, outsider.edit, outsider.changeStatus, outsider.addProgress], [true, false, false, false]);
});

test("能编辑卡片的成员即可创建其子任务（负责人默认可，参与人授予编辑后可）", () => {
  const base = { creatorIdentityId: "creator-1", assigneeIdentityIds: ["member-a"], participantIdentityIds: ["member-b"] };
  assert.equal(taskAccess(context("member"), base).createSubtask, true); // 负责人
  assert.equal(taskAccess({ ...context("member"), actor: { id: "member-b" } }, base).createSubtask, false); // 参与人默认不可
  const granted = { ...base, memberGrants: { "member-b": { edit: true } } };
  assert.equal(taskAccess({ ...context("member"), actor: { id: "member-b" } }, granted).createSubtask, true); // 授予编辑后可
  const revoked = { ...base, memberGrants: { "member-a": { edit: false } } };
  assert.equal(taskAccess(context("member"), revoked).createSubtask, false); // 收回编辑即收回建子任务
});
