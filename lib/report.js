import { DEFAULT_STATUSES, findStatus, statusLabel } from "../shared/task-statuses.js";
// 周报引擎：范围计算、分节归集、去重、第一人称模板（本地时区）
import { STATUSES, STATUS_TRANSITIONS, isTransitionReasonRequired, visibleProgressRecords } from "./tasks.js";

export function dayString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function parseDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// 默认范围：本周一 00:00 ~ 周五 24:00；含周末则延伸至周日 24:00
export function defaultWeekRange(now = new Date(), includeWeekend = false) {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((now.getDay() + 6) % 7));
  const end = addDays(monday, includeWeekend ? 6 : 4);
  return { start: dayString(monday), end: dayString(end) };
}

export const REPORT_TYPES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly", "handover"];
export const REPORT_LABELS = {
  daily: "日报", weekly: "周报", biweekly: "双周报",
  monthly: "月报", quarterly: "季报", yearly: "年报", handover: "离职交接报告"
};
const TIME_TYPES = ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"];

// 各类型默认时间范围（handover 无时间过滤 → null）
export function defaultRangeFor(type, now = new Date()) {
  switch (type) {
    case "daily":
      return { start: dayString(now), end: dayString(now) };
    case "weekly":
      return defaultWeekRange(now, false);
    case "biweekly": {
      const r = defaultWeekRange(now, false);
      return { start: r.start, end: dayString(addDays(parseDay(r.start), 13)) };
    }
    case "monthly": {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: dayString(s), end: dayString(e) };
    }
    case "quarterly": {
      const q = Math.floor(now.getMonth() / 3);
      const s = new Date(now.getFullYear(), q * 3, 1);
      const e = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { start: dayString(s), end: dayString(e) };
    }
    case "yearly":
      return { start: dayString(new Date(now.getFullYear(), 0, 1)), end: dayString(new Date(now.getFullYear(), 11, 31)) };
    default:
      return null; // handover
  }
}

// 周期步长（天）：上一周期/下一周期平移用
export function periodDays(type) {
  switch (type) {
    case "daily": return 1;
    case "weekly": return 7;
    case "biweekly": return 14;
    case "monthly": return 30;
    case "quarterly": return 91;
    case "yearly": return 365;
    default: return 7;
  }
}

const systemTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const dayInTimeZone = (iso, timeZone) => {
  if (typeof iso !== "string" || !iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const inDayRange = (iso, start, end, timeZone) => {
  const day = dayInTimeZone(iso, timeZone);
  if (!day) return false;
  return day >= start && day <= end;
};

const canonicalReportStatus = (status) => status === "planned" ? "backlog" : status === "archived" ? "cancelled" : status;
const STATUS_SET = new Set(STATUSES);
const INITIAL_STATUS_SET = new Set(STATUSES);
const HISTORY_ACTION_SET = new Set(["created", "moved", "calibrated"]);

const invalidTimeline = (code, reason) => ({ code, reason });

function workflowSnapshotAt(task, end, timeZone) {
  const events = (task.history || []).filter((e) => HISTORY_ACTION_SET.has(e.action));
  if (!events.length) return invalidTimeline("missing_history", "缺少状态轨迹");
  let snapshot = null, previousAt = -Infinity;
  for (const event of events) {
    const at = Date.parse(event.at);
    const definition = event.toDefinition || DEFAULT_STATUSES.find((s) => s.id === canonicalReportStatus(event.toStatus));
    if (!Number.isFinite(at) || !definition || definition.id !== event.toStatus || !["pending", "active", "blocked", "terminal"].includes(definition.lifecycle) || (definition.lifecycle === "terminal" && !["completed", "abandoned"].includes(definition.outcome)) || at < previousAt) return invalidTimeline("invalid_history_event", "状态轨迹事件无效");
    previousAt = at;
    if (dayInTimeZone(event.at, timeZone) > end) continue;
    if (event.action === "calibrated") {
      if (!event.reason?.trim()) return invalidTimeline("missing_reason", "人工校准缺少原因");
    } else if (!snapshot && event.action !== "created") {
      const from = event.fromDefinition || DEFAULT_STATUSES.find((s) => s.id === canonicalReportStatus(event.fromStatus));
      if (event.action !== "moved" || !from) return invalidTimeline("invalid_history_root", "状态轨迹起点无效");
      snapshot = { status: event.fromStatus, definition: from };
    } else if (snapshot && (event.action !== "moved" || event.fromStatus !== snapshot.status)) {
      return invalidTimeline("invalid_transition", "状态轨迹不连续");
    }
    const continuingCompletion = snapshot?.completedAt && snapshot?.definition?.outcome === "completed" && definition.outcome === "completed";
    snapshot = {
      status: event.toStatus, definition, at: event.at, reason: event.reason || "",
      createdAt: event.action === "created" ? event.at : snapshot?.createdAt,
      source: event.source,
      completedAt: definition.outcome === "completed" ? continuingCompletion ? snapshot.completedAt : event.at : null,
      completionSource: definition.outcome === "completed" ? continuingCompletion ? snapshot.completionSource : event.source : null
    };
  }
  if (!snapshot) return { pending: true };
  if (!events.some((e) => dayInTimeZone(e.at, timeZone) > end) && snapshot.status !== task.status) return invalidTimeline("status_mismatch", "最后轨迹与卡片状态不一致");
  return snapshot;
}

function workflowReport(tasks, start, end, opts, handover = false, includeCompleted = false) {
  const timeZone = opts.timeZone || systemTimeZone();
  const diagnostics = { excluded: [] }, sections = { completed: [], inProgress: [], blocked: [], created: [], todo: [], urgent: [], reference: [] };
  const groups = new Map();
  for (const task of tasks) {
    const snapshot = trustedSnapshotAt(task, end || "9999-12-31", timeZone);
    if (snapshot.pending) continue;
    if (snapshot.code) { diagnostics.excluded.push({ id: task.id, title: task.title, ...snapshot }); continue; }
    const definition = snapshot.definition || DEFAULT_STATUSES.find((s) => s.id === snapshot.status);
    const closed = definition?.lifecycle === "terminal";
    if (handover ? closed && !(includeCompleted && definition.outcome === "completed") : closed && !inDayRange(snapshot.at, start, end, timeZone)) continue;
    const item = {
      id: task.id, title: task.title, description: task.description, priority: task.priority, tags: task.tags,
      dueDate: task.dueDate, parentTaskId: task.parentTaskId, status: snapshot.status,
      statusName: findStatus(snapshot.status, opts.workflow) ? statusLabel(snapshot.status, opts.workflow) : definition.name,
      lifecycle: definition.lifecycle, outcome: definition.outcome, blockReason: snapshot.reason || task.blockReason,
      completedAt: snapshot.completedAt || snapshot.at, source: snapshot.completionSource || snapshot.source,
      ...(opts.includeProgressRecords ? { progressRecords: visibleProgressRecords(task) } : {})
    };
    if (!groups.has(snapshot.status)) groups.set(snapshot.status, { id: snapshot.status, name: item.statusName, items: [] });
    groups.get(snapshot.status).items.push(item);
    if (definition.outcome === "completed" && item.source !== "workflow" && (handover || inDayRange(item.completedAt, start, end, timeZone))) sections[handover ? "reference" : "completed"].push(item);
    if (definition.lifecycle === "active") sections.inProgress.push(item);
    if (definition.lifecycle === "blocked") sections.blocked.push(item);
    if (definition.lifecycle === "pending") {
      sections.todo.push(item);
      if (inDayRange(snapshot.createdAt, start, end, timeZone)) sections.created.push(item);
    }
  }
  const order = [...(opts.workflow?.mode === "custom" ? opts.workflow.custom : DEFAULT_STATUSES), ...(opts.workflow?.deleted || [])].map((s) => s.id);
  return { type: handover ? "handover" : undefined, timeZone, diagnostics, sections, nextWeek: [],
    stats: { completed: sections.completed.length, inProgress: sections.inProgress.length, blocked: sections.blocked.length, created: sections.created.length, todo: sections.todo.length },
    statusGroups: [...groups.values()].sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id)) };
}
function usesWorkflow(tasks, opts) {
  return opts.workflow?.mode === "custom" || tasks.some((t) => (t.statusDefinition && !t.statusDefinition.builtin) || t.history?.some((e) => e.toDefinition && !e.toDefinition.builtin));
}
function workflowTemplate(summary, type, start, end) {
  const title = type === "handover" ? "离职交接报告" : ({ daily: "工作日报", weekly: "工作周报", biweekly: "双周工作报", monthly: "工作月报", quarterly: "季度工作报", yearly: "年度工作报" }[type] || "工作报告");
  const lines = [`# ${title}${start && end ? `（${start} - ${end}）` : ""}`, "", `完成 ${summary.stats.completed || 0} 项、进行中 ${summary.stats.inProgress || 0} 项、阻塞 ${summary.stats.blocked || 0} 项。`, ""];
  for (const group of summary.statusGroups) {
    if (!group.items.length) continue;
    lines.push(`## ${group.name}`, "");
    pushTaskGroup(lines, group.items, (t) => t.source === "workflow" ? "（状态流程变更，非本期实际完成）" : t.lifecycle === "blocked" && t.blockReason ? `（阻塞原因：${t.blockReason}）` : "");
    lines.push("");
  }
  return lines.join("\n");
}

