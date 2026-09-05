import crypto from "node:crypto";
import { appendAudit } from "./audit.js";
import { assertAgentWriteToolsEnabled } from "./agent-policy.js";
import { originAuditSummary } from "./agent-protocol.js";
import { projectTaskRelations, readableTasks, workspaceCapabilities } from "./permissions.js";

function agentError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function assertCollaborator(context) {
  if (!workspaceCapabilities(context).edit) {
    throw agentError("TASK_ACTION_FORBIDDEN", "当前角色不能在工作区指派任务", 403);
  }
}

export function assertTeamManager(context) {
  if (!workspaceCapabilities(context).manage) {
    throw agentError("AGENT_WORKSPACE_MANAGEMENT_REQUIRED", "仅工作区所有者或管理员可使用该 Agent 工具", 403);
  }
}

export function createAgentAssignmentDraft(raw, tasks, members, context, intent) {
  assertCollaborator(context);
  const parentTaskId = typeof (raw?.taskId || raw?.parentTaskId) === "string" ? (raw.taskId || raw.parentTaskId).trim() : "";
  const requestedIds = Array.isArray(raw?.memberIdentityIds) ? [...new Set(raw.memberIdentityIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))] : [];
  const parent = tasks.find((task) => task.id === parentTaskId && !task.deletedAt);
  if (!parent) throw agentError("AGENT_ASSIGNMENT_TASK_NOT_FOUND", "分派计划中的任务不存在", 404);
  const selectable = new Map(members.filter((member) => ["owner", "admin", "member"].includes(member.role)).map((member) => [member.id, member]));
  if (!requestedIds.length || requestedIds.some((id) => !selectable.has(id))) {
    throw agentError("AGENT_ASSIGNMENT_MEMBER_INVALID", "分派对象必须是当前工作区成员");
  }
  if (requestedIds.length > 1) throw agentError("AGENT_ASSIGNMENT_SINGLE_ASSIGNEE", "一个任务只能设置一个负责人");
  const currentIds = parent.assigneeIdentityId ? new Set([parent.assigneeIdentityId]) : new Set();
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
      remove: parent.assigneeIdentityId && !currentIds.has(parent.assigneeIdentityId) ? [parent.assigneeIdentityId] : []
    }
  };
}

export async function confirmAgentAssignmentDraft(ctx, context, draft) {
  try {
    assertCollaborator(context);
    await assertAgentWriteToolsEnabled(ctx);
    const tasks = await ctx.persistence.tasks.load(context);
    const parent = tasks.find((task) => task.id === draft.parent.id && !task.deletedAt);
    if (!parent || (parent.updatedAt || null) !== (draft.expectedUpdatedAt || null)) {
      throw agentError("AGENT_PLAN_STALE", "任务已被其他操作更新，请重新生成分派计划", 409);
    }
    const listed = await ctx.persistence.auth.listTeamMembers(context.actor.id, context.workspace.id);
    const allowedIds = new Set(listed.members.filter((member) => ["owner", "admin", "member"].includes(member.role)).map((member) => member.id));
    if (draft.members.some((member) => !allowedIds.has(member.id))) {
      throw agentError("AGENT_ASSIGNMENT_MEMBER_INVALID", "工作区成员已变化，请重新生成分派计划", 409);
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
  } catch (error) {
    await appendAudit(ctx.audit, {
      actor: context.actor,
      workspace: context.workspace,
      source: "agent",
      action: "agent.task_assign",
      target: { type: "task", id: draft.parent?.id || context.workspace.id },
      outcome: error.statusCode && error.statusCode < 500 ? "denied" : "failure",
      summary: originAuditSummary(draft, { code: error.code })
    }).catch(() => {});
    throw error;
  }
}

export async function readTeamProgress(ctx, context) {
  if (!workspaceCapabilities(context).report) {
    throw agentError("REPORT_FORBIDDEN", "当前空间无报告读取权限", 403);
  }
  const loaded = await ctx.persistence.tasks.load(context);
  const projected = projectTaskRelations(context, readableTasks(context, loaded));
  const parents = projected.filter((task) => !task.deletedAt).map((task) => ({
    id: task.id,
    title: task.title,
    dueDate: task.dueDate || null,
    status: task.status,
    assigneeIdentityId: task.assigneeIdentityId || null,
    parentTaskId: task.parentTaskId || null
  }));
  return {
    aggregate: parents.reduce((counts, task) => ({ ...counts, [task.status]: (counts[task.status] || 0) + 1 }), {}),
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
