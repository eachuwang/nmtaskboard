import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createAndLoginUser, inviteAndAcceptTeamMember, readAdminPassword } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

if (!databaseUrl) {
  test("PostgreSQL 权限矩阵：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("owner/admin/member 都能日常协作，管理操作仍受角色约束且密钥不回传", async (t) => {
    const schema = `nmtaskboard_permissions_${process.pid}_${Date.now()}`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-permissions-pg-"));
    const config = loadConfig({
      PORT: "0", DATA_DIR: dataDir,
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema
    });
    const app = await createApp(config, {
      log: () => {},
      gitProviders: {
        async listGithubRepositories() {
          return [{ url: "https://github.com/acme/app", name: "app", defaultBranch: "main" }];
        }
      }
    });
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
    const memberCookie = await createAndLoginUser(app, baseUrl, { login: "member-a", displayName: "成员甲" });
    const adminCookieRaw = await createAndLoginUser(app, baseUrl, { login: "admin-b", displayName: "管理员乙" });
    const outsiderCookie = await createAndLoginUser(app, baseUrl, { login: "outsider", displayName: "团队外成员" });
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json", "idempotency-key": "permissions-team" },
      body: JSON.stringify({ name: "权限工作区", identifier: "permission-team", timeZone: "Asia/Shanghai" })
    });
    const teamId = team.body.workspace.id;
    const memberSession = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: memberCookie } });
    const adminSession = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: adminCookieRaw } });
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, memberCookie, memberSession.body.actor.id);
    await inviteAndAcceptTeamMember(baseUrl, ownerCookie, adminCookieRaw, adminSession.body.actor.id);
    await requestJson(`${baseUrl}/api/team/members/${adminSession.body.actor.id}/role`, {
      method: "PATCH", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    });
    for (const cookie of [memberCookie, adminCookieRaw]) {
      assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
      })).status, 200);
    }

    // 普通成员不能创建任务，只有 owner/admin 可以
    const createdByMember = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "成员创建的任务", status: "todo" })
    });
    assert.equal(createdByMember.status, 403);
    const other = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "他人任务", status: "todo" })
    });
    const visible = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.equal(visible.body.tasks.map((task) => task.title).sort().join(","), "他人任务");
    // 其他成员对非自己负责的任务只读（状态也不能改、不能评论）
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${other.body.task.id}`, {
      method: "PUT", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "done" })
    })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${other.body.task.id}/comments`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ text: "协作评论" })
    })).status, 403);

    // 非创建者（即使是管理员）不能指派他人任务
    const adminAssign = await requestJson(`${baseUrl}/api/tasks/${other.body.task.id}/assign`, {
      method: "POST", headers: { cookie: adminCookieRaw, "content-type": "application/json" },
      body: JSON.stringify({ identityId: adminSession.body.actor.id })
    });
    assert.equal(adminAssign.status, 403);
    // 创建者本人可以指派
    const selfAssign = await requestJson(`${baseUrl}/api/tasks/${other.body.task.id}/assign`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: adminSession.body.actor.id })
    });
    assert.equal(selfAssign.status, 200);
    assert.equal(selfAssign.body.task.assigneeIdentityId, adminSession.body.actor.id);

    // 负责人拖动自己的卡到其他状态列：只对真正跨列的任务鉴权 changeStatus，
    // 同列他人任务仅需可读（否则目标列只要有别人的卡就会被整体 403）
    const mine = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "成员负责的任务", status: "todo" })
    });
    await requestJson(`${baseUrl}/api/tasks/${mine.body.task.id}/assign`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: memberSession.body.actor.id })
    });
    const ownersInProgress = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "所有者在途任务", status: "in_progress" })
    });
    const dragOwn = await requestJson(`${baseUrl}/api/tasks/reorder`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ moves: [
        { status: "todo", orderedIds: [other.body.task.id] },
        { status: "in_progress", orderedIds: [ownersInProgress.body.task.id, mine.body.task.id] }
      ] })
    });
    assert.equal(dragOwn.status, 200);
    const memberTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.equal(memberTasks.body.tasks.find((task) => task.id === mine.body.task.id).status, "in_progress");
    // 负责人拖别人的卡跨列仍被拒绝
    const dragOthers = await requestJson(`${baseUrl}/api/tasks/reorder`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ moves: [{ status: "done", orderedIds: [ownersInProgress.body.task.id] }] })
    });
    assert.equal(dragOthers.status, 403);

    // 负责人与列联动：无负责人默认待整理；指派后进待办；取消指派回待整理
    const unassigned = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "未分派任务" })
    });
    assert.equal(unassigned.body.task.status, "backlog");
    const assigned = await requestJson(`${baseUrl}/api/tasks/${unassigned.body.task.id}/assign`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: memberSession.body.actor.id })
    });
    assert.equal(assigned.body.task.status, "todo");
    const unassign = await requestJson(`${baseUrl}/api/tasks/${unassigned.body.task.id}/assign`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: null })
    });
    assert.equal(unassign.body.task.status, "backlog");
    // 创建时直接带负责人 → 直接进待办
    const createdAssigned = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "创建即分派", assigneeIdentityId: memberSession.body.actor.id })
    });
    assert.equal(createdAssigned.body.task.status, "todo");

    const inviteDenied = await requestJson(`${baseUrl}/api/team/members/invite`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: outsiderCookie } })).body.actor.id })
    });
    assert.equal(inviteDenied.status, 403);

    const connection = await requestJson(`${baseUrl}/api/connections`, {
      method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github_app", installationId: "99", accountLogin: "acme" })
    });
    assert.equal(connection.status, 201);
    assert.equal(connection.body.connection.token, undefined);
    assert.equal(connection.body.connection.credentialEncrypted, undefined);
    assert.equal(JSON.stringify(connection.body).includes("secret"), false);
    assert.equal((await requestJson(`${baseUrl}/api/connections`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github_app", installationId: "100", accountLogin: "other" })
    })).status, 403);

    const outsiderSelect = await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: outsiderCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    });
    assert.equal(outsiderSelect.status, 404);

    const adminPassword = readAdminPassword(dataDir);
    const sysadminLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "admin", password: adminPassword })
    });
    const sysadminCookie = sysadminLogin.headers.get("set-cookie");
    const changed = await fetch(`${baseUrl}/api/auth/password`, {
      method: "POST", headers: { cookie: sysadminCookie, "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: adminPassword, newPassword: "new-horse-battery" })
    });
    assert.equal(changed.status, 200);
    const sysadminSelect = await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: sysadminCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    });
    assert.equal(sysadminSelect.status, 403);

    assert.equal((await requestJson(`${baseUrl}/api/team/members/${memberSession.body.actor.id}`, {
      method: "DELETE", headers: { cookie: adminCookieRaw, "content-type": "application/json" }, body: JSON.stringify({ handling: "unassign" })
    })).status, 200);
    assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: memberCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
    })).status, 404);
    const removedTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: memberCookie } });
    assert.equal(removedTasks.body.tasks.some((task) => task.title === "他人任务"), false);
  });

  test("负责人只能改状态与评论，创建子任务和指派仅任务创建者", async (t) => {
    const schema = `nmtaskboard_taskperm_${process.pid}_${Date.now()}`;
    const config = loadConfig({ PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-taskperm-pg-")), DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema });
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

    const creatorCookie = await createAndLoginUser(app, baseUrl, { login: "creator", displayName: "创建者" });
    const assigneeCookie = await createAndLoginUser(app, baseUrl, { login: "assignee", displayName: "负责人" });
    const assignee = (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: assigneeCookie } })).body;
    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: creatorCookie, "content-type": "application/json", "idempotency-key": "taskperm-team" },
      body: JSON.stringify({ name: "任务权限区", identifier: "taskperm-team", timeZone: "Asia/Shanghai" })
    });
    await inviteAndAcceptTeamMember(baseUrl, creatorCookie, assigneeCookie, assignee.actor.id);
    await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "POST", headers: { cookie: assigneeCookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: team.body.workspace.id })
    });

    const created = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: creatorCookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "权限边界任务", status: "todo" })
    });
    assert.equal(created.status, 201);
    const taskId = created.body.task.id;

    // 创建者指派给负责人
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${taskId}/assign`, {
      method: "POST", headers: { cookie: creatorCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: assignee.actor.id })
    })).status, 200);

    // 负责人：可以改状态、可以评论
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: assigneeCookie, "content-type": "application/json" }, body: JSON.stringify({ status: "in_progress" })
    })).status, 200);
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${taskId}/comments`, {
      method: "POST", headers: { cookie: assigneeCookie, "content-type": "application/json" }, body: JSON.stringify({ text: "负责人进展" })
    })).status, 201);
    // 负责人：不能改内容、不能删除、不能指派、不能建子任务
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "PUT", headers: { cookie: assigneeCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "篡改标题" })
    })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${taskId}`, {
      method: "DELETE", headers: { cookie: assigneeCookie }
    })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/tasks/${taskId}/assign`, {
      method: "POST", headers: { cookie: assigneeCookie, "content-type": "application/json" }, body: JSON.stringify({ identityId: assignee.actor.id })
    })).status, 403);
    assert.equal((await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: assigneeCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "越权子任务", parentTaskId: taskId })
    })).status, 403);

    // 创建者：可以建子任务
    const subtask = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: creatorCookie, "content-type": "application/json" }, body: JSON.stringify({ title: "合法子任务", parentTaskId: taskId })
    });
    assert.equal(subtask.status, 201);
    assert.equal(subtask.body.task.parentTaskId, taskId);
  });
}