export const trustedSnapshotAt = (task, end, timeZone) => {
  if (task.history?.some((e) => e.source === "workflow" || (e.toDefinition && !e.toDefinition.builtin))) return workflowSnapshotAt(task, end, timeZone);
  const history = Array.isArray(task.history) ? task.history : [];
  if (!history.length) return invalidTimeline("missing_history", "缺少状态轨迹");

  const statusEntries = history.filter((entry) => HISTORY_ACTION_SET.has(entry?.action)).map((entry) => ({
    ...entry,
    fromStatus: entry.fromStatus ? canonicalReportStatus(entry.fromStatus) : entry.fromStatus,
    toStatus: canonicalReportStatus(entry.toStatus)
  }));
  if (!statusEntries.length) return invalidTimeline("missing_history", "缺少状态轨迹");
  if (statusEntries.some((entry) => (
    typeof entry.at !== "string" || !entry.at ||
    typeof entry.toStatus !== "string" || !STATUS_SET.has(entry.toStatus)
  ))) return invalidTimeline("invalid_history_event", "状态轨迹事件无效");
  if (statusEntries.some((entry) => Number.isNaN(new Date(entry.at).getTime()))) {
    return invalidTimeline("invalid_history_time", "状态轨迹时间无效");
  }
  const entries = statusEntries.filter((entry) => dayInTimeZone(entry.at, timeZone) <= end);
  if (!entries.length) return { pending: true };

  let rootIndex = -1;
  for (let index = 0; index < entries.length; index++) {
    if (entries[index].action === "calibrated") rootIndex = index;
  }
  let replayIndex;
  let status;
  let at = null;
  let atMs = -Infinity;
  let createdAt = null;
  let reason = "";
  if (rootIndex >= 0) {
    const root = entries[rootIndex];
    if (typeof root.reason !== "string" || !root.reason.trim()) {
      return invalidTimeline("missing_reason", "人工校准缺少原因");
    }
    status = root.toStatus;
    at = root.at;
    atMs = new Date(root.at).getTime();
    reason = root.reason.trim();
    replayIndex = rootIndex + 1;
  } else {
    const first = entries[0];
    if (first.action === "created") {
      if (!INITIAL_STATUS_SET.has(first.toStatus)) return invalidTimeline("invalid_initial_status", "创建状态非法");
      status = first.toStatus;
      at = first.at;
      atMs = new Date(first.at).getTime();
      createdAt = first.at;
      replayIndex = 1;
    } else if (first.action === "moved" && INITIAL_STATUS_SET.has(first.fromStatus)) {
      status = first.fromStatus;
      replayIndex = 0;
    } else {
      return invalidTimeline("invalid_history_root", "状态轨迹起点无效");
    }
  }
  for (let index = replayIndex; index < entries.length; index++) {
    const entry = entries[index];
    const entryAtMs = new Date(entry.at).getTime();
    if (entryAtMs <= atMs) return invalidTimeline("invalid_history_order", "状态轨迹时间顺序无效");
    if (entry.action === "calibrated") {
      if (typeof entry.reason !== "string" || !entry.reason.trim()) return invalidTimeline("missing_reason", "人工校准缺少原因");
      status = entry.toStatus;
      at = entry.at;
      atMs = entryAtMs;
      createdAt = null;
      reason = entry.reason.trim();
      continue;
    }
    if (entry.action !== "moved" || entry.fromStatus !== status || !STATUS_TRANSITIONS[status]?.includes(entry.toStatus)) {
      return invalidTimeline("invalid_transition", "存在非法状态跳转");
    }
    if (isTransitionReasonRequired(status, entry.toStatus) && (typeof entry.reason !== "string" || !entry.reason.trim())) {
      return invalidTimeline("missing_reason", "状态变更缺少原因");
    }
    status = entry.toStatus;
    at = entry.at;
    atMs = entryAtMs;
    reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
  }

  const hasLaterEntry = statusEntries.some((entry) => dayInTimeZone(entry.at, timeZone) > end);
  if (!hasLaterEntry && canonicalReportStatus(task.status) !== status) return invalidTimeline("status_mismatch", "最后轨迹与卡片状态不一致");
  return { status, at, createdAt, reason };
};

