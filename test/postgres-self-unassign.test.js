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
  test("负责人自我移除契约：需要 TEST_DATABASE_URL", { skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("负责人可以自我移除：取消指派对所有成员对称，含自己", async (t) => {
    const schema = `nmtaskboard_self_unassign_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-self-unassign-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema });
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
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "self-unassign-team" },
      body: JSON.stringify({ name: "自我移除工作区", identifier: "self-unassign-team", timeZone: "Asia/Shanghai" })
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

    // 创建任务：负责人=成员甲，授予甲 assign 权限
    const created = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "自我移除测试任务", assigneeIdentityIds: [member.actor.id], memberGrants: { [member.actor.id]: { assign: true } } })
    });
    assert.equal(created.status, 201);
    const taskId = created.body.task.id;

    // 甲把自己移除（取消自己的指派）→ 200，集合为空
    const removeSelf = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIdentityIds: [] })
    });
    assert.equal(removeSelf.status, 200);
    assert.deepEqual(removeSelf.body.task.assigneeIdentityIds, []);

    // 甲把自己加回，再通过兼容指派接口把自己移除 → 200（两条路径同一规则）
    const readd = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIdentityIds: [member.actor.id] })
    });
    assert.equal(readd.status, 200);
    const legacyRemoveSelf = await requestJson(`${baseUrl}/api/tasks/${taskId}/assign`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ identityIds: [] })
    });
    assert.equal(legacyRemoveSelf.status, 200);
    assert.deepEqual(legacyRemoveSelf.body.task.assigneeIdentityIds, []);

    // 甲把自己加回并追加乙 → 200；移除乙（不含自己）→ 200
    const addOther = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIdentityIds: [member.actor.id, other.actor.id] })
    });
    assert.equal(addOther.status, 200);
    assert.deepEqual(addOther.body.task.assigneeIdentityIds.sort(), [member.actor.id, other.actor.id].sort());
    const removeOther = await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIdentityIds: [member.actor.id] })
    });
    assert.equal(removeOther.status, 200);
  });
}
