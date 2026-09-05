import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { persistableDrafts, sessionError } from "./agent-sessions.js";
import { BUILTIN_ADMIN_ID } from "./builtin-admin.js";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";
import { DEFAULT_LOCAL_ACTOR_ID, DEFAULT_PERSONAL_WORKSPACE_ID, localPersonalContext } from "./personal-space.js";
import { normalizeProject, normalizeResource } from "./projects.js";
import { normalizeCatalogEntry } from "./repositories.js";
import { applyStatusTransition, cancelParentTask, createTask, ensureTaskExtras, normalizeTask, normalizeTransitionReason, recordHistory } from "./tasks.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "postgres", "migrations");
const SETTINGS_DEFAULTS = {
  providers: [],
  defaultProviderId: "",
  temperature: 0.7,
  tags: [],
  reportTimeZone: DEFAULT_REPORT_TIME_ZONE
};

function schemaIdentifier(value) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value || "")) {
    throw new Error("DATABASE_SCHEMA 仅允许小写字母、数字和下划线，且必须以字母开头");
  }
  return `"${value}"`;
}

export function loadPostgresMigrations(dir = migrationsDir) {
  return fs.readdirSync(dir)
    .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      version: Number(name.slice(0, name.indexOf("_"))),
      name,
      sql: fs.readFileSync(path.join(dir, name), "utf8")
    }));
}

export async function runPostgresMigrations(pool, schema, migrations = loadPostgresMigrations()) {
  const identifier = schemaIdentifier(schema);
  const client = await pool.connect();
  const report = { schema, status: "pending", total: migrations.length, skipped: [], attempted: [], failed: null };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`nmtaskboard:${schema}`]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${identifier}`);
    await client.query(`SET LOCAL search_path TO ${identifier}, public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version integer PRIMARY KEY,
        name text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((row) => row.version));
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        report.skipped.push(migration.name);
        continue;
      }
      report.attempted.push(migration.name);
      report.failed = migration.name;
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
      report.failed = null;
    }
    await client.query("COMMIT");
    report.status = "applied";
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    report.status = "rolled_back";
    error.migrationReport = report;
    throw error;
  } finally {
    client.release();
  }
}

function postgresContext(context) {
  const actorId = context?.actor?.id;
  const actorName = context?.actor?.displayName;
  const workspaceId = context?.workspace?.id;
  const workspaceType = context?.workspace?.type;
  if (!actorId || !actorName || !workspaceId || !["workspace", "personal", "team"].includes(workspaceType)) {
    throw new Error("持久化操作缺少有效的 actor/workspace 上下文");
  }
  return { actorId, actorName, workspaceId, workspaceType: "workspace" };
}

function timestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function asIso(value) {
  if (value instanceof Date) return value.toISOString();
  return timestamp(value);
}

function cancelRequestFrom(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentTaskId: row.parent_task_id,
    executionTaskId: row.execution_task_id,
    requester: { id: row.requester_identity_id, displayName: row.requester_display_name },
    reason: row.reason,
    status: row.status,
    decisionReason: row.decision_reason || null,
    decidedBy: row.decided_by_identity_id ? { id: row.decided_by_identity_id, displayName: row.decided_by_display_name } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function progressRecordFrom(row) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const asIso = (value) => value instanceof Date ? value.toISOString() : value;
  return {
    ...payload,
    id: row.id,
    text: row.text,
    author: row.author_display_name,
    ...(payload.authorIdentityId ? { authorIdentityId: row.author_identity_id || payload.authorIdentityId } : {}),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    revisions: Array.isArray(payload.revisions) ? payload.revisions : [],
    deletedAt: asIso(row.deleted_at) || null
  };
}

function readJsonSource(file, fallback) {
  if (!fs.existsSync(file)) return { exists: false, bytes: "", value: fallback };
  const bytes = fs.readFileSync(file, "utf8");
  return { exists: true, bytes, value: JSON.parse(bytes) };
}

export function readLegacyPersonalData(config) {
  if (!config.dataDir) return null;
  const tasksFile = path.join(config.dataDir, "tasks.json");
  const settingsFile = path.join(config.dataDir, "settings.json");
  const taskSource = readJsonSource(tasksFile, { tasks: [] });
  const settingsSource = readJsonSource(settingsFile, { ...SETTINGS_DEFAULTS });
  if (!taskSource.exists && !settingsSource.exists) return null;
  if (!Array.isArray(taskSource.value?.tasks)) throw new Error("tasks.json 缺少 tasks 数组，无法迁移");
  if (!settingsSource.value || Array.isArray(settingsSource.value) || typeof settingsSource.value !== "object") {
    throw new Error("settings.json 不是有效对象，无法迁移");
  }
  const digest = crypto.createHash("sha256")
    .update(taskSource.bytes)
    .update("\0")
    .update(settingsSource.bytes)
    .digest("hex");
  return {
    digest,
    tasks: taskSource.value.tasks,
    settings: settingsSource.value
  };
}

