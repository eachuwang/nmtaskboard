import { buildReportEvidenceBundle } from "./report-evidence.js";
import { REPORT_TYPES } from "./report.js";
import { normalizeReportTimeZone, normalizeSettings } from "./settings.js";
import { progressRecordsForViewer, readableTasks, workspaceCapabilities } from "./permissions.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportTypeRange(body) {
  const type = typeof body?.type === "string" && REPORT_TYPES.includes(body.type) ? body.type : "weekly";
  // personal = 仅本人负责的任务；workspace = 全工作区（仅 owner/admin 可用，服务端再校验）
  // 未传时按角色自动：管理者默认工作区，成员默认个人
  const scope = body?.scope === "personal" || body?.scope === "workspace" ? body.scope : undefined;
  if (type === "handover") return { type, start: null, end: null, includeCompleted: Boolean(body?.includeCompleted), scope };
  const { start, end } = body?.range || {};
  if (!DATE_RE.test(start || "") || !DATE_RE.test(end || "")) {
    throw Object.assign(new Error("日期范围不合法"), { statusCode: 400 });
  }
  if (start > end) throw Object.assign(new Error("开始日期不能晚于结束日期"), { statusCode: 400 });
  return { type, start, end, includeCompleted: false, scope };
}

export async function createReportEvidence(ctx, context, { type, start, end, includeCompleted = false, scope }) {
  const settings = normalizeSettings(await ctx.persistence.settings.load(context));
  const workspace = context.workspace;
  const timeZone = normalizeReportTimeZone(workspace.timeZone || settings.reportTimeZone);
  const loaded = await ctx.persistence.tasks.load(context);
  const readable = readableTasks(context, loaded);
  let tasks = readable.map((task) => ({ ...task, progressRecords: progressRecordsForViewer(context, task) }));
  // 工作区报告仅 owner/admin 可读全量；成员一律个人范围（本人负责的任务）。未指定时管理者默认工作区。
  const manage = workspaceCapabilities(context).manage;
  const effectiveScope = scope === "personal" ? "personal" : manage ? "workspace" : "personal";
  if (effectiveScope === "personal") tasks = tasks.filter((task) => task.assigneeIdentityId === context.actor.id);
  const subject = effectiveScope;
  const evidence = buildReportEvidenceBundle(tasks, type, start, end, {
    includeCompleted,
    timeZone,
    includeProgressRecords: true,
    scope: {
      workspaceId: workspace.id,
      workspaceType: workspace.type,
      subject,
      subjectLabel: effectiveScope === "workspace" ? "工作区报告" : "个人报告",
      role: workspace.role || "owner",
      actorIdentityId: context.actor.id
    },
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