// 分节归集：每个任务只出现一次，优先级 完成 > 阻塞 > 进行中/待审核 > 新建
export function buildReportSummary(tasks, start, end, opts = {}) {
  if (usesWorkflow(tasks, opts)) return workflowReport(tasks, start, end, opts);
  const timeZone = opts.timeZone || systemTimeZone();
  const diagnostics = { excluded: [] };
  const reportable = [];
  for (const task of tasks) {
    const snapshot = trustedSnapshotAt(task, end, timeZone);
    if (snapshot.pending) continue;
    if (snapshot.code) {
      diagnostics.excluded.push({
        id: task.id,
        title: task.title,
        status: task.status,
        code: snapshot.code,
        reason: snapshot.reason
      });
      continue;
    }
    reportable.push({ task, snapshot });
  }
  const completed = reportable
    .filter(({ snapshot }) => snapshot.status === "done" && inDayRange(snapshot.at, start, end, timeZone))
    .sort((a, b) => new Date(a.snapshot.at).getTime() - new Date(b.snapshot.at).getTime());
  const blocked = reportable.filter(({ snapshot }) => snapshot.status === "blocked");
  const inProgress = reportable.filter(({ snapshot }) => ["in_progress", "in_review"].includes(snapshot.status));
  const used = new Set([...completed, ...blocked, ...inProgress].map(({ task }) => task.id));
  const created = reportable.filter(({ task, snapshot }) => (
    !used.has(task.id) &&
    (snapshot.status === "backlog" || snapshot.status === "todo") &&
    inDayRange(snapshot.createdAt, start, end, timeZone)
  ));
  for (const { task } of created) used.add(task.id);

  // 下周计划：待规划/待办中，截止在下周（周一~周五）或高优先级，且未被前四节收录
  const nextStart = dayString(addDays(parseDay(end), 1));
  const nextEnd = dayString(addDays(parseDay(end), 5));
  const nextWeek = reportable
    .filter(
      ({ task, snapshot }) =>
        !used.has(task.id) &&
      (snapshot.status === "backlog" || snapshot.status === "todo") &&
        ((task.dueDate && task.dueDate >= nextStart && task.dueDate <= nextEnd) || ["urgent", "high"].includes(task.priority))
    )
    .sort((a, b) => (a.task.dueDate || "9999").localeCompare(b.task.dueDate || "9999") || (a.task.priority === "high" ? -1 : 1));

  const pick = (record, extra = {}) => ({
    id: record.task.id,
    title: record.task.title,
    description: record.task.description || "",
    priority: record.task.priority,
    tags: record.task.tags,
    dueDate: record.task.dueDate,
    blockReason: record.task.blockReason || "",
    ...(opts.includeProgressRecords ? { progressRecords: visibleProgressRecords(record.task) } : {}),
    ...extra
  });

  return {
    timeZone,
    diagnostics,
    stats: {
      completed: completed.length,
      inProgress: inProgress.length,
      blocked: blocked.length,
      created: created.length
    },
    sections: {
      completed: completed.map((record) => pick(record, { completedAt: record.snapshot.at, completedDay: dayInTimeZone(record.snapshot.at, timeZone) })),
      inProgress: inProgress.map((record) => pick(record)),
      blocked: blocked.map((record) => pick(record, { blockReason: record.snapshot.reason || record.task.blockReason })),
      created: created.map((record) => pick(record, { createdAt: record.snapshot.createdAt }))
    },
    nextWeek: nextWeek.map((record) => pick(record))
  };
}

