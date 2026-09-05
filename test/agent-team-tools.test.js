import test from "node:test";
import assert from "node:assert/strict";
import { confirmAgentAssignmentDraft, createAgentAssignmentDraft, readTeamProgress } from "../lib/agent-team-tools.js";

const admin = { actor: { id: "admin-1", displayName: "管理员" }, workspace: { id: "team-1", type: "workspace", role: "admin" } };
const member = { actor: { id: "member-1", displayName: "成员甲" }, workspace: { id: "team-1", type: "workspace", role: "member" } };
const parent = { id: "parent-1", title: "接口联调", status: "backlog", dueDate: "2026-09-01", updatedAt: "2026-08-29T10:00:00.000Z" };
const child = { id: "child-1", title: "接口联调", parentTaskId: "parent-1", status: "in_progress", assigneeIdentityId: "member-1", history: [{ at: "2026-08-29T11:00:00.000Z" }] };
const members = [{ id: "member-1", displayName: "成员甲", role: "member" }, { id: "member-2", displayName: "成员乙", role: "member" }, { id: "admin-1", displayName: "管理员", role: "admin" }];

test("活跃成员都能生成单负责人分派计划，管理员也可分派给自己", () => {
  const draft = createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["member-1"] }, [parent], members, member, "分派");
  assert.deepEqual(draft.parent, { id: "parent-1", title: "接口联调", dueDate: "2026-09-01" });
  assert.deepEqual(draft.members, [{ id: "member-1", displayName: "成员甲" }]);
  assert.throws(
    () => createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["member-1", "member-2"] }, [parent, child], members, admin, "分派接口联调"),
    (error) => error.code === "AGENT_ASSIGNMENT_SINGLE_ASSIGNEE"
  );
  const adminDraft = createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["admin-1"] }, [parent, child], members, admin, "管理员自分派");
  assert.deepEqual(adminDraft.members, [{ id: "admin-1", displayName: "管理员" }]);
});

test("确认分派会重新校验全局开关、成员与版本，并把审计纳入事务", async () => {
  const draft = createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["member-2"] }, [parent, child], members, admin, "重新分派");
  let call = null;
  const ctx = { persistence: {
    tasks: {
      async load() { return [structuredClone(parent), structuredClone(child)]; },
      async assign(...args) { call = args; return { parent, executions: [], removedExecutions: [], createdCount: 1, removedCount: 1 }; }
    },
    auth: {
      async getAgentConfiguration() { return { writeToolsEnabled: true }; },
      async listTeamMembers() { return { members }; }
    }
  } };
  const result = await confirmAgentAssignmentDraft(ctx, admin, draft);
  assert.equal(result.createdCount, 1);
  assert.deepEqual(call.slice(1, 5), ["parent-1", ["member-2"], "agent", parent.updatedAt]);
  assert.equal(call[5].action, "agent.task_assign");

  const adminDraft = createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["admin-1"] }, [parent, child], members, admin, "管理员自分派");
  await confirmAgentAssignmentDraft(ctx, admin, adminDraft);
  assert.deepEqual(call.slice(1, 3), ["parent-1", ["admin-1"]]);

  ctx.persistence.auth.getAgentConfiguration = async () => ({ writeToolsEnabled: false });
  await assert.rejects(confirmAgentAssignmentDraft(ctx, admin, draft), (error) => error.code === "AGENT_WRITE_TOOLS_DISABLED");
});

test("工作区进度对所有活跃成员返回聚合", async () => {
  const ctx = { persistence: { tasks: { async load() { return [parent, child]; } } } };
  const progress = await readTeamProgress(ctx, admin);
  assert.equal(progress.aggregate.in_progress, 1);
  const memberProgress = await readTeamProgress(ctx, member);
  assert.equal(memberProgress.tasks.length, 2);
});
