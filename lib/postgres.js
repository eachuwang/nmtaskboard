import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { DEFAULT_REPORT_TIME_ZONE } from "./settings.js";
import { DEFAULT_LOCAL_ACTOR_ID, DEFAULT_PERSONAL_WORKSPACE_ID, localPersonalContext } from "./personal-space.js";

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

function backupAdapter(pool, schema) {
  return {
    async export(context) {
      const { workspaceId } = postgresContext(context);
      return snapshot(pool, schema, async (client) => {
        const tasks = await client.query("SELECT payload FROM tasks WHERE workspace_id = $1 ORDER BY ordinal", [workspaceId]);
        const settings = await client.query("SELECT payload FROM settings WHERE workspace_id = $1", [workspaceId]);
        return {
          tasks: tasks.rows.map((row) => row.payload),
          settings: settings.rows[0]?.payload || { ...SETTINGS_DEFAULTS }
        };
      });
    },
    async replace(context, data) {
      await transaction(pool, schema, async (client) => {
        const current = await ensureContext(client, context);
        await replaceTasks(client, current, data.tasks);
        if (data.settings) await replaceSettings(client, current, data.settings);
      });
    }
  };
}

function authAdapter(pool, schema) {
  const identityFrom = (row) => row && ({
    id: row.id,
    login: row.login_name,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    disabledAt: row.disabled_at,
    isSystemAdmin: row.is_system_admin
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
          return identityFrom({ ...existing.rows[0], display_name: profile.displayName, email: profile.email });
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
          return identityFrom(linked.rows[0]);
        }
        const inserted = await client.query(`
          INSERT INTO identities (id, display_name, email)
          VALUES ($1, $2, $3) RETURNING *
        `, [identityId, profile.displayName, profile.email]);
        await client.query(`
          INSERT INTO external_identities (provider, subject, tenant_id, identity_id, email)
          VALUES ($1, $2, $3, $4, $5)
        `, [profile.provider, profile.subject, profile.tenantId, identityId, profile.email]);
        const personalWorkspaceId = `personal-${identityId}`;
        await client.query(`
          INSERT INTO workspaces (id, type, name, created_by_identity_id)
          VALUES ($1, 'personal', $2, $3)
        `, [personalWorkspaceId, `${profile.displayName}的个人空间`, identityId]);
        await client.query(`
          INSERT INTO workspace_members (workspace_id, identity_id, role)
          VALUES ($1, $2, 'owner')
        `, [personalWorkspaceId, identityId]);
        return identityFrom(inserted.rows[0]);
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
          INSERT INTO workspaces (id, type, name, created_by_identity_id)
          VALUES ($1, 'personal', $2, $3)
          ON CONFLICT (id) DO NOTHING
        `, [DEFAULT_PERSONAL_WORKSPACE_ID, `${displayName}的个人空间`, DEFAULT_LOCAL_ACTOR_ID]);
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
    async findIdentityByLogin(login) {
      const result = await query(pool, schema, "SELECT * FROM identities WHERE lower(login_name) = lower($1)", [login]);
      return identityFrom(result.rows[0]);
    },
    async createSession({ tokenHash, identityId, expiresAt }) {
      await query(pool, schema, `
        INSERT INTO auth_sessions (token_hash, identity_id, expires_at)
        VALUES ($1, $2, $3)
      `, [tokenHash, identityId, expiresAt]);
    },
    async findSession(tokenHash) {
      const result = await query(pool, schema, `
        SELECT s.expires_at, s.revoked_at, i.*
        FROM auth_sessions s
        JOIN identities i ON i.id = s.identity_id
        WHERE s.token_hash = $1
      `, [tokenHash]);
      const row = result.rows[0];
      return row ? {
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        identity: identityFrom(row)
      } : null;
    },
    async revokeSession(tokenHash) {
      await query(pool, schema, "UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1", [tokenHash]);
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
    backup: backupAdapter(pool, schema),
    auth: authAdapter(pool, schema),
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
