import { buildReportForType } from "./report.js";

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
    actor: entry.actor || null
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

function evidenceItem(item, source, end, timeZone) {
  const history = historyEvidence(source, end, timeZone);
  const progressRecords = progressEvidence(source);
  return {
    ...item,
    description: source.description || "",
    status: item.status || source.status,
    taskType: "task",
    parentTaskId: source.parentTaskId || null,
    assigneeIdentityId: source.assigneeIdentityId || null,
    progressRecords,
    evidence: {
      references: {
        taskId: source.id,
        parentTaskId: source.parentTaskId || null,
        executionTaskId: null,
        historyEntryIds: history.map((entry) => entry.id),
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
      progressRecords
    }
  };
}

export function buildReportEvidenceBundle(tasks, type, start, end, options = {}) {
  const timeZone = options.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const summary = buildReportForType(tasks, type, start, end, { ...options, timeZone });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const sectionKeys = type === "handover" ? HANDOVER_SECTIONS : TIME_SECTIONS;
  const sections = { ...summary.sections };
  for (const key of sectionKeys) {
    sections[key] = (summary.sections[key] || []).map((item) => evidenceItem(item, byId.get(item.id) || item, end, timeZone));
  }
  const nextWeek = (summary.nextWeek || []).map((item) => evidenceItem(item, byId.get(item.id) || item, end, timeZone));
  const evidenceSummary = { ...summary, sections, ...(summary.nextWeek ? { nextWeek } : {}) };
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
