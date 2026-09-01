import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser, readAdminPassword } from "./helpers.js";
import { createLlmStub } from "./llm-stub.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 实例 LLM：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("仅系统管理员可配置实例 LLM，任务解析走 instance_settings", async (t) => {
    const schema = `nmtaskboard_instance_llm_${process.pid}_${Date.now()}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-instance-llm-"));
    const config = loadConfig({
      PORT: "0", DATA_DIR: dataDir, DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema
    });
    const llm = await createLlmStub({
      handler: () => ({ status: 200, body: { choices: [{ message: { content: JSON.stringify({ tasks: [{ title: "实例配置任务", priority: "medium", tags: [], dueDate: null, suggestedStatus: "planned" }] }) } }] } })
    });
    const app = await createApp(config, { log: () => {} });
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      await llm.close();
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    const password = readAdminPassword(dataDir);
    const adminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "admin", password })
    });
    const adminCookie = adminLogin.headers.get("set-cookie");
    assert.equal((await requestJson(`${baseUrl}/api/auth/password`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: password, newPassword: "new-horse-battery" })
    })).status, 200);
    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "所有者" });

    assert.equal((await requestJson(`${baseUrl}/api/admin/llm`, { headers: { cookie: ownerCookie } })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/admin/llm`, {
      method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [{ id: "stolen", name: "Stolen", baseUrl: llm.baseUrl, apiKey: "x", models: [{ id: "m" }] }],
        defaultProviderId: "stolen"
      })
    })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/llm/test`, {
      method: "POST", headers: { cookie: ownerCookie }
    })).status, 403);

    assert.equal((await requestJson(`${baseUrl}/api/settings`, {
      method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [{ id: "ws", name: "空间", baseUrl: llm.baseUrl, apiKey: "workspace-key", models: [{ id: "ws-model" }] }],
        defaultProviderId: "ws"
      })
    })).status, 200);
    const ownerSettings = await requestJson(`${baseUrl}/api/settings`, { headers: { cookie: ownerCookie } });
    assert.deepEqual(ownerSettings.body.providers, []);
    const statusBefore = await requestJson(`${baseUrl}/api/llm/status`, { headers: { cookie: ownerCookie } });
    assert.equal(statusBefore.body.configured, false);

    const saved = await requestJson(`${baseUrl}/api/admin/llm`, {
      method: "PUT", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({
        providers: [{
          id: "stub", name: "Stub", baseUrl: llm.baseUrl, protocol: "openai-chat-completions",
          apiKey: "instance-key", defaultModelId: "stub", models: [{ id: "stub" }]
        }],
        defaultProviderId: "stub",
        temperature: 0.2
      })
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.providers[0].hasKey, true);
    assert.equal("apiKey" in saved.body.providers[0], false);

    const statusAfter = await requestJson(`${baseUrl}/api/llm/status`, { headers: { cookie: ownerCookie } });
    assert.equal(statusAfter.body.configured, true);
    const ownerSettingsAfter = await requestJson(`${baseUrl}/api/settings`, { headers: { cookie: ownerCookie } });
    assert.deepEqual(ownerSettingsAfter.body.providers, []);

    const parsed = await requestJson(`${baseUrl}/api/ai/parse`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ text: "创建一个实例配置任务" })
    });
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.tasks[0].title, "实例配置任务");
    assert.equal((await requestJson(`${baseUrl}/api/llm/test`, {
      method: "POST", headers: { cookie: adminCookie }
    })).status, 200);
    const models = await requestJson(`${baseUrl}/api/llm/models?providerId=stub`, { headers: { cookie: adminCookie } });
    assert.equal(models.status, 200);
    assert.ok(models.body.models.includes("model-a"));
  });
}
