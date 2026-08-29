// 报告事实不变量：只允许 AI 重组表达，不允许删除、改写或虚构证据事实。
const SECTION_KEYS = ["completed", "inProgress", "blocked", "created", "todo", "urgent", "reference"];
const DATE_TOKEN_RE = /\b\d{4}[-/.]\d{2}[-/.]\d{2}\b/g;
const NUMBER_TOKEN_RE = /\b\d+(?:\.\d+)?\b/g;

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function evidenceItems(evidence) {
  const summary = evidence?.summary || {};
  return [...SECTION_KEYS.flatMap((key) => summary.sections?.[key] || []), ...(summary.nextWeek || [])];
}

function itemValues(item) {
  const facts = item?.evidence?.facts || {};
  const references = item?.evidence?.references || {};
  return [
    item?.title, facts.description, facts.status, facts.priority, facts.dueDate,
    facts.blockReason, facts.cancelReason, ...(Array.isArray(facts.assignees) ? facts.assignees : []),
    references.taskId, references.parentTaskId, references.executionTaskId,
    ...(references.historyEntryIds || []), ...(references.progressRecordIds || []),
    ...(item?.evidence?.history || []).flatMap((entry) => [entry.reason, entry.actor, entry.at]),
    ...(item?.evidence?.progressRecords || []).flatMap((record) => [record.text, record.author, record.createdAt, record.updatedAt])
  ];
}

export function extractFacts(evidence, draft = "") {
  const summary = evidence?.summary || {};
  const items = evidenceItems(evidence);
  const titles = unique(items.map((item) => item?.title));
  const evidenceValues = unique(items.flatMap(itemValues));
  const range = evidence?.range || summary.range || null;
  const allowedText = `${draft}\n${JSON.stringify(evidence)}`;
  return {
    titles,
    protectedValues: unique([...titles, ...evidenceValues.filter((value) => draft.includes(value))]),
    dates: unique([range?.start, range?.end]),
    stats: summary.stats || null,
    allowedDateTokens: unique(allowedText.match(DATE_TOKEN_RE) || []),
    allowedNumberTokens: unique(allowedText.match(NUMBER_TOKEN_RE) || [])
  };
}

export function validateFactInvariants(facts, text) {
  const violations = [];
  for (const value of facts.protectedValues || facts.titles || []) {
    if (!text.includes(value)) violations.push({ kind: "missing-fact", value });
  }
  const allowedDates = new Set(facts.allowedDateTokens || facts.dates || []);
  for (const value of unique(text.match(DATE_TOKEN_RE) || [])) {
    if (!allowedDates.has(value)) violations.push({ kind: "invented-date", value });
  }
  const allowedNumbers = new Set(facts.allowedNumberTokens || []);
  for (const value of unique(text.match(NUMBER_TOKEN_RE) || [])) {
    if (allowedNumbers.size && !allowedNumbers.has(value)) violations.push({ kind: "invented-number", value });
  }
  return { ok: violations.length === 0, violations };
}
