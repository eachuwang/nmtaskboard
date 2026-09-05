import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createMemoryObjectStore } from "../lib/storage.js";
import { createAndLoginUser, inviteAndAcceptTeamMember } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};

async function sessionOf(baseUrl, cookie) {
  return (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie } })).body;
}

async function collectSse(url, cookie, until, timeoutMs = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const events = [];
  try {
    const response = await fetch(url, { headers: { cookie }, signal: ac.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop();
      for (const block of blocks) {
        const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
        const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (event && data) {
          events.push({ event, data: JSON.parse(data) });
          if (until(events)) {
            ac.abort();
            return events;
          }
        }
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  } finally {
    clearTimeout(timer);
  }
  return events;
}

if (!databaseUrl) {
  test("PostgreSQL 协作全旅程：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("统一工作区完成邀请实时、全员协作、任务树、项目绑定、收件箱与解散", async (t) => {
    const schema = `nmtaskboard_journey_${process.pid}_${Date.now()}`;
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-journey-")),
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema
    });
    const app = await createApp(config, {
      log: () => {},
      objectStore: createMemoryObjectStore(),
      gitProviders: {
        async listGithubRepositories() {
          return [{ url: "https://github.com/acme/app", name: "app", defaultBranch: "main" }];
        },
        async testGitlab() { return { ok: true }; },
        async testGit() { return { ok: true }; }
      }
    });
    const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner@example.com", displayName: "企业所有者" });
    const memberACookie = await createAndLoginUser(app, baseUrl, { login: "member-a@example.com", displayName: "成员甲" });
    const memberBCookie = await createAndLoginUser(app, baseUrl, { login: "member-b@example.com", displayName: "成员乙" });
    const owner = { cookie: ownerCookie, session: await sessionOf(baseUrl, ownerCookie) };
    const memberA = { cookie: memberACookie, session: await sessionOf(baseUrl, memberACookie) };
    const memberB = { cookie: memberBCookie, session: await sessionOf(baseUrl, memberBCookie) };
    assert.equal(owner.session.actor.isSystemAdmin, false);
    assert.equal(owner.session.workspace.type, "workspace");

    const created = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json", "idempotency-key": "journey-team-create" },
      body: JSON.stringify({ name: "上线协作工作区", identifier: "journey-team", timeZone: "Asia/Shanghai" })
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.workspace.type, "workspace");
    const workspaceId = created.body.workspace.id;

    const inviteStream = collectSse(`${baseUrl}/api/notifications/stream`, memberA.cookie, (events) => events.some((item) => item.event === "invitation.created"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    await inviteAndAcceptTeamMember(baseUrl, owner.cookie, memberA.cookie, memberA.session.actor.id);
    const streamed = await inviteStream;
    assert.equal(streamed.some((item) => item.event === "invitation.created"), true);
    await inviteAndAcceptTeamMember(baseUrl, owner.cookie, memberB.cookie, memberB.session.actor.id);
    for (const identity of [memberA, memberB]) {
      assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
        method: "POST", headers: { cookie: identity.cookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId })
      })).status, 200);
    }

    const directory = await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: memberA.cookie } });
    assert.equal(directory.status, 200);
    assert.equal(directory.body.members.length, 3);
    assert.deepEqual(directory.body.invitations, []);

    const promoted = await requestJson(`${baseUrl}/api/team/members/${memberB.session.actor.id}/role`, {
      method: "PATCH", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.member.role, "admin");
    // 仅 owner/admin 可创建任务：memberA 先提升为管理员再建任务
    assert.equal((await requestJson(`${baseUrl}/api/team/members/${memberA.session.actor.id}/role`, {
      method: "PATCH", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    })).status, 200);

    const parent = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "协作上线", description: "完成企业协作验收", status: "todo" })
    });
    assert.equal(parent.status, 201);
    const child = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "联调接口", parentTaskId: parent.body.task.id, projectId: null })
    });
    assert.equal(child.status, 201);
    const grandchild = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "联调子步骤", parentTaskId: child.body.task.id })
    });
    assert.equal(grandchild.status, 201);
    const cycle = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}`, {
      method: "PUT", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ parentTaskId: grandchild.body.task.id })
    });
    assert.equal(cycle.status, 400);

    // 只有任务创建者（memberA）可以指派
    const ownerAssign = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: memberB.session.actor.id })
    });
    assert.equal(ownerAssign.status, 403);

    const assignedToB = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: memberB.session.actor.id })
    });
    assert.equal(assignedToB.status, 200);
    const inbox = await requestJson(`${baseUrl}/api/notifications`, { headers: { cookie: memberB.cookie } });
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.notifications.some((item) => item.category === "assignment"), true);

    // 非创建者自领被拒；创建者改派给 memberB 成功
    const selfAssign = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: memberB.cookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: memberB.session.actor.id })
    });
    assert.equal(selfAssign.status, 403);
    const reassign = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/assign`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ identityId: memberB.session.actor.id })
    });
    assert.equal(reassign.status, 200);
    assert.equal(reassign.body.task.assigneeIdentityId, memberB.session.actor.id);
    assert.equal(reassign.body.executions, undefined);

    const project = await requestJson(`${baseUrl}/api/projects`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "发布", status: "in_progress" })
    });
    assert.equal(project.status, 201);
    const github = await requestJson(`${baseUrl}/api/connections`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ provider: "github_app", installationId: "42", accountLogin: "acme" })
    });
    assert.equal(github.status, 201);
    assert.equal(JSON.stringify(github.body).includes("token"), false);
    const catalog = await requestJson(`${baseUrl}/api/repositories`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ connectionId: github.body.connection.id, url: "https://github.com/acme/app", provider: "github" })
    });
    assert.equal(catalog.status, 201);
    const bind = await requestJson(`${baseUrl}/api/projects/${project.body.project.id}/repository-bindings`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ repositoryId: catalog.body.repository.id, ref: "main" })
    });
    assert.equal(bind.status, 201);
    // memberA 已提升为管理员，可以管理连接（普通成员禁止的负向用例见权限矩阵测试）
    const memberBind = await requestJson(`${baseUrl}/api/connections`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ provider: "gitlab", displayName: "GitLab", instanceUrl: "https://gitlab.com", token: "glpat-secret" })
    });
    assert.equal(memberBind.status, 201);

    const linked = await requestJson(`${baseUrl}/api/tasks/${child.body.task.id}`, {
      method: "PUT", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.body.project.id, status: "in_progress" })
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.task.status, "in_progress");
    assert.equal(parent.body.task.status, "todo");

    const root = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/comments`, {
      method: "POST", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ text: "请 @成员乙 看一下发布清单" })
    });
    assert.equal(root.status, 201);
    const reply = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/comments`, {
      method: "POST", headers: { cookie: memberB.cookie, "content-type": "application/json" },
      body: JSON.stringify({ text: "已收到", parentId: root.body.comment.id })
    });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.comment.parentId, root.body.comment.id);
    const resolved = await requestJson(`${baseUrl}/api/tasks/${parent.body.task.id}/comments/${root.body.comment.id}/resolve`, {
      method: "POST", headers: { cookie: memberB.cookie, "content-type": "application/json" }, body: "{}"
    });
    assert.equal(resolved.status, 200);
    assert.ok(resolved.body.comment.resolvedAt);

    const catchUp = await requestJson(`${baseUrl}/api/notifications`, { headers: { cookie: memberB.cookie } });
    assert.equal(catchUp.body.notifications.some((item) => ["mention", "comment"].includes(item.category)), true);

    const audit = await requestJson(`${baseUrl}/api/audit`, { headers: { cookie: owner.cookie } });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.events.some((event) => event.action === "workspace.create"), true);
    assert.equal(audit.body.events.some((event) => event.action === "workspace.member_invite"), true);

    const dissolved = await requestJson(`${baseUrl}/api/workspaces/current`, {
      method: "DELETE", headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ confirmName: "上线协作工作区" })
    });
    assert.equal(dissolved.status, 200);
    const after = await sessionOf(baseUrl, owner.cookie);
    assert.equal(after.workspace.type, "workspace");
    assert.notEqual(after.workspace.id, workspaceId);
    assert.equal((await requestJson(`${baseUrl}/api/workspaces`, { headers: { cookie: owner.cookie } })).body.workspaces.some((item) => item.id === workspaceId), false);
  });
}
