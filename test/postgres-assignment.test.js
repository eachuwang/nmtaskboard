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
  test("PostgreSQL 任务分派：需要 TEST_DATABASE_URL", { skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("任务只有一个负责人，管理员可以分派给自己，且不会生成执行副本", async (t) => {
    const schema = `nmtaskboard_assignment_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-assignment-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema });
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
    const adminCookie = await createAndLoginUser(app, baseUrl, { login: "admin-b", displayName: "管理员乙" });
    const outsiderCookie = await createAndLoginUser(app, baseUrl, { login: "outsider", displayName: "外部成员" });
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "assignment-team" },
      body: JSON.stringify({ name: "分派工作区", identifier: "assignment-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;
    const member = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: memberCookie } })).body;
    const admin = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: adminCookie } })).body;
    const outsider = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: outsiderCookie } })).body;
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, memberCookie, member.actor.id);
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, adminCookie, admin.actor.id);
    await requestJson(`${baseUrl}/api/team/members/${admin.actor.id}/role`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    });
    for (const cookie of [memberCookie, adminCookie]) {
      await requestJson(`${baseUrl}/api/workspaces/current`, {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
      });
    }

    const task = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "交付任务", status: "todo" })
    });
    assert.equal(task.status, 201);
    const invalid = await requestJson(`${baseUrl}/api/tasks/${task.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: outsider.actor.id })
    });
    assert.equal(invalid.status, 400);

    const assigned = await requestJson(`${baseUrl}/api/tasks/${task.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityIds: [member.actor.id, admin.actor.id] })
    });
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.task.assigneeIdentityId, member.actor.id);
    assert.equal(assigned.body.createdCount, undefined);

    // 非创建者（即使是被指派人）不能指派
    const repeated = await requestJson(`${baseUrl}/api/tasks/${task.body.task.id}/assign`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: member.actor.id })
    });
    assert.equal(repeated.status, 403);
    // 非创建者通过 PUT 改派他人被拒绝（PUT 负责人不变的不视为指派，不受限）
    const putAssign = await requestJson(`${baseUrl}/api/tasks/${task.body.task.id}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ assigneeIdentityId: admin.actor.id })
    });
    assert.equal(putAssign.status, 403);

    const listed = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.equal(listed.body.tasks.length, 1);
    assert.equal(listed.body.tasks[0].id, task.body.task.id);

    const self = await requestJson(`${baseUrl}/api/tasks/${task.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: admin.actor.id })
    });
    assert.equal(self.status, 200);
    assert.equal(self.body.task.assigneeIdentityId, admin.actor.id);

    const verify = new Pool({ connectionString: databaseUrl });
    const counts = await verify.query(`SELECT count(*)::int AS count FROM "${schema}".tasks WHERE payload->>'taskType' = 'execution'`);
    await verify.end();
    assert.equal(counts.rows[0].count, 0);
  });

  test("任务编号缺号/乱序时新建不撞唯一约束", async (t) => {
    const schema = `nmtaskboard_tasknum_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-tasknum-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema });
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

    const cookie = await createAndLoginUser(app, baseUrl, { login: "num-user", displayName: "编号用户" });
    const first = await requestJson(`${baseUrl}/api/tasks`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ title: "第一卡" }) });
    assert.equal(first.status, 201);

    // 人为制造缺号状态：把已有任务编号改成 2（等价于历史遗留/删除造成的空洞）
    const fix = new Pool({ connectionString: databaseUrl });
    await fix.query(`UPDATE "${schema}".tasks SET task_number = 2, payload = jsonb_set(payload, '{taskNumber}', '2')`);
    await fix.end();

    // 再建两张，不应撞唯一约束
    for (const title of ["第二卡", "第三卡"]) {
      const created = await requestJson(`${baseUrl}/api/tasks`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ title }) });
      assert.equal(created.status, 201, `${title} 创建失败`);
    }
    const verify = new Pool({ connectionString: databaseUrl });
    const numbers = await verify.query(`SELECT task_number FROM "${schema}".tasks WHERE task_number IS NOT NULL ORDER BY task_number`);
    await verify.end();
    const values = numbers.rows.map((row) => Number(row.task_number));
    assert.equal(new Set(values).size, values.length, "编号不能重复");
    assert.ok(values.length >= 3);
  });
}
