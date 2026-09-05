import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStatusTransition, createComment, createTask, mentionedIdentityIds, projectProgress,
  toggleCommentReaction, validateTaskParent, STATUSES, PRIORITIES
} from "../lib/tasks.js";
import { taskAccess, workspaceCapabilities } from "../lib/permissions.js";

const context = (role = "member", id = "member-1") => ({
  actor: { id, displayName: id }, workspace: { id: "workspace-1", role }
});

test("issue uses Multica status and priority vocabulary", () => {
  assert.deepEqual(STATUSES, ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"]);
  assert.deepEqual(PRIORITIES, ["urgent", "high", "medium", "low", "none"]);
  const task = createTask({ title: "设计项目", assigneeIdentityId: "member-1" }, [], "成员");
  assert.equal(task.status, "todo"); // 有负责人直接进待办；无负责人才是待整理
  assert.equal(createTask({ title: "未分派" }, [], "成员").status, "backlog");
  assert.equal(task.priority, "none");
  assert.equal(task.assigneeIdentityId, "member-1");
  assert.equal(task.taskType, undefined);
});

test("status transitions are direct and do not require a reason", () => {
  const task = createTask({ title: "直接关闭", status: "backlog" }, [], "成员");
  applyStatusTransition(task, "done", { actor: "成员" });
  assert.equal(task.status, "done");
  assert.equal(task.history.at(-1).toStatus, "done");
});

test("child task inherits project once and parent status stays independent", () => {
  const parent = createTask({ id: "parent", title: "父任务", projectId: "project-1", status: "in_progress" }, [], "成员");
  const child = createTask({ id: "child", title: "子任务", parentTaskId: parent.id }, [parent], "成员");
  assert.equal(child.projectId, "project-1");
  applyStatusTransition(child, "done");
  assert.equal(parent.status, "in_progress");
});

test("parent validation rejects arbitrary-depth cycles", () => {
  const tasks = [
    { id: "a", parentTaskId: "b" },
    { id: "b", parentTaskId: "c" },
    { id: "c", parentTaskId: null }
  ];
  assert.throws(() => validateTaskParent(tasks, "c", "a"), /循环/);
  assert.throws(() => validateTaskParent(tasks, "a", "a"), /自己/);
});

test("project progress counts done and cancelled tasks", () => {
  assert.equal(projectProgress([
    { projectId: "p", status: "done" },
    { projectId: "p", status: "cancelled" },
    { projectId: "p", status: "todo" }
  ], "p"), 67);
});

test("member and admin share ordinary task permissions", () => {
  const task = { id: "task", assigneeIdentityId: "admin-1" };
  assert.equal(taskAccess(context("member"), task).edit, true);
  assert.equal(taskAccess(context("member"), task).delete, true);
  assert.equal(taskAccess(context("member"), task).changeStatus, true);
  assert.equal(taskAccess(context("admin", "admin-1"), task).access, "own");
  assert.equal(workspaceCapabilities(context("member")).manage, false);
  assert.equal(workspaceCapabilities(context("member")).create, true);
});

test("comments and progress updates share one stream", () => {
  const task = createTask({ title: "讨论" }, [], "成员");
  const root = createComment(task, "结论", "成员");
  const reply = createComment(task, "收到", "成员", root.id);
  assert.equal(task.comments.length, 2);
  assert.equal(reply.parentId, root.id);
});

test("mentions resolve workspace member display names", () => {
  const ids = mentionedIdentityIds("请 @成员甲 和 @未知 确认", [
    { id: "member-a", displayName: "成员甲" },
    { id: "member-b", displayName: "成员乙" }
  ]);
  assert.deepEqual(ids, ["member-a"]);
});

test("comment reactions toggle the acting identity", () => {
  const task = createTask({ title: "讨论" }, [], "成员");
  const comment = createComment(task, "收到", "成员");
  toggleCommentReaction(comment, "👍", "member-a");
  toggleCommentReaction(comment, "👍", "member-b");
  toggleCommentReaction(comment, "👍", "member-a");
  assert.deepEqual(comment.reactions["👍"], ["member-b"]);
});
