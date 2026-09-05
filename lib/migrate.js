import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { jsonStore } from "./store.js";

export const MIGRATION_MARK = ".migrated-v2";
const STATUS_MAP = {
  planned: "backlog", backlog: "backlog", todo: "todo", in_progress: "in_progress",
  in_review: "in_review", blocked: "blocked", done: "done", cancelled: "cancelled", archived: "cancelled"
};
const PRIORITY_MAP = { urgent: "urgent", critical: "urgent" };

function convertLegacyTask(raw, now, parentTaskId = null, usedIds = new Set()) {
  const id = typeof raw.id === "string" && raw.id && !usedIds.has(raw.id) ? raw.id : crypto.randomUUID();
  usedIds.add(id);
  const status = STATUS_MAP[raw.status] || "backlog";
  const legacyParentTaskId = typeof raw.parentTaskId === "string" && raw.parentTaskId ? raw.parentTaskId : null;
  const resolvedParentTaskId = parentTaskId || (legacyParentTaskId && legacyParentTaskId !== id ? legacyParentTaskId : null);
  const legacyAssignee = typeof raw.assigneeIdentityId === "string" && raw.assigneeIdentityId
    ? raw.assigneeIdentityId
    : null;
  const task = {
    ...raw,
    id,
    title: String(raw.title || raw.text || "").slice(0, 200) || "未命名任务",
    description: typeof raw.description === "string" ? raw.description.slice(0, 5000) : "",
    status,
    priority: ["urgent", "high", "medium", "low", "none"].includes(raw.priority)
      ? raw.priority
      : PRIORITY_MAP[raw.priority] || "medium",
    tags: Array.isArray(raw.tags)
      ? [...new Set(raw.tags.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 20)))].slice(0, 8)
      : [],
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate || "") ? raw.dueDate : null,
    parentTaskId: resolvedParentTaskId,
    assigneeIdentityId: legacyAssignee,
    blockReason: status === "blocked" && typeof raw.blockReason === "string" ? raw.blockReason.slice(0, 500) : null,
    cancelReason: status === "cancelled" && typeof raw.cancelReason === "string" ? raw.cancelReason.slice(0, 500) : null,
    order: typeof raw.order === "number" ? raw.order : 0,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    startedAt: status === "in_progress" && typeof raw.startedAt === "string" ? raw.startedAt : null,
    completedAt: status === "done" ? (typeof raw.completedAt === "string" ? raw.completedAt : (raw.updatedAt || now)) : null,
    cancelledAt: status === "cancelled" ? (typeof raw.cancelledAt === "string" ? raw.cancelledAt : (raw.updatedAt || now)) : null,
    creator: typeof raw.creator === "string" ? raw.creator.slice(0, 50) : "我",
    creatorIdentityId: typeof raw.creatorIdentityId === "string" && raw.creatorIdentityId ? raw.creatorIdentityId : null,
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    progressRecords: []
  };
  if (raw.taskType === "execution" && raw.assignmentStatus === "removed") {
    task.status = "cancelled";
    task.assigneeIdentityId = null;
    task.cancelReason = task.cancelReason || "迁移时负责人已移除";
    task.cancelledAt = task.cancelledAt || now;
  }
  const existingCommentIds = new Set(task.comments.map((comment) => comment.id));
  for (const record of Array.isArray(raw.progressRecords) ? raw.progressRecords : []) {
    if (existingCommentIds.has(record.id)) continue;
    task.comments.push({
      id: record.id || crypto.randomUUID(),
      type: "progress_update",
      text: String(record.text || "").slice(0, 5000),
      author: typeof record.author === "string" && record.author.trim() ? record.author.slice(0, 50) : "我",
      authorIdentityId: typeof record.authorIdentityId === "string" ? record.authorIdentityId : null,
      createdAt: record.createdAt || now,
      updatedAt: record.updatedAt || record.createdAt || now,
      revisions: Array.isArray(record.revisions) ? record.revisions : [],
      deletedAt: record.deletedAt || null,
      parentId: null
    });
  }
  delete task.subtasks;
  delete task.taskType;
  delete task.assignmentStatus;
  delete task.assignees;
  delete task.participants;
  delete task.formerAssigneeIdentityId;
  delete task.formerAssigneeDisplayName;
  const children = Array.isArray(raw.subtasks) ? raw.subtasks : [];
  return [task, ...children.flatMap((child) => convertLegacyTask(child || {}, now, id, usedIds))];
}

// 旧项目数据文件候选位置（只读；可用 config.legacyTasksFile 覆盖，测试用）
export function defaultLegacyFile(config) {
  return path.resolve(config.projectRoot, "..", "task-board", "data", "tasks.json");
}

// 一次性迁移：备份旧数据 → 映射导入 → 写标记。旧文件不存在时不写标记（下次启动再探测）。
export async function runMigrationOnce(config) {
  const mark = path.join(config.dataDir, MIGRATION_MARK);
  if (fs.existsSync(mark)) return { migrated: false, reason: "already" };
  const src = config.legacyTasksFile || defaultLegacyFile(config);
  if (!fs.existsSync(src)) return { migrated: false, reason: "no-legacy" };

  const raw = JSON.parse(fs.readFileSync(src, "utf8"));
  const legacy = Array.isArray(raw?.tasks) ? raw.tasks : [];
  const now = new Date().toISOString();

  const migrated = legacy.flatMap((task) => convertLegacyTask(task || {}, now));

  // 备份旧数据到 v2 数据目录（只读旧项目，不写旧项目任何文件）
  const backupFile = path.join(config.dataDir, "migration-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json");
  fs.copyFileSync(src, backupFile);

  // 与 v2 已有数据按 id 合并（不重复导入）
  const store = jsonStore(config.dataDir, "tasks.json", { tasks: [] });
  const { tasks: existing } = store.read();
  const existingIds = new Set(existing.map((t) => t.id));
  store.write({ tasks: [...existing, ...migrated.filter((t) => !existingIds.has(t.id))] });

  fs.writeFileSync(mark, JSON.stringify({ at: now, count: migrated.length, backupFile }, null, 2));
  return { migrated: true, count: migrated.length, backupFile };
}
