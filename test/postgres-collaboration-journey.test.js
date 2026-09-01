import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createLlmStub } from "./llm-stub.js";
import { createAndLoginUser, inviteAndAcceptTeamMember, TEST_PASSWORD } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
};

async function loginExisting(baseUrl, login, password = TEST_PASSWORD) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, password })
  });
  const cookie = response.headers.get("set-cookie");
  const session = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie } });
  return { cookie, session: session.body };
}

async function readSse(response) {
  assert.equal(response.status, 200);
  const blocks = (await response.text()).split("\n\n").filter(Boolean);
  return blocks.map((block) => {
    const event = block.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = block.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
    return event && data ? { event, data: JSON.parse(data) } : null;
  }).filter(Boolean);
}

if (!databaseUrl) {
  test("PostgreSQL 协作全旅程：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("伪企业身份在真实 PostgreSQL 中完成团队分派、独立推进、管理追踪、报告与 Agent 安全确认", async (t) => {
    const schema = `nmtaskboard_journey_${process.pid}_${Date.now()}`;
    const reportStart = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const reportEnd = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const llm = await createLlmStub({
      handler(body) {
        const system = body.messages?.[0]?.content || "";
        const user = body.messages?.at(-1)?.content || "";
        if (system.includes("团队任务分派草稿规划器")) {
          const parentId = system.match(/"id":"([^"]+)","title":"协作上线"/)?.[1];
          const members = [...system.matchAll(/"id":"([^"]+)","displayName":"成员[甲乙]"/g)].map((match) => match[1]);
          return { body: { choices: [{ message: { content: JSON.stringify({ parentTaskId: parentId, memberIdentityIds: members }) } }] } };
        }
        if (system.includes("任务看板的 Agent 规划器")) {
          const plan = user.includes("团队周报")
            ? { intent: "生成团队周报草稿", tool: "draftTeamReport", arguments: { type: "weekly", range: { start: reportStart, end: reportEnd } } }
            : { intent: "分派协作上线", tool: "draftAssignments", arguments: {} };
          return { body: { choices: [{ message: { content: JSON.stringify(plan) } }] } };
        }
        return { body: { choices: [{ message: { content: "已根据可信证据生成团队草稿。" } }] } };
      }
    });
    const config = loadConfig({
      PORT: "0", DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-journey-")),
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema
    });
    const app = await createApp(config, { log: () => {} });
    const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      await llm.close();
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    const ownerCookie = await createAndLoginUser(app, baseUrl, { login: "owner@example.com", displayName: "企业所有者" });
    await createAndLoginUser(app, baseUrl, { login: "member-a@example.com", displayName: "成员甲" });
    await createAndLoginUser(app, baseUrl, { login: "member-b@example.com", displayName: "成员乙" });
    const owner = { cookie: ownerCookie, session: (await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie: ownerCookie } })).body };
    const memberA = await loginExisting(baseUrl, "member-a@example.com");
    const memberB = await loginExisting(baseUrl, "member-b@example.com");
    assert.equal(owner.session.actor.isSystemAdmin, false);

    const health = await requestJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body.components.authentication, { ok: true, configured: true, provider: "local" });

    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json", "idempotency-key": "journey-team-create" },
      body: JSON.stringify({ name: "上线协作团队", identifier: "journey-team", timeZone: "Asia/Shanghai" })
    });
    assert.equal(team.status, 201);
    const teamId = team.body.workspace.id;
    for (const identity of [memberA, memberB]) {
      await inviteAndAcceptTeamMember(baseUrl, owner.cookie, identity.cookie, identity.session.actor.id);
      assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
        method: "POST", headers: { cookie: identity.cookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
      })).status, 200);
    }

    const ownerContext = { actor: owner.session.actor, workspace: { id: teamId, type: "team", role: "owner", timeZone: "Asia/Shanghai" } };
    await app.locals.application.persistence.settings.save(ownerContext, {
      providers: [], defaultProviderId: "", temperature: 0.2, tags: [], reportTimeZone: "Asia/Shanghai"
    });
    await app.locals.application.persistence.settings.saveInstance({
      providers: [{ id: "stub", name: "Stub", baseUrl: llm.baseUrl, protocol: "openai-chat-completions", apiKey: "test", defaultModelId: "model-a", models: [{ id: "model-a", name: "model-a" }] }],
      defaultProviderId: "stub", temperature: 0.2
    });
    const parent = await requestJson(`${baseUrl}/api/tasks`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ title: "协作上线", description: "完成企业协作验收", dueDate: "2026-09-04", status: "planned" })
    });
    assert.equal(parent.status, 201);

    const agentSession = await requestJson(`${baseUrl}/api/agent/sessions`, { method: "POST", headers: { cookie: owner.cookie } });
    const assignmentEvents = await readSse(await fetch(`${baseUrl}/api/agent/sessions/${agentSession.body.session.id}/messages`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "把协作上线分派给成员甲和成员乙" })
    }));
    const assignment = assignmentEvents.find(({ event }) => event === "assignmentDraft")?.data.draft;
    assert.deepEqual(assignment.impact.create.sort(), ["成员乙", "成员甲"]);
    const confirmUrl = `${baseUrl}/api/agent/sessions/${agentSession.body.session.id}/assignments/${assignment.id}/confirm`;
    const confirmOptions = { method: "POST", headers: { cookie: owner.cookie, "idempotency-key": "journey-assignment-confirm" } };
    assert.equal((await requestJson(confirmUrl, confirmOptions)).status, 201);
    assert.equal((await requestJson(confirmUrl, confirmOptions)).status, 200);

    const ownerTasks = await requestJson(`${baseUrl}/api/tasks`, { headers: { cookie: owner.cookie } });
    const executions = ownerTasks.body.tasks.filter((task) => task.taskType === "execution");
    const executionA = executions.find((task) => task.assigneeIdentityId === memberA.session.actor.id);
    const executionB = executions.find((task) => task.assigneeIdentityId === memberB.session.actor.id);
    const move = (identity, task, status, reason) => requestJson(`${baseUrl}/api/tasks/${task.id}`, {
      method: "PUT", headers: { cookie: identity.cookie, "content-type": "application/json" },
      body: JSON.stringify({ status, expectedUpdatedAt: task.updatedAt, ...(reason ? { reason } : {}) })
    });
    const aStarted = await move(memberA, executionA, "in_progress");
    assert.equal(aStarted.status, 200);
    assert.equal((await move(memberA, aStarted.body.task, "done")).status, 200);
    const bStarted = await move(memberB, executionB, "in_progress");
    assert.equal(bStarted.status, 200);
    assert.equal((await move(memberB, bStarted.body.task, "blocked", "等待生产权限")).status, 200);

    const forbiddenPeer = await requestJson(`${baseUrl}/api/tasks/${executionB.id}`, {
      method: "PUT", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ status: "done", expectedUpdatedAt: executionB.updatedAt })
    });
    assert.equal(forbiddenPeer.status, 404);
    const stale = await requestJson(`${baseUrl}/api/tasks/${executionA.id}`, {
      method: "PUT", headers: { cookie: memberA.cookie, "content-type": "application/json" },
      body: JSON.stringify({ status: "in_progress", reason: "返工", expectedUpdatedAt: executionA.updatedAt })
    });
    assert.equal(stale.status, 409);

    const tracking = await requestJson(`${baseUrl}/api/team/members`, { headers: { cookie: owner.cookie } });
    assert.equal(tracking.status, 200);
    assert.equal(tracking.body.members.find((member) => member.id === memberA.session.actor.id).taskOverview.done, 1);
    assert.equal(tracking.body.members.find((member) => member.id === memberB.session.actor.id).taskOverview.blocked, 1);

    const reportEvents = await readSse(await fetch(`${baseUrl}/api/agent/sessions/${agentSession.body.session.id}/messages`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "生成本期团队周报草稿" })
    }));
    const report = reportEvents.find(({ event }) => event === "result")?.data.data;
    assert.equal(report.publicationStatus, "draft");
    assert.match(report.draft, /协作上线/);

    await requestJson(`${baseUrl}/api/team/members/${memberB.session.actor.id}/role`, {
      method: "PATCH", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ role: "admin" })
    });
    const memberBAdminSession = await requestJson(`${baseUrl}/api/agent/sessions`, { method: "POST", headers: { cookie: memberB.cookie } });
    const pendingEvents = await readSse(await fetch(`${baseUrl}/api/agent/sessions/${memberBAdminSession.body.session.id}/messages`, {
      method: "POST", headers: { cookie: memberB.cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "重新分派协作上线" })
    }));
    const pending = pendingEvents.find(({ event }) => event === "assignmentDraft")?.data.draft;
    await requestJson(`${baseUrl}/api/team/members/${memberB.session.actor.id}/role`, {
      method: "PATCH", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ role: "member" })
    });
    const permissionChanged = await requestJson(`${baseUrl}/api/agent/sessions/${memberBAdminSession.body.session.id}/assignments/${pending.id}/confirm`, {
      method: "POST", headers: { cookie: memberB.cookie, "idempotency-key": "permission-changed-confirm" }
    });
    assert.equal(permissionChanged.status, 403);

    const auditPool = new Pool({ connectionString: databaseUrl });
    const audit = await auditPool.query(`SELECT action, outcome FROM "${schema}".audit_events WHERE source = 'agent' ORDER BY occurred_at`);
    await auditPool.end();
    assert.equal(audit.rows.some((event) => event.action === "agent.task_assign" && event.outcome === "success"), true);
    assert.equal(audit.rows.some((event) => event.action === "agent.tool.draftAssignments.confirm" && event.outcome === "denied"), true);
  });
}
