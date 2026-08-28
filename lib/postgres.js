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

function teamError(code, message, statusCode) {
  return Object.assign(new Error(message), { code, statusCode });
}

function memberFrom(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email || "",
    login: row.login_name || "",
    role: row.role,
    visibilityScope: row.visibility_scope || (row.role === "member" ? "assigned" : "team"),
    operationScope: row.operation_scope || "assigned",
    joinedAt: row.created_at,
    unfinishedTaskCount: Number(row.unfinished_task_count) || 0
  };
}

async function requireTeamRole(client, workspaceId, identityId, roles) {
  const membership = await client.query(`
    SELECT m.role FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = $1 AND m.identity_id = $2 AND m.removed_at IS NULL
      AND w.type = 'team' AND m.role = ANY($3::text[])
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
    lastWorkspaceId: row.last_workspace_id || null
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
        const personalWorkspaceId = `personal-${identityId}`;
        await client.query(`
          INSERT INTO workspaces (id, type, name, created_by_identity_id)
          VALUES ($1, 'personal', $2, $3)
        `, [personalWorkspaceId, `${profile.displayName}的个人空间`, identityId]);
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
    async resolveWorkspace(identityId, preferredWorkspaceId) {
      if (preferredWorkspaceId) {
        const preferred = await query(pool, schema, `
          SELECT w.id, w.type, w.name, m.role,
            m.visibility_scope AS "visibilityScope", m.operation_scope AS "operationScope"
          FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.identity_id = $1 AND w.id = $2 AND m.removed_at IS NULL
        `, [identityId, preferredWorkspaceId]);
        if (preferred.rows[0]) return preferred.rows[0];
      }
      const personal = await query(pool, schema, `
        SELECT w.id, w.type, w.name, m.role,
          m.visibility_scope AS "visibilityScope", m.operation_scope AS "operationScope"
        FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.identity_id = $1 AND w.type = 'personal' AND m.removed_at IS NULL
        ORDER BY w.created_at ASC LIMIT 1
      `, [identityId]);
      return personal.rows[0] || null;
    },
    async listWorkspaces(identityId) {
      const result = await query(pool, schema, `
        SELECT w.id, w.type, w.name, m.role,
          m.visibility_scope AS "visibilityScope", m.operation_scope AS "operationScope"
        FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.identity_id = $1 AND m.removed_at IS NULL
        ORDER BY CASE w.type WHEN 'personal' THEN 0 ELSE 1 END, lower(w.name), w.id
      `, [identityId]);
      return result.rows;
    },
    async createTeam(identityId, input) {
      const teamFrom = (row) => ({
        id: row.id, type: row.type, name: row.name, identifier: row.identifier,
        timeZone: row.time_zone, role: "owner"
      });
      try {
        return await transaction(pool, schema, async (client) => {
          const inserted = await client.query(`
            INSERT INTO workspaces (
              id, type, name, identifier, time_zone, creation_request_id, created_by_identity_id
            ) VALUES ($1, 'team', $2, $3, $4, $5, $6)
            ON CONFLICT (created_by_identity_id, creation_request_id)
              WHERE type = 'team' AND creation_request_id IS NOT NULL
              DO NOTHING
            RETURNING id, type, name, identifier, time_zone
          `, [crypto.randomUUID(), input.name, input.identifier, input.timeZone, input.requestId, identityId]);
          let workspace = inserted.rows[0];
          if (!workspace) {
            const existing = await client.query(`
              SELECT id, type, name, identifier, time_zone
              FROM workspaces
              WHERE type = 'team' AND created_by_identity_id = $1 AND creation_request_id = $2
            `, [identityId, input.requestId]);
            workspace = existing.rows[0];
            return { workspace: teamFrom(workspace), created: false };
          }
          await client.query(`
            INSERT INTO workspace_members (workspace_id, identity_id, role)
            VALUES ($1, $2, 'owner')
          `, [workspace.id, identityId]);
          return { workspace: teamFrom(workspace), created: true };
        });
      } catch (error) {
        if (error.code === "23505" && error.constraint === "workspaces_team_identifier_unique") {
          throw Object.assign(new Error("团队标识已被使用"), { code: "TEAM_IDENTIFIER_EXISTS", statusCode: 409 });
        }
        throw error;
      }
    },
    async listTeamMembers(actorId, workspaceId) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner", "admin"]);
        const workspace = await client.query("SELECT id, name FROM workspaces WHERE id = $1", [workspaceId]);
        const result = await client.query(`
          SELECT i.id, i.display_name, i.email, i.login_name, m.role, m.visibility_scope, m.operation_scope, m.created_at,
            count(p.task_id) FILTER (WHERE p.status NOT IN ('done', 'cancelled'))::int AS unfinished_task_count
          FROM workspace_members m
          JOIN identities i ON i.id = m.identity_id
          LEFT JOIN task_progress p ON p.workspace_id = m.workspace_id AND p.participant_identity_id = m.identity_id
          WHERE m.workspace_id = $1 AND m.removed_at IS NULL
          GROUP BY i.id, i.display_name, i.email, i.login_name, m.role, m.visibility_scope, m.operation_scope, m.created_at
          ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(i.display_name), i.id
        `, [workspaceId]);
        return { workspace: workspace.rows[0], members: result.rows.map(memberFrom) };
      });
    },
    async inviteTeamMember(actorId, workspaceId, identifier) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner"]);
        const identity = await client.query(`
          SELECT id, display_name, email, login_name
          FROM identities
          WHERE lower(coalesce(email, '')) = lower($1) OR lower(coalesce(login_name, '')) = lower($1)
          ORDER BY CASE WHEN lower(coalesce(email, '')) = lower($1) THEN 0 ELSE 1 END
          LIMIT 1
        `, [identifier]);
        const target = identity.rows[0];
        if (!target) throw teamError("MEMBER_NOT_FOUND", "未找到可识别的企业用户", 404);
        if (target.id === actorId) throw teamError("MEMBER_ALREADY_JOINED", "你已经是团队所有者", 409);
        const membership = await client.query(`
          SELECT role, removed_at FROM workspace_members WHERE workspace_id = $1 AND identity_id = $2 FOR UPDATE
        `, [workspaceId, target.id]);
        if (membership.rows[0] && !membership.rows[0].removed_at) throw teamError("MEMBER_ALREADY_JOINED", "该用户已经是团队成员", 409);
        if (membership.rows[0]) {
          await client.query(`
            UPDATE workspace_members SET role = 'member', visibility_scope = 'assigned', operation_scope = 'assigned', removed_at = NULL, removed_by_identity_id = NULL,
              removal_task_handling = NULL, created_at = now(), updated_at = now()
            WHERE workspace_id = $1 AND identity_id = $2
          `, [workspaceId, target.id]);
        } else {
          await client.query(`INSERT INTO workspace_members (workspace_id, identity_id, role) VALUES ($1, $2, 'member')`, [workspaceId, target.id]);
        }
        return memberFrom({ ...target, role: "member", visibility_scope: "assigned", operation_scope: "assigned", created_at: new Date().toISOString(), unfinished_task_count: 0 });
      });
    },
    async changeTeamMemberRole(actorId, workspaceId, identityId, role) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner"]);
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
    async transferTeamOwnership(actorId, workspaceId, identityId, confirmName) {
      return transaction(pool, schema, async (client) => {
        const team = await client.query("SELECT id, name FROM workspaces WHERE id = $1 AND type = 'team' FOR UPDATE", [workspaceId]);
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
        await requireTeamRole(client, workspaceId, actorId, ["owner"]);
        const member = await activeRemovableMember(client, workspaceId, actorId, identityId);
        const tasks = await client.query(`
          SELECT p.task_id AS id, t.title, p.status
          FROM task_progress p JOIN tasks t ON t.workspace_id = p.workspace_id AND t.id = p.task_id
          WHERE p.workspace_id = $1 AND p.participant_identity_id = $2 AND p.status NOT IN ('done', 'cancelled')
          ORDER BY t.ordinal, p.task_id
        `, [workspaceId, identityId]);
        return { member: memberFrom({ ...member, unfinished_task_count: tasks.rows.length }), unfinishedTasks: tasks.rows };
      });
    },
    async removeTeamMember(actorId, workspaceId, identityId, handling) {
      return transaction(pool, schema, async (client) => {
        await requireTeamRole(client, workspaceId, actorId, ["owner"]);
        const member = await activeRemovableMember(client, workspaceId, actorId, identityId);
        const unfinished = await client.query(`
          SELECT count(*)::int AS count FROM task_progress
          WHERE workspace_id = $1 AND participant_identity_id = $2 AND status NOT IN ('done', 'cancelled')
        `, [workspaceId, identityId]);
        if (unfinished.rows[0].count > 0 && !["unassign", "cancel"].includes(handling)) {
          throw teamError("MEMBER_TASK_HANDLING_REQUIRED", "请先选择未完成执行任务的处理方式", 409);
        }
        if (handling === "unassign") {
          await client.query(`
            UPDATE task_progress SET participant_identity_id = NULL, participant_label = participant_label || '（已移除）',
              payload = payload || jsonb_build_object('removedIdentityId', $2::text), updated_at = now()
            WHERE workspace_id = $1 AND participant_identity_id = $2 AND status NOT IN ('done', 'cancelled')
          `, [workspaceId, identityId]);
        } else if (handling === "cancel") {
          await client.query(`
            UPDATE task_progress SET status = 'cancelled',
              payload = payload || jsonb_build_object('cancelReason', '成员被移除', 'removedIdentityId', $2::text), updated_at = now()
            WHERE workspace_id = $1 AND participant_identity_id = $2 AND status NOT IN ('done', 'cancelled')
          `, [workspaceId, identityId]);
        }
        await client.query(`
          UPDATE workspace_members SET removed_at = now(), removed_by_identity_id = $3,
            removal_task_handling = $4, updated_at = now()
          WHERE workspace_id = $1 AND identity_id = $2
        `, [workspaceId, identityId, actorId, unfinished.rows[0].count > 0 ? handling : null]);
        return { member: memberFrom({ ...member, unfinished_task_count: unfinished.rows[0].count }), handling: unfinished.rows[0].count > 0 ? handling : null };
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

function auditAdapter(pool, schema) {
  return {
    async append(event) {
      const actor = event.actor || {};
      const workspace = event.workspace || {};
      const result = await query(pool, schema, `
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
    audit: auditAdapter(pool, schema),
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
