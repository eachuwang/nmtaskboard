import crypto from "node:crypto";

export const STATUSES = ["planned", "todo", "in_progress", "blocked", "done", "cancelled"];
export const PRIORITIES = ["high", "medium", "low"];
export const STATUS_LABELS = {
  planned: "待规划", todo: "待办", in_progress: "进行中",
  blocked: "阻塞中", done: "已完成", cancelled: "已取消"
};
export const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" };
export const MANUAL_CREATE_STATUSES = ["planned", "todo"];
export const STATUS_TRANSITIONS = {
  planned: ["todo", "cancelled"],
  todo: ["in_progress", "cancelled"],
  in_progress: ["blocked", "done", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"]
};

const REASON_REQUIRED_TRANSITIONS = new Set([
  "planned:cancelled", "todo:cancelled", "in_progress:blocked", "in_progress:cancelled",
  "blocked:in_progress", "blocked:cancelled", "done:in_progress", "cancelled:todo"
]);

const nowIso = () => new Date().toISOString();
export const TASK_RETENTION_DAYS = 30;

export function normalizeTask(input) {
  const t = { ...input };
  if (typeof t.title !== "string" || !t.title.trim()) {
    throw Object.assign(new Error("任务标题不能为空"), { statusCode: 400 });
  }
  t.title = t.title.trim().slice(0, 200);
  if (!STATUSES.includes(t.status)) t.status = "planned";
  if (!PRIORITIES.includes(t.priority)) t.priority = "medium";
  t.description = typeof t.description === "string" ? t.description.trim().slice(0, 5000) : "";
  t.tags = Array.isArray(t.tags)
    ? [...new Set(t.tags.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 20)))].slice(0, 8)
    : [];
  t.assignees = Array.isArray(t.assignees)
    ? [...new Set(t.assignees.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 20)))].slice(0, 8)
    : [];
  t.dueDate = typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null;
  t.blockReason = typeof t.blockReason === "string" && t.blockReason.trim() ? t.blockReason.trim().slice(0, 200) : null;
  t.cancelReason = typeof t.cancelReason === "string" && t.cancelReason.trim() ? t.cancelReason.trim().slice(0, 200) : null;
  return t;
}

// 状态流转时间戳：进入 in_progress/done/cancelled 写对应时间戳，离开清空；
// 阻塞原因和取消原因只在各自状态保留。
export function applyStatusTransition(task, newStatus, opts = {}) {
  const now = nowIso();
  const prev = opts.prevStatus !== undefined ? opts.prevStatus : task.status;
  const reason = normalizeTransitionReason(opts.reason);
  validateStatusTransition(prev, newStatus, reason);
  if (prev === newStatus) return;
  task.status = newStatus;
  task.startedAt = newStatus === "in_progress" ? now : null;
  task.completedAt = newStatus === "done" ? now : null;
  task.cancelledAt = newStatus === "cancelled" ? now : null;
  task.blockReason = newStatus === "blocked" ? reason : null;
  task.cancelReason = newStatus === "cancelled" ? reason : null;
  // 轨迹：仅当状态真实变化时追记一条「移动」
  if (prev !== newStatus) {
    recordHistory(task, { action: "moved", fromStatus: prev, toStatus: newStatus, actor: opts.actor, reason });
  }
}

export function cancelParentTask(parent, tasks, { actor, reason }) {
  const normalizedReason = normalizeTransitionReason(reason);
  applyStatusTransition(parent, "cancelled", { actor, reason: normalizedReason });
  parent.updatedAt = new Date().toISOString();
  const affectedExecutions = [];
  const cancelledExecutions = [];
  for (const execution of tasks) {
    if (execution.taskType !== "execution" || execution.parentTaskId !== parent.id || execution.assignmentStatus === "removed") continue;
    if (execution.status === "cancelled") continue;
    execution.parentCancelledAt = parent.cancelledAt;
    execution.parentCancelReason = normalizedReason;
    if (execution.status !== "done") {
      applyStatusTransition(execution, "cancelled", { actor, reason: `因父任务取消：${normalizedReason}` });
      cancelledExecutions.push(execution);
    } else if (execution.status === "done") {
      recordHistory(execution, { action: "parent_cancelled", actor, reason: normalizedReason });
    }
    execution.updatedAt = parent.updatedAt;
    affectedExecutions.push(execution);
  }
  return { parent, affectedExecutions, cancelledExecutions };
}

export function normalizeTransitionReason(value) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
}

