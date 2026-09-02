import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser, readAdminPassword } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test("PostgreSQL 认证：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("PostgreSQL 种子固定 admin，改密后不能建团，普通用户可登录", async (t) => {
    const schema = `nmtaskboard_auth_${process.pid}_${Date.now()}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-auth-pg-"));
    const config = loadConfig({
      PORT: "0",
      DATA_DIR: dataDir,
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: schema
    });
    const app = await createApp(config, { log: () => {} });
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    const password = readAdminPassword(dataDir);
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "admin", password })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    const gated = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "idempotency-key": "admin-no" },
      body: JSON.stringify({ name: "管理团队", identifier: "admin-team", timeZone: "Asia/Shanghai" })
    });
    assert.equal(gated.status, 403);

    const changed = await fetch(`${baseUrl}/api/auth/password`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: password, newPassword: "new-horse-battery" })
    });
    assert.equal(changed.status, 200);
    const again = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "idempotency-key": "admin-no" },
      body: JSON.stringify({ name: "管理团队", identifier: "admin-team", timeZone: "Asia/Shanghai" })
    });
    assert.equal(again.status, 403);

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "所有者" });
    const usernameLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "所有者", password: "correct-horse-battery" })
    });
    assert.equal(usernameLogin.status, 200);

    const duplicateUsername = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "所有者", login: "another@example.com", password: "correct-horse-battery" })
    });
    assert.equal(duplicateUsername.status, 409);
    assert.equal((await duplicateUsername.json()).code, "USERNAME_EXISTS");

    const created = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "数据库会话任务", actor: "伪造用户" })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).task.creator, "所有者");

    const registered = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "艾达", login: "ada@example.com", password: "correct-horse-battery" })
    });
    assert.equal(registered.status, 201);
    const pendingLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "ada@example.com", password: "correct-horse-battery" })
    });
    const pendingBody = await pendingLogin.json();
    assert.equal(pendingLogin.status, 200, JSON.stringify(pendingBody));
    assert.equal(pendingBody.identity.reviewStatus, "pending");

    const restart = await createApp(config, { log: () => {} });
    t.after(() => restart.locals.application.persistence.close());
    assert.equal(readAdminPassword(dataDir), password);

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const stored = await pool.query(`SELECT token_hash FROM "${schema}".auth_sessions`);
      assert.ok(stored.rows.length >= 1);
      assert.match(stored.rows[0].token_hash, /^[a-f0-9]{64}$/);
      const admin = await pool.query(`SELECT login_name, is_system_admin FROM "${schema}".identities WHERE login_name = 'admin'`);
      assert.deepEqual(admin.rows, [{ login_name: "admin", is_system_admin: true }]);
    } finally {
      await pool.end();
    }
  });
}