async function transaction(pool, schema, operation) {
  const identifier = schemaIdentifier(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${identifier}, public`);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function snapshot(pool, schema, operation) {
  const identifier = schemaIdentifier(schema);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL search_path TO ${identifier}, public`);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function query(pool, schema, text, values) {
  const identifier = schemaIdentifier(schema);
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${identifier}, public`);
    return await client.query(text, values);
  } finally {
    client.release();
  }
}

async function ensureContext(client, context) {
  const current = postgresContext(context);
  await client.query(`
    INSERT INTO identities (id, display_name)
    VALUES ($1, $2)
    ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
  `, [current.actorId, current.actorName]);
  const sourceName = context?.workspace?.name || `${current.actorName}的工作区`;
  const baseSlug = String(context?.workspace?.slug || current.workspaceId)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || current.workspaceId.slice(0, 60);
  await client.query(`
    INSERT INTO workspaces (id, type, name, slug, task_prefix, created_by_identity_id)
    VALUES ($1, 'workspace', $2, $3, $3, $4)
    ON CONFLICT (id) DO NOTHING
  `, [current.workspaceId, sourceName, baseSlug, current.actorId]);
  await client.query(`
    INSERT INTO workspace_members (workspace_id, identity_id, role)
    VALUES ($1, $2, 'owner')
    ON CONFLICT (workspace_id, identity_id) DO NOTHING
  `, [current.workspaceId, current.actorId]);
  return current;
}

function canonicalizeLegacyTask(rawTask, taskIds) {
  const legacy = { ...rawTask };
  const status = legacy.status === "planned" ? "backlog" : legacy.status;
  const parentTaskId = legacy.parentTaskId && taskIds.has(legacy.parentTaskId) ? legacy.parentTaskId : null;
  const oldParticipant = Array.isArray(legacy.participants) ? legacy.participants.find((item) => item?.identityId) : null;
  const assigneeIdentityId = legacy.assigneeIdentityId || oldParticipant?.identityId || null;
  const converted = {
    ...legacy,
    status,
    parentTaskId,
    assigneeIdentityId,
    ...(legacy.taskType === "execution" && legacy.assignmentStatus === "removed" ? {
      status: "cancelled", assigneeIdentityId: null, cancelReason: legacy.cancelReason || "迁移时负责人已移除"
    } : {})
  };
  delete converted.taskType;
  delete converted.assignmentStatus;
  delete converted.participants;
  delete converted.assignees;
  delete converted.formerAssigneeIdentityId;
  delete converted.formerAssigneeDisplayName;
  return converted;
}

async function replaceTasks(client, current, tasks, { memberExecutionOnly = false } = {}) {
  const inputTasks = Array.isArray(tasks) ? tasks : [];
  const taskIds = new Set(inputTasks.map((task) => task.id));
  const canonicalTasks = inputTasks.map((task) => canonicalizeLegacyTask(task, taskIds));
  const byId = new Map(canonicalTasks.map((task) => [task.id, task]));
  const depth = (task, trail = new Set()) => {
    if (!task.parentTaskId || trail.has(task.id)) return 0;
    trail.add(task.id);
    return 1 + depth(byId.get(task.parentTaskId) || {}, trail);
  };
  // Parent rows are inserted first so the composite self-reference is valid.
  const nextTasks = [...canonicalTasks].sort((a, b) => depth(a) - depth(b) || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
  // 编号分配必须全局防碰：已有编号可能缺号/乱序/历史遗留，顺延 index 会与保留编号撞唯一约束
  const taskNumbers = new Map();
  const usedNumbers = new Set();
  const numbered = [...canonicalTasks]
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id).localeCompare(String(b.id)));
  for (const task of numbered) {
    const existing = Number.isFinite(task.taskNumber) && task.taskNumber > 0 && !usedNumbers.has(task.taskNumber) ? task.taskNumber : null;
    if (existing) { usedNumbers.add(existing); taskNumbers.set(task.id, existing); }
  }
  let cursor = 1;
  for (const task of numbered) {
    if (taskNumbers.has(task.id)) continue;
    while (usedNumbers.has(cursor)) cursor += 1;
    usedNumbers.add(cursor);
    taskNumbers.set(task.id, cursor);
  }
  await client.query("DELETE FROM tasks WHERE workspace_id = $1", [current.workspaceId]);
  for (const [ordinal, rawTask] of nextTasks.entries()) {
    const task = normalizeTask(rawTask);
    Object.assign(rawTask, task);
    ensureTaskExtras(task);
    await client.query(`
      INSERT INTO tasks (
        workspace_id, id, ordinal, title, status, priority, creator_identity_id,
        due_date, created_at, updated_at, task_number, parent_task_id, project_id, assignee_identity_id, stage, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
    `, [
      current.workspaceId, task.id, ordinal, task.title, task.status, task.priority,
      task.creatorIdentityId || (task.creator === current.actorName ? current.actorId : null),
      task.dueDate || null, timestamp(task.createdAt), timestamp(task.updatedAt), taskNumbers.get(task.id),
      task.parentTaskId || null, task.projectId || null, task.assigneeIdentityId || null, task.stage, JSON.stringify({ ...task, taskNumber: taskNumbers.get(task.id) })
    ]);
    for (const [index, entry] of (task.history || []).entries()) {
      await client.query(`
        INSERT INTO task_history (
          workspace_id, task_id, id, actor_identity_id, actor_display_name,
          action, occurred_at, recorded_at, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `, [
        current.workspaceId, task.id, entry.id || `${task.id}:history:${index}`,
        entry.actor === current.actorName ? current.actorId : null, entry.actor || "我", entry.action,
        timestamp(entry.at) || new Date(0).toISOString(), timestamp(entry.recordedAt) || timestamp(entry.at) || new Date(0).toISOString(),
        JSON.stringify(entry)
      ]);
    }
    for (const [index, comment] of (task.comments || []).entries()) {
      await client.query(`
        INSERT INTO task_comments (
          workspace_id, task_id, id, author_identity_id, author_display_name,
          parent_id, created_at, updated_at, deleted_at, type, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      `, [
        current.workspaceId, task.id, comment.id || `${task.id}:comment:${index}`,
        comment.authorIdentityId || (comment.author === current.actorName ? current.actorId : null), comment.author || "我",
        comment.parentId || null, timestamp(comment.createdAt) || new Date(0).toISOString(), timestamp(comment.updatedAt) || timestamp(comment.createdAt) || new Date(0).toISOString(),
        timestamp(comment.deletedAt), comment.type || "comment", JSON.stringify(comment)
      ]);
    }
  }
}

function tasksAdapter(pool, schema) {
  return {
    async load(context) {
      const { workspaceId } = postgresContext(context);
      const result = await query(pool, schema, "SELECT payload FROM tasks WHERE workspace_id = $1 ORDER BY ordinal", [workspaceId]);
      return result.rows.map((row) => ensureTaskExtras({ ...row.payload }));
    },
    async save(context, tasks) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await replaceTasks(client, current, tasks);
      });
    },
    async saveWithAudit(context, tasks, auditEvent, expectedVersions = []) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        const stored = await client.query(
          "SELECT payload FROM tasks WHERE workspace_id = $1 ORDER BY ordinal FOR UPDATE",
          [current.workspaceId]
        );
        const persisted = stored.rows.map((row) => row.payload);
        const persistedById = new Map(persisted.map((task) => [task.id, task]));
        const incomingById = new Map(tasks.map((task) => [task.id, task]));
        const changedIds = new Set();
        for (const expected of expectedVersions) {
          const task = persistedById.get(expected.taskId);
          if (!task || (task.updatedAt || null) !== (expected.expectedUpdatedAt || null)) {
            throw Object.assign(new Error("任务已被其他操作更新，请重新生成操作计划"), { code: "AGENT_PLAN_STALE", statusCode: 409 });
          }
          if (!incomingById.has(expected.taskId)) {
            throw Object.assign(new Error("Agent 操作结果缺少目标任务"), { code: "AGENT_ACTION_RESULT_INVALID", statusCode: 500 });
          }
          changedIds.add(expected.taskId);
        }
        const merged = persisted.map((task) => changedIds.has(task.id) ? incomingById.get(task.id) : task);
        await replaceTasks(client, current, merged);
        await insertAuditEvent(client, auditEvent);
      });
    },
    async assign(context, taskId, identityIds, source = "ui", expectedUpdatedAt = null, auditEvent = null) {
      const identityId = Array.isArray(identityIds) ? identityIds[0] || null : identityIds || null;
      return transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        const taskResult = await client.query("SELECT payload FROM tasks WHERE workspace_id = $1 AND id = $2 FOR UPDATE", [current.workspaceId, taskId]);
        const task = taskResult.rows[0]?.payload;
        if (!task || task.deletedAt) throw teamError("TASK_NOT_FOUND", "任务不存在", 404);
        if (expectedUpdatedAt && expectedUpdatedAt !== task.updatedAt) throw teamError("TASK_VERSION_CONFLICT", "任务已被其他操作更新，请刷新后重试", 409);
        if (identityId) {
          const member = await client.query("SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND identity_id = $2 AND removed_at IS NULL", [current.workspaceId, identityId]);
          if (!member.rows.length) throw teamError("TASK_ASSIGNEE_INVALID", "负责人必须是当前工作区成员", 400);
        }
        task.assigneeIdentityId = identityId;
        task.updatedAt = new Date().toISOString();
        recordHistory(task, { action: "assigned", actor: current.actorName });
        await client.query("UPDATE tasks SET assignee_identity_id = $3, payload = $4::jsonb, updated_at = $5 WHERE workspace_id = $1 AND id = $2", [current.workspaceId, taskId, identityId, JSON.stringify(task), task.updatedAt]);
        const history = task.history.at(-1);
        await client.query("INSERT INTO task_history (workspace_id, task_id, id, actor_identity_id, actor_display_name, action, occurred_at, recorded_at, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8::jsonb)", [current.workspaceId, taskId, history.id, current.actorId, current.actorName, history.action, history.at, JSON.stringify(history)]);
        if (auditEvent) await insertAuditEvent(client, auditEvent);
        return { task, parent: task, executions: [], createdCount: 0, removedCount: 0 };
      });
    },
    async listCancellationRequests(context, taskId = null) {
      const current = postgresContext(context);
      const manager = ["owner", "admin"].includes(context?.workspace?.role);
      const result = await query(pool, schema, `
        SELECT * FROM task_cancel_requests
        WHERE workspace_id = $1
          AND ($2::boolean OR requester_identity_id = $3)
          AND ($4::text IS NULL OR parent_task_id = $4 OR execution_task_id = $4)
        ORDER BY created_at DESC, id DESC
      `, [current.workspaceId, manager, current.actorId, taskId]);
      return result.rows.map(cancelRequestFrom);
    },
    async requestCancellation(context, executionTaskId, reason) {
      return transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        const taskResult = await client.query("SELECT payload FROM tasks WHERE workspace_id = $1 AND id = $2 FOR UPDATE", [current.workspaceId, executionTaskId]);
        const execution = taskResult.rows[0]?.payload;
        if (!execution || execution.deletedAt || execution.taskType !== "execution") throw teamError("TASK_NOT_FOUND", "任务不存在", 404);
        if (execution.assignmentStatus === "removed" || execution.assigneeIdentityId !== current.actorId) {
          throw teamError("TASK_ACTION_FORBIDDEN", "只能为自己负责的执行任务提交取消申请", 403);
        }
        if (["done", "cancelled"].includes(execution.status)) throw teamError("CANCEL_REQUEST_INVALID", "已完成或已取消的任务不能提交取消申请", 409);
        const parentResult = await client.query("SELECT payload FROM tasks WHERE workspace_id = $1 AND id = $2 FOR UPDATE", [current.workspaceId, execution.parentTaskId]);
        if (!parentResult.rows[0] || parentResult.rows[0].payload.deletedAt || parentResult.rows[0].payload.status === "cancelled") throw teamError("CANCEL_REQUEST_INVALID", "父任务已取消或删除，不能重复提交取消申请", 409);
        const normalizedReason = normalizeTransitionReason(reason);
        if (!normalizedReason) throw teamError("CANCEL_REASON_REQUIRED", "取消原因不能为空", 400);
        const existing = await client.query(`
          SELECT * FROM task_cancel_requests
          WHERE workspace_id = $1 AND execution_task_id = $2 AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE
        `, [current.workspaceId, executionTaskId]);
        if (existing.rows[0]) return { request: cancelRequestFrom(existing.rows[0]), created: false };
        const inserted = await client.query(`
          INSERT INTO task_cancel_requests (
            id, workspace_id, parent_task_id, execution_task_id,
            requester_identity_id, requester_display_name, reason
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `, [crypto.randomUUID(), current.workspaceId, execution.parentTaskId, executionTaskId, current.actorId, current.actorName, normalizedReason]);
        return { request: cancelRequestFrom(inserted.rows[0]), created: true };
      });
    },
    async decideCancellation(context, requestId, decision, decisionReason, expectedUpdatedAt = null) {
      return transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await requireTeamRole(client, current.workspaceId, current.actorId, ["owner", "admin"]);
        const requestResult = await client.query("SELECT * FROM task_cancel_requests WHERE workspace_id = $1 AND id = $2 FOR UPDATE", [current.workspaceId, requestId]);
        const request = requestResult.rows[0];
        if (!request) throw teamError("CANCEL_REQUEST_NOT_FOUND", "取消申请不存在", 404);
        if (expectedUpdatedAt && expectedUpdatedAt !== request.updated_at.toISOString()) {
          throw teamError("TASK_VERSION_CONFLICT", "取消申请已被其他操作处理，请刷新后重试", 409);
        }
        if (request.status !== "pending") throw teamError("CANCEL_REQUEST_RESOLVED", "该取消申请已经处理", 409);
        const normalizedReason = normalizeTransitionReason(decisionReason);
        if (!normalizedReason) throw teamError("CANCEL_REASON_REQUIRED", "请填写处理原因", 400);
        const nextStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : null;
        if (!nextStatus) throw teamError("CANCEL_DECISION_INVALID", "处理决定无效", 400);
        if (nextStatus === "rejected") {
          const updated = await client.query(`
            UPDATE task_cancel_requests
            SET status = 'rejected', decision_reason = $3, decided_by_identity_id = $4,
              decided_by_display_name = $5, updated_at = now()
            WHERE workspace_id = $1 AND id = $2
            RETURNING *
          `, [current.workspaceId, requestId, normalizedReason, current.actorId, current.actorName]);
          return { request: cancelRequestFrom(updated.rows[0]), parent: null, executions: [] };
        }

        const parentResult = await client.query("SELECT payload FROM tasks WHERE workspace_id = $1 AND id = $2 FOR UPDATE", [current.workspaceId, request.parent_task_id]);
        const parent = parentResult.rows[0]?.payload;
        if (!parent || parent.deletedAt || parent.taskType !== "parent") throw teamError("TASK_NOT_FOUND", "父任务不存在", 404);
        const executionRows = await client.query("SELECT payload FROM tasks WHERE workspace_id = $1 ORDER BY ordinal FOR UPDATE", [current.workspaceId]);
        const executions = executionRows.rows.map((row) => row.payload).filter((task) => !task.deletedAt && task.taskType === "execution" && task.parentTaskId === parent.id && task.assignmentStatus !== "removed");
        const cancellation = cancelParentTask(parent, executions, { actor: current.actorName, reason: normalizedReason });
        for (const execution of cancellation.affectedExecutions) {
          const latestHistory = execution.history[execution.history.length - 1];
          await client.query("UPDATE tasks SET payload = $3::jsonb, status = $4, updated_at = $5 WHERE workspace_id = $1 AND id = $2", [current.workspaceId, execution.id, JSON.stringify(execution), execution.status, execution.updatedAt]);
          await client.query(`
            INSERT INTO task_history (workspace_id, task_id, id, actor_identity_id, actor_display_name, action, occurred_at, recorded_at, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8::jsonb)
          `, [current.workspaceId, execution.id, latestHistory.id, current.actorId, current.actorName, latestHistory.action, latestHistory.at, JSON.stringify(latestHistory)]);
          if (execution.status === "cancelled") {
            await client.query(`
              UPDATE task_progress SET status = 'cancelled', payload = payload || jsonb_build_object('cancelReason', $3::text), updated_at = $4
              WHERE workspace_id = $1 AND task_id = $2 AND participant_key = $5
            `, [current.workspaceId, execution.id, execution.cancelReason, execution.updatedAt, execution.assigneeIdentityId]);
          }
        }
        const latestParentHistory = parent.history[parent.history.length - 1];
        await client.query("UPDATE tasks SET payload = $3::jsonb, status = $4, updated_at = $5 WHERE workspace_id = $1 AND id = $2", [current.workspaceId, parent.id, JSON.stringify(parent), parent.status, parent.updatedAt]);
        await client.query(`
          INSERT INTO task_history (workspace_id, task_id, id, actor_identity_id, actor_display_name, action, occurred_at, recorded_at, payload)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8::jsonb)
        `, [current.workspaceId, parent.id, latestParentHistory.id, current.actorId, current.actorName, latestParentHistory.action, latestParentHistory.at, JSON.stringify(latestParentHistory)]);
        const updated = await client.query(`
          UPDATE task_cancel_requests
          SET status = 'approved', decision_reason = $3, decided_by_identity_id = $4,
            decided_by_display_name = $5, updated_at = now()
          WHERE workspace_id = $1 AND id = $2
          RETURNING *
        `, [current.workspaceId, requestId, normalizedReason, current.actorId, current.actorName]);
        return { request: cancelRequestFrom(updated.rows[0]), parent, executions: cancellation.affectedExecutions };
      });
    }
  };
}

async function replaceProjects(client, current, state) {
  const projects = (state.projects || []).map(normalizeProject);
  const resources = (state.resources || []).map(normalizeResource);
  const projectIds = projects.map((project) => project.id);
  const resourceIds = resources.map((resource) => resource.id);
  await client.query("UPDATE tasks SET project_id = NULL, payload = jsonb_set(payload, '{projectId}', 'null'::jsonb) WHERE workspace_id = $1 AND project_id IS NOT NULL AND NOT (project_id = ANY($2::text[]))", [current.workspaceId, projectIds]);
  await client.query("DELETE FROM project_resources WHERE workspace_id = $1 AND NOT (id = ANY($2::text[]))", [current.workspaceId, resourceIds]);
  await client.query("DELETE FROM projects WHERE workspace_id = $1 AND NOT (id = ANY($2::text[]))", [current.workspaceId, projectIds]);
  for (const project of projects) {
    await client.query(`
      INSERT INTO projects (id, workspace_id, name, icon, description, status, priority, lead_identity_id, start_date, target_date, payload, created_by_identity_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, COALESCE($13::timestamptz, now()), COALESCE($14::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, icon = EXCLUDED.icon, description = EXCLUDED.description,
        status = EXCLUDED.status, priority = EXCLUDED.priority, lead_identity_id = EXCLUDED.lead_identity_id,
        start_date = EXCLUDED.start_date, target_date = EXCLUDED.target_date, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
    `, [project.id, current.workspaceId, project.name, project.icon, project.description, project.status, project.priority, project.leadIdentityId, project.startDate, project.targetDate, JSON.stringify(project), project.createdByIdentityId || current.actorId, timestamp(project.createdAt), timestamp(project.updatedAt)]);
  }
  for (const resource of resources) {
    await client.query(`
      INSERT INTO project_resources (id, workspace_id, project_id, resource_type, name, url, ref, connection_id, repository_id, availability, snapshot, created_by_identity_id, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, COALESCE($13::timestamptz, now()), COALESCE($14::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET project_id = EXCLUDED.project_id, resource_type = EXCLUDED.resource_type,
        name = EXCLUDED.name, url = EXCLUDED.url, ref = EXCLUDED.ref, connection_id = EXCLUDED.connection_id,
        repository_id = EXCLUDED.repository_id, availability = EXCLUDED.availability, snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at
    `, [resource.id, current.workspaceId, resource.projectId, resource.resourceType, resource.name, resource.url, resource.ref, resource.connectionId, resource.repositoryId || null, resource.availability, JSON.stringify(resource.snapshot || {}), resource.createdByIdentityId || current.actorId, timestamp(resource.createdAt), timestamp(resource.updatedAt)]);
  }
}

function projectsAdapter(pool, schema) {
  return {
    async load(context) {
      const { workspaceId } = postgresContext(context);
      const projects = await query(pool, schema, "SELECT * FROM projects WHERE workspace_id = $1 ORDER BY created_at, id", [workspaceId]);
      const resources = await query(pool, schema, "SELECT * FROM project_resources WHERE workspace_id = $1 ORDER BY created_at, id", [workspaceId]);
      return {
        projects: projects.rows.map((row) => ({
          ...row.payload,
          id: row.id,
          name: row.name,
          icon: row.icon,
          description: row.description,
          status: row.status,
          priority: row.priority,
          leadIdentityId: row.lead_identity_id,
          startDate: row.start_date,
          targetDate: row.target_date,
          createdAt: asIso(row.created_at),
          updatedAt: asIso(row.updated_at)
        })),
        resources: resources.rows.map((row) => ({
          ...row.snapshot,
          id: row.id,
          projectId: row.project_id,
          resourceType: row.resource_type,
          name: row.name,
          url: row.url,
          ref: row.ref,
          connectionId: row.connection_id,
          repositoryId: row.repository_id,
          availability: row.availability,
          createdAt: asIso(row.created_at),
          updatedAt: asIso(row.updated_at)
        }))
      };
    },
    async save(context, state) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await replaceProjects(client, current, state);
      });
    }
  };
}

async function replaceRepositories(client, current, state) {
  const connections = state.connections || [];
  const repositories = (state.repositories || []).map(normalizeCatalogEntry);
  const connectionIds = connections.map((item) => item.id);
  const repositoryIds = repositories.map((item) => item.id);
  await client.query("UPDATE workspace_repositories SET connection_id = NULL WHERE workspace_id = $1 AND connection_id IS NOT NULL AND NOT (connection_id = ANY($2::text[]))", [current.workspaceId, connectionIds]);
  await client.query("DELETE FROM workspace_repositories WHERE workspace_id = $1 AND NOT (id = ANY($2::text[]))", [current.workspaceId, repositoryIds]);
  await client.query("DELETE FROM workspace_git_connections WHERE workspace_id = $1 AND NOT (id = ANY($2::text[]))", [current.workspaceId, connectionIds]);
  for (const connection of connections) {
    await client.query(`
      INSERT INTO workspace_git_connections (
        id, workspace_id, provider, display_name, instance_url, account_login, installation_id,
        credential_encrypted, status, payload, created_by_identity_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, COALESCE($12::timestamptz, now()), COALESCE($13::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET provider = EXCLUDED.provider, display_name = EXCLUDED.display_name,
        instance_url = EXCLUDED.instance_url, account_login = EXCLUDED.account_login, installation_id = EXCLUDED.installation_id,
        credential_encrypted = EXCLUDED.credential_encrypted, status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
    `, [
      connection.id, current.workspaceId, connection.provider, connection.displayName, connection.instanceUrl,
      connection.accountLogin, connection.installationId, connection.credentialEncrypted || null, connection.status || "active",
      JSON.stringify({}), connection.createdByIdentityId || current.actorId, timestamp(connection.createdAt), timestamp(connection.updatedAt)
    ]);
  }
  for (const repository of repositories) {
    await client.query(`
      INSERT INTO workspace_repositories (
        id, workspace_id, connection_id, canonical_key, provider, namespace, name, url, default_branch, availability, payload, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, COALESCE($12::timestamptz, now()), COALESCE($13::timestamptz, now()))
      ON CONFLICT (id) DO UPDATE SET connection_id = EXCLUDED.connection_id, canonical_key = EXCLUDED.canonical_key,
        provider = EXCLUDED.provider, namespace = EXCLUDED.namespace, name = EXCLUDED.name, url = EXCLUDED.url,
        default_branch = EXCLUDED.default_branch, availability = EXCLUDED.availability, payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at
    `, [
      repository.id, current.workspaceId, repository.connectionId, repository.canonicalKey, repository.provider,
      repository.namespace, repository.name, repository.url, repository.defaultBranch, repository.availability,
      JSON.stringify({}), timestamp(repository.createdAt), timestamp(repository.updatedAt)
    ]);
  }
}

function repositoriesAdapter(pool, schema) {
  return {
    async load(context) {
      const { workspaceId } = postgresContext(context);
      const connections = await query(pool, schema, "SELECT * FROM workspace_git_connections WHERE workspace_id = $1 ORDER BY created_at, id", [workspaceId]);
      const repositories = await query(pool, schema, "SELECT * FROM workspace_repositories WHERE workspace_id = $1 ORDER BY created_at, id", [workspaceId]);
      return {
        connections: connections.rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          displayName: row.display_name,
          instanceUrl: row.instance_url,
          accountLogin: row.account_login,
          installationId: row.installation_id,
          credentialEncrypted: row.credential_encrypted,
          status: row.status,
          createdAt: asIso(row.created_at),
          updatedAt: asIso(row.updated_at)
        })),
        repositories: repositories.rows.map((row) => ({
          id: row.id,
          connectionId: row.connection_id,
          canonicalKey: row.canonical_key,
          provider: row.provider,
          namespace: row.namespace,
          name: row.name,
          url: row.url,
          defaultBranch: row.default_branch,
          availability: row.availability,
          createdAt: asIso(row.created_at),
          updatedAt: asIso(row.updated_at)
        }))
      };
    },
    async save(context, state) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await replaceRepositories(client, current, state);
      });
    }
  };
}

async function replaceSettings(client, current, settings) {
  await client.query(`
    INSERT INTO settings (workspace_id, payload)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (workspace_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
  `, [current.workspaceId, JSON.stringify(settings)]);
  await client.query("DELETE FROM tags WHERE workspace_id = $1", [current.workspaceId]);
  for (const tag of settings.tags || []) {
    await client.query(`
      INSERT INTO tags (workspace_id, name, color, created_by_identity_id, created_at, payload)
      VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), $6::jsonb)
    `, [
      current.workspaceId, tag.name, tag.color || null,
      tag.creator === current.actorName ? current.actorId : null, timestamp(tag.createdAt), JSON.stringify(tag)
    ]);
  }
}

function notificationsAdapter(pool, schema) {
  return {
    async list(context) {
      const { actorId } = postgresContext(context);
      const result = await query(pool, schema, `
        SELECT * FROM workspace_notifications
        WHERE recipient_identity_id = $1
        ORDER BY created_at DESC
        LIMIT 200
      `, [actorId]);
      return result.rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        category: row.category,
        entityType: row.entity_type,
        entityId: row.entity_id,
        payload: row.payload || {},
        readAt: asIso(row.read_at),
        archivedAt: asIso(row.archived_at),
        createdAt: asIso(row.created_at)
      }));
    },
    async markRead(context, id) {
      const { actorId } = postgresContext(context);
      const result = await query(pool, schema, `
        UPDATE workspace_notifications
        SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND recipient_identity_id = $2
        RETURNING *
      `, [id, actorId]);
      const row = result.rows[0];
      return row ? { id: row.id, readAt: asIso(row.read_at) || new Date().toISOString() } : null;
    },
    async archive(context, id) {
      const { actorId } = postgresContext(context);
      const result = await query(pool, schema, `
        UPDATE workspace_notifications
        SET archived_at = COALESCE(archived_at, now())
        WHERE id = $1 AND recipient_identity_id = $2
        RETURNING *
      `, [id, actorId]);
      const row = result.rows[0];
      return row ? { id: row.id, archivedAt: asIso(row.archived_at) } : null;
    },
    async create(context, input) {
      const { workspaceId } = postgresContext(context);
      const id = input.id || crypto.randomUUID();
      const createdAt = input.createdAt || new Date().toISOString();
      await query(pool, schema, `
        INSERT INTO workspace_notifications (
          id, workspace_id, recipient_identity_id, category, entity_type, entity_id, payload, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `, [
        id, workspaceId, input.recipientId, input.category,
        input.entityType || null, input.entityId || null,
        JSON.stringify(input.payload || {}), createdAt
      ]);
      return {
        id,
        workspaceId,
        category: input.category,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        payload: input.payload || {},
        readAt: null,
        archivedAt: null,
        createdAt
      };
    },
    async markAllRead(context) {
      const { actorId } = postgresContext(context);
      const result = await query(pool, schema, `
        UPDATE workspace_notifications
        SET read_at = COALESCE(read_at, now())
        WHERE recipient_identity_id = $1 AND read_at IS NULL
      `, [actorId]);
      return { updated: result.rowCount || 0 };
    },
    async archiveAll(context) {
      const { actorId } = postgresContext(context);
      const result = await query(pool, schema, `
        UPDATE workspace_notifications
        SET archived_at = COALESCE(archived_at, now())
        WHERE recipient_identity_id = $1 AND archived_at IS NULL
      `, [actorId]);
      return { updated: result.rowCount || 0 };
    }
  };
}

function settingsAdapter(pool, schema) {
  return {
    async load(context) {
      const { workspaceId } = postgresContext(context);
      const result = await query(pool, schema, "SELECT payload FROM settings WHERE workspace_id = $1", [workspaceId]);
      return result.rows[0]?.payload || { ...SETTINGS_DEFAULTS };
    },
    async loadInstance() {
      const result = await query(pool, schema, "SELECT payload FROM instance_settings WHERE singleton = true", []);
      return result.rows[0]?.payload || { providers: [], defaultProviderId: "", temperature: 0.7 };
    },
    async saveInstance(settings) {
      await query(pool, schema, `
        INSERT INTO instance_settings (singleton, payload)
        VALUES (true, $1::jsonb)
        ON CONFLICT (singleton) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
      `, [JSON.stringify({
        providers: settings.providers || [],
        defaultProviderId: settings.defaultProviderId || "",
        temperature: settings.temperature
      })]);
    },
    async save(context, settings) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await replaceSettings(client, current, settings);
      });
    }
  };
}

function backupAdapter(pool, schema) {
  return {
    async export(context) {
      const { workspaceId } = postgresContext(context);
      return snapshot(pool, schema, async (client) => {
        const tasks = await client.query("SELECT payload FROM tasks WHERE workspace_id = $1 ORDER BY ordinal", [workspaceId]);
        const settings = await client.query("SELECT payload FROM settings WHERE workspace_id = $1", [workspaceId]);
        const projects = await client.query("SELECT * FROM projects WHERE workspace_id = $1 ORDER BY created_at, id", [workspaceId]);
        const resources = await client.query("SELECT * FROM project_resources WHERE workspace_id = $1 ORDER BY created_at, id", [workspaceId]);
        return {
          tasks: tasks.rows.map((row) => row.payload),
          projects: projects.rows.map((row) => ({ ...row.payload, id: row.id, name: row.name, description: row.description, status: row.status, priority: row.priority, leadIdentityId: row.lead_identity_id, startDate: row.start_date, targetDate: row.target_date })),
          resources: resources.rows.map((row) => ({ ...row.snapshot, id: row.id, projectId: row.project_id, resourceType: row.resource_type, name: row.name, url: row.url, ref: row.ref, connectionId: row.connection_id, availability: row.availability })),
          settings: settings.rows[0]?.payload || { ...SETTINGS_DEFAULTS }
        };
      });
    },
    async replace(context, data) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        // Projects must exist before tasks because task.project_id has a
        // workspace-scoped foreign key to the project.
        if (data.projects || data.resources) await replaceProjects(client, current, data);
        await replaceTasks(client, current, data.tasks);
        if (data.settings) await replaceSettings(client, current, data.settings);
      });
    }
  };
}

function teamError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function memberFrom(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email || "",
    login: row.login_name || "",
    avatarImage: row.avatar_image || null,
    role: row.role,
    visibilityScope: row.visibility_scope || (row.role === "member" ? "assigned" : "team"),
    operationScope: row.operation_scope || "assigned",
    joinedAt: row.created_at,
    unfinishedTaskCount: Number(row.unfinished_task_count) || 0,
    lastActiveAt: row.last_active_at || null,
    taskOverview: {
      backlog: Number(row.backlog_count) || 0,
      todo: Number(row.todo_count) || 0,
      inProgress: Number(row.in_progress_count) || 0,
      inReview: Number(row.in_review_count) || 0,
      blocked: Number(row.blocked_count) || 0,
      done: Number(row.done_count) || 0
    }
  };
}

function invitationFrom(row) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at || null,
    workspace: { id: row.workspace_id, name: row.workspace_name },
    invitee: row.invitee_identity_id ? {
      id: row.invitee_identity_id,
      displayName: row.invitee_display_name,
      email: row.invitee_email || row.invitee_login || ""
    } : undefined,
    inviter: row.inviter_identity_id ? {
      id: row.inviter_identity_id,
      displayName: row.inviter_display_name
    } : undefined
  };
}

async function requireTeamRole(client, workspaceId, identityId, roles) {
  const membership = await client.query(`
    SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = $1 AND m.identity_id = $2 AND m.removed_at IS NULL
      AND w.type = 'workspace' AND m.role = ANY($3::text[])
    FOR UPDATE OF m
  `, [workspaceId, identityId, roles]);
  if (!membership.rows[0]) throw teamError("TEAM_MANAGEMENT_FORBIDDEN", "没有团队成员管理权限", 403);
  return membership.rows[0].role;
}

async function activeRemovableMember(client, workspaceId, actorId, identityId) {
  if (identityId === actorId) throw teamError("OWNER_REMOVAL_FORBIDDEN", "所有者不能移除自己，请先转移所有权", 409);
  const result = await client.query(`
    SELECT i.id, i.display_name, i.email, i.login_name, m.role, m.created_at
    FROM workspace_members m JOIN identities i ON i.id = m.identity_id
    WHERE m.workspace_id = $1 AND m.identity_id = $2 AND m.removed_at IS NULL AND m.role <> 'owner'
    FOR UPDATE OF m
  `, [workspaceId, identityId]);
  if (!result.rows[0]) throw teamError("MEMBER_NOT_FOUND", "团队成员不存在", 404);
  return result.rows[0];
}

function authAdapter(pool, schema) {
  const identityFrom = (row) => row && ({
    id: row.id,
    login: row.login_name,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    disabledAt: row.disabled_at,
    isSystemAdmin: row.is_system_admin,
    mustChangePassword: row.must_change_password === true,
    reviewStatus: row.review_status || "approved",
    rejectionReason: row.rejection_reason || null,
    frozenAt: row.frozen_at || null,
    cancelledAt: row.cancelled_at || null,
    email: row.email || row.login_name,
    createdAt: row.created_at || null,
    approvedAt: row.approved_at || null,
    lastWorkspaceId: row.last_workspace_id || null,
    avatarImage: row.avatar_image || null
  });
  return {
    async getAuthConfiguration() {
      const result = await query(pool, schema, "SELECT * FROM auth_configuration WHERE singleton = true", []);
      const row = result.rows[0];
      return row ? {
        provider: row.provider,
        tenantId: row.tenant_id,
        clientId: row.client_id,
        clientSecretEncrypted: row.client_secret_encrypted,
        redirectUri: row.redirect_uri,
        administratorSubject: row.administrator_subject,
        updatedAt: row.updated_at
      } : { provider: "local" };
    },
    async getAgentConfiguration() {
      const result = await query(pool, schema, "SELECT write_tools_enabled FROM agent_configuration WHERE singleton = true", []);
      return { writeToolsEnabled: result.rows[0]?.write_tools_enabled !== false };
    },
    async saveAgentConfiguration(configuration, actorId) {
      await query(pool, schema, `
        INSERT INTO agent_configuration (singleton, write_tools_enabled, updated_by_identity_id)
        VALUES (true, $1, $2)
        ON CONFLICT (singleton) DO UPDATE SET
          write_tools_enabled = EXCLUDED.write_tools_enabled,
          updated_by_identity_id = EXCLUDED.updated_by_identity_id,
          updated_at = now()
      `, [configuration.writeToolsEnabled !== false, actorId]);
    },
    async saveAuthConfiguration(configuration, actorId) {
      await query(pool, schema, `
        INSERT INTO auth_configuration (
          singleton, provider, tenant_id, client_id, client_secret_encrypted, redirect_uri, administrator_subject, updated_by_identity_id
        ) VALUES (true, $1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (singleton) DO UPDATE SET
          provider = EXCLUDED.provider,
          tenant_id = EXCLUDED.tenant_id,
          client_id = EXCLUDED.client_id,
          client_secret_encrypted = EXCLUDED.client_secret_encrypted,
          redirect_uri = EXCLUDED.redirect_uri,
          administrator_subject = EXCLUDED.administrator_subject,
          updated_by_identity_id = EXCLUDED.updated_by_identity_id,
          updated_at = now()
      `, [
        configuration.provider,
        configuration.provider === "entra" ? configuration.tenantId : null,
        configuration.provider === "entra" ? configuration.clientId : null,
        configuration.provider === "entra" ? configuration.clientSecretEncrypted : null,
        configuration.provider === "entra" ? configuration.redirectUri : null,
        configuration.provider === "entra" ? configuration.administratorSubject : null,
        actorId
      ]);
    },
    async createOidcFlow(flow) {
      await query(pool, schema, `
        INSERT INTO oidc_login_flows (state_hash, nonce_hash, code_verifier, expires_at)
        VALUES ($1, $2, $3, $4)
      `, [flow.stateHash, flow.nonceHash, flow.codeVerifier, flow.expiresAt]);
    },
    async consumeOidcFlow(stateHash) {
      return transaction(pool, schema, async (client) => {
        const result = await client.query(`
          DELETE FROM oidc_login_flows WHERE state_hash = $1
          RETURNING nonce_hash, code_verifier, expires_at
        `, [stateHash]);
        const row = result.rows[0];
        return row ? { nonceHash: row.nonce_hash, codeVerifier: row.code_verifier, expiresAt: row.expires_at } : null;
      });
    },
    async bindExternalIdentity(profile) {
      return transaction(pool, schema, async (client) => {
        const existing = await client.query(`
          SELECT i.* FROM external_identities e
          JOIN identities i ON i.id = e.identity_id
          WHERE e.provider = $1 AND e.subject = $2
        `, [profile.provider, profile.subject]);
        if (existing.rows.length) {
          await client.query(`
            UPDATE external_identities SET email = $3, last_login_at = now()
            WHERE provider = $1 AND subject = $2
          `, [profile.provider, profile.subject, profile.email]);
          await client.query("UPDATE identities SET display_name = $2, email = $3, updated_at = now() WHERE id = $1", [existing.rows[0].id, profile.displayName, profile.email]);
          return { ...identityFrom({ ...existing.rows[0], display_name: profile.displayName, email: profile.email }), externalIdentityCreated: false };
        }
        const administrator = await client.query(`
          SELECT updated_by_identity_id AS id
          FROM auth_configuration
          WHERE singleton = true AND provider = $1 AND administrator_subject = $2
        `, [profile.provider, profile.subject]);
        const identityId = administrator.rows[0]?.id || crypto.randomUUID();
        if (administrator.rows.length) {
          const linked = await client.query(`
            UPDATE identities SET display_name = $2, email = $3, updated_at = now()
            WHERE id = $1 RETURNING *
          `, [identityId, profile.displayName, profile.email]);
          await client.query(`
            INSERT INTO external_identities (provider, subject, tenant_id, identity_id, email)
            VALUES ($1, $2, $3, $4, $5)
          `, [profile.provider, profile.subject, profile.tenantId, identityId, profile.email]);
          return { ...identityFrom(linked.rows[0]), externalIdentityCreated: true };
        }
        const inserted = await client.query(`
          INSERT INTO identities (id, display_name, email)
          VALUES ($1, $2, $3) RETURNING *
        `, [identityId, profile.displayName, profile.email]);
        await client.query(`
          INSERT INTO external_identities (provider, subject, tenant_id, identity_id, email)
          VALUES ($1, $2, $3, $4, $5)
        `, [profile.provider, profile.subject, profile.tenantId, identityId, profile.email]);
        const personalWorkspaceId = `workspace-${identityId}`;
        const workspaceSlug = `workspace-${identityId.slice(0, 8)}`;
        await client.query(`
          INSERT INTO workspaces (id, type, name, slug, task_prefix, created_by_identity_id)
          VALUES ($1, 'workspace', $2, $4, $4, $3)
        `, [personalWorkspaceId, `${profile.displayName}的工作区`, identityId, workspaceSlug]);
        await client.query(`
          INSERT INTO workspace_members (workspace_id, identity_id, role)
          VALUES ($1, $2, 'owner')
        `, [personalWorkspaceId, identityId]);
        return { ...identityFrom(inserted.rows[0]), externalIdentityCreated: true };
      });
    },
    async isBootstrapComplete() {
      const result = await query(pool, schema, "SELECT 1 FROM system_bootstrap WHERE singleton = true", []);
      return result.rows.length > 0;
    },
    async bootstrapInitialAdmin({ login, displayName, passwordHash }) {
      return transaction(pool, schema, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["nmtaskboard:system-bootstrap"]);
        const completed = await client.query("SELECT initial_admin_identity_id FROM system_bootstrap WHERE singleton = true");
        if (completed.rows.length) {
          throw Object.assign(new Error("初始系统管理员已经建立"), { code: "BOOTSTRAP_COMPLETED", statusCode: 409 });
        }
        const duplicate = await client.query("SELECT id FROM identities WHERE lower(login_name) = lower($1)", [login]);
        if (duplicate.rows.length) {
          throw Object.assign(new Error("登录名已存在"), { code: "LOGIN_EXISTS", statusCode: 409 });
        }
        const inserted = await client.query(`
          INSERT INTO identities (id, display_name, login_name, password_hash, is_system_admin)
          VALUES ($1, $2, $3, $4, true)
          ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            login_name = EXCLUDED.login_name,
            password_hash = EXCLUDED.password_hash,
            is_system_admin = true,
            updated_at = now()
          RETURNING *
        `, [DEFAULT_LOCAL_ACTOR_ID, displayName, login, passwordHash]);
        await client.query(`
          INSERT INTO workspaces (id, type, name, slug, task_prefix, created_by_identity_id)
          VALUES ($1, 'workspace', $2, $4, $4, $3)
          ON CONFLICT (id) DO NOTHING
        `, [DEFAULT_PERSONAL_WORKSPACE_ID, `${displayName}的工作区`, DEFAULT_LOCAL_ACTOR_ID, "system-workspace"]);
        await client.query(`
          INSERT INTO workspace_members (workspace_id, identity_id, role)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (workspace_id, identity_id) DO NOTHING
        `, [DEFAULT_PERSONAL_WORKSPACE_ID, DEFAULT_LOCAL_ACTOR_ID]);
        await client.query(
          "INSERT INTO system_bootstrap (singleton, initial_admin_identity_id) VALUES (true, $1)",
          [DEFAULT_LOCAL_ACTOR_ID]
        );
        return identityFrom(inserted.rows[0]);
      });
    },
    async findIdentitiesByLogin(login) {
      const result = await query(pool, schema, `
        SELECT * FROM identities
        WHERE lower(login_name) = lower($1)
           OR lower(email) = lower($1)
           OR lower(display_name) = lower($1)
        ORDER BY CASE WHEN lower(display_name) = lower($1) THEN 0 ELSE 1 END, created_at ASC
      `, [login]);
      return result.rows.map(identityFrom);
    },
    async findIdentityByLogin(login) {
      const identities = await this.findIdentitiesByLogin(login);
      return identities[0] || null;
    },
    async findIdentityById(id) {
      const result = await query(pool, schema, "SELECT * FROM identities WHERE id = $1", [id]);
      return identityFrom(result.rows[0]);
    },
    async updateAvatar(id, avatarImage) {
      await query(pool, schema, `
        UPDATE identities
        SET avatar_image = $2, updated_at = now()
        WHERE id = $1
      `, [id, avatarImage || null]);
    },
    async updatePassword(id, passwordHash, { mustChangePassword = false } = {}) {
      await query(pool, schema, `
        UPDATE identities
        SET password_hash = $2, must_change_password = $3, updated_at = now()
        WHERE id = $1
      `, [id, passwordHash, mustChangePassword === true]);
    },
    async ensureBuiltInAdmin({ login, displayName, passwordHash, mustChangePassword }) {
      return transaction(pool, schema, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["nmtaskboard:builtin-admin"]);
        const existing = await client.query("SELECT * FROM identities WHERE lower(login_name) = lower($1)", [login]);
        if (existing.rows[0]) return { created: false, identity: identityFrom(existing.rows[0]) };
        const inserted = await client.query(`
          INSERT INTO identities (id, display_name, login_name, password_hash, is_system_admin, must_change_password, review_status)
          VALUES ($1, $2, $3, $4, true, $5, 'approved')
          RETURNING *
        `, [BUILTIN_ADMIN_ID, displayName, login, passwordHash, mustChangePassword === true]);
        await client.query(`
          INSERT INTO system_bootstrap (singleton, initial_admin_identity_id)
          VALUES (true, $1)
          ON CONFLICT (singleton) DO NOTHING
        `, [BUILTIN_ADMIN_ID]);
        return { created: true, identity: identityFrom(inserted.rows[0]) };
      });
    },
    async createLocalUser({ login, displayName, passwordHash, mustChangePassword = false }) {
      return transaction(pool, schema, async (client) => {
        const duplicate = await client.query("SELECT id FROM identities WHERE lower(login_name) = lower($1)", [login]);
        if (duplicate.rows.length) {
          throw Object.assign(new Error("登录名已存在"), { code: "LOGIN_EXISTS", statusCode: 409 });
        }
        const identityId = crypto.randomUUID();
        const inserted = await client.query(`
          INSERT INTO identities (id, display_name, login_name, email, password_hash, is_system_admin, must_change_password, review_status, approved_at)
          VALUES ($1, $2, $3, $3, $4, false, $5, 'approved', now())
          RETURNING *
        `, [identityId, displayName, login, passwordHash, mustChangePassword === true]);
        const personalWorkspaceId = `workspace-${identityId}`;
        const workspaceSlug = `workspace-${identityId.slice(0, 8)}`;
        await client.query(`
          INSERT INTO workspaces (id, type, name, slug, task_prefix, created_by_identity_id)
          VALUES ($1, 'workspace', $2, $4, $4, $3)
        `, [personalWorkspaceId, `${displayName}的工作区`, identityId, workspaceSlug]);
        await client.query(`
          INSERT INTO workspace_members (workspace_id, identity_id, role)
          VALUES ($1, $2, 'owner')
        `, [personalWorkspaceId, identityId]);
        return identityFrom(inserted.rows[0]);
      });
    },
    async createPendingRegistration({ login, displayName, passwordHash, usernameHash, emailHash }) {
      return transaction(pool, schema, async (client) => {
        const locks = [
          `nmtaskboard:registration:email:${login}`,
          `nmtaskboard:registration:username:${displayName.toLowerCase()}`
        ].sort();
        for (const lock of locks) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lock]);
        await client.query("DELETE FROM cancelled_identity_blocks WHERE expires_at <= now()");
        const reserved = await client.query(`
          SELECT 1 FROM cancelled_identity_blocks
          WHERE expires_at > now() AND (username_hash = $1 OR email_hash = $2)
          LIMIT 1
        `, [usernameHash, emailHash]);
        if (reserved.rows.length) {
          throw Object.assign(new Error("该用户名或邮箱暂时不可注册"), { code: "IDENTIFIER_RESERVED", statusCode: 409 });
        }
        const conflicts = await client.query(`
          SELECT * FROM identities
          WHERE lower(display_name) = lower($1)
             OR lower(login_name) = lower($2)
             OR lower(email) = lower($2)
          FOR UPDATE
        `, [displayName, login]);
        let rejected = conflicts.rows.find((row) => row.review_status === "rejected"
          && (row.id === conflicts.rows.find((item) => item.review_status === "rejected" && (item.login_name?.toLowerCase() === login || item.email?.toLowerCase() === login))?.id
            || row.display_name?.toLowerCase() === displayName.toLowerCase()));
        const activeConflict = conflicts.rows.find((row) => row.review_status !== "rejected");
        if (activeConflict) {
          const usernameConflict = activeConflict.display_name?.toLowerCase() === displayName.toLowerCase();
          throw Object.assign(new Error(usernameConflict ? "该用户名已存在" : "该邮箱已注册"), {
            code: usernameConflict ? "USERNAME_EXISTS" : "LOGIN_EXISTS", statusCode: 409
          });
        }
        if (!rejected && conflicts.rows.length === 0) {
          const rejectedRows = await client.query("SELECT * FROM identities WHERE review_status = 'rejected' AND is_system_admin = false ORDER BY updated_at DESC LIMIT 2 FOR UPDATE");
          if (rejectedRows.rows.length === 1) rejected = rejectedRows.rows[0];
        }
        if (rejected) {
          const updated = await client.query(`
            UPDATE identities
            SET display_name = $2, login_name = $3, email = $3, password_hash = $4,
              review_status = 'pending', rejection_reason = NULL, frozen_at = NULL, cancelled_at = NULL,
              must_change_password = false, approved_at = NULL, disabled_at = NULL,
              created_at = now(), updated_at = now()
            WHERE id = $1
            RETURNING *
          `, [rejected.id, displayName, login, passwordHash]);
          await client.query(`
            INSERT INTO identity_review_history (id, identity_id, from_status, to_status, reason)
            VALUES ($1, $2, 'rejected', 'pending', NULL)
          `, [crypto.randomUUID(), rejected.id]);
          return identityFrom(updated.rows[0]);
        }
        const identityId = crypto.randomUUID();
        const inserted = await client.query(`
          INSERT INTO identities (id, display_name, login_name, email, password_hash, is_system_admin, must_change_password, review_status)
          VALUES ($1, $2, $3, $3, $4, false, false, 'pending')
          RETURNING *
        `, [identityId, displayName, login, passwordHash]);
        await client.query(`
          INSERT INTO identity_review_history (id, identity_id, from_status, to_status, reason)
          VALUES ($1, $2, NULL, 'pending', NULL)
        `, [crypto.randomUUID(), identityId]);
        return identityFrom(inserted.rows[0]);
      });
    },
    async listPendingRegistrations(search = "") {
      const needle = String(search || "").trim();
      const result = await query(pool, schema, `
        SELECT id, display_name, email, login_name, created_at
        FROM identities
        WHERE review_status = 'pending' AND is_system_admin = false
          AND ($1 = '' OR display_name ILIKE '%' || $1 || '%' OR login_name ILIKE '%' || $1 || '%' OR COALESCE(email, '') ILIKE '%' || $1 || '%')
        ORDER BY created_at ASC
      `, [needle]);
      return result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email || row.login_name,
        submittedAt: row.created_at
      }));
    },
    async listDirectoryUsers(search = "") {
      const needle = String(search || "").trim();
      const result = await query(pool, schema, `
        SELECT i.id, i.display_name, i.email, i.login_name, i.review_status, i.disabled_at, i.approved_at, i.created_at,
          i.rejection_reason, i.frozen_at, i.cancelled_at,
          COALESCE(json_agg(json_build_object('id', w.id, 'name', w.name) ORDER BY w.name)
            FILTER (WHERE w.id IS NOT NULL), '[]'::json) AS teams
        FROM identities i
        LEFT JOIN workspace_members m ON m.identity_id = i.id AND m.removed_at IS NULL
        LEFT JOIN workspaces w ON w.id = m.workspace_id AND w.type = 'workspace'
        WHERE i.is_system_admin = false
          AND ($1 = '' OR i.display_name ILIKE '%' || $1 || '%' OR i.login_name ILIKE '%' || $1 || '%' OR COALESCE(i.email, '') ILIKE '%' || $1 || '%')
        GROUP BY i.id
        ORDER BY i.created_at DESC
      `, [needle]);
      const users = result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        email: row.email || row.login_name,
        reviewStatus: row.disabled_at && row.review_status === "approved" ? "frozen" : row.review_status || "approved",
        rejectionReason: row.rejection_reason || null,
        frozenAt: row.frozen_at || null,
        cancelledAt: row.cancelled_at || null,
        createdAt: row.created_at,
        approvedAt: row.approved_at,
        teams: Array.isArray(row.teams) ? row.teams : []
      }));
      const tombstones = await query(pool, schema, `
        SELECT id, cancelled_at, expires_at
        FROM cancelled_identity_blocks
        WHERE expires_at > now()
        ORDER BY cancelled_at DESC
      `, []);
      return users.concat(tombstones.rows.map((row) => ({
        id: row.id,
        displayName: "已注销用户",
        email: "",
        reviewStatus: "cancelled",
        rejectionReason: null,
        frozenAt: null,
        cancelledAt: row.cancelled_at,
        createdAt: row.cancelled_at,
        approvedAt: null,
        teams: [],
        anonymous: true
      })));
    },
    async changeDirectoryUserStatus(id, status, reason = "", actorId = null) {
      return transaction(pool, schema, async (client) => {
        const current = await client.query("SELECT * FROM identities WHERE id = $1 AND is_system_admin = false FOR UPDATE", [id]);
        const identity = current.rows[0];
        if (!identity) throw Object.assign(new Error("用户记录不存在"), { code: "USER_NOT_FOUND", statusCode: 404 });
        const allowed = {
          pending: new Set(["approved", "rejected"]),
          approved: new Set(["frozen"]),
          frozen: new Set(["approved"])
        };
        if (!allowed[identity.review_status]?.has(status)) {
          throw Object.assign(new Error("用户状态已变化，请刷新后重试"), { code: "USER_STATUS_CONFLICT", statusCode: 409 });
        }
        if (status === "rejected" && (reason.length < 1 || reason.length > 500)) {
          throw Object.assign(new Error("请填写拒绝理由（1–500 个字符）"), { code: "REJECTION_REASON_REQUIRED", statusCode: 400 });
        }
        const updated = await client.query(`
          UPDATE identities SET review_status = $2,
            rejection_reason = CASE WHEN $2 = 'rejected' THEN $3 ELSE NULL END,
            frozen_at = CASE WHEN $2 = 'frozen' THEN now() ELSE NULL END,
            disabled_at = CASE WHEN $2 = 'frozen' THEN now() ELSE NULL END,
            approved_at = CASE WHEN $2 = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END,
            updated_at = now()
          WHERE id = $1 RETURNING *
        `, [id, status, reason || null]);
        await client.query(`
          INSERT INTO identity_review_history (id, identity_id, from_status, to_status, reason, actor_identity_id)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [crypto.randomUUID(), id, identity.review_status, status, reason || null, actorId]);
        if (status === "approved") {
          await client.query(`
            INSERT INTO workspaces (id, type, name, slug, task_prefix, created_by_identity_id)
            VALUES ($1, 'workspace', $2, $4, $4, $3)
            ON CONFLICT (id) DO NOTHING
          `, [`workspace-${id}`, `${identity.display_name}的工作区`, id, `workspace-${id.slice(0, 8)}`]);
          await client.query(`
            INSERT INTO workspace_members (workspace_id, identity_id, role)
            VALUES ($1, $2, 'owner')
            ON CONFLICT (workspace_id, identity_id) DO NOTHING
          `, [`workspace-${id}`, id]);
        }
        if (status === "frozen") await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE identity_id = $1 AND revoked_at IS NULL", [id]);
        return identityFrom(updated.rows[0]);
      });
    },
    async approveRegistration(id) { return this.changeDirectoryUserStatus(id, "approved"); },
    async rejectRegistration(id, reason) { return this.changeDirectoryUserStatus(id, "rejected", reason); },
    async resetDirectoryPassword(id, passwordHash) {
      const result = await query(pool, schema, `
        UPDATE identities
        SET password_hash = $2, must_change_password = true, updated_at = now()
        WHERE id = $1 AND is_system_admin = false AND review_status = 'approved'
        RETURNING id
      `, [id, passwordHash]);
      if (!result.rows[0]) {
        throw Object.assign(new Error("不能重置该账号"), { code: "USER_RESET_FORBIDDEN", statusCode: 403 });
      }
    },
    async createSession({ tokenHash, identityId, expiresAt }) {
      await query(pool, schema, `
        INSERT INTO auth_sessions (token_hash, identity_id, expires_at)
        VALUES ($1, $2, $3)
      `, [tokenHash, identityId, expiresAt]);
    },
    async findSession(tokenHash) {
      const result = await query(pool, schema, `
        SELECT s.expires_at, s.revoked_at, s.selected_workspace_id, i.*
        FROM auth_sessions s
        JOIN identities i ON i.id = s.identity_id
        WHERE s.token_hash = $1
      `, [tokenHash]);
      const row = result.rows[0];
      return row ? {
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        selectedWorkspaceId: row.selected_workspace_id,
        identity: identityFrom(row)
      } : null;
    },
    async revokeSession(tokenHash) {
      await query(pool, schema, "UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1", [tokenHash]);
    },
    async revokeIdentitySessions(identityId) {
      await query(pool, schema, "UPDATE auth_sessions SET revoked_at = now() WHERE identity_id = $1 AND revoked_at IS NULL", [identityId]);
    },
    async cancelIdentity(id, { usernameHash, emailHash }) {
      return transaction(pool, schema, async (client) => {
        const result = await client.query("SELECT * FROM identities WHERE id = $1 AND is_system_admin = false FOR UPDATE", [id]);
        const identity = result.rows[0];
        if (!identity) throw Object.assign(new Error("账号不存在"), { code: "ACCOUNT_NOT_FOUND", statusCode: 404 });
        if (!["pending", "approved", "frozen"].includes(identity.review_status)) {
          throw Object.assign(new Error("当前账号不能申请注销"), { code: "ACCOUNT_CANCEL_FORBIDDEN", statusCode: 409 });
        }
        const owners = await client.query(`
          SELECT w.id, w.name FROM workspaces w
          JOIN workspace_members m ON m.workspace_id = w.id AND m.identity_id = $1
          WHERE w.type = 'workspace' AND m.role = 'owner' AND m.removed_at IS NULL
          FOR UPDATE OF w
        `, [id]);
        if (owners.rows.length) throw Object.assign(new Error("请先转移或删除你拥有的团队"), { code: "TEAM_OWNERSHIP_REQUIRED", statusCode: 409 });
        await client.query("DELETE FROM cancelled_identity_blocks WHERE expires_at <= now()");
        const tombstone = await client.query(`
          INSERT INTO cancelled_identity_blocks (id, username_hash, email_hash, expires_at)
          VALUES ($1, $2, $3, now() + interval '24 hours') RETURNING *
        `, [crypto.randomUUID(), usernameHash, emailHash]);
        await client.query("SET LOCAL nmtaskboard.allow_identity_anonymization = 'on'");
        await client.query("UPDATE workspaces SET created_by_identity_id = (SELECT identity_id FROM workspace_members WHERE workspace_id = workspaces.id AND role = 'owner' AND removed_at IS NULL LIMIT 1) WHERE type = 'workspace' AND created_by_identity_id = $1", [id]);
        await client.query("UPDATE tasks SET creator_identity_id = NULL, payload = nmtaskboard_anonymize_identity_payload(payload, $1, $2) WHERE creator_identity_id = $1 OR payload::text LIKE '%' || $1 || '%' OR payload::text LIKE '%' || $2 || '%'", [id, identity.display_name]);
        await client.query("UPDATE task_history SET actor_identity_id = NULL, actor_display_name = '已注销用户', payload = nmtaskboard_anonymize_identity_payload(payload, $1, $2) WHERE actor_identity_id = $1", [id, identity.display_name]);
        await client.query("UPDATE task_comments SET author_identity_id = NULL, author_display_name = '已注销用户', payload = nmtaskboard_anonymize_identity_payload(payload, $1, $2) WHERE author_identity_id = $1", [id, identity.display_name]);
        await client.query("UPDATE task_progress SET participant_identity_id = NULL, participant_label = '已注销用户', payload = nmtaskboard_anonymize_identity_payload(payload, $1, $2) WHERE participant_identity_id = $1", [id, identity.display_name]);
        await client.query("UPDATE task_progress_records SET author_identity_id = NULL, author_display_name = '已注销用户', payload = nmtaskboard_anonymize_identity_payload(payload, $1, $2) WHERE author_identity_id = $1", [id, identity.display_name]);
        await client.query("UPDATE tags SET created_by_identity_id = NULL WHERE created_by_identity_id = $1", [id]);
        await client.query("DELETE FROM task_cancel_requests WHERE requester_identity_id = $1", [id]);
        await client.query("UPDATE task_cancel_requests SET decided_by_identity_id = NULL, decided_by_display_name = '已注销用户' WHERE decided_by_identity_id = $1", [id]);
        await client.query("UPDATE report_versions SET author_identity_id = NULL, author_display_name = '已注销用户', evidence_summary = nmtaskboard_anonymize_identity_payload(evidence_summary, $1, $2), draft_text = replace(draft_text, $2, '已注销用户') WHERE author_identity_id = $1", [id, identity.display_name]);
        await client.query("UPDATE audit_events SET actor_identity_id = NULL, actor_display_name = '已注销用户', summary = nmtaskboard_anonymize_identity_payload(summary, $1, $2) WHERE actor_identity_id = $1", [id, identity.display_name]);
        await client.query("DELETE FROM team_invitations WHERE inviter_identity_id = $1", [id]);
        await client.query("DELETE FROM workspace_members WHERE identity_id = $1", [id]);
        await client.query("DELETE FROM identity_review_history WHERE identity_id = $1", [id]);
        await client.query("DELETE FROM identities WHERE id = $1", [id]);
        return { id: tombstone.rows[0].id, expiresAt: tombstone.rows[0].expires_at };
      });
    },
    async resolveWorkspace(identityId, preferredWorkspaceId) {
      if (preferredWorkspaceId) {
        const preferred = await query(pool, schema, `
          SELECT w.id, w.type, w.name, w.description, w.slug, w.task_prefix AS "taskPrefix",
            w.time_zone AS "timeZone", m.role,
            m.visibility_scope AS "visibilityScope", m.operation_scope AS "operationScope"
          FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.identity_id = $1 AND w.id = $2 AND m.removed_at IS NULL
        `, [identityId, preferredWorkspaceId]);
        if (preferred.rows[0]) return preferred.rows[0];
      }
      const fallback = await query(pool, schema, `
        SELECT w.id, w.type, w.name, w.description, w.slug, w.task_prefix AS "taskPrefix",
          w.time_zone AS "timeZone", m.role,
          m.visibility_scope AS "visibilityScope", m.operation_scope AS "operationScope"
        FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.identity_id = $1 AND m.removed_at IS NULL
        ORDER BY w.created_at ASC LIMIT 1
        `, [identityId]);
      return fallback.rows[0] || null;
    },
    async listWorkspaces(identityId) {
      const result = await query(pool, schema, `
        SELECT w.id, w.type, w.name, m.role,
          m.visibility_scope AS "visibilityScope", m.operation_scope AS "operationScope"
        FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.identity_id = $1 AND m.removed_at IS NULL
        ORDER BY lower(w.name), w.id
      `, [identityId]);
      return result.rows;
    },
    async createTeam(identityId, input) {
      const workspaceFrom = (row) => ({
        id: row.id, type: "workspace", name: row.name, slug: row.slug || row.identifier,
        identifier: row.slug || row.identifier,
        timeZone: row.time_zone, role: "owner"
      });
      try {
        return await transaction(pool, schema, async (client) => {
          const inserted = await client.query(`
            INSERT INTO workspaces (
              id, type, name, slug, task_prefix, identifier, time_zone, creation_request_id, created_by_identity_id
            ) VALUES ($1, 'workspace', $2, $3, $3, $3, $4, $5, $6)
            ON CONFLICT (created_by_identity_id, creation_request_id)
              WHERE creation_request_id IS NOT NULL
              DO NOTHING
            RETURNING id, type, name, slug, identifier, time_zone
          `, [crypto.randomUUID(), input.name, input.identifier, input.timeZone, input.requestId, identityId]);
          let workspace = inserted.rows[0];
          if (!workspace) {
            const existing = await client.query(`
              SELECT id, type, name, identifier, time_zone
              FROM workspaces
              WHERE type = 'workspace' AND created_by_identity_id = $1 AND creation_request_id = $2
            `, [identityId, input.requestId]);
            workspace = existing.rows[0];
            return { workspace: workspaceFrom(workspace), created: false };
          }
          await client.query(`
            INSERT INTO workspace_members (workspace_id, identity_id, role)
            VALUES ($1, $2, 'owner')
          `, [workspace.id, identityId]);
          return { workspace: workspaceFrom(workspace), created: true };
        });
      } catch (error) {
        if (error.code === "23505" && ["workspaces_team_identifier_unique", "workspaces_slug_unique"].includes(error.constraint)) {
          throw Object.assign(new Error("团队标识已被使用"), { code: "TEAM_IDENTIFIER_EXISTS", statusCode: 409 });
        }
        throw error;
      }
    },
    async deleteTeam(actorId, workspaceId, confirmName, tokenHash) {
      return transaction(pool, schema, async (client) => {
        const team = await client.query("SELECT id, name FROM workspaces WHERE id = $1 AND type = 'workspace' FOR UPDATE", [workspaceId]);
        if (!team.rows[0]) throw teamError("WORKSPACE_NOT_FOUND", "工作区不存在", 404);
        await requireTeamRole(client, workspaceId, actorId, ["owner"]);
        if (confirmName !== team.rows[0].name) throw teamError("TEAM_DELETE_CONFIRMATION_REQUIRED", "请输入完整团队名称确认解散团队", 400);

        const otherWorkspace = await client.query(`
          SELECT w.id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.identity_id = $1 AND w.id <> $2 AND m.removed_at IS NULL
          ORDER BY w.created_at ASC LIMIT 1
        `, [actorId, workspaceId]);
        let currentWorkspaceId = otherWorkspace.rows[0]?.id || null;
        if (!currentWorkspaceId) {
          const identity = await client.query("SELECT display_name FROM identities WHERE id = $1", [actorId]);
          const fallbackId = `workspace-${actorId}`;
          const fallbackSlug = `home-${actorId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
          await client.query(`
            INSERT INTO workspaces (id, type, name, slug, task_prefix, time_zone, created_by_identity_id)
            VALUES ($1, 'workspace', $2, $3, $3, 'Asia/Shanghai', $4)
            ON CONFLICT (id) DO NOTHING
          `, [fallbackId, `${identity.rows[0]?.display_name || "我的"}的工作区`, fallbackSlug, actorId]);
          await client.query("INSERT INTO workspace_members (workspace_id, identity_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (workspace_id, identity_id) DO NOTHING", [fallbackId, actorId]);
          currentWorkspaceId = fallbackId;
        }
        if (tokenHash && currentWorkspaceId) {
          await client.query(`
            UPDATE auth_sessions SET selected_workspace_id = $3
            WHERE token_hash = $1 AND identity_id = $2 AND revoked_at IS NULL
          `, [tokenHash, actorId, currentWorkspaceId]);
          await client.query("UPDATE identities SET last_workspace_id = $2, updated_at = now() WHERE id = $1", [actorId, currentWorkspaceId]);
        }
        await client.query("SET LOCAL nmtaskboard.workspace_delete = 'on'");
        await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
        return { deletedWorkspace: { id: workspaceId, name: team.rows[0].name }, currentWorkspaceId };
      });
    },
    async listWorkspaceMembers(actorId, workspaceId) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin", "member"]);
        const result = await client.query(`
          SELECT i.id, i.display_name, i.email, i.login_name, i.avatar_image, m.role, m.created_at
          FROM workspace_members m JOIN identities i ON i.id = m.identity_id
          WHERE m.workspace_id = $1 AND m.removed_at IS NULL
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(i.display_name), i.id
        `, [workspaceId]);
        return result.rows.map((row) => memberFrom({ ...row, unfinished_task_count: 0 }));
      });
    },
    async listTeamMembers(actorId, workspaceId) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin", "member"]);
        const workspace = await client.query("SELECT id, type, name, slug, time_zone AS \"timeZone\" FROM workspaces WHERE id = $1", [workspaceId]);
        const result = await client.query(`
          SELECT i.id, i.display_name, i.email, i.login_name, i.avatar_image, m.role, m.visibility_scope, m.operation_scope, m.created_at,
            activity.last_active_at, progress.unfinished_task_count, progress.todo_count,
            progress.in_progress_count, progress.blocked_count, progress.done_count
          FROM workspace_members m
          JOIN identities i ON i.id = m.identity_id
          LEFT JOIN LATERAL (
            SELECT max(s.created_at) AS last_active_at
            FROM auth_sessions s WHERE s.identity_id = i.id
          ) activity ON true
          LEFT JOIN LATERAL (
            SELECT
              count(*) FILTER (WHERE t.status NOT IN ('done', 'cancelled'))::int AS unfinished_task_count,
              count(*) FILTER (WHERE t.status = 'backlog')::int AS backlog_count,
              count(*) FILTER (WHERE t.status = 'todo')::int AS todo_count,
              count(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress_count,
              count(*) FILTER (WHERE t.status = 'in_review')::int AS in_review_count,
              count(*) FILTER (WHERE t.status = 'blocked')::int AS blocked_count,
              count(*) FILTER (WHERE t.status = 'done')::int AS done_count
            FROM tasks t
            WHERE t.workspace_id = m.workspace_id AND t.assignee_identity_id = m.identity_id
          ) progress ON true
          WHERE m.workspace_id = $1 AND m.removed_at IS NULL
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(i.display_name), i.id
        `, [workspaceId]);
        return { workspace: workspace.rows[0], members: result.rows.map(memberFrom) };
      });
    },
    async listInvitationCandidates(actorId, workspaceId, search = "") {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const result = await client.query(`
          SELECT i.id, i.display_name, i.email, i.login_name
          FROM identities i
          WHERE i.review_status = 'approved' AND i.is_system_admin = false AND i.disabled_at IS NULL
            AND ($2 = '' OR lower(i.display_name) LIKE '%' || lower($2) || '%'
              OR lower(coalesce(i.email, i.login_name, '')) LIKE '%' || lower($2) || '%')
            AND NOT EXISTS (
              SELECT 1 FROM workspace_members m
              WHERE m.workspace_id = $1 AND m.identity_id = i.id AND m.removed_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM team_invitations invitation
              WHERE invitation.workspace_id = $1 AND invitation.invitee_identity_id = i.id AND invitation.status = 'pending'
            )
          ORDER BY lower(i.display_name), i.id
          LIMIT 20
        `, [workspaceId, search]);
        return result.rows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          email: row.email || row.login_name || ""
        }));
      });
    },
    async listOutgoingInvitations(actorId, workspaceId) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const result = await client.query(`
          SELECT invitation.*, w.name AS workspace_name,
            invitee.display_name AS invitee_display_name, invitee.email AS invitee_email, invitee.login_name AS invitee_login
          FROM team_invitations invitation
          JOIN workspaces w ON w.id = invitation.workspace_id
          JOIN identities invitee ON invitee.id = invitation.invitee_identity_id
          WHERE invitation.workspace_id = $1 AND invitation.status = 'pending' AND invitation.expires_at > now()
          ORDER BY invitation.created_at DESC
        `, [workspaceId]);
        const history = await client.query(`
          SELECT invitation.*, w.name AS workspace_name,
            invitee.display_name AS invitee_display_name, invitee.email AS invitee_email, invitee.login_name AS invitee_login
          FROM team_invitations invitation
          JOIN workspaces w ON w.id = invitation.workspace_id
          JOIN identities invitee ON invitee.id = invitation.invitee_identity_id
          WHERE invitation.workspace_id = $1 AND NOT (invitation.status = 'pending' AND invitation.expires_at > now())
          ORDER BY invitation.created_at DESC
          LIMIT 20
        `, [workspaceId]);
        return { pending: result.rows.map(invitationFrom), history: history.rows.map(invitationFrom) };
        // 注意：返回值从数组变为 { pending, history }，调用方在 auth.teamMembers 中展开。
      });
    },
    async createTeamInvitation(actorId, workspaceId, identityId) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const target = await client.query(`
          SELECT i.id, i.display_name, i.email, i.login_name
          FROM identities i
          WHERE i.id = $2 AND i.review_status = 'approved' AND i.is_system_admin = false AND i.disabled_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM workspace_members m
              WHERE m.workspace_id = $1 AND m.identity_id = i.id AND m.removed_at IS NULL
            )
          FOR UPDATE
        `, [workspaceId, identityId]);
        if (!target.rows[0]) throw teamError("INVITATION_TARGET_INVALID", "该用户不可邀请或已在团队中", 409);
        try {
          const inserted = await client.query(`
            INSERT INTO team_invitations (id, workspace_id, invitee_identity_id, inviter_identity_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
          `, [crypto.randomUUID(), workspaceId, identityId, actorId]);
          const workspace = await client.query("SELECT name FROM workspaces WHERE id = $1", [workspaceId]);
          return invitationFrom({
            ...inserted.rows[0],
            workspace_name: workspace.rows[0].name,
            invitee_display_name: target.rows[0].display_name,
            invitee_email: target.rows[0].email,
            invitee_login: target.rows[0].login_name
          });
        } catch (error) {
          if (error.code === "23505") throw teamError("INVITATION_ALREADY_PENDING", "该用户已有待处理邀请", 409);
          throw error;
        }
      });
    },
    async revokeTeamInvitation(actorId, workspaceId, invitationId) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const updated = await client.query(`
          UPDATE team_invitations SET status = 'revoked', resolved_at = now()
          WHERE id = $1 AND workspace_id = $2 AND status = 'pending'
          RETURNING id
        `, [invitationId, workspaceId]);
        if (!updated.rows[0]) throw teamError("INVITATION_NOT_FOUND", "待处理邀请不存在", 404);
        return { id: invitationId, status: "revoked" };
      });
    },
    async listIncomingInvitations(identityId) {
      const result = await query(pool, schema, `
        SELECT invitation.*, w.name AS workspace_name, inviter.display_name AS inviter_display_name
        FROM team_invitations invitation
        JOIN workspaces w ON w.id = invitation.workspace_id
        JOIN identities inviter ON inviter.id = invitation.inviter_identity_id
          WHERE invitation.invitee_identity_id = $1 AND invitation.status = 'pending' AND invitation.expires_at > now()
        ORDER BY invitation.created_at DESC
      `, [identityId]);
      return result.rows.map(invitationFrom);
    },
    async resolveTeamInvitation(identityId, invitationId, decision) {
      return transaction(pool, schema, async (client) => {
        const found = await client.query(`
          SELECT invitation.*, w.name AS workspace_name
          FROM team_invitations invitation JOIN workspaces w ON w.id = invitation.workspace_id
          WHERE invitation.id = $1 AND invitation.invitee_identity_id = $2 AND invitation.status = 'pending' AND invitation.expires_at > now()
          FOR UPDATE OF invitation
        `, [invitationId, identityId]);
        const invitation = found.rows[0];
        if (!invitation) throw teamError("INVITATION_NOT_FOUND", "待处理邀请不存在", 404);
        if (decision === "accepted") {
          const membership = await client.query(`
            SELECT removed_at FROM workspace_members WHERE workspace_id = $1 AND identity_id = $2 FOR UPDATE
          `, [invitation.workspace_id, identityId]);
          if (membership.rows[0]) {
            await client.query(`
              UPDATE workspace_members SET role = 'member', visibility_scope = 'assigned', operation_scope = 'assigned',
                removed_at = NULL, removed_by_identity_id = NULL, removal_task_handling = NULL,
                created_at = now(), updated_at = now()
              WHERE workspace_id = $1 AND identity_id = $2
            `, [invitation.workspace_id, identityId]);
          } else {
            await client.query(`
              INSERT INTO workspace_members (workspace_id, identity_id, role) VALUES ($1, $2, 'member')
            `, [invitation.workspace_id, identityId]);
          }
        }
        await client.query(`
          UPDATE team_invitations SET status = $2, resolved_at = now() WHERE id = $1
        `, [invitationId, decision]);
        return {
          id: invitationId,
          status: decision,
          workspace: { id: invitation.workspace_id, name: invitation.workspace_name }
        };
      });
    },
    async changeTeamMemberRole(actorId, workspaceId, identityId, role) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        if (identityId === actorId) throw teamError("OWNER_ROLE_IMMUTABLE", "所有者不能修改自己的角色", 409);
        const updated = await client.query(`
          UPDATE workspace_members m SET role = $3, updated_at = now()
          FROM identities i
          WHERE m.workspace_id = $1 AND m.identity_id = $2 AND m.identity_id = i.id
            AND m.removed_at IS NULL AND m.role <> 'owner'
          RETURNING i.id, i.display_name, i.email, i.login_name, m.role, m.visibility_scope, m.operation_scope, m.created_at
        `, [workspaceId, identityId, role]);
        if (!updated.rows[0]) throw teamError("MEMBER_NOT_FOUND", "团队成员不存在", 404);
        return memberFrom({ ...updated.rows[0], unfinished_task_count: 0 });
      });
    },
    async updateTeamMemberPermissions(actorId, workspaceId, identityId, input) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const updated = await client.query(`
          UPDATE workspace_members m
          SET visibility_scope = $3, operation_scope = $4, updated_at = now()
          FROM identities i
          WHERE m.workspace_id = $1 AND m.identity_id = $2 AND m.identity_id = i.id
            AND m.removed_at IS NULL AND m.role = 'member'
          RETURNING i.id, i.display_name, i.email, i.login_name, m.role, m.visibility_scope, m.operation_scope, m.created_at
        `, [workspaceId, identityId, input.visibilityScope, input.operationScope]);
      if (!updated.rows[0]) throw teamError("MEMBER_NOT_FOUND", "可配置的普通成员不存在", 404);
      return memberFrom({ ...updated.rows[0], unfinished_task_count: 0 });
      });
    },
    async updateTeamTimeZone(actorId, workspaceId, timeZone) {
      return this.updateWorkspace(actorId, workspaceId, { timeZone });
    },
    async updateWorkspace(actorId, workspaceId, input = {}) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const updated = await client.query(`
          UPDATE workspaces
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              slug = COALESCE($4, slug),
              task_prefix = COALESCE($5, task_prefix),
              identifier = COALESCE($4, identifier),
              time_zone = COALESCE($6, time_zone)
          WHERE id = $1 AND type = 'workspace'
          RETURNING id, type, name, description, slug, task_prefix AS "taskPrefix", identifier, time_zone AS "timeZone"
        `, [workspaceId, input.name || null, input.description ?? null, input.slug || null, input.taskPrefix || null, input.timeZone || null]);
        if (!updated.rows[0]) throw teamError("TEAM_NOT_FOUND", "工作区不存在", 404);
        return updated.rows[0];
      });
    },
    async transferTeamOwnership(actorId, workspaceId, identityId, confirmName) {
      return transaction(pool, schema, async (client) => {
        const team = await client.query("SELECT id, name FROM workspaces WHERE id = $1 AND type = 'workspace' FOR UPDATE", [workspaceId]);
        if (!team.rows[0]) throw teamError("TEAM_NOT_FOUND", "团队不存在", 404);
        await requireTeamRole(client, workspaceId, actorId, ["owner"]);
        if (confirmName !== team.rows[0].name) throw teamError("OWNERSHIP_CONFIRMATION_REQUIRED", "请输入完整团队名称确认所有权转移", 400);
        if (identityId === actorId) throw teamError("OWNER_TRANSFER_INVALID", "你已经是团队所有者", 409);
        const target = await client.query(`
          SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND identity_id = $2 AND removed_at IS NULL AND role <> 'owner' FOR UPDATE
        `, [workspaceId, identityId]);
        if (!target.rows[0]) throw teamError("MEMBER_NOT_FOUND", "接收所有权的成员不存在", 404);
        await client.query("UPDATE workspace_members SET role = 'admin', updated_at = now() WHERE workspace_id = $1 AND identity_id = $2", [workspaceId, actorId]);
        await client.query("UPDATE workspace_members SET role = 'owner', updated_at = now() WHERE workspace_id = $1 AND identity_id = $2", [workspaceId, identityId]);
        return { previousOwnerId: actorId, ownerId: identityId, teamName: team.rows[0].name };
      });
    },
    async teamMemberRemovalImpact(actorId, workspaceId, identityId) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const member = await activeRemovableMember(client, workspaceId, actorId, identityId);
        const tasks = await client.query(`
          SELECT t.id, t.title, t.status
          FROM tasks t
          WHERE t.workspace_id = $1 AND t.assignee_identity_id = $2 AND t.status NOT IN ('done', 'cancelled')
          ORDER BY t.ordinal, t.id
        `, [workspaceId, identityId]);
        return { member: memberFrom({ ...member, unfinished_task_count: tasks.rows.length }), unfinishedTasks: tasks.rows };
      });
    },
    async removeTeamMember(actorId, workspaceId, identityId, handling) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const member = await activeRemovableMember(client, workspaceId, actorId, identityId);
        const unfinished = await client.query(`
          SELECT count(*)::int AS count FROM tasks
          WHERE workspace_id = $1 AND assignee_identity_id = $2 AND status NOT IN ('done', 'cancelled')
        `, [workspaceId, identityId]);
        await client.query(`
          UPDATE tasks
          SET assignee_identity_id = NULL,
              payload = jsonb_set(payload, '{assigneeIdentityId}', 'null'::jsonb),
              updated_at = now()
          WHERE workspace_id = $1 AND assignee_identity_id = $2 AND status NOT IN ('done', 'cancelled')
        `, [workspaceId, identityId]);
        await client.query(`
          UPDATE workspace_members SET removed_at = now(), removed_by_identity_id = $3,
            removal_task_handling = $4, updated_at = now()
          WHERE workspace_id = $1 AND identity_id = $2
        `, [workspaceId, identityId, actorId, unfinished.rows[0].count > 0 ? handling : null]);
        return { member: memberFrom({ ...member, unfinished_task_count: unfinished.rows[0].count }), handling: unfinished.rows[0].count ? "unassign" : null };
      });
    },
    async selectWorkspace(tokenHash, identityId, workspaceId) {
      return transaction(pool, schema, async (client) => {
        const accessible = await client.query(`
          SELECT w.id, w.type, w.name, m.role,
            m.visibility_scope AS "visibilityScope", m.operation_scope AS "operationScope"
          FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.identity_id = $1 AND w.id = $2 AND m.removed_at IS NULL
        `, [identityId, workspaceId]);
        if (!accessible.rows[0]) {
          throw Object.assign(new Error("空间不存在或无权访问"), { code: "WORKSPACE_NOT_FOUND", statusCode: 404 });
        }
        await client.query(`
          UPDATE auth_sessions SET selected_workspace_id = $3
          WHERE token_hash = $1 AND identity_id = $2 AND revoked_at IS NULL
        `, [tokenHash, identityId, workspaceId]);
        await client.query("UPDATE identities SET last_workspace_id = $2, updated_at = now() WHERE id = $1", [identityId, workspaceId]);
        return accessible.rows[0];
      });
    },
    async setSessionWorkspace(tokenHash, identityId, workspaceId) {
      await transaction(pool, schema, async (client) => {
        await client.query(`
          UPDATE auth_sessions SET selected_workspace_id = $3
          WHERE token_hash = $1 AND identity_id = $2 AND revoked_at IS NULL
        `, [tokenHash, identityId, workspaceId]);
        await client.query("UPDATE identities SET last_workspace_id = $2, updated_at = now() WHERE id = $1", [identityId, workspaceId]);
      });
    }
  };
}

async function insertAuditEvent(client, event) {
  const actor = event.actor || {};
  const workspace = event.workspace || {};
  const result = await client.query(`
    INSERT INTO audit_events (
      id, actor_identity_id, actor_display_name, workspace_id, workspace_type,
      source, action, target_type, target_id, outcome, summary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    RETURNING *
  `, [
    crypto.randomUUID(), actor.id || null, actor.displayName || null,
    workspace.id || null, workspace.type || null, event.source, event.action,
    event.target?.type || "unknown", event.target?.id || null,
    event.outcome, JSON.stringify(event.summary || {})
  ]);
  return auditEventFrom(result.rows[0]);
}

function auditAdapter(pool, schema) {
  return {
    async append(event) {
      return transaction(pool, schema, (client) => insertAuditEvent(client, event));
    },
    async list(context, { limit = 100 } = {}) {
      const current = postgresContext(context);
      const membership = await query(pool, schema, `
        SELECT role FROM workspace_members
        WHERE workspace_id = $1 AND identity_id = $2 AND role IN ('owner', 'admin') AND removed_at IS NULL
      `, [current.workspaceId, current.actorId]);
      if (!membership.rows.length) {
        throw Object.assign(new Error("仅空间管理员可查看审计记录"), { code: "AUDIT_FORBIDDEN", statusCode: 403 });
      }
      const result = await query(pool, schema, `
        SELECT * FROM audit_events
        WHERE workspace_id = $1
        ORDER BY occurred_at DESC, id DESC
        LIMIT $2
      `, [current.workspaceId, Math.min(Math.max(Number(limit) || 100, 1), 500)]);
      return result.rows.map(auditEventFrom);
    }
  };
}

function auditEventFrom(row) {
  return {
    id: row.id,
    actor: row.actor_identity_id ? { id: row.actor_identity_id, displayName: row.actor_display_name } : null,
    workspace: row.workspace_id ? { id: row.workspace_id, type: row.workspace_type } : null,
    source: row.source,
    action: row.action,
    target: { type: row.target_type, id: row.target_id },
    occurredAt: row.occurred_at,
    outcome: row.outcome,
    summary: row.summary
  };
}

function reportVersionMetaFrom(row) {
  const asIso = (value) => (value instanceof Date ? value.toISOString() : value);
  return {
    id: row.id,
    reportType: row.report_type,
    rangeStart: row.range_start || null,
    rangeEnd: row.range_end || null,
    subject: row.subject,
    model: row.model || null,
    source: row.source,
    authorIdentityId: row.author_identity_id,
    authorDisplayName: row.author_display_name,
    createdAt: asIso(row.created_at)
  };
}

function agentSessionFrom(row, messages = []) {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    status: row.status,
    summary: row.summary || "",
    createdAt: asIso(row.created_at),
    archivedAt: asIso(row.archived_at) || null,
    messages: messages.map((message) => ({
      id: message.id,
      seq: message.seq,
      role: message.role,
      content: message.content,
      createdAt: asIso(message.created_at)
    })),
    drafts: persistableDrafts(row.task_drafts),
    actionDrafts: persistableDrafts(row.action_drafts),
    assignmentDrafts: persistableDrafts(row.assignment_drafts)
  };
}

async function loadAgentSession(client, sessionId) {
  const session = await client.query("SELECT * FROM agent_sessions WHERE id = $1", [sessionId]);
  if (!session.rows[0]) return null;
  const messages = await client.query(
    "SELECT * FROM agent_session_messages WHERE session_id = $1 ORDER BY seq ASC",
    [sessionId]
  );
  return agentSessionFrom(session.rows[0], messages.rows);
}

function assertAgentSessionReadable(session, current) {
  if (!session || session.actorId !== current.actorId) {
    throw sessionError("AGENT_SESSION_NOT_FOUND", "Agent 会话不存在", 404);
  }
}

async function archiveAgentSessionRow(client, sessionId) {
  await client.query(`
    UPDATE agent_sessions
    SET status = 'archived', archived_at = COALESCE(archived_at, now()), updated_at = now()
    WHERE id = $1 AND status = 'active'
  `, [sessionId]);
}

function agentSessionsAdapter(pool, schema) {
  return {
    async getOrCreate(context) {
      return transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await client.query(`
          UPDATE agent_sessions
          SET status = 'archived', archived_at = now(), updated_at = now()
          WHERE actor_id = $1 AND workspace_id <> $2 AND status = 'active'
        `, [current.actorId, current.workspaceId]);
        const existing = await client.query(`
          SELECT * FROM agent_sessions
          WHERE actor_id = $1 AND workspace_id = $2 AND status = 'active'
          FOR UPDATE
        `, [current.actorId, current.workspaceId]);
        if (existing.rows[0]) return { session: await loadAgentSession(client, existing.rows[0].id), created: false };
        const id = crypto.randomUUID();
        try {
          await client.query(`
            INSERT INTO agent_sessions (id, actor_id, workspace_id, status)
            VALUES ($1, $2, $3, 'active')
          `, [id, current.actorId, current.workspaceId]);
        } catch (error) {
          if (error.code !== "23505") throw error;
          const raced = await client.query(`
            SELECT id FROM agent_sessions
            WHERE actor_id = $1 AND workspace_id = $2 AND status = 'active'
          `, [current.actorId, current.workspaceId]);
          return { session: await loadAgentSession(client, raced.rows[0].id), created: false };
        }
        return { session: await loadAgentSession(client, id), created: true };
      });
    },

    async getBound(context, id) {
      return transaction(pool, schema, async (client) => {
        const current = postgresContext(context);
        const locked = await client.query("SELECT * FROM agent_sessions WHERE id = $1 FOR UPDATE", [id]);
        const session = locked.rows[0] ? agentSessionFrom(locked.rows[0]) : null;
        assertAgentSessionReadable(session, current);
        if (session.status !== "active") {
          throw sessionError("AGENT_SESSION_ARCHIVED", "Agent 会话已结束，请新建会话", 409);
        }
        if (session.workspaceId !== current.workspaceId) {
          await archiveAgentSessionRow(client, id);
          throw sessionError("AGENT_SESSION_CONTEXT_CHANGED", "空间已经切换，原 Agent 会话已结束", 409);
        }
        return loadAgentSession(client, id);
      });
    },

    async archive(context, id) {
      return transaction(pool, schema, async (client) => {
        const current = postgresContext(context);
        const locked = await client.query("SELECT * FROM agent_sessions WHERE id = $1 FOR UPDATE", [id]);
        const session = locked.rows[0] ? agentSessionFrom(locked.rows[0]) : null;
        assertAgentSessionReadable(session, current);
        await archiveAgentSessionRow(client, id);
      });
    },

    async save(context, session) {
      return transaction(pool, schema, async (client) => {
        const current = postgresContext(context);
        const locked = await client.query("SELECT * FROM agent_sessions WHERE id = $1 FOR UPDATE", [session.id]);
        const stored = locked.rows[0] ? agentSessionFrom(locked.rows[0]) : null;
        assertAgentSessionReadable(stored, current);
        if (stored.workspaceId !== current.workspaceId || stored.workspaceId !== session.workspaceId) {
          await archiveAgentSessionRow(client, session.id);
          throw sessionError("AGENT_SESSION_CONTEXT_CHANGED", "空间已经切换，原 Agent 会话已结束", 409);
        }
        await client.query(`
          UPDATE agent_sessions
          SET summary = $2,
              task_drafts = $3::jsonb,
              action_drafts = $4::jsonb,
              assignment_drafts = $5::jsonb,
              status = $6,
              archived_at = $7,
              updated_at = now()
          WHERE id = $1
        `, [
          session.id,
          typeof session.summary === "string" ? session.summary : stored.summary,
          JSON.stringify(persistableDrafts(session.drafts).slice(-6)),
          JSON.stringify(persistableDrafts(session.actionDrafts).slice(-6)),
          JSON.stringify(persistableDrafts(session.assignmentDrafts).slice(-6)),
          session.status,
          session.status === "archived" ? (session.archivedAt || new Date().toISOString()) : null
        ]);
        return loadAgentSession(client, session.id);
      });
    },

    async appendMessages(context, id, items) {
      return transaction(pool, schema, async (client) => {
        const current = postgresContext(context);
        const locked = await client.query("SELECT * FROM agent_sessions WHERE id = $1 FOR UPDATE", [id]);
        const session = locked.rows[0] ? agentSessionFrom(locked.rows[0]) : null;
        assertAgentSessionReadable(session, current);
        if (session.status !== "active") {
          throw sessionError("AGENT_SESSION_ARCHIVED", "Agent 会话已结束，请新建会话", 409);
        }
        if (session.workspaceId !== current.workspaceId) {
          await archiveAgentSessionRow(client, id);
          throw sessionError("AGENT_SESSION_CONTEXT_CHANGED", "空间已经切换，原 Agent 会话已结束", 409);
        }
        const max = await client.query(
          "SELECT COALESCE(MAX(seq), 0)::int AS seq FROM agent_session_messages WHERE session_id = $1",
          [id]
        );
        let seq = max.rows[0].seq;
        for (const item of items) {
          seq += 1;
          await client.query(`
            INSERT INTO agent_session_messages (id, session_id, seq, role, content)
            VALUES ($1, $2, $3, $4, $5)
          `, [crypto.randomUUID(), id, seq, item.role, item.content]);
        }
        await client.query("UPDATE agent_sessions SET updated_at = now() WHERE id = $1", [id]);
        return loadAgentSession(client, id);
      });
    }
  };
}

function reportVersionsAdapter(pool, schema) {
  return {
    async save(context, version) {
      return transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        const id = crypto.randomUUID();
        const inserted = await client.query(`
          INSERT INTO report_versions (
            id, workspace_id, author_identity_id, author_display_name,
            report_type, range_start, range_end, subject,
            evidence_summary, draft_text, model, source
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
          RETURNING id, report_type, range_start, range_end, subject, model, source, author_identity_id, author_display_name, created_at
        `, [
          id, current.workspaceId, current.actorId, current.actorName,
          version.reportType, version.rangeStart || null, version.rangeEnd || null, version.subject,
          JSON.stringify(version.evidenceSummary), version.draftText, version.model || null, version.source
        ]);
        return reportVersionMetaFrom(inserted.rows[0]);
      });
    },
    async list(context, filter = {}) {
      const { workspaceId } = postgresContext(context);
      const values = [workspaceId];
      let where = "workspace_id = $1";
      if (filter.reportType) { values.push(filter.reportType); where += ` AND report_type = $${values.length}`; }
      if (filter.rangeStart) { values.push(filter.rangeStart); where += ` AND range_start = $${values.length}`; }
      if (filter.rangeEnd) { values.push(filter.rangeEnd); where += ` AND range_end = $${values.length}`; }
      if (filter.authorIdentityId) { values.push(filter.authorIdentityId); where += ` AND author_identity_id = $${values.length}`; }
      const result = await query(pool, schema, `
        SELECT id, report_type, range_start, range_end, subject, model, source, author_identity_id, author_display_name, created_at
        FROM report_versions WHERE ${where}
        ORDER BY created_at DESC
      `, values);
      return result.rows.map(reportVersionMetaFrom);
    },
    async read(context, versionId) {
      const { workspaceId } = postgresContext(context);
      const result = await query(pool, schema, `
        SELECT id, report_type, range_start, range_end, subject, evidence_summary, draft_text, model, source, author_identity_id, author_display_name, created_at
        FROM report_versions WHERE id = $1 AND workspace_id = $2
      `, [versionId, workspaceId]);
      if (!result.rows[0]) return null;
      const row = result.rows[0];
      return { ...reportVersionMetaFrom(row), evidenceSummary: row.evidence_summary, draftText: row.draft_text };
    }
  };
}

export async function migrateLegacyPersonalData(pool, schema, config) {
  const source = readLegacyPersonalData(config);
  if (!source) return { migrated: false, reason: "no-source" };
  return transaction(pool, schema, async (client) => {
    const existing = await client.query("SELECT source_digest FROM data_imports WHERE import_key = $1", ["json-personal-v1"]);
    if (existing.rows.length) return { migrated: false, reason: "already", digest: existing.rows[0].source_digest };

    const target = await client.query(`
      SELECT
        (SELECT count(*)::int FROM tasks) AS task_count,
        (SELECT count(*)::int FROM settings) AS settings_count
    `);
    if (target.rows[0].task_count > 0 || target.rows[0].settings_count > 0) {
      throw new Error("PostgreSQL 目标空间已有数据，拒绝自动覆盖；请使用空 schema 迁移");
    }

    const current = await ensureContext(client, localPersonalContext());
    await replaceTasks(client, current, source.tasks);
    await replaceSettings(client, current, source.settings);
    const summary = { tasks: source.tasks.length, tags: Array.isArray(source.settings.tags) ? source.settings.tags.length : 0 };
    await client.query(`
      INSERT INTO data_imports (import_key, source_digest, summary)
      VALUES ($1, $2, $3::jsonb)
    `, ["json-personal-v1", source.digest, JSON.stringify(summary)]);
    return { migrated: true, digest: source.digest, ...summary };
  });
}

export async function createPostgresPersistence(config) {
  if (!config.databaseUrl) throw new Error("PostgreSQL 模式缺少 DATABASE_URL");
  const schema = config.databaseSchema || "nmtaskboard";
  schemaIdentifier(schema);
  const pool = new Pool({ connectionString: config.databaseUrl });
  let migrationReport;
  let importReport;
  try {
    migrationReport = await runPostgresMigrations(pool, schema);
    importReport = await migrateLegacyPersonalData(pool, schema, config);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    driver: "postgres",
    tasks: tasksAdapter(pool, schema),
    projects: projectsAdapter(pool, schema),
    repositories: repositoriesAdapter(pool, schema),
    notifications: notificationsAdapter(pool, schema),
    settings: settingsAdapter(pool, schema),
    backup: backupAdapter(pool, schema),
    auth: authAdapter(pool, schema),
    audit: auditAdapter(pool, schema),
    reportVersions: reportVersionsAdapter(pool, schema),
    agentSessions: agentSessionsAdapter(pool, schema),
    diagnostics() {
      return structuredClone({ migrations: migrationReport, legacyImport: importReport });
    },
    async health() {
      try {
        await pool.query("SELECT 1");
        return { driver: "postgres", ok: true };
      } catch (error) {
        return { driver: "postgres", ok: false, error: error.message };
      }
    },
    async close() {
      await pool.end();
    }
  };
}
