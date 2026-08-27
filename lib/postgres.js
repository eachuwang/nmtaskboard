import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";
import { localPersonalContext } from "./personal-space.js";

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
      if (applied.has(migration.version)) continue;
      await client.query(migration.sql);
      await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
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
  if (!actorId || !actorName || !workspaceId || !["personal", "team"].includes(workspaceType)) {
    throw new Error("持久化操作缺少有效的 actor/workspace 上下文");
  }
  return { actorId, actorName, workspaceId, workspaceType };
}

function timestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
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
  await client.query(`
    INSERT INTO workspaces (id, type, name, created_by_identity_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING
  `, [current.workspaceId, current.workspaceType, current.workspaceType === "personal" ? `${current.actorName}的个人空间` : current.workspaceId, current.actorId]);
  await client.query(`
    INSERT INTO workspace_members (workspace_id, identity_id, role)
    VALUES ($1, $2, 'owner')
    ON CONFLICT (workspace_id, identity_id) DO NOTHING
  `, [current.workspaceId, current.actorId]);
  return current;
}

async function replaceTasks(client, current, tasks) {
  await client.query("DELETE FROM tasks WHERE workspace_id = $1", [current.workspaceId]);
  for (const [ordinal, task] of tasks.entries()) {
    await client.query(`
      INSERT INTO tasks (
        workspace_id, id, ordinal, title, status, priority, creator_identity_id,
        due_date, created_at, updated_at, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `, [
      current.workspaceId, task.id, ordinal, task.title, task.status, task.priority,
      task.creator === current.actorName ? current.actorId : null,
      task.dueDate || null, timestamp(task.createdAt), timestamp(task.updatedAt), JSON.stringify(task)
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
          parent_id, created_at, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `, [
        current.workspaceId, task.id, comment.id || `${task.id}:comment:${index}`,
        comment.author === current.actorName ? current.actorId : null, comment.author || "我",
        comment.parentId || null, timestamp(comment.createdAt) || new Date(0).toISOString(), JSON.stringify(comment)
      ]);
    }
  }
}

function tasksAdapter(pool, schema) {
  return {
    async load(context) {
      const { workspaceId } = postgresContext(context);
      const result = await query(pool, schema, "SELECT payload FROM tasks WHERE workspace_id = $1 ORDER BY ordinal", [workspaceId]);
      return result.rows.map((row) => row.payload);
    },
    async save(context, tasks) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await replaceTasks(client, current, tasks);
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

function settingsAdapter(pool, schema) {
  return {
    async load(context) {
      const { workspaceId } = postgresContext(context);
      const result = await query(pool, schema, "SELECT payload FROM settings WHERE workspace_id = $1", [workspaceId]);
      return result.rows[0]?.payload || { ...SETTINGS_DEFAULTS };
    },
    async save(context, settings) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await replaceSettings(client, current, settings);
      });
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
  try {
    await runPostgresMigrations(pool, schema);
    await migrateLegacyPersonalData(pool, schema, config);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    driver: "postgres",
    tasks: tasksAdapter(pool, schema),
    settings: settingsAdapter(pool, schema),
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
