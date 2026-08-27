import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  test("PostgreSQL 认证：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("PostgreSQL 保证初始管理员唯一并用服务端会话解析请求身份", async (t) => {
    const schema = `nmtaskboard_auth_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0",
      DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-auth-pg-")),
      DATABASE_URL: databaseUrl,
      DATABASE_SCHEMA: schema,
      BOOTSTRAP_TOKEN: "postgres-bootstrap-secret"
    });
    const app = await createApp(config);
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

    const bootstrap = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bootstrap-token": "postgres-bootstrap-secret" },
      body: JSON.stringify({ login: "admin", displayName: "数据库管理员", password: "correct-horse-battery" })
    });
    assert.equal(bootstrap.status, 201);

    const duplicate = await fetch(`${baseUrl}/api/auth/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bootstrap-token": "postgres-bootstrap-secret" },
      body: JSON.stringify({ login: "admin2", displayName: "另一管理员", password: "correct-horse-battery" })
    });
    assert.equal(duplicate.status, 409);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "admin", password: "correct-horse-battery" })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    const created = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "数据库会话任务", actor: "伪造用户" })
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).task.creator, "数据库管理员");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const stored = await pool.query(`SELECT token_hash FROM "${schema}".auth_sessions`);
      assert.equal(stored.rows.length, 1);
      assert.match(stored.rows[0].token_hash, /^[a-f0-9]{64}$/);
      assert.equal(stored.rows[0].token_hash.includes(cookie.split("=")[1].split(";")[0]), false);
    } finally {
      await pool.end();
    }
  });
}
