import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 团队创建：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("团队、唯一所有者、幂等请求与审计在真实 PostgreSQL 中成立", async (t) => {
    const schema = `nmtaskboard_team_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-team-pg-")),
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema
    });
    const app = await createApp(config);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    });

    const cookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "团队所有者" });
    const createOptions = {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "idempotency-key": "550e8400-e29b-41d4-a716-446655440000" },
      body: JSON.stringify({ name: "产品研发团队", identifier: "product-team", timeZone: "Asia/Shanghai" })
    };
    const [first, retried] = await Promise.all([
      requestJson(`${baseUrl}/api/workspaces`, createOptions),
      requestJson(`${baseUrl}/api/workspaces`, createOptions)
    ]);
    assert.deepEqual([first.status, retried.status].sort(), [200, 201]);
    assert.equal(first.body.workspace.id, retried.body.workspace.id);
    assert.equal(first.body.workspace.role, "owner");

    const spaces = await requestJson(`${baseUrl}/api/workspaces`, { headers: { cookie } });
    assert.equal(spaces.body.currentWorkspaceId, first.body.workspace.id);
    assert.deepEqual(
      [...spaces.body.workspaces.map(({ name }) => name)].sort(),
      ["产品研发团队", "团队所有者的工作区"].sort()
    );
    assert.deepEqual((await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie } })).body.tasks, []);

    const duplicateIdentifier = await requestJson(`${baseUrl}/api/workspaces`, {
      ...createOptions,
      headers: { ...createOptions.headers, "idempotency-key": "550e8400-e29b-41d4-a716-446655440001" }
    });
    assert.equal(duplicateIdentifier.status, 409);
    assert.equal(duplicateIdentifier.body.code, "TEAM_IDENTIFIER_EXISTS");

    const pool = new Pool({ connectionString: databaseUrl });
    const ownerCount = await pool.query(`SELECT count(*)::int AS count FROM "${schema}".workspace_members WHERE workspace_id = $1 AND role = 'owner'`, [first.body.workspace.id]);
    const teamRows = await pool.query(`SELECT identifier, time_zone FROM "${schema}".workspaces WHERE id = $1`, [first.body.workspace.id]);
    const audits = await pool.query(`SELECT action FROM "${schema}".audit_events WHERE workspace_id = $1 ORDER BY action`, [first.body.workspace.id]);
    await pool.end();
    assert.equal(ownerCount.rows[0].count, 1);
    assert.deepEqual(teamRows.rows[0], { identifier: "product-team", time_zone: "Asia/Shanghai" });
    assert.deepEqual(audits.rows.map(({ action }) => action), ["workspace.create", "workspace.owner_grant"]);
  });
}
