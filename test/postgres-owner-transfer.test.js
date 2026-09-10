import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser, inviteAndAcceptTeamMember } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
};

if (!databaseUrl) {
  test("卡片所有权转移：需要 TEST_DATABASE_URL", { skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("所有者可把卡片所有权转移给现任负责人，原创建者降级为普通成员", async (t) => {
    const schema = `nmtaskboard_owner_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-owner-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema });
    const app = await createApp(config, { log: () => {} });
    const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    });

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "所有者" });
    const memberCookie = await createAndLoginUser(app, baseUrl, { login: "member-a", displayName: "成员甲" });
    const otherCookie = await createAndLoginUser(app, baseUrl, { login: "member-b", displayName: "成员乙" });
    await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "owner-transfer-team" },
      body: JSON.stringify({ name: "所有权工作区", identifier: "owner-transfer-team", timeZone: "Asia/Shanghai" })
    });
    const member = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: memberCookie } })).body;
    const other = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: otherCookie } })).body;
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, memberCookie, member.actor.id);
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, otherCookie, other.actor.id);
    // 接受邀请不自动切换当前工作区；先让两个受邀账号进入测试空间。
    const workspaceId = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: ownerCookie } })).body.workspace.id;
    for (const cookie of [memberCookie, otherCookie]) {
      const switched = await requestJson(`${baseUrl}/api/workspaces/current`, {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId })
      });
      assert.equal(switched.status, 200);
    }


    const created = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "所有权转移测试", assigneeIdentityIds: [member.actor.id] })
    });
    assert.equal(created.status, 201);
    const taskId = created.body.task.id;
    // 创建者即默认所有者
    assert.equal(created.body.task.ownerIdentityId, created.body.task.creatorIdentityId);

    // 非所有者尝试转移 → 403
    const forbidden = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ ownerIdentityId: member.actor.id })
    });
    assert.equal(forbidden.status, 403);

    // 转移给非负责人 → 400
    const notAssignee = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ ownerIdentityId: other.actor.id })
    });
    assert.equal(notAssignee.status, 400);

    // 所有者转移给负责人甲 → 200，序列化回显新所有者
    const transferred = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ ownerIdentityId: member.actor.id })
    });
    assert.equal(transferred.status, 200);
    assert.equal(transferred.body.task.ownerIdentityId, member.actor.id);
    assert.equal(transferred.body.task.ownerDisplayName, "成员甲");
    // 创建者字段保留（审计溯源）
    assert.equal(transferred.body.task.creatorIdentityId, created.body.task.creatorIdentityId);

    const audit = await requestJson(`${baseUrl}/api/audit`, { headers: { cookie: ownerCookie } });
    assert.equal(audit.status, 200);
    const transfer = (audit.body.events || []).find((event) => event.target?.id === taskId && event.summary?.changedFields?.includes("ownerIdentityId"));
    assert.equal(transfer?.summary?.taskTitle, "所有权转移测试");

    // 新所有者获得全权（调整成员授予 → 200）
    const grantByNewOwner = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ memberGrants: { [other.actor.id]: { edit: true } } })
    });
    assert.equal(grantByNewOwner.status, 200);

    // 原创建者降级：调整授予 → 403；删除 → 403
    const grantByOldCreator = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ memberGrants: {} })
    });
    assert.equal(grantByOldCreator.status, 403);
    const deleteByOldCreator = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "DELETE", headers: { cookie: ownerCookie }
    });
    assert.equal(deleteByOldCreator.status, 403);
  });
}
