import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { hashPassword } from "../lib/auth.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser, inviteAndAcceptTeamMember, loginUser } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 团队成员管理：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("成员邀请、角色、所有权转移、任务处置与即时撤权形成完整生命周期", async (t) => {
    const schema = `nmtaskboard_members_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-members-pg-")),
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

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "原所有者" });
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "members-team-request" },
      body: JSON.stringify({ name: "交付团队", identifier: "delivery-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;

    const passwordHash = await hashPassword("correct-horse-battery");
    const pool = new Pool({ connectionString: databaseUrl });
    for (const person of [
      { id: "member-a", name: "成员甲", login: "member-a", email: "member-a@example.com" },
      { id: "member-b", name: "成员乙", login: "member-b", email: "member-b@example.com" }
    ]) {
      await pool.query(`INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash) VALUES ($1, $2, $3, $4, $5)`, [person.id, person.name, person.login, person.email, passwordHash]);
      await pool.query(`INSERT INTO "${schema}".workspaces (id, type, name, created_by_identity_id) VALUES ($1, 'personal', $2, $3)`, [`personal-${person.id}`, `${person.name}的个人空间`, person.id]);
      await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id, identity_id, role) VALUES ($1, $2, 'owner')`, [`personal-${person.id}`, person.id]);
    }
    await pool.end();

    const memberCookie = await loginUser(baseUrl, "member-a");
    const memberBCookie = await loginUser(baseUrl, "member-b");
    const inviteA = await requestJson(`${baseUrl}/api/team/members/invite`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: "member-a" })
    });
    assert.equal(inviteA.status, 201);
    const pending = (await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: ownerCookie } })).body;
    assert.equal(pending.members.length, 1);
    assert.equal(pending.invitations.length, 1);
    assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    })).status, 404);
    assert.equal((await requestJson(`${baseUrl}/api/invitations/${inviteA.body.invitation.id}/accept`, {
      method: "POST", headers: { cookie: memberCookie }
    })).status, 200);
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, memberBCookie, "member-b");
    const management = (await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: ownerCookie } })).body;
    assert.equal(management.members.length, 3);
    assert.equal(management.members.every((member) => member.taskOverview && Object.hasOwn(member.taskOverview, "inProgress")), true);
    assert.equal(management.members.find((member) => member.role === "owner").lastActiveAt !== null, true);
    assert.equal(management.recentEvents.some((event) => event.action === "workspace.member_invite"), true);

    await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    });
    const denied = await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: memberCookie } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, "TEAM_MANAGEMENT_FORBIDDEN");

    const promoted = await requestJson(`${baseUrl}/api/team/members/member-a/role`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    });
    assert.equal(promoted.body.member.role, "admin");
    const adminDenied = await requestJson(`${baseUrl}/api/team/members/member-b/role`, {
      method: "PATCH", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    });
    assert.equal(adminDenied.status, 403);
    assert.equal(adminDenied.body.code, "TEAM_MANAGEMENT_FORBIDDEN");
    assert.equal((await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: memberCookie } })).status, 200);

    assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberBCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    })).status, 200);

    const task = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "待交接执行任务" })
    });
    const progressPool = new Pool({ connectionString: databaseUrl });
    await progressPool.query(`
      INSERT INTO "${schema}".task_progress (workspace_id, task_id, participant_key, participant_identity_id, participant_label, status, payload)
      VALUES ($1, $2, 'member-b', 'member-b', '成员乙', 'in_progress', '{}')
    `, [teamId, task.body.task.id]);
    await progressPool.end();
    const impact = await requestJson(`${baseUrl}/api/team/members/member-b/removal-impact`, { headers: { cookie: ownerCookie } });
    assert.deepEqual(impact.body.unfinishedTasks.map(({ title }) => title), ["待交接执行任务"]);
    const missingHandling = await requestJson(`${baseUrl}/api/team/members/member-b`, {
      method: "DELETE", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: "{}"
    });
    assert.equal(missingHandling.body.code, "MEMBER_TASK_HANDLING_REQUIRED");
    const removed = await requestJson(`${baseUrl}/api/team/members/member-b`, {
      method: "DELETE", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ handling: "unassign" })
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.handling, "unassign");
    const revokedSession = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: memberBCookie } });
    assert.equal(revokedSession.body.workspace.id, "personal-member-b");

    const wrongConfirmation = await requestJson(`${baseUrl}/api/team/ownership/transfer`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: "member-a", confirmName: "错误名称" })
    });
    assert.equal(wrongConfirmation.body.code, "OWNERSHIP_CONFIRMATION_REQUIRED");
    const transferred = await requestJson(`${baseUrl}/api/team/ownership/transfer`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: "member-a", confirmName: "交付团队" })
    });
    assert.equal(transferred.status, 200);
    assert.equal(transferred.body.ownerId, "member-a");
    const formerOwnerDenied = await requestJson(`${baseUrl}/api/team/members/member-a/role`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "member" })
    });
    assert.equal(formerOwnerDenied.status, 403);

    const verify = new Pool({ connectionString: databaseUrl });
    const owners = await verify.query(`SELECT identity_id FROM "${schema}".workspace_members WHERE workspace_id = $1 AND role = 'owner' AND removed_at IS NULL`, [teamId]);
    const progress = await verify.query(`SELECT participant_identity_id, status FROM "${schema}".task_progress WHERE workspace_id = $1 AND task_id = $2`, [teamId, task.body.task.id]);
    const audit = await verify.query(`SELECT action FROM "${schema}".audit_events WHERE workspace_id = $1 AND action LIKE 'workspace.%'`, [teamId]);
    await verify.end();
    assert.deepEqual(owners.rows.map(({ identity_id }) => identity_id), ["member-a"]);
    assert.deepEqual(progress.rows[0], { participant_identity_id: null, status: "in_progress" });
    const auditActions = new Set(audit.rows.map(({ action }) => action));
    assert.equal(["workspace.member_invite", "workspace.member_role_update", "workspace.member_remove", "workspace.ownership_transfer"].every((action) => auditActions.has(action)), true);

    const forbiddenSelect = await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberBCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    });
    assert.equal(forbiddenSelect.status, 404);
  });

  test("邀请候选排除超管与未审核用户，拒绝或撤回后不会入团", async (t) => {
    const schema = `nmtaskboard_invites_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-invites-pg-")),
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

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner", displayName: "所有者" });
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "invite-filter-team" },
      body: JSON.stringify({ name: "邀请团队", identifier: "invite-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;
    const passwordHash = await hashPassword("correct-horse-battery");
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash, review_status) VALUES ($1,$2,$1,$3,$4,'approved')`, ["candidate-a", "可邀请甲", "a@example.com", passwordHash]);
    await pool.query(`INSERT INTO "${schema}".workspaces (id,type,name,created_by_identity_id) VALUES ($1,'personal',$2,$3)`, ["personal-candidate-a", "甲个人空间", "candidate-a"]);
    await pool.query(`INSERT INTO "${schema}".workspace_members (workspace_id,identity_id,role) VALUES ($1,$2,'owner')`, ["personal-candidate-a", "candidate-a"]);
    await pool.query(`INSERT INTO "${schema}".identities (id, display_name, login_name, email, password_hash, review_status) VALUES ($1,$2,$1,$3,$4,'pending')`, ["pending-user", "待审核乙", "b@example.com", passwordHash]);
    await pool.end();

    const emptyAdmin = await requestJson(`${baseUrl}/api/team/invitation-candidates?q=admin`, { headers: { cookie: ownerCookie } });
    assert.equal(emptyAdmin.status, 200);
    assert.deepEqual(emptyAdmin.body.candidates, []);
    const emptyPending = await requestJson(`${baseUrl}/api/team/invitation-candidates?q=${encodeURIComponent("待审核乙")}`, { headers: { cookie: ownerCookie } });
    assert.deepEqual(emptyPending.body.candidates, []);
    const found = await requestJson(`${baseUrl}/api/team/invitation-candidates?q=${encodeURIComponent("可邀请甲")}`, { headers: { cookie: ownerCookie } });
    assert.deepEqual(found.body.candidates.map(({ id }) => id), ["candidate-a"]);

    const invited = await requestJson(`${baseUrl}/api/team/members/invite`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: "candidate-a" })
    });
    assert.equal(invited.status, 201);
    const duplicate = await requestJson(`${baseUrl}/api/team/members/invite`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: "candidate-a" })
    });
    assert.equal(duplicate.status, 409);
    const afterInvite = await requestJson(`${baseUrl}/api/team/invitation-candidates?q=${encodeURIComponent("可邀请甲")}`, { headers: { cookie: ownerCookie } });
    assert.deepEqual(afterInvite.body.candidates, []);

    const inviteeCookie = await loginUser(baseUrl, "candidate-a");
    const incoming = await requestJson(`${baseUrl}/api/invitations`, { headers: { cookie: inviteeCookie } });
    assert.equal(incoming.body.invitations.length, 1);
    assert.equal((await requestJson(`${baseUrl}/api/invitations/${invited.body.invitation.id}/reject`, {
      method: "POST", headers: { cookie: inviteeCookie }
    })).status, 200);
    assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: inviteeCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    })).status, 404);

    const reinvited = await requestJson(`${baseUrl}/api/team/members/invite`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: "candidate-a" })
    });
    assert.equal(reinvited.status, 201);
    assert.equal((await requestJson(`${baseUrl}/api/team/invitations/${reinvited.body.invitation.id}`, {
      method: "DELETE", headers: { cookie: ownerCookie }
    })).status, 200);
    const restored = await requestJson(`${baseUrl}/api/team/invitation-candidates?q=${encodeURIComponent("可邀请甲")}`, { headers: { cookie: ownerCookie } });
    assert.deepEqual(restored.body.candidates.map(({ id }) => id), ["candidate-a"]);
  });
}
