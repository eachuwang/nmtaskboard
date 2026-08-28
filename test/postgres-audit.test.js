import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { appendAudit } from "../lib/audit.js";
import { createPostgresPersistence } from "../lib/postgres.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test("PostgreSQL 审计：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("审计事件不可变且查询严格受空间管理员成员关系约束", async (t) => {
    const schema = `nmtaskboard_audit_${process.pid}_${Date.now()}`;
    const persistence = await createPostgresPersistence({ databaseUrl, databaseSchema: schema });
    const ownerContext = {
      actor: { id: "audit-owner", displayName: "空间所有者" },
      workspace: { id: "audit-personal", type: "personal" }
    };
    await persistence.tasks.save(ownerContext, []);
    await appendAudit(persistence.audit, {
      actor: ownerContext.actor, workspace: ownerContext.workspace, source: "agent",
      action: "task.update", target: { type: "task", id: "task-1" }, outcome: "success",
      summary: { statusCode: 200, apiKey: "must-not-store", prompt: "must-not-store", changedFields: ["status"] }
    });
    t.after(async () => {
      await persistence.close();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    });

    const events = await persistence.audit.list(ownerContext);
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "agent");
    assert.equal(events[0].action, "task.update");
    assert.deepEqual(events[0].summary, { statusCode: 200, changedFields: ["status"] });

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await assert.rejects(pool.query(`UPDATE "${schema}".audit_events SET action = 'tampered'`), /append-only/);
      await assert.rejects(pool.query(`DELETE FROM "${schema}".audit_events`), /append-only/);
      await pool.query(`INSERT INTO "${schema}".identities (id, display_name, is_system_admin) VALUES ('system-outsider', '系统管理员', true)`);
      await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id, identity_id, role) VALUES ('audit-personal', 'system-outsider', 'member')`);
    } finally {
      await pool.end();
    }
    await assert.rejects(
      persistence.audit.list({ actor: { id: "system-outsider", displayName: "系统管理员", isSystemAdmin: true }, workspace: ownerContext.workspace }),
      (error) => error.code === "AUDIT_FORBIDDEN" && error.statusCode === 403
    );
  });
}
