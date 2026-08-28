import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 报告版本：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("报告版本不可变、跨空间隔离", async (t) => {
    const schema = `nmtaskboard_rv_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-rv-pg-")),
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, BOOTSTRAP_TOKEN: "rv-bootstrap"
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
      method: "POST", headers: { "content-type": "application/json", "x-bootstrap-token": "rv-bootstrap" },
      body: JSON.stringify({ login: "owner", displayName: "所有者", password: "correct-horse-battery" })
    });
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "owner", password: "correct-horse-battery" })
    });
    const cookie = login.headers.get("set-cookie");

    const saved = await requestJson(`${baseUrl}/api/report/versions`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ reportType: "weekly", range: { start: "2026-08-24", end: "2026-08-28" }, draftText: "第一版内容", evidenceSummary: { schemaVersion: "report-evidence/v1", summary: {} }, source: "deterministic" })
    });
    assert.equal(saved.status, 201);
    const versionId = saved.body.version.id;

    const list = await requestJson(`${baseUrl}/api/report/versions`, { headers: { cookie } });
    assert.equal(list.body.versions.length, 1);
    assert.equal(list.body.versions[0].id, versionId);

    const read = await requestJson(`${baseUrl}/api/report/versions/${versionId}`, { headers: { cookie } });
    assert.equal(read.body.version.draftText, "第一版内容");
    assert.equal(read.body.version.evidenceSummary.schemaVersion, "report-evidence/v1");

    const restore = await requestJson(`${baseUrl}/api/report/versions/${versionId}/restore`, { method: "POST", headers: { cookie } });
    assert.equal(restore.body.version.draftText, "第一版内容");

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await assert.rejects(
        pool.query(`UPDATE "${schema}".report_versions SET draft_text = '篡改' WHERE id = $1`, [versionId]),
        /append-only/
      );
      await assert.rejects(
        pool.query(`DELETE FROM "${schema}".report_versions WHERE id = $1`, [versionId]),
        /append-only/
      );
      const stillThere = await pool.query(`SELECT draft_text FROM "${schema}".report_versions WHERE id = $1`, [versionId]);
      assert.equal(stillThere.rows[0].draft_text, "第一版内容");
    } finally {
      await pool.end();
    }

    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie, "content-type": "application/json", "idempotency-key": "rv-team-1" },
      body: JSON.stringify({ name: "版本团队", identifier: "rv-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;
    const teamList = await requestJson(`${baseUrl}/api/report/versions`, { headers: { cookie } });
    assert.equal(teamList.body.versions.length, 0);

    const crossRead = await requestJson(`${baseUrl}/api/report/versions/${versionId}`, { headers: { cookie } });
    assert.equal(crossRead.status, 404);

    await fetch(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ workspaceId: teamId })
    });
  });
}
