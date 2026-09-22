import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/auth.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser, insertIdentityWorkspace, inviteAndAcceptTeamMember, loginUser } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 成员改名：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("工作区所有者可改成员显示名称：登录名不变，权限与校验收紧", async (t) => {
    const schema = `nmtaskboard_rename_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-rename-pg-")),
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

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "rename-owner", displayName: "改名所有者" });
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "rename-team-request" },
      body: JSON.stringify({ name: "改名团队", identifier: "rename-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;

    const passwordHash = await hashPassword("correct-horse-battery");
    const seed = new Pool({ connectionString: databaseUrl });
    for (const person of [
      { id: "member-a", name: "原名成员甲", login: "member-a", email: "member-a@example.com", workspaceId: "personal-member-a" },
      { id: "member-b", name: "成员乙", login: "member-b", email: "member-b@example.com", workspaceId: "personal-member-b" }
    ]) {
      await insertIdentityWorkspace(seed, schema, person, passwordHash);
    }
    await seed.end();
    const memberACookie = await loginUser(baseUrl, "member-a");
    const memberBCookie = await loginUser(baseUrl, "member-b");
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, memberACookie, "member-a");
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, memberBCookie, "member-b");
    // 成员接受邀请后切换到团队空间，后续越权请求发生在团队上下文
    for (const cookie of [memberACookie, memberBCookie]) {
      assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
      })).status, 200);
    }

    // 所有者改名：成功且登录名/邮箱保持不变
    const renamed = await requestJson(`${baseUrl}/api/team/members/member-a/display-name`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ displayName: "新名成员甲" })
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.member.displayName, "新名成员甲");
    assert.equal(renamed.body.member.login, "member-a");
    assert.equal(renamed.body.member.email, "member-a@example.com");

    // 成员列表与被改者自身会话均使用新名
    const directory = (await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: ownerCookie } })).body;
    assert.equal(directory.members.find((member) => member.id === "member-a").displayName, "新名成员甲");
    const memberASession = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: memberACookie } });
    assert.equal(memberASession.body.actor.displayName, "新名成员甲");

    // 任务序列化的负责人名称使用新名
    const task = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "改名后分派", assigneeIdentityId: "member-a" })
    });
    assert.equal(task.status, 201);
    const tasks = (await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: ownerCookie } })).body;
    assert.equal(tasks.tasks.find((item) => item.id === task.body.task.id).assigneeDisplayName, "新名成员甲");

    // 审计：动作与字段名（不含新名称值）
    const events = directory.recentEvents.filter((event) => event.action === "workspace.member_rename");
    assert.equal(events.length >= 1, true);
    assert.equal(events.some((event) => (event.summary?.changedFields || []).includes("displayName")), true);

    // 普通成员与管理员都不能改名（仅所有者）
    const deniedMember = await requestJson(`${baseUrl}/api/team/members/member-b/display-name`, {
      method: "PATCH", headers: { cookie: memberACookie, "content-type": "application/json" }, body: JSON.stringify({ displayName: "越权改名" })
    });
    assert.equal(deniedMember.status, 403);
    const promoted = await requestJson(`${baseUrl}/api/team/members/member-a/role`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    });
    assert.equal(promoted.body.member.role, "admin");
    const deniedAdmin = await requestJson(`${baseUrl}/api/team/members/member-b/display-name`, {
      method: "PATCH", headers: { cookie: memberACookie, "content-type": "application/json" }, body: JSON.stringify({ displayName: "管理员改名" })
    });
    assert.equal(deniedAdmin.status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: ownerCookie } })).body.members.find((member) => member.id === "member-b").displayName, "成员乙");

    // 目标不在工作区、名称非法分别 404 / 400
    const unknown = await requestJson(`${baseUrl}/api/team/members/member-c/display-name`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ displayName: "不存在" })
    });
    assert.equal(unknown.status, 404);
    for (const displayName of ["", "  ", "a".repeat(41), "带\n换行"]) {
      const invalid = await requestJson(`${baseUrl}/api/team/members/member-b/display-name`, {
        method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ displayName })
      });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.code, "DISPLAY_NAME_INVALID");
    }

    // 数据库层：display_name 更新、login_name 不动
    const verify = new Pool({ connectionString: databaseUrl });
    const identity = await verify.query(`SELECT display_name, login_name FROM "${schema}".identities WHERE id = $1`, ["member-a"]);
    await verify.end();
    assert.equal(identity.rows[0].display_name, "新名成员甲");
    assert.equal(identity.rows[0].login_name, "member-a");
  });
}
