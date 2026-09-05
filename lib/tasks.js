import crypto from "node:crypto";

// Statuses are categories, not a state machine: any workspace member may move
// an issue directly to any status.
export const STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"];
export const PRIORITIES = ["urgent", "high", "medium", "low", "none"];
export const PROJECT_STATUSES = ["planned", "in_progress", "paused", "completed", "cancelled"];
export const STATUS_LABELS = {
  backlog: "待整理", todo: "待办", in_progress: "进行中", in_review: "待审核",
  done: "已完成", blocked: "阻塞中", cancelled: "已取消"
};
export const PRIORITY_LABELS = { urgent: "紧急", high: "高", medium: "中", low: "低", none: "无" };
export const PROJECT_STATUS_LABELS = {
  planned: "计划中", in_progress: "进行中", paused: "已暂停", completed: "已完成", cancelled: "已取消"
};
export const MANUAL_CREATE_STATUSES = STATUSES;
// Compatibility export for reports and older integrations. Validation does not
// consult it because transitions are intentionally unrestricted.
export const STATUS_TRANSITIONS = Object.freeze(Object.fromEntries(STATUSES.map((status) => [status, [...STATUSES]])));

const nowIso = () => new Date().toISOString();
const text = (value, max, fallback = "") => typeof value === "string" ? value.trim().slice(0, max) : fallback;
const idOrNull = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const dateOrNull = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

export function normalizeTransitionReason(value) {
  return text(value, 500) || null;
}

export function normalizeTask(input = {}) {
  const task = { ...input };
  if (!text(task.title, 200)) throw Object.assign(new Error("任务标题不能为空"), { statusCode: 400 });
  task.title = text(task.title, 200);
  if (!STATUSES.includes(task.status)) task.status = "backlog";
  if (!PRIORITIES.includes(task.priority)) task.priority = "none";
  task.description = text(task.description, 5000);
  task.tags = Array.isArray(task.tags)
    ? [...new Set(task.tags.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim().slice(0, 20)))].slice(0, 20)
    : [];
  task.assigneeIdentityId = idOrNull(task.assigneeIdentityId);
  task.parentTaskId = idOrNull(task.parentTaskId);
  task.projectId = idOrNull(task.projectId);
  task.stage = Number.isInteger(task.stage) && task.stage > 0 ? task.stage : null;
  task.dueDate = dateOrNull(task.dueDate);
  task.blockReason = task.status === "blocked" ? text(task.blockReason, 500) || null : null;
  task.cancelReason = task.status === "cancelled" ? text(task.cancelReason, 500) || null : null;
  return task;
}

export function validateStatusTransition(fromStatus, toStatus) {
  if (!STATUSES.includes(toStatus)) throw Object.assign(new Error("非法状态"), { statusCode: 400 });
  if (fromStatus && !STATUSES.includes(fromStatus)) throw Object.assign(new Error("当前任务状态无效"), { statusCode: 400 });
  return true;
}

export function validateTaskParent(tasks = [], taskId, parentTaskId) {
  if (!parentTaskId) return true;
  if (taskId && taskId === parentTaskId) throw Object.assign(new Error("任务不能成为自己的父任务"), { statusCode: 400, code: "TASK_PARENT_SELF" });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (!byId.has(parentTaskId)) throw Object.assign(new Error("父任务不存在"), { statusCode: 400, code: "TASK_PARENT_NOT_FOUND" });
  const visited = new Set();
  let currentId = parentTaskId;
  while (currentId) {
    if (visited.has(currentId)) throw Object.assign(new Error("任务父级链已存在循环"), { statusCode: 400, code: "TASK_PARENT_CYCLE" });
    visited.add(currentId);
    if (currentId === taskId) throw Object.assign(new Error("任务父级链不能形成循环"), { statusCode: 400, code: "TASK_PARENT_CYCLE" });
    currentId = byId.get(currentId)?.parentTaskId || null;
  }
  return true;
}

export function projectProgress(tasks = [], projectId) {
  const items = tasks.filter((task) => task.projectId === projectId);
  if (!items.length) return 0;
  return Math.round(items.filter((task) => ["done", "cancelled"].includes(task.status)).length / items.length * 100);
}

export function isTransitionReasonRequired() {
  return false;
}