export function validateStatusTransition(fromStatus, toStatus, reason) {
  if (!STATUSES.includes(toStatus)) {
    throw Object.assign(new Error("非法状态"), { statusCode: 400 });
  }
  if (fromStatus === toStatus) return;
  if (!STATUS_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    const from = STATUS_LABELS[fromStatus] || fromStatus;
    const to = STATUS_LABELS[toStatus] || toStatus;
    throw Object.assign(new Error(`不能从「${from}」直接移至「${to}」`), { statusCode: 400 });
  }
  if (REASON_REQUIRED_TRANSITIONS.has(`${fromStatus}:${toStatus}`) && !normalizeTransitionReason(reason)) {
    throw Object.assign(new Error("本次状态变更必须填写原因"), { statusCode: 400 });
  }
}

export function isTransitionReasonRequired(fromStatus, toStatus) {
  return REASON_REQUIRED_TRANSITIONS.has(`${fromStatus}:${toStatus}`);
}

// 轨迹：追记一条卡片状态/操作时间线（创建、状态流转）
export function recordHistory(task, entry) {
  if (!Array.isArray(task.history)) task.history = [];
  const recordedAt = entry.recordedAt || nowIso();
  task.history.push({
    id: crypto.randomUUID(),
    at: entry.at || recordedAt,
    recordedAt,
    actor: (entry.actor || "我").trim().slice(0, 50) || "我",
    action: entry.action,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    reason: normalizeTransitionReason(entry.reason)
  });
}

// 计算级字段兜底：老数据可能没有 comments / history
export function ensureTaskExtras(task) {
  if (!Array.isArray(task.comments)) task.comments = [];
  if (!Array.isArray(task.history)) task.history = [];
  if (!Array.isArray(task.progressRecords)) {
    task.progressRecords = task.comments.map((comment) => ({
      id: comment.id || crypto.randomUUID(),
      text: comment.text || "",
      author: (comment.author || "我").trim().slice(0, 50) || "我",
      ...(comment.authorIdentityId ? { authorIdentityId: comment.authorIdentityId } : {}),
      createdAt: comment.createdAt || nowIso(),
      updatedAt: comment.createdAt || nowIso(),
      revisions: [],
      deletedAt: null,
      ...(comment.parentId ? { legacyParentId: comment.parentId } : {})
    }));
  } else {
    task.progressRecords = task.progressRecords.map((record) => ({
      ...record,
      text: typeof record.text === "string" ? record.text : "",
      author: (record.author || "我").trim().slice(0, 50) || "我",
      createdAt: record.createdAt || nowIso(),
      updatedAt: record.updatedAt || record.createdAt || nowIso(),
      revisions: Array.isArray(record.revisions) ? record.revisions : [],
      deletedAt: record.deletedAt || null
    }));
  }
  task.cancelReason = task.status === "cancelled" ? normalizeTransitionReason(task.cancelReason) : null;
  if (task.status === "cancelled" && !task.cancelReason) {
    const cancelled = [...task.history].reverse().find((entry) => entry.toStatus === "cancelled" && normalizeTransitionReason(entry.reason));
    task.cancelReason = normalizeTransitionReason(cancelled?.reason);
  }
  if (typeof task.creator !== "string" || !task.creator.trim()) {
    const created = task.history.find((h) => h.action === "created");
    task.creator = ((created && created.actor) || "我").trim().slice(0, 50) || "我";
  }
  if (!Array.isArray(task.assignees)) task.assignees = [];
  task.deletedAt = task.deletedAt || null;
  task.deletedBy = task.deletedBy || null;
  task.deletedByIdentityId = task.deletedByIdentityId || null;
  task.purgeAfter = task.purgeAfter || null;
  task.deletedCascadeRootId = task.deletedCascadeRootId || null;
  return task;
}

