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
  test("PostgreSQL 阶段就绪通知：需要 TEST_DATABASE_URL", { skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("阶段最后一个未关闭任务完成时，下一阶段任务的负责人收到就绪通知", async (t) => {
    const schema = `nmtaskboard_stage_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-stage-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema });
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

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner-stage", displayName: "所有者" });
    const memberCookie = await createAndLoginUser(app, baseUrl, { login: "member-stage", displayName: "成员甲" });
    await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "stage-team" },
      body: JSON.stringify({ name: "阶段工作区", identifier: "stage-team", timeZone: "Asia/Shanghai" })
    });
    const memberSession = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: memberCookie } })).body;
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, memberCookie, memberSession.actor.id);

    const jsonHeaders = (cookie) => ({ cookie, "content-type": "application/json" });
    const stageOne = await requestJson(`${baseUrl}/api/tasks`, { method: "POST", headers: jsonHeaders(ownerCookie), body: JSON.stringify({ title: "阶段一任务", stage: 1 }) });
    assert.equal(stageOne.status, 201);
    const stageTwo = await requestJson(`${baseUrl}/api/tasks`, { method: "POST", headers: jsonHeaders(ownerCookie), body: JSON.stringify({ title: "阶段二任务", stage: 2, assigneeIdentityId: memberSession.actor.id }) });
    assert.equal(stageTwo.status, 201);

    // 完成阶段一最后一个任务 → 阶段二就绪
    const done = await requestJson(`${baseUrl}/api/tasks/${stageOne.body.task.id}`, { method: "PUT", headers: jsonHeaders(ownerCookie), body: JSON.stringify({ status: "done" }) });
    assert.equal(done.status, 200);

    const notifications = await requestJson(`${baseUrl}/api/notifications`, { headers: { cookie: memberCookie } });
    const ready = (notifications.body.notifications || []).find((item) => item.category === "stage" && item.entityId === stageTwo.body.task.id);
    assert.ok(ready, "成员应收到阶段就绪通知");
    assert.match(ready.payload?.body || "", /已就绪/);
    // 通知不改变任务状态（成员先切换到团队工作区再读）
    const memberships = await requestJson(`${baseUrl}/api/workspaces`, { headers: { cookie: memberCookie } });
    const teamId = ready.workspaceId;
    await requestJson(`${baseUrl}/api/workspaces/current`, { method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId }) });
    const after = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    const taskB = (after.body.tasks || []).find((task) => task.id === stageTwo.body.task.id);
    // 创建时带负责人 → 按「负责人-列联动」规则落在 todo；通知不改变任务状态
    assert.equal(taskB?.status, "todo");
  });
}
