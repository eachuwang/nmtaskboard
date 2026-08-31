import { appendAudit } from "./audit.js";
import { originAuditSummary } from "./agent-protocol.js";
import { assertTeamManager, readTeamProgress } from "./agent-team-tools.js";
import { authorizeAgentTool, agentToolFailure, agentToolSuccess } from "./agent-policy.js";
import { AGENT_READ_TOOLS } from "./agent-registry.js";
import { projectTaskRelations, progressRecordsForViewer, readableTasks, taskAccess, workspaceCapabilities } from "./permissions.js";
import { createReportEvidence, filterReportEvidence, parseReportTypeRange } from "./report-service.js";
import { templateForType } from "./report.js";

export const AGENT_TOOL_NAMES = AGENT_READ_TOOLS;

function agentError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function compactTask(task, context) {
  return {
    id: task.id,
    title: task.title,
    description: task.description || "",
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate || null,
    tags: task.tags || [],
    assignees: task.assignees || [],
    blockReason: task.blockReason || null,
    cancelReason: task.cancelReason || null,
    taskType: task.taskType || (context.workspace.type === "personal" ? "personal" : null),
    parentTaskId: task.parentTaskId || null,
    memberRelation: task.memberRelation || null,
    participantSummary: task.participantSummary || []
  };
}

async function visibleState(ctx, context) {
  const loaded = await ctx.persistence.tasks.load(context);
  return projectTaskRelations(context, readableTasks(context, loaded));
}

function findVisibleTask(tasks, args) {
  const task = args.taskId
    ? tasks.find((item) => item.id === args.taskId)
    : tasks.find((item) => item.title === args.query) || tasks.find((item) => item.title?.includes(args.query));
  if (!task) throw agentError("TASK_NOT_FOUND", "任务不存在", 404);
  return task;
}

async function runTool(ctx, context, tool, args) {
  if (tool === "readTeamProgress") return readTeamProgress(ctx, context);
  if (tool === "readReport" || tool === "draftTeamReport") {
    if (tool === "draftTeamReport") assertTeamManager(context);
    if (!workspaceCapabilities(context).report) throw agentError("REPORT_FORBIDDEN", "当前空间无报告读取权限", 403);
    const parsed = parseReportTypeRange(args);
    const generated = await createReportEvidence(ctx, context, parsed);
    const evidence = filterReportEvidence(generated.evidence, args.excludedTaskIds, args.includeNextWeek !== false);
    const result = { type: parsed.type, range: evidence.range, timeZone: generated.timeZone, subject: generated.subject, evidence };
    return tool === "draftTeamReport"
      ? { ...result, draft: templateForType(evidence, parsed.type, parsed.start, parsed.end), publicationStatus: "draft" }
      : result;
  }

  const tasks = await visibleState(ctx, context);
  if (tool === "readBoard") return { tasks: tasks.map((task) => compactTask(task, context)), count: tasks.length };
  const task = findVisibleTask(tasks, args);
  if (!taskAccess(context, task).read) throw agentError("TASK_NOT_FOUND", "任务不存在", 404);
  if (tool === "readTask") return { task: { ...compactTask(task, context), progressRecords: progressRecordsForViewer(context, task) } };
  if (tool === "readHistory") return { task: compactTask(task, context), history: Array.isArray(task.history) ? task.history : [] };
  return { task: compactTask(task, context), records: progressRecordsForViewer(context, task) };
}

export async function executeAgentTool(ctx, context, tool, args = {}, origin = {}) {
  let outcome = "success";
  let code;
  try {
    await authorizeAgentTool(ctx, context, tool, args);
    const data = await runTool(ctx, context, tool, args);
    return agentToolSuccess(tool, data);
  } catch (error) {
    outcome = error.statusCode && error.statusCode < 500 ? "denied" : "failure";
    code = error.code;
    throw error;
  } finally {
    await appendAudit(ctx.audit, {
      actor: context.actor,
      workspace: context.workspace,
      source: "agent",
      action: `agent.tool.${tool}`,
      target: { type: args.taskId ? "task" : "workspace", id: args.taskId || context.workspace.id },
      outcome,
      summary: originAuditSummary({ origin }, code ? { code } : {})
    });
  }
}

export async function invokeAgentTool(ctx, context, tool, args = {}, origin = {}) {
  try {
    return await executeAgentTool(ctx, context, tool, args, origin);
  } catch (error) {
    return agentToolFailure(error, tool);
  }
}
