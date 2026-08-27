import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { runMigrationOnce, MIGRATION_MARK, defaultLegacyFile } from "../lib/migrate.js";
import { loadConfig } from "../lib/config.js";

function fakeLegacyDir(tasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tb-legacy-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "tasks.json"), JSON.stringify({ tasks }, null, 2));
  return path.join(dir, "data", "tasks.json");
}
function v2Config(tmp, legacyFile) {
  return loadConfig({ PORT: "0", DATA_DIR: tmp, CONFIG_FILE: path.join(tmp, "config.json") });
}

test("数据库配置：DATABASE_URL 自动启用 PostgreSQL，可显式保留 JSON", () => {
  const postgres = loadConfig({ DATABASE_URL: "postgres://localhost/nmtaskboard", DATABASE_SCHEMA: "team_a" });
  assert.equal(postgres.persistenceDriver, "postgres");
  assert.equal(postgres.databaseUrl, "postgres://localhost/nmtaskboard");
  assert.equal(postgres.databaseSchema, "team_a");

  const json = loadConfig({ DATABASE_URL: "postgres://localhost/nmtaskboard", PERSISTENCE_DRIVER: "json" });
  assert.equal(json.persistenceDriver, "json");
});

const legacyTasks = () => [
  { id: "t1", title: "旧待办", status: "todo", priority: "high", tags: ["工作"], dueDate: "2026-08-20", subtasks: [{ id: "s1", text: "子任务", done: false }], order: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", completedAt: null },
  { id: "t2", title: "旧进行中", status: "in_progress", priority: "urgent", tags: [], dueDate: null, subtasks: [], order: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", completedAt: null },
  { id: "t3", title: "旧完成", status: "done", priority: "medium", tags: [], dueDate: null, subtasks: [], order: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", completedAt: "2026-08-02T00:00:00.000Z" },
  { id: "t4", title: "旧归档", status: "archived", priority: "low", tags: [], dueDate: null, subtasks: [], order: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z", completedAt: null }
];

test("迁移映射：todo/in_progress/done/archived → 六列，urgent→high，subtasks 保留", async () => {
  const legacy = fakeLegacyDir(legacyTasks());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tb-v2-mig-"));
  const config = { ...v2Config(tmp, legacy), legacyTasksFile: legacy };
  const r = await runMigrationOnce(config);
  assert.equal(r.migrated, true);
  assert.equal(r.count, 4);
  assert.ok(fs.existsSync(r.backupFile), "备份文件存在");

  const data = JSON.parse(fs.readFileSync(path.join(tmp, "tasks.json"), "utf8"));
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  assert.equal(byId.get("t1").status, "todo");
  assert.equal(byId.get("t2").status, "in_progress");
  assert.equal(byId.get("t2").priority, "high", "urgent 映射为 high");
  assert.equal(byId.get("t3").status, "done");
  assert.ok(byId.get("t3").completedAt);
  assert.equal(byId.get("t4").status, "cancelled");
  assert.ok(byId.get("t4").cancelledAt);
  assert.deepEqual(byId.get("t1").subtasks, [{ id: "s1", text: "子任务", done: false }], "subtasks 原样保留");
  assert.equal(byId.get("t1").blockReason, null);
  assert.equal(byId.get("t1").dueDate, "2026-08-20");
});

test("幂等：标记存在则跳过；删除标记可重试", async () => {
  const legacy = fakeLegacyDir(legacyTasks());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tb-v2-mig2-"));
  const config = { ...v2Config(tmp, legacy), legacyTasksFile: legacy };
  const first = await runMigrationOnce(config);
  assert.equal(first.migrated, true);
  const again = await runMigrationOnce(config);
  assert.equal(again.migrated, false);
  assert.equal(again.reason, "already");

  fs.rmSync(path.join(tmp, MIGRATION_MARK));
  const retry = await runMigrationOnce(config);
  assert.equal(retry.migrated, true);
  // 与已有数据按 id 合并，不重复
  const data = JSON.parse(fs.readFileSync(path.join(tmp, "tasks.json"), "utf8"));
  assert.equal(data.tasks.length, 4);
});

test("旧文件不存在：不迁移也不写标记", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tb-v2-mig3-"));
  const config = { ...v2Config(tmp, null), legacyTasksFile: path.join(tmp, "不存在.json") };
  const r = await runMigrationOnce(config);
  assert.equal(r.migrated, false);
  assert.equal(r.reason, "no-legacy");
  assert.ok(!fs.existsSync(path.join(tmp, MIGRATION_MARK)));
});

test("默认旧文件候选路径指向 task-board/ 子目录", () => {
  const cfg = { projectRoot: "/app/task-board-v2" };
  const p = defaultLegacyFile(cfg);
  assert.ok(p.endsWith(path.join("task-board", "data", "tasks.json")));
});

test("旧项目文件全程只读：迁移后旧文件内容不变", async () => {
  const legacy = fakeLegacyDir(legacyTasks());
  const before = fs.readFileSync(legacy, "utf8");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tb-v2-mig4-"));
  const config = { ...v2Config(tmp, legacy), legacyTasksFile: legacy };
  await runMigrationOnce(config);
  assert.equal(fs.readFileSync(legacy, "utf8"), before);
  // 旧目录里不应新增任何文件
  assert.deepEqual(fs.readdirSync(path.dirname(legacy)).sort(), ["tasks.json"]);
});