const mdDay = (iso) => (iso || "").slice(5, 10).replace("-", ".");
const mdFull = (iso) => (iso || "").slice(0, 10).replace(/-/g, ".");
const mdRange = (start, end) => `${mdFull(start)} - ${mdFull(end)}`;

// 类型化归集入口（时间型走 buildReportSummary；handover 走 buildHandoverSummary）
export function buildReportForType(tasks, type, start, end, opts = {}) {
  if (type === "handover") return buildHandoverSummary(tasks, opts.includeCompleted, opts);
  return buildReportSummary(tasks, start, end, opts);
}

// 离职交接报告：状态分组（进行中 > 阻塞 > 到期高风险 > 待办），第三人称口径
export function buildHandoverSummary(tasks, includeCompleted = false, opts = {}) {
  if (usesWorkflow(tasks, opts)) return workflowReport(tasks, null, null, opts, true, includeCompleted);
  const timeZone = opts.timeZone || systemTimeZone();
  const diagnostics = { excluded: [] };
  const reportable = tasks.filter((task) => {
    const snapshot = trustedSnapshotAt(task, "9999-12-31", timeZone);
    if (!snapshot.code) return !snapshot.pending;
    diagnostics.excluded.push({
      id: task.id,
      title: task.title,
      status: task.status,
      code: snapshot.code,
      reason: snapshot.reason
    });
    return false;
  });
  const active = reportable.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const inProgress = active.filter((t) => ["in_progress", "in_review"].includes(t.status));
  const blocked = active.filter((t) => t.status === "blocked");
  const rest = active.filter((t) => !["in_progress", "in_review", "blocked"].includes(t.status));
  const soon = dayString(addDays(new Date(), 14));
  const urgent = rest.filter((t) => (t.dueDate && t.dueDate <= soon) || ["urgent", "high"].includes(t.priority));
  const urgentIds = new Set(urgent.map((t) => t.id));
  const todo = rest.filter((t) => !urgentIds.has(t.id));
  const reference = includeCompleted ? reportable.filter((t) => t.status === "done") : [];

  const pick = (t, extra = {}) => ({
    id: t.id, title: t.title, description: t.description,
    priority: t.priority, dueDate: t.dueDate, status: t.status, tags: t.tags,
    ...(opts.includeProgressRecords ? { progressRecords: visibleProgressRecords(t) } : {}),
    ...extra
  });
  return {
    type: "handover",
    timeZone,
    diagnostics,
    stats: { inProgress: inProgress.length, todo: todo.length, blocked: blocked.length },
    sections: {
      inProgress: inProgress.map((t) => pick(t)),
      blocked: blocked.map((t) => pick(t, { blockReason: t.blockReason })),
      urgent: urgent.map((t) => pick(t)),
      todo: todo.map((t) => pick(t)),
      reference: reference.map((t) => pick(t, { completedAt: t.completedAt }))
    }
  };
}

