import crypto from "node:crypto";
import { appendAudit } from "./audit.js";
import { assertAgentWriteToolsEnabled } from "./agent-policy.js";
import { originAuditSummary } from "./agent-protocol.js";
import { projectTaskRelations, readableTasks, workspaceCapabilities } from "./permissions.js";

function agentError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

export function assertTeamManager(context) {
  if (context?.workspace?.type !== "team" || !workspaceCapabilities(context).manage) {
    throw agentError("AGENT_TEAM_MANAGEMENT_REQUIRED", "仅团队所有者或管理员可使用该 Agent 工具", 403);
  }
}

export function createAgentAssignmentDraft(raw, tasks, members, context, intent) {
  assertTeamManager(context);
  const parentTaskId = typeof raw?.parentTaskId === "string" ? raw.parentTaskId.trim() : "";
  const requestedIds = Array.isArray(raw?.memberIdentityIds) ? [...new Set(raw.memberIdentityIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))] : [];
  const parent = tasks.find((task) => task.id === parentTaskId && task.taskType === "parent" && !task.deletedAt);
  if (!parent) throw agentError("AGENT_ASSIGNMENT_PARENT_NOT_FOUND", "分派计划中的团队父任务不存在", 404);
  const selectable = new Map(members.filter((member) => member.role === "member").map((member) => [member.id, member]));
  if (!requestedIds.length || requestedIds.some((id) => !selectable.has(id))) {
    throw agentError("AGENT_ASSIGNMENT_MEMBER_INVALID", "分派对象必须是当前团队的普通成员");
  }
  const active = tasks.filter((task) => task.taskType === "execution" && task.parentTaskId === parent.id && task.assignmentStatus !== "removed" && task.assigneeIdentityId);
  const currentIds = new Set(active.map((task) => task.assigneeIdentityId));
  const desiredIds = new Set(requestedIds);
  const selectedMembers = requestedIds.map((id) => ({ id, displayName: selectable.get(id).displayName }));
  return {
    id: crypto.randomUUID(),
    intent,
    status: "pending",
    atomic: true,
    parent: { id: parent.id, title: parent.title, dueDate: parent.dueDate || null },
    members: selectedMembers,
    expectedUpdatedAt: parent.updatedAt || null,
    impact: {
      create: selectedMembers.filter((member) => !currentIds.has(member.id)).map((member) => member.displayName),
      keep: selectedMembers.filter((member) => currentIds.has(member.id)).map((member) => member.displayName),
      remove: active.filter((task) => !desiredIds.has(task.assigneeIdentityId)).map((task) => task.assignees?.[0] || task.assigneeIdentityId)
    }
  };
}

export async function confirmAgentAssignmentDraft(ctx, context, draft) {
  assertTeamManager(context);
  await assertAgentWriteToolsEnabled(ctx);
  const tasks = await ctx.persistence.tasks.load(context);
  const parent = tasks.find((task) => task.id === draft.parent.id && task.taskType === "parent" && !task.deletedAt);
  if (!parent || (parent.updatedAt || null) !== (draft.expectedUpdatedAt || null)) {
    throw agentError("AGENT_PLAN_STALE", "任务已被其他操作更新，请重新生成分派计划", 409);
  }
  const listed = await ctx.persistence.auth.listTeamMembers(context.actor.id, context.workspace.id);
  const allowedIds = new Set(listed.members.filter((member) => member.role === "member").map((member) => member.id));
  if (draft.members.some((member) => !allowedIds.has(member.id))) {
    throw agentError("AGENT_ASSIGNMENT_MEMBER_INVALID", "团队成员已变化，请重新生成分派计划", 409);
  }
  const auditEvent = {
    actor: context.actor,
    workspace: context.workspace,
    source: "agent",
    action: "agent.task_assign",
    target: { type: "task", id: parent.id },
    outcome: "success",
    summary: originAuditSummary(draft, { count: draft.members.length })
  };
  const result = await ctx.persistence.tasks.assign(
    context,
    parent.id,
    draft.members.map((member) => member.id),
    "agent",
    draft.expectedUpdatedAt,
    auditEvent
  );
  return {
    atomic: true,
    parent: { id: result.parent.id, title: result.parent.title, dueDate: result.parent.dueDate || null },
    members: draft.members,
    createdCount: result.createdCount,
    removedCount: result.removedCount
  };
}

export async function readTeamProgress(ctx, context) {
  assertTeamManager(context);
  const loaded = await ctx.persistence.tasks.load(context);
  const projected = projectTaskRelations(context, readableTasks(context, loaded));
  const parents = projected.filter((task) => task.taskType === "parent" && !task.deletedAt).map((task) => ({
    id: task.id,
    title: task.title,
    dueDate: task.dueDate || null,
    aggregateStatus: task.aggregateStatus,
    aggregateUpdatedAt: task.aggregateUpdatedAt || null,
    participants: task.participantSummary || []
  }));
  return {
    aggregate: parents.reduce((counts, task) => ({ ...counts, [task.aggregateStatus]: (counts[task.aggregateStatus] || 0) + 1 }), {}),
    tasks: parents
  };
}

export async function auditTeamTool(ctx, context, tool, outcome, summary = {}) {
  await appendAudit(ctx.audit, {
    actor: context.actor,
    workspace: context.workspace,
    source: "agent",
    action: `agent.tool.${tool}`,
    target: { type: "workspace", id: context.workspace.id },
    outcome,
    summary
  });
}