export function softDeleteTask(task, { actor, actorIdentityId = null, cascadeRootId = null, now = new Date() }) {
  ensureTaskExtras(task);
  if (task.deletedAt) return task;
  const deletedAt = now.toISOString();
  const purgeAfter = new Date(now.getTime() + TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  task.deletedAt = deletedAt;
  task.deletedBy = (actor || "我").trim().slice(0, 50) || "我";
  task.deletedByIdentityId = actorIdentityId || null;
  task.purgeAfter = purgeAfter;
  task.deletedCascadeRootId = cascadeRootId;
  task.updatedAt = deletedAt;
  recordHistory(task, { action: "deleted", actor: task.deletedBy, recordedAt: deletedAt, at: deletedAt });
  return task;
}

export function restoreTask(task, { actor, now = new Date() }) {
  ensureTaskExtras(task);
  if (!task.deletedAt) return task;
  const restoredAt = now.toISOString();
  task.deletedAt = null;
  task.deletedBy = null;
  task.deletedByIdentityId = null;
  task.purgeAfter = null;
  task.deletedCascadeRootId = null;
  task.updatedAt = restoredAt;
  recordHistory(task, { action: "restored", actor, recordedAt: restoredAt, at: restoredAt });
  return task;
}

// 新增一条评论
export function createComment(task, text, author, parentId = null) {
  ensureTaskExtras(task);
  const comment = { id: crypto.randomUUID(), text, author: (author || "我").trim().slice(0, 50) || "我", createdAt: nowIso(), parentId: parentId || null };
  task.comments.push(comment);
  return comment;
}

// 进展记录：独立、不可回复的事实记录。修订和删除均保留在 revisions 中。
export function createProgressRecord(task, text, author, authorIdentityId = null, id = null) {
  ensureTaskExtras(task);
  const now = nowIso();
  const record = {
    id: id || crypto.randomUUID(),
    text: text.trim(),
    author: (author || "我").trim().slice(0, 50) || "我",
    ...(authorIdentityId ? { authorIdentityId } : {}),
    createdAt: now,
    updatedAt: now,
    revisions: [],
    deletedAt: null
  };
  task.progressRecords.push(record);
  return record;
}

export function updateProgressRecord(task, recordId, text, actor, actorIdentityId = null) {
  ensureTaskExtras(task);
  const record = task.progressRecords.find((item) => item.id === recordId);
  if (!record || record.deletedAt) return null;
  const nextText = text.trim();
  if (record.text === nextText) return record;
  const now = nowIso();
  record.revisions = [...(record.revisions || []), {
    id: crypto.randomUUID(),
    action: "updated",
    text: record.text,
    at: now,
    actor: (actor || "我").trim().slice(0, 50) || "我",
    ...(actorIdentityId ? { actorIdentityId } : {})
  }];
  record.text = nextText;
  record.updatedAt = now;
  return record;
}

export function deleteProgressRecord(task, recordId, actor, actorIdentityId = null) {
  ensureTaskExtras(task);
  const record = task.progressRecords.find((item) => item.id === recordId);
  if (!record || record.deletedAt) return null;
  const now = nowIso();
  record.revisions = [...(record.revisions || []), {
    id: crypto.randomUUID(),
    action: "deleted",
    text: record.text,
    at: now,
    actor: (actor || "我").trim().slice(0, 50) || "我",
    ...(actorIdentityId ? { actorIdentityId } : {})
  }];
  record.deletedAt = now;
  record.updatedAt = now;
  return record;
}

export function visibleProgressRecords(task) {
  ensureTaskExtras(task);
  return task.progressRecords.filter((record) => !record.deletedAt);
}

export function createTask(input, tasks, actor) {
  const t = normalizeTask(input);
  const order = Math.max(-1, ...tasks.filter(x => x.status === t.status).map(x => x.order ?? 0)) + 1;
  const task = {
    id: crypto.randomUUID(),
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    tags: t.tags,
    creator: ((t.creator || actor || "我") + "").trim().slice(0, 50) || "我",
    assignees: t.assignees,
    dueDate: t.dueDate,
    blockReason: t.blockReason,
    cancelReason: null,
    subtasks: Array.isArray(input?.subtasks) ? input.subtasks : [],
    comments: [],
    history: [],
    order,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    completedAt: null,
    cancelledAt: null
  };
  applyStatusTransition(task, t.status);
  recordHistory(task, { action: "created", toStatus: t.status, actor });
  return task;
}

export function calibrateTask(task, status, { reason, actor, effectiveAt }) {
  const prevStatus = task.status;
  const at = new Date(effectiveAt).toISOString();
  task.status = status;
  task.startedAt = status === "in_progress" ? at : null;
  task.completedAt = status === "done" ? at : null;
  task.cancelledAt = status === "cancelled" ? at : null;
  task.blockReason = status === "blocked" ? normalizeTransitionReason(reason) : null;
  task.cancelReason = status === "cancelled" ? normalizeTransitionReason(reason) : null;
  recordHistory(task, {
    action: "calibrated",
    fromStatus: prevStatus,
    toStatus: status,
    reason,
    actor,
    at,
    recordedAt: nowIso()
  });
  task.updatedAt = nowIso();
  return task;
}
