import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/auth.js";
import { loadConfig } from "../lib/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 团队时区：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("团队管理员配置时区并立即生效，成员被拒绝", async (t) => {
    const schema = `nmtaskboard_tz_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-tz-pg-")),
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, BOOTSTRAP_TOKEN: "tz-bootstrap"
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

    await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: "POST", headers: { "content-type": "application/json", "x-bootstrap-token": "tz-bootstrap" },
      body: JSON.stringify({ login: "owner", displayName: "团队所有者", password: "correct-horse-battery" })
    });
    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "owner", password: "correct-horse-battery" })
    });
    const ownerCookie = ownerLogin.headers.get("set-cookie");
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "tz-team-request" },
      body: JSON.stringify({ name: "时区团队", identifier: "tz-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;

    const updated = await requestJson(`${baseUrl}/api/team/timezone`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ timeZone: "Europe/Berlin" })
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.workspace.timeZone, "Europe/Berlin");

    const session = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: ownerCookie } });
    assert.equal(session.body.workspace.type, "team");
    assert.equal(session.body.workspace.timeZone, "Europe/Berlin");

    const members = await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: ownerCookie } });
    assert.equal(members.body.workspace.timeZone, "Europe/Berlin");

    const passwordHash = await hashPassword("correct-horse-battery");
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash) VALUES ($1, $2, $3, $4, $5)`, ["member-a", "成员甲", "member-a", "member-a@example.com", passwordHash]);
    await pool.query(`INSERT INTO "${schema}".workspaces (id, type, name, created_by_identity_id) VALUES ($1, 'personal', $2, $3)`, ["personal-member-a", "成员甲的个人空间", "member-a"]);
    await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id, identity_id, role) VALUES ($1, $2, 'owner')`, ["personal-member-a", "member-a"]);
    await pool.end();

    await requestJson(`${baseUrl}/api/team/members/invite`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identifier: "member-a@example.com" })
    });
    const memberLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "member-a", password: "correct-horse-battery" })
    });
    const memberCookie = memberLogin.headers.get("set-cookie");
    await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    });
    const denied = await requestJson(`${baseUrl}/api/team/timezone`, {
      method: "PATCH", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ timeZone: "Asia/Tokyo" })
    });
    assert.equal(denied.status, 403);
  });
}