// ---------- 报告条目渲染（描述摘要 + 进展记录 + 子任务缩进） ----------
const excerptText = (value, max = 120) => {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

// 单条任务：标题行 + 描述摘要子项 + 最近 3 条进展（评论）子项
function taskReportLines(task, level = 0, meta = "") {
  const pad = "  ".repeat(level);
  const lines = [`${pad}- ${task.title}${meta}`];
  const description = excerptText(task.description, 120);
  if (description) lines.push(`${pad}  - ${description}`);
  const records = Array.isArray(task.progressRecords) ? task.progressRecords.slice(-3) : [];
  for (const record of records) {
    const note = excerptText(record?.text || record?.content || record?.note || "", 100);
    if (note) lines.push(`${pad}  - 进展：${note}`);
  }
  return lines;
}

// 同一列表内的父子任务分组：子任务挂到父任务下方；父不在列表内时按顶层条目处理
function groupReportItems(items) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const childrenOf = new Map();
  const roots = [];
  for (const item of items) {
    if (item.parentTaskId && byId.has(item.parentTaskId)) {
      if (!childrenOf.has(item.parentTaskId)) childrenOf.set(item.parentTaskId, []);
      childrenOf.get(item.parentTaskId).push(item);
    } else {
      roots.push(item);
    }
  }
  return { roots, childrenOf };
}

function pushTaskLines(lines, task, metaOf, level = 0, childrenOf = new Map()) {
  lines.push(...taskReportLines(task, level, metaOf ? metaOf(task) : ""));
  for (const child of childrenOf.get(task.id) || []) pushTaskLines(lines, child, metaOf, level + 1, childrenOf);
}

function pushTaskGroup(lines, items, metaOf) {
  const { roots, childrenOf } = groupReportItems(items);
  for (const root of roots) pushTaskLines(lines, root, metaOf, 0, childrenOf);
}

// 第一人称 Markdown 模板（票 08 的 AI 回退版本与前端预览共用同一结构）
export function templateReport(summary, start, end) {
  return templateForType(summary, "weekly", start, end);
}


// ---------- 类型化模板 ----------

// ---------- 四段式报告（Highlights / Details / In-progress / Plan for next week） ----------
// 四个一级分节恒定输出（无内容留空）；Details/In-progress 附描述与评论的确定性摘要，AI 仅做事实内简洁总结
function fourSectionSummaryLines(lines, task, level) {
  const pad = "  ".repeat(level);
  const description = excerptText(task.description, 120);
  if (description) lines.push(`${pad}  - ${description}`);
  const records = Array.isArray(task.progressRecords) ? task.progressRecords.slice(-2) : [];
  for (const record of records) {
    const note = excerptText(record?.text || record?.content || record?.note || "", 100);
    if (note) lines.push(`${pad}  - 进展：${note}`);
  }
}

function pushFourSectionTask(lines, task, level, childrenOf, { titlePrefix = "", withSummary = false, meta = null } = {}) {
  const pad = "  ".repeat(level);
  lines.push(`${pad}- ${titlePrefix}${task.title}${meta ? meta(task) : ""}`);
  if (withSummary) fourSectionSummaryLines(lines, task, level);
  for (const child of childrenOf.get(task.id) || []) pushFourSectionTask(lines, child, level + 1, childrenOf, { titlePrefix, withSummary, meta });
}

