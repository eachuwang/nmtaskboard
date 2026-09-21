import { buildReportForType } from "./report.js";
import { descriptionToText } from "../shared/rich-description.js";

const TIME_SECTIONS = ["completed", "inProgress", "blocked", "created"];
const HANDOVER_SECTIONS = ["inProgress", "blocked", "urgent", "todo", "reference"];

function historyEvidence(task, end, timeZone) {
  const entries = Array.isArray(task.history) ? task.history : [];
  const throughEnd = end
    ? entries.filter((entry) => {
      if (!entry?.at) return false;
      const date = new Date(entry.at);
      if (Number.isNaN(date.getTime())) return false;
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      return `${values.year}-${values.month}-${values.day}` <= end;
    })
    : entries;
  return throughEnd.map((entry, index) => ({
    id: entry.id || `${task.id}:history:${index}`,
    action: entry.action,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    reason: entry.reason || null,
    at: entry.at,
    actor: entry.actor || null,
    source: entry.source,
    fromDefinition: entry.fromDefinition,
    toDefinition: entry.toDefinition
  }));
}

function progressEvidence(task) {
  return (Array.isArray(task.progressRecords) ? task.progressRecords : [])
    .filter((record) => !record.deletedAt)
    .map((record) => ({
      id: record.id,
      text: record.text,
      author: record.author,
      authorIdentityId: record.authorIdentityId || null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }));
}

function evidenceItem(item, source, end, timeZone, parentTitle = null) {
  const history = historyEvidence(source, end, timeZone);
  const progressRecords = progressEvidence(source);
  // 普通评论和回复也是报告素材；不要把它们伪装成旧版进展记录。
  const comments = (Array.isArray(source.comments) ? source.comments : [])
    .filter((record) => !record.deletedAt && (!record.type || record.type === "comment"))
    .map(({ id, text, author, authorIdentityId, parentId, createdAt, updatedAt }) => ({
      id, text, author, authorIdentityId: authorIdentityId || null,
      parentId: parentId || null, createdAt, updatedAt
    }));
  return {
    ...item,
    description: source.descriptionText || (source.description == null ? "" : descriptionToText(source.description)),
    status: item.status || source.status,
    taskType: "task",
    parentTaskId: source.parentTaskId || null,
    // 父任务标题（含不在报告范围内的父）：报告树按父任务聚合时作组头
    parentTitle: parentTitle || null,
    assigneeIdentityId: source.assigneeIdentityId || null,
    progressRecords,
    evidence: {
      references: {
        taskId: source.id,
        parentTaskId: source.parentTaskId || null,
        executionTaskId: null,
        historyEntryIds: history.map((entry) => entry.id),
        commentIds: comments.map((record) => record.id),
        progressRecordIds: progressRecords.map((record) => record.id)
      },
      facts: {
        title: source.title,
        description: source.description || "",
        status: item.status || source.status,
        priority: source.priority,
        dueDate: source.dueDate || null,
        assignees: source.assigneeIdentityId ? [source.assigneeIdentityId] : [],
        blockReason: item.blockReason || source.blockReason || null,
        cancelReason: source.cancelReason || null
      },
      history,
      comments,
      progressRecords
    }
  };
}

export function buildReportEvidenceBundle(tasks, type, start, end, options = {}) {
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const summary = buildReportForType(tasks, type, start, end, { ...options, timeZone });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const parentTitleOf = (source) => {
    if (!source.parentTaskId) return null;
    return byId.get(source.parentTaskId)?.title || options.taskTitlesById?.get(source.parentTaskId) || null;
  };
  const sectionKeys = type === "handover" ? HANDOVER_SECTIONS : TIME_SECTIONS;
  const withParentTitle = (item) => evidenceItem(item, byId.get(item.id) || item, end, timeZone, parentTitleOf(byId.get(item.id) || item));
  const sections = { ...summary.sections };
  for (const key of sectionKeys) {
    sections[key] = (summary.sections[key] || []).map(withParentTitle);
  }
  const nextWeek = (summary.nextWeek || []).map(withParentTitle);
  const evidenceSummary = {
    ...summary,
    ...(summary.statusGroups ? {
      statusGroups: summary.statusGroups.map((group) => ({
        ...group,
        items: group.items.map(withParentTitle)
      }))
    } : {}),
    sections,
    ...(summary.nextWeek ? { nextWeek } : {})
  };
  if (options.scopeDiagnostic) {
    evidenceSummary.diagnostics = {
      ...(evidenceSummary.diagnostics || { excluded: [] }),
      scope: [options.scopeDiagnostic]
    };
  }
  return {
    schemaVersion: "report-evidence/v1",
    reportType: type,
    range: type === "handover" ? null : { start, end },
    timeZone,
    scope: options.scope || null,
    summary: evidenceSummary
  };
}
