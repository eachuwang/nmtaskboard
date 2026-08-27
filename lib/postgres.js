import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";

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
          for (const assignee of task.assignees || []) {
            await client.query(`
              INSERT INTO task_progress (
                workspace_id, task_id, participant_key, participant_label, status, payload
              ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
            `, [current.workspaceId, task.id, assignee, assignee, task.status, JSON.stringify({ assignee, status: task.status })]);
          }
        }
      });
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
    async save(context, settings) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
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
      });
    }
  };
}

export async function createPostgresPersistence(config) {
  if (!config.databaseUrl) throw new Error("PostgreSQL 模式缺少 DATABASE_URL");
  const schema = config.databaseSchema || "nmtaskboard";
  schemaIdentifier(schema);
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await runPostgresMigrations(pool, schema);
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