export function fourSectionReport({ title, completed = [], inProgress = [], plan = [] }) {
  const lines = [`# ${title}`, ""];
  const section = (label, items, options = {}) => {
    lines.push(`- ${label}`);
    const { roots, childrenOf } = groupReportItems(items);
    for (const root of roots) pushFourSectionTask(lines, root, 1, childrenOf, options);
    lines.push("");
  };
  const blockedMeta = (t) => t.blockReason ? `（阻塞原因：${t.blockReason}）` : "";
  const sourceMeta = (t) => t.source === "workflow" ? "（状态流程变更，非本期实际完成）" : "";
  section("Highlights", completed, { titlePrefix: "「已完成」", meta: sourceMeta });
  section("Details", completed, { titlePrefix: "「已完成」", withSummary: true, meta: sourceMeta });
  section("In-progress", inProgress, { withSummary: true, meta: blockedMeta });
  section("Plan for next week", plan, { meta: (t) => t.dueDate ? `（截止 ${mdDay(t.dueDate)}）` : "" });
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// statusGroups 证据按生命周期分桶：终止且完成 → Highlights/Details；实施中/阻塞 → In-progress；待实施 → Plan；已取消不收录
export function splitFourSectionGroups(summary) {
  const completed = [];
  const inProgress = [];
  const plan = [];
  for (const group of summary.statusGroups || []) {
    for (const item of group.items || []) {
      if (item.lifecycle === "terminal") { if (item.outcome === "completed") completed.push(item); }
      else if (item.lifecycle === "blocked" || item.lifecycle === "active") inProgress.push(item);
      else if (item.lifecycle === "pending") plan.push(item);
    }
  }
  return { completed, inProgress, plan };
}

export function templateForType(summary, type, start, end) {
  summary = summary?.schemaVersion === "report-evidence/v1" ? summary.summary : summary;
  if (type === "handover") return handoverTemplate(summary);
  const mdRange = type === "monthly"
    ? start.slice(0, 7).replace("-", ".")
    : type === "quarterly"
    ? start.slice(0, 4) + " Q" + (Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1)
    : type === "yearly"
    ? start.slice(0, 4)
    : type === "daily"
    ? mdFull(start)
    : type === "weekly"
    ? mdFull(start) + " - " + mdFull(end)
    : mdRangeOf(start, end);
  const titles = {
    daily: "# 今日工作日报（" + mdRange + "）",
    weekly: "# 本周工作周报（" + mdRange + "）",
    biweekly: "# 双周工作报（" + mdRange + "）",
    monthly: "# 本月工作月报（" + mdRange + "）",
    quarterly: "# 本季度工作季报（" + mdRange + "）",
    yearly: "# 年度工作年报（" + mdRange + "）"
  };
  const title = (titles[type] || "# 工作周报（" + mdRange + "）").slice(2);
  if (summary.statusGroups) {
    return fourSectionReport({ title, ...splitFourSectionGroups(summary) });
  }
  const { completed = [], inProgress = [], blocked = [], created = [] } = summary.sections || {};
  return fourSectionReport({ title, completed, inProgress: inProgress.concat(blocked), plan: summary.nextWeek?.length ? summary.nextWeek : created });
}

function handoverTemplate(summary) {
  const lines = [];
  lines.push("# 离职交接报告");
  const { stats } = summary;
  lines.push("进行中 " + stats.inProgress + " 项、待办 " + stats.todo + " 项、阻塞 " + stats.blocked + " 项。");
  lines.push("");

  const { inProgress, blocked, urgent, todo, reference } = summary.sections;
  const merged = inProgress.concat(blocked);
  if (merged.length) {
    lines.push("## 进行中的工作", "", "以下工作请接手人继续推进：");
    pushTaskGroup(lines, merged, (t) => (t.blockReason ? "（阻塞原因：" + t.blockReason + "）" : ""));
    lines.push("");
  }
  if (todo.length) {
    lines.push("## 待办事项", "", "以下为待办与待规划事项：");
    pushTaskGroup(lines, todo, (t) => (t.dueDate ? "（截止 " + mdDay(t.dueDate) + "）" : ""));
    lines.push("");
  }
  if (urgent.length) {
    lines.push("## 到期与高风险事项", "", "以下事项需尽快关注：");
    pushTaskGroup(lines, urgent, (t) => (t.dueDate ? "（截止 " + mdDay(t.dueDate) + "）" : "（高优先级）"));
    lines.push("");
  }
  if (reference.length) {
    lines.push("## 已完成事项（参考）", "", "以下为本期已完成的参考事项：");
    pushTaskGroup(lines, reference);
    lines.push("");
  }
  lines.push("## 关键信息补充", "", "（在此补充账号、文档、联系人等信息）", "");
  lines.push("## 接手人", "", "_");
  return lines.join("\n");
}
function mdRangeOf(start, end) {
  return start.slice(5).replace("-", ".") + " - " + end.slice(5).replace("-", ".");
}
