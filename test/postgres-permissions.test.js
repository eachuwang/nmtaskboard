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
  test("PostgreSQL 权限矩阵：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("团队成员可见与操作范围即时生效，隐藏资源不可由 ID 探测", async (t) => {
    const schema = `nmtaskboard_permissions_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-permissions-pg-")),
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, BOOTSTRAP_TOKEN: "permissions-bootstrap"
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
      method: "POST", headers: { "content-type": "application/json", "x-bootstrap-token": "permissions-bootstrap" },
      body: JSON.stringify({ login: "owner", displayName: "所有者", password: "correct-horse-battery" })
    });
    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "owner", password: "correct-horse-battery" })
    });
    const ownerSession = ownerLogin.headers.get("set-cookie");
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerSession, "content-type": "application/json", "idempotency-key": "permissions-team" },
      body: JSON.stringify({ name: "权限团队", identifier: "permission-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;

    const passwordHash = await hashPassword("correct-horse-battery");
    const pool = new Pool({ connectionString: databaseUrl });
    for (const person of [
      { id: "member-a", name: "成员甲", login: "member-a" },
      { id: "member-b", name: "成员乙", login: "member-b" },
      { id: "outsider", name: "团队外成员", login: "outsider" }
    ]) {
      await pool.query(`INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash) VALUES ($1, $2, $3, $4, $5)`, [person.id, person.name, person.login, `${person.login}@example.com`, passwordHash]);
      await pool.query(`INSERT INTO "${schema}".workspaces (id, type, name, created_by_identity_id) VALUES ($1, 'personal', $2, $3)`, [`personal-${person.id}`, `${person.name}个人空间`, person.id]);
      await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id, identity_id, role) VALUES ($1, $2, 'owner')`, [`personal-${person.id}`, person.id]);
    }
    await pool.end();
    for (const id of ["member-a", "member-b"]) {
      assert.equal((await requestJson(`${baseUrl}/api/team/members/invite`, {
        method: "POST", headers: { cookie: ownerSession, "content-type": "application/json" }, body: JSON.stringify({ identifier: id })
      })).status, 201);
    }

    const create = async (title) => requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerSession, "content-type": "application/json" }, body: JSON.stringify({ title, status: "todo" })
    });
    const own = await create("成员甲执行任务");
    const other = await create("成员乙只读任务");
    const seed = new Pool({ connectionString: databaseUrl });
    for (const [task, assignee] of [[own.body.task, "member-a"], [other.body.task, "member-b"]]) {
      await seed.query(`UPDATE "${schema}".tasks SET status = 'in_progress', payload = payload || $3::jsonb WHERE workspace_id = $1 AND id = $2`, [teamId, task.id, JSON.stringify({ status: "in_progress", taskType: "execution", assigneeIdentityId: assignee })]);
    }
    await seed.end();

    const login = async (loginName) => {
      const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: loginName, password: "correct-horse-battery" })
      });
      return response.headers.get("set-cookie");
    };
    const memberCookie = await login("member-a");
    assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    })).status, 200);

    const assignedOnly = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.deepEqual(assignedOnly.body.tasks.map((task) => task.title), ["成员甲执行任务"]);
    assert.equal(assignedOnly.body.tasks[0].permission.access, "own");
    const hiddenById = await requestJson(`${baseUrl}/api/tasks/${other.body.task.id}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "done" })
    });
    assert.equal(hiddenById.status, 404);
    assert.equal((await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "越权创建" })
    })).status, 403);

    assert.equal((await requestJson(`${baseUrl}/api/team/members/member-a/permissions`, {
      method: "PATCH", headers: { cookie: ownerSession, "content-type": "application/json" },
      body: JSON.stringify({ visibilityScope: "team", operationScope: "assigned" })
    })).status, 200);
    const teamVisible = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.deepEqual(teamVisible.body.tasks.map((task) => task.title), ["成员甲执行任务", "成员乙只读任务"]);
    assert.equal(teamVisible.body.tasks[1].permission.access, "readonly");
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${other.body.task.id}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "done" })
    })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${own.body.task.id}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "done" })
    })).status, 200);

    assert.equal((await requestJson(`${baseUrl}/api/team/members/member-a/permissions`, {
      method: "PATCH", headers: { cookie: ownerSession, "content-type": "application/json" },
      body: JSON.stringify({ visibilityScope: "team", operationScope: "none" })
    })).status, 200);
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${own.body.task.id}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "in_progress", reason: "需要返工" })
    })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/settings`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" }, body: "{}"
    })).status, 403);

    const outsiderCookie = await login("outsider");
    assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: outsiderCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    })).status, 404);
  });
}
