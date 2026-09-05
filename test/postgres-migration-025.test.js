import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { loadPostgresMigrations, runPostgresMigrations } from "../lib/postgres.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test("025 迁移回归：需要 TEST_DATABASE_URL", { skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("025 迁移：含 personal/team 旧审计行的库可迁移成功且值归一为 workspace", async (t) => {
    const schema = `nmtaskboard_mig025_${process.pid}_${Date.now()}`;
    const pool = new Pool({ connectionString: databaseUrl });
    t.after(async () => {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    const migrations = loadPostgresMigrations();
    const through024 = migrations.filter((migration) => migration.version < 25);
    const from025 = migrations.filter((migration) => migration.version >= 25);

    // 先推进到 025 之前的结构（此时 audit_events 允许 personal/team）
    const baseline = await runPostgresMigrations(pool, schema, through024);
    assert.equal(baseline.status, "applied");

    // 模拟真实 dev/prod 库：残留旧域值的审计行 + personal 工作区 + planned 任务 + 旧进展记录
    await pool.query(`
      INSERT INTO "${schema}".audit_events (id, workspace_type, source, action, target_type, outcome)
      VALUES
        (gen_random_uuid(), 'personal', 'ui', 'auth.login', 'identity', 'success'),
        (gen_random_uuid(), 'team', 'api', 'task.create', 'task', 'success'),
        (gen_random_uuid(), 'system', 'system', 'identity.bootstrap', 'identity', 'success'),
        (gen_random_uuid(), NULL, 'ui', 'settings.update', 'workspace', 'success');

      INSERT INTO "${schema}".identities (id, display_name, email)
      VALUES ('u-legacy', '旧用户', 'legacy@example.com');

      INSERT INTO "${schema}".workspaces (id, type, name, created_by_identity_id)
      VALUES ('ws-legacy', 'personal', '旧个人空间', 'u-legacy');

      INSERT INTO "${schema}".tasks (workspace_id, id, ordinal, title, status, priority, payload)
      VALUES ('ws-legacy', 't-legacy', 1, '旧计划任务', 'planned', 'high', '{}'::jsonb);

      INSERT INTO "${schema}".task_progress_records (workspace_id, task_id, id, author_identity_id, author_display_name, text, created_at, updated_at, payload)
      VALUES ('ws-legacy', 't-legacy', 'pr-1', 'u-legacy', '旧用户', '旧进展记录', now(), now(), '{"text": "旧进展记录"}'::jsonb);
    `);

    // 025 重加约束前必须先回填，否则会因 CHECK 违例失败
    const report = await runPostgresMigrations(pool, schema, from025);
    assert.equal(report.status, "applied");
    assert.ok(report.attempted.some((name) => name.includes("multica_workspace_domain")));

    const rows = await pool.query(`SELECT workspace_type, count(*) FROM "${schema}".audit_events GROUP BY 1 ORDER BY 1`);
    const distribution = Object.fromEntries(rows.rows.map((row) => [row.workspace_type ?? "NULL", Number(row.count)]));
    assert.deepEqual(distribution, { NULL: 1, system: 1, workspace: 2 });

    // 旧工作区/任务/进展记录被统一到 multifca 域
    const workspace = await pool.query(`SELECT type, slug, task_prefix FROM "${schema}".workspaces WHERE id = 'ws-legacy'`);
    assert.equal(workspace.rows[0].type, "workspace");
    assert.ok(workspace.rows[0].slug);
    const task = await pool.query(`SELECT status FROM "${schema}".tasks WHERE id = 't-legacy'`);
    assert.equal(task.rows[0].status, "backlog");
    const comment = await pool.query(`SELECT type, payload->>'text' AS text FROM "${schema}".task_comments WHERE task_id = 't-legacy' AND id = 'pr-1'`);
    assert.equal(comment.rows[0]?.type, "progress_update");
    assert.equal(comment.rows[0]?.text, "旧进展记录");
  });
}