export function recordHistory(task, entry) {
  if (!Array.isArray(task.history)) task.history = [];
  const recordedAt = entry.recordedAt || nowIso();
  task.history.push({
    id: entry.id || crypto.randomUUID(), at: entry.at || recordedAt, recordedAt,
    actor: text(entry.actor, 50, "我") || "我", action: entry.action,
    fromStatus: entry.fromStatus ?? null, toStatus: entry.toStatus ?? null,
    reason: normalizeTransitionReason(entry.reason)
  });
}

export function applyStatusTransition(task, newStatus, opts = {}) {
  const previous = opts.prevStatus !== undefined ? opts.prevStatus : task.status;
  validateStatusTransition(previous, newStatus);
  if (previous === newStatus) return task;
  const at = opts.effectiveAt || nowIso();
  task.status = newStatus;
  task.startedAt = newStatus === "in_progress" ? at : task.startedAt || null;
  task.completedAt = newStatus === "done" ? at : null;
  task.cancelledAt = newStatus === "cancelled" ? at : null;
  task.blockReason = newStatus === "blocked" ? normalizeTransitionReason(opts.reason || opts.blockReason) : null;
  task.cancelReason = newStatus === "cancelled" ? normalizeTransitionReason(opts.reason || opts.cancelReason) : null;
  recordHistory(task, {
    action: "moved", fromStatus: previous, toStatus: newStatus, actor: opts.actor,
    reason: opts.reason || opts.blockReason || opts.cancelReason, at, recordedAt: opts.recordedAt
  });
  return task;
}

// Compatibility helper for old callers. Parent/child tasks are independent in
// the new model, so cancellation never mutates children.
export function cancelParentTask(parent, tasks = [], { actor, reason } = {}) {
  applyStatusTransition(parent, "cancelled", { actor, reason });
  parent.updatedAt = nowIso();
  return { parent, affectedExecutions: [], cancelledExecutions: [], affectedChildren: [] };
}

export function ensureTaskExtras(task) {
  if (task.status === "planned") task.status = "backlog";
  if (task.priority === "critical") task.priority = "urgent";
  if (!STATUSES.includes(task.status)) task.status = "backlog";
  if (!PRIORITIES.includes(task.priority)) task.priority = "none";
  if (!task.assigneeIdentityId && Array.isArray(task.participants)) {
    task.assigneeIdentityId = idOrNull(task.participants.find((item) => item?.identityId)?.identityId);
  }
  if (task.taskType === "execution" && task.assignmentStatus === "removed") {
    task.status = "cancelled";
    task.assigneeIdentityId = null;
    task.cancelReason ||= "迁移时负责人已移除";
  }
  if (!Array.isArray(task.comments)) task.comments = [];
  if (!Array.isArray(task.history)) task.history = [];
  // Old JSON is upgraded lazily; the durable migration performs the same
  // conversion into task_comments with type=progress_update.
  if (Array.isArray(task.progressRecords)) {
    const existingIds = new Set(task.comments.map((comment) => comment.id));
    for (const record of task.progressRecords) {
      if (existingIds.has(record.id)) continue;
      task.comments.push({
        id: record.id || crypto.randomUUID(), type: "progress_update", text: text(record.text, 5000),
        author: text(record.author, 50, "我") || "我", authorIdentityId: idOrNull(record.authorIdentityId),
        createdAt: record.createdAt || nowIso(), updatedAt: record.updatedAt || record.createdAt || nowIso(),
        revisions: Array.isArray(record.revisions) ? record.revisions : [], deletedAt: record.deletedAt || null, parentId: null
      });
    }
  }
  task.comments = task.comments.map((comment) => ({
    ...comment, id: comment.id || crypto.randomUUID(), type: comment.type || "comment",
    text: text(comment.text, 5000), author: text(comment.author, 50, "我") || "我",
    authorIdentityId: idOrNull(comment.authorIdentityId), parentId: idOrNull(comment.parentId),
    createdAt: comment.createdAt || nowIso(), updatedAt: comment.updatedAt || comment.createdAt || nowIso(),
    revisions: Array.isArray(comment.revisions) ? comment.revisions : [], deletedAt: comment.deletedAt || null,
    resolvedAt: comment.resolvedAt || null, resolvedBy: comment.resolvedBy || null,
    reactions: comment.reactions && typeof comment.reactions === "object" && !Array.isArray(comment.reactions) ? comment.reactions : {},
    mentions: Array.isArray(comment.mentions) ? comment.mentions : []
  }));
  if (!Array.isArray(task.watchers)) task.watchers = [];
  task.assigneeIdentityId = idOrNull(task.assigneeIdentityId);
  if (task.status === "cancelled" && !task.cancelReason) {
    const last = [...(task.history || [])].reverse().find((entry) => entry?.toStatus === "cancelled" && entry.reason);
    task.cancelReason = last?.reason || null;
  }
  if (!Array.isArray(task.attachments)) task.attachments = [];
  task.attachments = task.attachments.map((item) => ({
    ...item,
    id: item.id || crypto.randomUUID(),
    filename: text(item.filename, 200) || "attachment",
    contentType: text(item.contentType, 200) || "application/octet-stream",
    size: Number.isFinite(item.size) ? item.size : 0,
    commentId: idOrNull(item.commentId),
    objectKey: item.objectKey,
    createdByIdentityId: idOrNull(item.createdByIdentityId),
    createdAt: item.createdAt || nowIso()
  }));
  const createdEntry = task.history.find((entry) => entry?.action === "created" && typeof entry.actor === "string" && entry.actor.trim());
  task.creator = text(task.creator, 50) || text(createdEntry?.actor, 50, "我") || "我";
  task.creatorIdentityId = idOrNull(task.creatorIdentityId);
  // New reads never expose the old recycle-bin or execution projection.
  task.deletedAt = null;
  task.deletedBy = null;
  task.deletedByIdentityId = null;
  task.purgeAfter = null;
  delete task.deletedCascadeRootId;
  delete task.subtasks;
  delete task.taskType;
  delete task.assignmentStatus;
  delete task.formerAssigneeIdentityId;
  delete task.formerAssigneeDisplayName;
  return task;
}

