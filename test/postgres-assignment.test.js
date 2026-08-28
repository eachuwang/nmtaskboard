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
  return { status: response.status, body: await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 父任务分派：需要 TEST_DATABASE_URL", { skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("管理员事务分派为成员创建唯一、独立且可追溯的执行任务", async (t) => {
    const schema = `nmtaskboard_assignment_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-assignment-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, BOOTSTRAP_TOKEN: "assignment-bootstrap" });
    const app = await createApp(config);
    const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    });

    await fetch(`${baseUrl}/api/auth/bootstrap`, { method: "POST", headers: { "content-type": "application/json", "x-bootstrap-token": "assignment-bootstrap" }, body: JSON.stringify({ login: "owner", displayName: "所有者", password: "correct-horse-battery" }) });
    const login = async (loginName) => (await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: loginName, password: "correct-horse-battery" }) })).headers.get("set-cookie");
    const ownerCookie = await login("owner");
    const team = await requestJson(`${baseUrl}/api/workspaces`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "assignment-team" }, body: JSON.stringify({ name: "分派团队", identifier: "assignment-team", timeZone: "Asia/Shanghai" }) });
    const teamId = team.body.workspace.id;
    const passwordHash = await hashPassword("correct-horse-battery");
    const pool = new Pool({ connectionString: databaseUrl });
    for (const person of [{ id: "member-a", name: "成员甲" }, { id: "member-b", name: "成员乙" }, { id: "admin-b", name: "管理员乙" }, { id: "outsider", name: "外部成员" }]) {
      await pool.query(`INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash) VALUES ($1,$2,$1,$3,$4)`, [person.id, person.name, `${person.id}@example.com`, passwordHash]);
      await pool.query(`INSERT INTO "${schema}".workspaces (id,type,name,created_by_identity_id) VALUES ($1,'personal',$2,$3)`, [`personal-${person.id}`, `${person.name}个人空间`, person.id]);
      await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id,identity_id,role) VALUES ($1,$2,'owner')`, [`personal-${person.id}`, person.id]);
    }
    await pool.end();
    for (const id of ["member-a", "member-b", "admin-b"]) await requestJson(`${baseUrl}/api/team/members/invite`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identifier: id }) });
    await requestJson(`${baseUrl}/api/team/members/admin-b/role`, { method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" }) });
    const adminCookie = await login("admin-b");
    await requestJson(`${baseUrl}/api/workspaces/current`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId }) });

    const parent = await requestJson(`${baseUrl}/api/tasks`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "交付父任务", description: "按说明交付", dueDate: "2026-09-04", status: "todo" }) });
    const invalid = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ identityIds: ["outsider"] }) });
    assert.equal(invalid.status, 400);
    const assigned = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json", "x-action-source": "agent" }, body: JSON.stringify({ identityIds: ["member-a"] }) });
    assert.equal(assigned.status, 201);
    assert.equal(assigned.body.createdCount, 1);
    assert.deepEqual(assigned.body.parent.participants.map(({ identityId, status }) => ({ identityId, status })), [{ identityId: "member-a", status: "todo" }]);
    assert.equal(assigned.body.executions[0].dueDate, "2026-09-04");
    assert.equal(assigned.body.executions[0].history[0].action, "created");
    const repeated = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ identityIds: ["member-a"] }) });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.createdCount, 0);
    assert.equal(repeated.body.executions[0].id, assigned.body.executions[0].id);

    const memberCookie = await login("member-a");
    await requestJson(`${baseUrl}/api/workspaces/current`, { method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId }) });
    const memberTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.deepEqual(memberTasks.body.tasks.map(({ id }) => id), [assigned.body.executions[0].id]);
    assert.equal(memberTasks.body.tasks[0].permission.access, "own");

    const assignedBoth = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: JSON.stringify({ identityIds: ["member-a", "member-b"] })
    });
    assert.equal(assignedBoth.status, 201);
    assert.equal(assignedBoth.body.createdCount, 1);
    await requestJson(`${baseUrl}/api/team/members/member-a/permissions`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ visibilityScope: "team", operationScope: "assigned" })
    });
    const teamTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    const memberBExecution = assignedBoth.body.executions.find(({ assigneeIdentityId }) => assigneeIdentityId === "member-b");
    assert.ok(memberBExecution);
    assert.deepEqual(teamTasks.body.tasks.map(({ id }) => id), [parent.body.task.id, assigned.body.executions[0].id, memberBExecution.id]);
    const parentProjection = teamTasks.body.tasks[0];
    const ownProjection = teamTasks.body.tasks[1];
    const peerProjection = teamTasks.body.tasks[2];
    assert.equal(parentProjection.memberRelation, "participant");
    assert.equal(ownProjection.memberRelation, "responsible");
    assert.equal(peerProjection.memberRelation, "readonly");
    assert.equal(peerProjection.permission.changeStatus, false);
    assert.deepEqual(ownProjection.participantSummary.map(({ displayName, status, isViewer }) => ({ displayName, status, isViewer })), [
      { displayName: "成员甲", status: "todo", isViewer: true },
      { displayName: "成员乙", status: "todo", isViewer: false }
    ]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const verify = new Pool({ connectionString: databaseUrl });
    const counts = await verify.query(`SELECT (SELECT count(*) FROM "${schema}".tasks WHERE payload->>'taskType'='execution')::int AS executions, (SELECT count(*) FROM "${schema}".task_progress)::int AS progress`);
    const audits = await verify.query(`SELECT source, action, outcome FROM "${schema}".audit_events WHERE action = 'task.assign' ORDER BY occurred_at`);
    await verify.end();
    assert.deepEqual(counts.rows[0], { executions: 2, progress: 2 });
    assert.equal(audits.rows.some((event) => event.source === "agent" && event.outcome === "success"), true);
    assert.equal(audits.rows.some((event) => event.outcome === "denied"), true);
  });
}
