import crypto from "node:crypto";

export const STATUSES = ["planned", "todo", "in_progress", "blocked", "done", "cancelled"];
export const PRIORITIES = ["high", "medium", "low"];
export const STATUS_LABELS = {
  planned: "待规划", todo: "待办", in_progress: "进行中",
  blocked: "阻塞中", done: "已完成", cancelled: "已取消"
};
export const PRIORITY_LABELS = { high: "高", medium: "中", low: "低" };

const nowIso = () => new Date().toISOString();

export function normalizeTask(input) {
  const t = { ...input };
  if (typeof t.title !== "string" || !t.title.trim()) {
    throw Object.assign(new Error("任务标题不能为空"), { statusCode: 400 });
  }
  t.title = t.title.trim().slice(0, 200);
  if (!STATUSES.includes(t.status)) t.status = "todo";
  if (!PRIORITIES.includes(t.priority)) t.priority = "medium";
  t.description = typeof t.description === "string" ? t.description.trim().slice(0, 5000) : "";
  t.tags = Array.isArray(t.tags)
    ? [...new Set(t.tags.filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 20)))].slice(0, 8)
    : [];
  t.dueDate = typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : null;
  t.blockReason = typeof t.blockReason === "string" && t.blockReason.trim() ? t.blockReason.trim().slice(0, 200) : null;
  return t;
}

// 状态流转时间戳：进入 in_progress/done/cancelled 写对应时间戳，离开清空；
// 阻塞原因只在 blocked 状态保留。
export function applyStatusTransition(task, newStatus, opts = {}) {
  const now = nowIso();
  const prev = opts.prevStatus !== undefined ? opts.prevStatus : task.status;
  task.status = newStatus;
  task.startedAt = newStatus === "in_progress" ? now : null;
  task.completedAt = newStatus === "done" ? now : null;
  task.cancelledAt = newStatus === "cancelled" ? now : null;
  if (newStatus !== "blocked") task.blockReason = null;
  // 轨迹：仅当状态真实变化时追记一条「移动」
  if (prev !== newStatus) {
    recordHistory(task, { action: "moved", fromStatus: prev, toStatus: newStatus, actor: opts.actor });
  }
}

// 轨迹：追记一条卡片状态/操作时间线（创建、状态流转）
export function recordHistory(task, entry) {
  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({
    id: crypto.randomUUID(),
    at: nowIso(),
    actor: (entry.actor || "我").trim().slice(0, 50) || "我",
    action: entry.action,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null
  });
}

// 计算级字段兜底：老数据可能没有 comments / history
export function ensureTaskExtras(task) {
  if (!Array.isArray(task.comments)) task.comments = [];
  if (!Array.isArray(task.history)) task.history = [];
  return task;
}

// 新增一条评论
export function createComment(task, text, author, parentId = null) {
  ensureTaskExtras(task);
  const comment = { id: crypto.randomUUID(), text, author: (author || "我").trim().slice(0, 50) || "我", createdAt: nowIso(), parentId: parentId || null };
  task.comments.push(comment);
  return comment;
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
    dueDate: t.dueDate,
    blockReason: t.blockReason,
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
