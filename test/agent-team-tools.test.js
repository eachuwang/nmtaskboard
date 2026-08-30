import test from "node:test";
import assert from "node:assert/strict";
import { confirmAgentAssignmentDraft, createAgentAssignmentDraft, readTeamProgress } from "../lib/agent-team-tools.js";

const admin = { actor: { id: "admin-1", displayName: "管理员" }, workspace: { id: "team-1", type: "team", role: "admin" } };
const member = { actor: { id: "member-1", displayName: "成员甲" }, workspace: { id: "team-1", type: "team", role: "member" } };
const parent = { id: "parent-1", title: "接口联调", taskType: "parent", status: "planned", dueDate: "2026-09-01", updatedAt: "2026-08-29T10:00:00.000Z", participants: [] };
const execution = { id: "execution-1", title: "接口联调", taskType: "execution", parentTaskId: "parent-1", status: "in_progress", assigneeIdentityId: "member-1", assignees: ["成员甲"], assignmentStatus: "active", history: [{ at: "2026-08-29T11:00:00.000Z" }] };
const members = [{ id: "member-1", displayName: "成员甲", role: "member" }, { id: "member-2", displayName: "成员乙", role: "member" }, { id: "admin-1", displayName: "管理员", role: "admin" }];

test("只有团队管理员能生成分派计划，计划明确成员、截止日期和执行卡影响", () => {
  assert.throws(() => createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["member-1"] }, [parent], members, member, "分派"), (error) => error.code === "AGENT_TEAM_MANAGEMENT_REQUIRED");
  const draft = createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["member-1", "member-2"] }, [parent, execution], members, admin, "分派接口联调");
  assert.deepEqual(draft.parent, { id: "parent-1", title: "接口联调", dueDate: "2026-09-01" });
  assert.deepEqual(draft.impact, { create: ["成员乙"], keep: ["成员甲"], remove: [] });
  assert.equal(draft.expectedUpdatedAt, parent.updatedAt);
});

test("确认分派会重新校验全局开关、权限、成员与版本，并把审计纳入事务", async () => {
  const draft = createAgentAssignmentDraft({ parentTaskId: "parent-1", memberIdentityIds: ["member-2"] }, [parent, execution], members, admin, "重新分派");
  let call = null;
  const ctx = { persistence: {
    tasks: {
      async load() { return [structuredClone(parent), structuredClone(execution)]; },
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

  ctx.persistence.auth.getAgentConfiguration = async () => ({ writeToolsEnabled: false });
  await assert.rejects(confirmAgentAssignmentDraft(ctx, admin, draft), (error) => error.code === "AGENT_WRITE_TOOLS_DISABLED");
});

test("团队进度只对管理员返回聚合与成员明细", async () => {
  const ctx = { persistence: { tasks: { async load() { return [parent, execution]; } } } };
  const progress = await readTeamProgress(ctx, admin);
  assert.equal(progress.aggregate.in_progress, 1);
  assert.equal(progress.tasks[0].participants[0].displayName, "成员甲");
  await assert.rejects(readTeamProgress(ctx, member), (error) => error.code === "AGENT_TEAM_MANAGEMENT_REQUIRED");
});
