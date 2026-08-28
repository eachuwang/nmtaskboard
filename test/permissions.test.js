import test from "node:test";
import assert from "node:assert/strict";
import { aggregateExecutionStatus, latestExecutionActivity, progressRecordsForViewer, projectTaskRelations, taskAccess, workspaceCapabilities } from "../lib/permissions.js";

const context = (role, visibilityScope = "assigned", operationScope = "assigned") => ({
  actor: { id: "member-a" },
  workspace: { type: "team", role, visibilityScope, operationScope }
});
const execution = (assigneeIdentityId, status = "in_progress") => ({ taskType: "execution", assigneeIdentityId, status });

test("团队权限矩阵区分管理、自有执行任务、可见只读与隐藏任务", () => {
  assert.equal(workspaceCapabilities(context("owner")).manage, true);
  assert.equal(workspaceCapabilities(context("admin")).create, true);
  assert.equal(workspaceCapabilities(context("member")).manage, false);

  assert.deepEqual(taskAccess(context("member"), execution("member-a")), {
    read: true, edit: false, delete: false, changeStatus: true, addProgress: true, requestCancellation: true, access: "own"
  });
  assert.equal(taskAccess(context("member"), execution("member-b")).access, "hidden");
  assert.equal(taskAccess(context("member", "team"), execution("member-b")).access, "readonly");
  assert.equal(taskAccess(context("member", "team"), execution("member-b")).changeStatus, false);
  assert.equal(taskAccess(context("member", "team", "none"), execution("member-a")).changeStatus, false);
  assert.equal(taskAccess(context("member"), execution("member-a", "planned")).changeStatus, false);
  assert.equal(taskAccess(context("member"), execution("member-a", "cancelled")).changeStatus, false);
  assert.equal(taskAccess(context("member"), execution("member-a", "planned")).access, "readonly");
  assert.equal(taskAccess(context("member"), execution("member-a", "cancelled")).addProgress, false);
});

test("软删除任务对任何普通看板视图都不可见", () => {
  const deleted = { ...execution("member-a"), deletedAt: "2026-08-28T08:00:00.000Z" };
  assert.equal(taskAccess(context("owner"), deleted).access, "hidden");
  assert.equal(taskAccess(context("member"), deleted).read, false);
});

test("团队任务投影标注当前用户关系并限制成员状态摘要到可见任务", () => {
  const teamContext = context("member", "team");
  const tasks = projectTaskRelations(teamContext, [
    { id: "parent-1", taskType: "parent", status: "planned", participants: [{ identityId: "member-a", displayName: "成员甲", status: "todo" }] },
    { id: "execution-a", taskType: "execution", parentTaskId: "parent-1", assigneeIdentityId: "member-a", assignees: ["成员甲"], status: "in_progress" },
    { id: "execution-b", taskType: "execution", parentTaskId: "parent-1", assigneeIdentityId: "member-b", assignees: ["成员乙"], status: "todo" }
  ]);

  assert.equal(tasks[0].memberRelation, "participant");
  assert.equal(tasks[1].memberRelation, "responsible");
  assert.equal(tasks[2].memberRelation, "readonly");
  assert.deepEqual(tasks[1].participantSummary.map(({ identityId, status, isViewer }) => ({ identityId, status, isViewer })), [
    { identityId: "member-a", status: "in_progress", isViewer: true },
    { identityId: "member-b", status: "todo", isViewer: false }
  ]);

  const assignedOnly = projectTaskRelations(context("member"), [tasks[1]]);
  assert.deepEqual(assignedOnly[0].participantSummary.map(({ identityId }) => identityId), ["member-a"]);
  assert.equal(projectTaskRelations(context("admin", "team"), [tasks[2]])[0].memberRelation, null);
});

test("父任务聚合状态优先暴露阻塞与进行中，并按最新轨迹时间更新", () => {
  const executions = [
    { id: "execution-done", taskType: "execution", parentTaskId: "parent-1", assigneeIdentityId: "member-c", status: "done", history: [{ at: "2026-08-28T08:00:00+08:00" }] },
    { id: "execution-blocked", taskType: "execution", parentTaskId: "parent-1", assigneeIdentityId: "member-b", status: "blocked", history: [{ at: "2026-08-28T09:00:00+08:00" }] },
    { id: "execution-progress", taskType: "execution", parentTaskId: "parent-1", assigneeIdentityId: "member-a", status: "in_progress", history: [{ at: "2026-08-28T10:00:00+08:00" }] }
  ];
  assert.equal(aggregateExecutionStatus(executions), "blocked");
  assert.equal(aggregateExecutionStatus([...executions].reverse()), "blocked");
  assert.equal(latestExecutionActivity(executions), "2026-08-28T02:00:00.000Z");

  const projected = projectTaskRelations(context("admin", "team"), [
    { id: "parent-1", taskType: "parent", status: "planned", participants: [] },
    ...executions
  ]);
  assert.equal(projected[0].status, "planned");
  assert.equal(projected[0].aggregateStatus, "blocked");
  assert.equal(projected[0].aggregateUpdatedAt, "2026-08-28T02:00:00.000Z");
  assert.deepEqual(projected[0].participantSummary.map(({ identityId, status }) => ({ identityId, status })), [
    { identityId: "member-c", status: "done" },
    { identityId: "member-b", status: "blocked" },
    { identityId: "member-a", status: "in_progress" }
  ]);
  assert.equal(aggregateExecutionStatus([{ status: "done" }, { status: "cancelled" }]), "done");
  assert.equal(aggregateExecutionStatus([{ status: "cancelled" }, { status: "cancelled" }]), "cancelled");
  assert.equal(aggregateExecutionStatus([]), "planned");
});

test("团队成员只能在报告与详情中看到自己的进展记录", () => {
  const task = {
    comments: [],
    progressRecords: [
      { id: "mine", text: "我的记录", author: "成员甲", authorIdentityId: "member-a" },
      { id: "peer", text: "他人的记录", author: "成员乙", authorIdentityId: "member-b" }
    ]
  };
  assert.deepEqual(progressRecordsForViewer(context("member", "team"), task).map(({ id }) => id), ["mine"]);
  assert.deepEqual(progressRecordsForViewer(context("admin", "team"), task).map(({ id }) => id), ["mine", "peer"]);
});
