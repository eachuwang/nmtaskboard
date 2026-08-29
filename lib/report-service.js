import { buildReportEvidenceBundle } from "./report-evidence.js";
import { REPORT_TYPES } from "./report.js";
import { normalizeReportTimeZone, normalizeSettings } from "./settings.js";
import { progressRecordsForViewer, readableTasks } from "./permissions.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportTypeRange(body) {
  const type = typeof body?.type === "string" && REPORT_TYPES.includes(body.type) ? body.type : "weekly";
  if (type === "handover") return { type, start: null, end: null, includeCompleted: Boolean(body?.includeCompleted) };
  const { start, end } = body?.range || {};
  if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) {
    throw Object.assign(new Error("日期范围不合法"), { statusCode: 400 });
  }
  if (start > end) throw Object.assign(new Error("开始日期不能晚于结束日期"), { statusCode: 400 });
  return { type, start, end, includeCompleted: false };
}

export async function createReportEvidence(ctx, context, { type, start, end, includeCompleted = false }) {
  const settings = normalizeSettings(await ctx.persistence.settings.load(context));
  const workspace = context.workspace;
  const timeZone = workspace.type === "team"
    ? normalizeReportTimeZone(workspace.timeZone)
    : settings.reportTimeZone;
  const loaded = await ctx.persistence.tasks.load(context);
  const readable = readableTasks(context, loaded);
  const memberScope = workspace.type === "team" && workspace.role === "member";
  const scoped = memberScope
    ? readable.filter((task) => task.taskType === "execution" && task.assigneeIdentityId === context.actor.id && task.assignmentStatus !== "removed")
    : readable;
  const tasks = scoped.map((task) => ({ ...task, progressRecords: progressRecordsForViewer(context, task) }));
  const subject = workspace.type === "team" ? "team" : "personal";
  const evidence = buildReportEvidenceBundle(tasks, type, start, end, {
    includeCompleted,
    timeZone,
    includeProgressRecords: true,
    scope: {
      workspaceId: workspace.id,
      workspaceType: workspace.type,
      subject,
      role: workspace.role || "owner",
      actorIdentityId: context.actor.id
    },
    ...(memberScope ? { scopeDiagnostic: { code: "restricted_to_own_execution", reason: "团队成员报告仅包含本人负责的执行任务和本人进展记录" } } : {})
  });
  return { evidence, timeZone, subject };
}

export function filterReportEvidence(evidence, excludedTaskIds = [], includeNextWeek = true) {
  const excluded = new Set(Array.isArray(excludedTaskIds) ? excludedTaskIds.filter((id) => typeof id === "string") : []);
  const source = evidence?.summary || {};
  const sections = Object.fromEntries(Object.entries(source.sections || {}).map(([key, items]) => [
    key,
    Array.isArray(items) ? items.filter((item) => !excluded.has(item?.id)) : items
  ]));
  const nextWeek = includeNextWeek
    ? (source.nextWeek || []).filter((item) => !excluded.has(item?.id))
    : [];
  const stats = source.stats ? Object.fromEntries(Object.keys(source.stats).map((key) => [key, sections[key]?.length || 0])) : undefined;
  return {
    ...evidence,
    summary: {
      ...source,
      sections,
      ...(source.nextWeek ? { nextWeek } : {}),
      ...(stats ? { stats } : {})
    }
  };
}
