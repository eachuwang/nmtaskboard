import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createPostgresPersistence, runPostgresMigrations } from "../lib/postgres.js";
import { CONTRACT_CONTEXT, persistenceContract } from "./persistence-contract.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schema = `nmtaskboard_test_${process.pid}_${Date.now()}`;

async function dropSchema(name) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
  } finally {
    await pool.end();
  }
}

if (!databaseUrl) {
  test("PostgreSQL Adapter：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => {
    assert.fail("请设置 TEST_DATABASE_URL 后运行 PostgreSQL 契约测试");
  });
} else {
  persistenceContract("PostgreSQL Adapter", async () => {
    const persistence = await createPostgresPersistence({ databaseUrl, databaseSchema: schema });
    const close = persistence.close.bind(persistence);
    persistence.close = async () => {
      await close();
      await dropSchema(schema);
    };
    return persistence;
  });

  test("PostgreSQL 配置可启动应用并报告数据库就绪", async (t) => {
    const appSchema = `${schema}_app`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-pg-app-"));
    const config = loadConfig({
      PORT: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: appSchema
    });
    const app = await createApp(config);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      await dropSchema(appSchema);
    });

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ready, true);
    assert.deepEqual(body.persistence, { driver: "postgres", ok: true });

    const catalogPool = new Pool({ connectionString: databaseUrl });
    try {
      const tables = await catalogPool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
      `, [appSchema]);
      assert.deepEqual(tables.rows.map((row) => row.table_name), [
        "agent_configuration",
        "agent_session_messages",
        "agent_sessions",
        "audit_events",
        "auth_configuration",
        "auth_sessions",
        "data_imports",
        "external_identities",
        "identities",
        "instance_settings",
        "oidc_login_flows",
        "report_versions",
        "schema_migrations",
        "settings",
        "system_bootstrap",
        "tags",
        "task_cancel_requests",
        "task_comments",
        "task_history",
        "task_progress",
        "task_progress_records",
        "tasks",
        "team_invitations",
        "workspace_members",
        "workspaces"
      ]);
      const indexes = await catalogPool.query(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = $1
      `, [appSchema]);
      const indexNames = new Set(indexes.rows.map((row) => row.indexname));
      for (const required of [
        "identities_email_unique",
        "identities_login_name_unique",
        "auth_sessions_identity_idx",
        "auth_sessions_selected_workspace_idx",
        "audit_events_workspace_time_idx",
        "audit_events_actor_time_idx",
        "external_identities_identity_idx",
        "oidc_login_flows_expiry_idx",
        "workspace_members_identity_idx",
        "tasks_workspace_status_order_idx",
        "task_history_timeline_idx",
        "task_cancel_requests_workspace_time_idx",
        "task_cancel_requests_execution_status_idx",
        "task_comments_task_time_idx",
        "task_progress_identity_idx",
        "task_progress_records_task_time_idx",
        "task_progress_records_author_time_idx",
        "report_versions_workspace_time_idx",
        "report_versions_workspace_type_range_idx",
        "agent_sessions_active_actor_workspace_idx",
        "agent_sessions_actor_workspace_idx",
        "agent_session_messages_session_seq_idx",
        "team_invitations_one_pending",
        "team_invitations_invitee_pending"
      ]) {
        assert.equal(indexNames.has(required), true, `缺少索引 ${required}`);
      }
    } finally {
      await catalogPool.end();
    }
  });

  test("真实 PostgreSQL 中失败迁移不留下 schema 或成功版本", async (t) => {
    const failureSchema = `${schema}_rollback`;
    const pool = new Pool({ connectionString: databaseUrl });
    t.after(async () => {
      await pool.end();
      await dropSchema(failureSchema);
    });

    await assert.rejects(runPostgresMigrations(pool, failureSchema, [
      { version: 1, name: "first", sql: "CREATE TABLE migration_probe (id integer PRIMARY KEY)" },
      { version: 2, name: "broken", sql: "THIS IS NOT VALID SQL" }
    ]));
    const result = await pool.query("SELECT to_regnamespace($1) AS namespace", [failureSchema]);
    assert.equal(result.rows[0].namespace, null);
  });

  test("PostgreSQL 备份恢复失败会回滚，并发恢复不会混合任务与设置", async (t) => {
    const backupSchema = `${schema}_backup`;
    const persistence = await createPostgresPersistence({ databaseUrl, databaseSchema: backupSchema });
    t.after(async () => {
      await persistence.close();
      await dropSchema(backupSchema);
    });
    const bundle = (id, temperature) => ({
      tasks: [{ id, title: id, status: "todo", priority: "medium", order: 0, comments: [], history: [], assignees: [] }],
      settings: { providers: [], defaultProviderId: "", temperature, tags: [], reportTimeZone: "Asia/Shanghai" }
    });

    const original = bundle("original", 0.5);
    await persistence.backup.replace(CONTRACT_CONTEXT, original);
    await assert.rejects(persistence.backup.replace(CONTRACT_CONTEXT, {
      tasks: [{ ...original.tasks[0], priority: "invalid" }],
      settings: { ...original.settings, temperature: 0.9 }
    }));
    assert.deepEqual(await persistence.backup.export(CONTRACT_CONTEXT), original);

    const first = bundle("first", 0.1);
    const second = bundle("second", 0.2);
    await Promise.all([
      persistence.backup.replace(CONTRACT_CONTEXT, first),
      persistence.backup.replace(CONTRACT_CONTEXT, second)
    ]);
    const final = await persistence.backup.export(CONTRACT_CONTEXT);
    assert.ok(
      (final.tasks[0].id === "first" && final.settings.temperature === 0.1) ||
      (final.tasks[0].id === "second" && final.settings.temperature === 0.2)
    );
  });
}
