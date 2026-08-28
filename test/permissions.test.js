import test from "node:test";
import assert from "node:assert/strict";
import { taskAccess, workspaceCapabilities } from "../lib/permissions.js";

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
});
