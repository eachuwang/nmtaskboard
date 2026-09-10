import { activeStatuses, defaultWorkflow } from "../shared/task-statuses.js";
import crypto from "node:crypto";
import { appendAudit } from "./audit.js";
import { assertAgentWriteToolsEnabled } from "./agent-policy.js";
import { originAuditSummary } from "./agent-protocol.js";
import { workspaceCapabilities } from "./permissions.js";
import { normalizeSettings, normalizeTags } from "./settings.js";
import { createTask, normalizeTask } from "./tasks.js";

function draftError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requireCreate(context) {
  if (!workspaceCapabilities(context).create) {
    throw draftError("AGENT_CREATE_FORBIDDEN", "当前角色不能在工作区创建任务", 403);
  }
}

export function normalizeAgentTaskDraft(raw, savedTags = [], workflow) {
  const source = Array.isArray(raw?.tasks) ? raw.tasks.slice(0, 12) : [];
  const tasks = source.map((item) => normalizeTask({ ...item, status: item.status || activeStatuses(workflow)[0].id }, workflow));
  if (!tasks.length) throw draftError("AGENT_DRAFT_EMPTY", "没有生成可确认的任务草稿", 502);

  const existing = new Map(normalizeTags(savedTags).map((tag) => [tag.name, tag]));
  const suggestions = new Map(normalizeTags(raw?.newTags).map((tag) => [tag.name, tag]));
  const referenced = [...new Set(tasks.flatMap((task) => task.tags))];
  const newNames = referenced.filter((name) => !existing.has(name));
  if (existing.size + newNames.length > 50) throw draftError("AGENT_TAG_LIMIT", "新增标签会超过当前空间 50 个标签的上限");

  const tags = referenced.map((name) => existing.has(name)
    ? { name, color: existing.get(name).color || "", action: "reuse" }
    : { name, color: suggestions.get(name)?.color || "", action: "create" });
  return { tasks, tags };
}

export function createAgentDraft(raw, savedTags, intent, workflow) {
  const normalized = normalizeAgentTaskDraft(raw, savedTags, workflow);
  return {
    id: crypto.randomUUID(),
    intent,
    workflowRevision: workflow?.revision || 0,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...normalized
  };
}

export async function confirmAgentDraft(ctx, context, draft) {
  let outcome = "success";
  let code;
  let createdTasks = [];
  let createdTags = [];
  try {
    await assertAgentWriteToolsEnabled(ctx);
    requireCreate(context);
    const settings = normalizeSettings(await ctx.persistence.settings.load(context));
    const workflow = await ctx.persistence.statusWorkflow?.load(context) || defaultWorkflow();
    context = { ...context, statusWorkflow: workflow };
    if ((draft.workflowRevision || 0) !== workflow.revision) throw draftError("AGENT_PLAN_STALE", "状态流程已变化，请重新生成草稿", 409);
    const currentTasks = await ctx.persistence.tasks.load(context);
    const normalized = normalizeAgentTaskDraft({
      tasks: draft.tasks,
      newTags: draft.tags.filter((tag) => tag.action === "create")
    }, settings.tags, workflow);
    const actor = context.actor.displayName;
    const now = new Date().toISOString();
    createdTags = normalized.tags.filter((tag) => tag.action === "create").map((tag) => ({
      name: tag.name, color: tag.color, creator: actor, createdAt: now
    }));
    const pending = [...currentTasks];
    createdTasks = normalized.tasks.map((input) => {
      const task = createTask({ ...input, creatorIdentityId: context.actor.id }, pending, actor, workflow);
      task.createdSource = "agent";
      pending.push(task);
      return task;
    });

    if (createdTags.length) {
      await ctx.persistence.settings.save(context, { ...settings, tags: [...settings.tags, ...createdTags] });
    }
    await ctx.persistence.tasks.save(context, [...currentTasks, ...createdTasks]);
    return {
      draftId: draft.id,
      tasks: createdTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, source: task.createdSource })),
      tags: normalized.tags,
      items: createdTasks.map((task) => ({ type: "task", id: task.id, label: task.title, status: "success" }))
    };
  } catch (error) {
    outcome = error.statusCode && error.statusCode < 500 ? "denied" : "failure";
    code = error.code;
    throw error;
  } finally {
    await appendAudit(ctx.audit, {
      actor: context.actor,
      workspace: context.workspace,
      source: "agent",
      action: "agent.task_batch_create",
      target: { type: "workspace", id: context.workspace.id },
      outcome,
      summary: originAuditSummary(draft, {
        count: createdTasks.length,
        ...(createdTags.length ? { changedFields: ["tasks", "tags"] } : createdTasks.length ? { changedFields: ["tasks"] } : {}),
        ...(code ? { code } : {})
      })
    }).catch(() => {});
  }
}

export function assertAgentCanDraft(context) {
  requireCreate(context);
}
