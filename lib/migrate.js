import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { jsonStore } from "./store.js";

export const MIGRATION_MARK = ".migrated-v2";
const STATUS_MAP = { todo: "todo", in_progress: "in_progress", done: "done", archived: "cancelled" };
const PRIORITY_MAP = { urgent: "high" };

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

  const migrated = legacy.map((t) => {
    const status = STATUS_MAP[t.status] || "todo";
    return {
      id: typeof t.id === "string" && t.id ? t.id : crypto.randomUUID(),
      title: String(t.title || "").slice(0, 200) || "未命名任务",
      description: typeof t.description === "string" ? t.description.slice(0, 5000) : "",
      status,
      priority: ["high", "medium", "low"].includes(t.priority)
        ? t.priority
        : PRIORITY_MAP[t.priority] || "medium",
      tags: Array.isArray(t.tags)
        ? [...new Set(t.tags.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 20)))].slice(0, 8)
        : [],
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate || "") ? t.dueDate : null,
      blockReason: null,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks : [], // 保留在 JSON，UI 与 API 不展示
      order: typeof t.order === "number" ? t.order : 0,
      createdAt: typeof t.createdAt === "string" ? t.createdAt : now,
      updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : now,
      startedAt: null,
      completedAt: typeof t.completedAt === "string" ? t.completedAt : status === "done" ? (t.updatedAt || now) : null,
      cancelledAt: status === "cancelled" ? (t.updatedAt || now) : null
    };
  });

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