export function createComment(task, value, author, parentId = null, options = {}) {
  ensureTaskExtras(task);
  const comment = {
    id: options.id || crypto.randomUUID(), type: options.type || "comment", text: text(value, 5000),
    author: text(author, 50, "我") || "我", ...(options.authorIdentityId ? { authorIdentityId: options.authorIdentityId } : {}),
    createdAt: options.createdAt || nowIso(), updatedAt: options.updatedAt || options.createdAt || nowIso(),
    parentId: idOrNull(parentId), revisions: [], resolvedAt: null, conclusion: options.conclusion || null, reactions: options.reactions || {}
  };
  task.comments.push(comment);
  return comment;
}

export function mentionedIdentityIds(textValue, members = []) {
  const lookup = new Map((members || []).map((member) => [String(member.displayName || "").toLowerCase(), member.id]));
  const ids = [];
  const seen = new Set();
  const pattern = /@([^\s@]+)/g;
  let match;
  while ((match = pattern.exec(String(textValue || "")))) {
    const id = lookup.get(match[1].toLowerCase());
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function addWatcher(task, identityId) {
  ensureTaskExtras(task);
  const id = idOrNull(identityId);
  if (id && !task.watchers.includes(id)) task.watchers.push(id);
  return task;
}

export function toggleCommentReaction(comment, emoji, identityId) {
  const key = text(emoji, 16);
  const actor = idOrNull(identityId);
  if (!key || !actor) return comment;
  const current = comment.reactions && typeof comment.reactions === "object" && !Array.isArray(comment.reactions) ? comment.reactions : {};
  const list = Array.isArray(current[key]) ? [...current[key]] : [];
  comment.reactions = { ...current, [key]: list.includes(actor) ? list.filter((id) => id !== actor) : [...list, actor] };
  if (!comment.reactions[key].length) delete comment.reactions[key];
  return comment;
}

export function createProgressRecord(task, value, author, authorIdentityId = null, id = null) {
  return createComment(task, value, author, null, { id, type: "progress_update", authorIdentityId });
}

function findComment(task, id) {
  ensureTaskExtras(task);
  return task.comments.find((comment) => comment.id === id && !comment.deletedAt) || null;
}

export function updateProgressRecord(task, recordId, value, actor, actorIdentityId = null) {
  const record = findComment(task, recordId);
  if (!record || record.type !== "progress_update") return null;
  const nextText = text(value, 5000);
  if (record.text === nextText) return record;
  const at = nowIso();
  record.revisions.push({ id: crypto.randomUUID(), action: "updated", text: record.text, at, actor: text(actor, 50, "我") || "我", actorIdentityId });
  record.text = nextText;
  record.updatedAt = at;
  return record;
}

export function deleteProgressRecord(task, recordId, actor, actorIdentityId = null) {
  const record = findComment(task, recordId);
  if (!record || record.type !== "progress_update") return null;
  const at = nowIso();
  record.revisions.push({ id: crypto.randomUUID(), action: "deleted", text: record.text, at, actor: text(actor, 50, "我") || "我", actorIdentityId });
  record.deletedAt = at;
  record.updatedAt = at;
  return record;
}

export function visibleProgressRecords(task) {
  ensureTaskExtras(task);
  return task.comments.filter((comment) => comment.type === "progress_update" && !comment.deletedAt);
}

export function createTask(input, tasks = [], actor = "我") {
  const normalized = normalizeTask(input);
  const parent = normalized.parentTaskId ? tasks.find((task) => task.id === normalized.parentTaskId) : null;
  const createdAt = input.createdAt || nowIso();
  // 默认状态按负责人分流：有负责人进待办，无负责人留在待整理；显式 status 优先
  const effectiveStatus = !STATUSES.includes(input.status) && normalized.assigneeIdentityId ? "todo" : normalized.status;
  const order = Math.max(-1, ...tasks.filter((item) => item.status === effectiveStatus).map((item) => item.order ?? 0)) + 1;
  const task = {
    id: input.id || crypto.randomUUID(), title: normalized.title, description: normalized.description,
    status: effectiveStatus, priority: normalized.priority, tags: normalized.tags,
    creator: text(input.creator || actor, 50, "我") || "我", creatorIdentityId: idOrNull(input.creatorIdentityId),
    assigneeIdentityId: normalized.assigneeIdentityId, parentTaskId: normalized.parentTaskId,
    // Inheritance happens once, at child creation. Later changes are explicit.
    projectId: normalized.projectId || parent?.projectId || null, stage: normalized.stage,
    dueDate: normalized.dueDate, blockReason: normalized.blockReason, cancelReason: normalized.cancelReason,
    comments: [], history: [], watchers: [idOrNull(input.creatorIdentityId), normalized.assigneeIdentityId].filter(Boolean)
      .filter((id, index, list) => list.indexOf(id) === index), order, createdAt, updatedAt: input.updatedAt || createdAt,
    startedAt: input.startedAt || (effectiveStatus === "in_progress" ? createdAt : null),
    completedAt: input.completedAt || (effectiveStatus === "done" ? createdAt : null),
    cancelledAt: input.cancelledAt || (normalized.status === "cancelled" ? createdAt : null)
  };
  recordHistory(task, { action: "created", toStatus: task.status, actor, at: createdAt, recordedAt: createdAt });
  return task;
}

export function calibrateTask(task, status, { reason, actor, effectiveAt }) {
  validateStatusTransition(task.status, status);
  const at = new Date(effectiveAt).toISOString();
  const previous = task.status;
  task.status = status;
  task.startedAt = status === "in_progress" ? at : null;
  task.completedAt = status === "done" ? at : null;
  task.cancelledAt = status === "cancelled" ? at : null;
  task.blockReason = status === "blocked" ? normalizeTransitionReason(reason) : null;
  task.cancelReason = status === "cancelled" ? normalizeTransitionReason(reason) : null;
  recordHistory(task, { action: "calibrated", fromStatus: previous, toStatus: status, reason, actor, at, recordedAt: nowIso() });
  task.updatedAt = nowIso();
  return task;
}

// Deprecated import-compatible helpers. The new HTTP API permanently removes
// tasks from the collection and never calls these functions.
export const TASK_RETENTION_DAYS = 0;
export function softDeleteTask(task, { actor, actorIdentityId = null, now = new Date() } = {}) {
  ensureTaskExtras(task);
  const at = now.toISOString();
  task.deletedAt = at;
  task.deletedBy = text(actor, 50, "我") || "我";
  task.deletedByIdentityId = actorIdentityId;
  task.updatedAt = at;
  recordHistory(task, { action: "deleted", actor: task.deletedBy, at, recordedAt: at });
  return task;
}

export function restoreTask(task, { actor, now = new Date() } = {}) {
  ensureTaskExtras(task);
  task.deletedAt = null;
  task.deletedBy = null;
  task.deletedByIdentityId = null;
  task.updatedAt = now.toISOString();
  recordHistory(task, { action: "restored", actor, at: task.updatedAt, recordedAt: task.updatedAt });
  return task;
}
