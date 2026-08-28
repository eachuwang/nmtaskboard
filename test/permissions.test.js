import test from "node:test";
import assert from "node:assert/strict";
import { projectTaskRelations, taskAccess, workspaceCapabilities } from "../lib/permissions.js";

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
    read: true, edit: false, delete: false, changeStatus: true, addProgress: true, access: "own"
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
