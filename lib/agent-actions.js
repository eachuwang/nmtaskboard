import crypto from "node:crypto";
import { appendAudit } from "./audit.js";
import { assertAgentWriteToolsEnabled } from "./agent-policy.js";
import { originAuditSummary } from "./agent-protocol.js";
import { readableTasks, requireTaskAction, taskAccess } from "./permissions.js";
import {
  applyStatusTransition, createProgressRecord, isTransitionReasonRequired,
  normalizeTransitionReason, STATUS_LABELS, STATUSES, validateStatusTransition
} from "./tasks.js";

function actionError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function findTask(tasks, input) {
  const taskId = text(input?.taskId, 100);
  const query = text(input?.query, 200);
  const matches = taskId
    ? tasks.filter((task) => task.id === taskId)
    : tasks.filter((task) => task.title === query || task.title?.includes(query));
  if (!matches.length) throw actionError("TASK_NOT_FOUND", "任务不存在", 404);
  if (matches.length > 1) throw actionError("AGENT_TASK_AMBIGUOUS", `“${query}”匹配到多项任务，请补充更准确的标题`);
  return matches[0];
}

export function createAgentActionDraft(raw, allTasks, context, intent, sourceText = intent) {
  const inputs = Array.isArray(raw?.actions) ? raw.actions.slice(0, 20) : [];
  if (!inputs.length) throw actionError("AGENT_ACTION_DRAFT_EMPTY", "没有生成可确认的任务操作", 502);
  const visible = readableTasks(context, allTasks);
  const seen = new Set();
  const actions = inputs.map((input) => {
    const task = findTask(visible, input);
    if (seen.has(task.id)) throw actionError("AGENT_ACTION_DUPLICATE", `任务“${task.title}”在同一批操作中重复出现`);
    seen.add(task.id);
    if (["planned", "cancelled"].includes(task.status)) {
      throw actionError("AGENT_TASK_LOCKED", `Agent 不能修改「${STATUS_LABELS[task.status]}」列中的任务“${task.title}”`);
    }
    const targetStatus = text(input?.targetStatus, 30) || null;
    const reason = normalizeTransitionReason(input?.reason);
    const progressText = text(input?.progressText, 2000) || null;
    if (!targetStatus && !progressText) throw actionError("AGENT_ACTION_EMPTY", `任务“${task.title}”没有需要执行的状态或进展变更`);
    if (targetStatus) {
      requireTaskAction(context, task, "changeStatus");
      if (!STATUSES.includes(targetStatus)) throw actionError("AGENT_STATUS_INVALID", "目标状态不合法");
      if (isTransitionReasonRequired(task.status, targetStatus) && !reason) {
        const label = targetStatus === "blocked" ? "阻塞原因" : "本次状态变更原因";
        throw actionError("AGENT_REASON_REQUIRED", `请补充任务“${task.title}”的${label}后重新提交`);
      }
      if (reason && !String(sourceText || "").includes(reason)) {
        throw actionError("AGENT_REASON_UNVERIFIED", `任务“${task.title}”的变更原因不是用户明确提供的内容，请明确说明原因后重试`);
      }
      validateStatusTransition(task.status, targetStatus, reason);
    }
    if (progressText) requireTaskAction(context, task, "addProgress");
    const access = taskAccess(context, task);
    return {
      taskId: task.id,
      title: task.title,
      currentStatus: task.status,
      targetStatus,
      reason,
      progressText,
      expectedUpdatedAt: task.updatedAt || null,
      access: access.access
    };
  });
  return {
    id: crypto.randomUUID(), kind: "taskActions", intent, status: "pending",
    atomic: true, createdAt: new Date().toISOString(), sourceText: String(sourceText || "").slice(0, 2000), actions
  };
}

export async function confirmAgentActionDraft(ctx, context, draft) {
  await assertAgentWriteToolsEnabled(ctx);
  const currentTasks = await ctx.persistence.tasks.load(context);
  for (const action of draft.actions) {
    const current = currentTasks.find((task) => task.id === action.taskId && !task.deletedAt);
    if (!current || (current.updatedAt || null) !== action.expectedUpdatedAt || current.status !== action.currentStatus) {
      throw actionError("AGENT_PLAN_STALE", `任务“${action.title}”已发生变化，本批操作未写入；请刷新后重新生成操作计划`, 409);
    }
  }
  const validated = createAgentActionDraft({ actions: draft.actions }, currentTasks, context, draft.intent, draft.sourceText);
  const nextTasks = structuredClone(currentTasks);
  const now = new Date().toISOString();
  const items = [];
  for (const action of validated.actions) {
    const task = nextTasks.find((item) => item.id === action.taskId);
    if (action.targetStatus) {
      applyStatusTransition(task, action.targetStatus, {
        prevStatus: action.currentStatus, actor: context.actor.displayName, reason: action.reason
      });
    }
    if (action.progressText) {
      createProgressRecord(task, action.progressText, context.actor.displayName, context.actor.id);
    }
    task.updatedAt = now;
    items.push({
      type: "task", taskId: task.id, title: task.title, status: "success",
      fromStatus: action.currentStatus, toStatus: action.targetStatus || action.currentStatus,
      progressRecorded: Boolean(action.progressText)
    });
  }
  const audit = {
    actor: context.actor,
    workspace: context.workspace,
    source: "agent",
    action: "agent.task_batch_update",
    target: { type: "workspace", id: context.workspace.id },
    outcome: "success",
    summary: originAuditSummary(draft, { count: items.length, changedFields: ["status", "history", "progressRecords"] })
  };
  const expectedVersions = validated.actions.map(({ taskId, expectedUpdatedAt }) => ({ taskId, expectedUpdatedAt }));
  if (typeof ctx.persistence.tasks.saveWithAudit === "function") {
    await ctx.persistence.tasks.saveWithAudit(context, nextTasks, audit, expectedVersions);
  } else {
    await ctx.persistence.tasks.save(context, nextTasks);
    await appendAudit(ctx.audit, audit);
  }
  return { draftId: draft.id, atomic: true, items };
}
