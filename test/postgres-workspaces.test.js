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
  test("PostgreSQL 空间切换：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("空间选择恢复、权限撤销回退与跨空间实体隔离", async (t) => {
    const schema = `nmtaskboard_workspace_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-workspace-pg-")),
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

    const personalCookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "空间用户" });
    const session = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: personalCookie } });
    const actorId = session.body.actor.id;
    const personalId = session.body.workspace.id;
    const personalTask = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: personalCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "个人任务" })
    });
    const personalTaskId = personalTask.body.task.id;

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(`INSERT INTO "${schema}".workspaces (id, type, name, created_by_identity_id) VALUES ('team-shared', 'team', '协作团队', $1)`, [actorId]);
      await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id, identity_id, role) VALUES ('team-shared', $1, 'owner')`, [actorId]);
      await pool.query(`INSERT INTO "${schema}".identities (id, display_name) VALUES ('other-owner', '其他所有者')`);
      await pool.query(`INSERT INTO "${schema}".workspaces (id, type, name, created_by_identity_id) VALUES ('team-secret', 'team', '不可见团队', 'other-owner')`);
      await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id, identity_id, role) VALUES ('team-secret', 'other-owner', 'owner')`);
    } finally {
      await pool.end();
    }

    const spaces = await requestJson(`${baseUrl}/api/workspaces`, { headers: { cookie: personalCookie } });
    assert.equal(spaces.status, 200);
    assert.deepEqual(spaces.body.workspaces.map(({ id }) => id), [personalId, "team-shared"]);
    assert.equal(spaces.body.currentWorkspaceId, personalId);

    const selected = await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: personalCookie, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "team-shared" })
    });
    assert.equal(selected.status, 200);
    assert.equal((await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: personalCookie } })).body.tasks.length, 0);
    const crossSpace = await requestJson(`${baseUrl}/api/tasks/${personalTaskId}`, {
      method: "PUT", headers: { cookie: personalCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "越权修改" })
    });
    const unknown = await requestJson(`${baseUrl}/api/tasks/not-existing`, {
      method: "PUT", headers: { cookie: personalCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "未知任务" })
    });
    assert.deepEqual(crossSpace, unknown);
    await fetch(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: personalCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "团队任务" })
    });

    await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: personalCookie } });
    const returningLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "owner", password: "correct-horse-battery" })
    });
    const returningCookie = returningLogin.headers.get("set-cookie");
    assert.equal((await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: returningCookie } })).body.workspace.id, "team-shared");

    const revokePool = new Pool({ connectionString: databaseUrl });
    await revokePool.query(`DELETE FROM "${schema}".workspace_members WHERE workspace_id = 'team-shared' AND identity_id = $1`, [actorId]);
    await revokePool.end();
    const fallback = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: returningCookie } });
    assert.equal(fallback.body.workspace.id, personalId);
    assert.deepEqual((await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: returningCookie } })).body.tasks.map(({ title }) => title), ["个人任务"]);

    const forbidden = await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: returningCookie, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "team-secret" })
    });
    const missing = await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: returningCookie, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: "missing-space" })
    });
    assert.deepEqual(forbidden, missing);
    assert.equal(forbidden.status, 404);
  });
}
