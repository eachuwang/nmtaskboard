import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createApp } from "../server.js";
import { loadConfig } from "../lib/config.js";
import { createLlmStub } from "./llm-stub.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const tenantId = "11111111-2222-3333-4444-555555555555";
const clientId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ownerSubject = "99999999-8888-7777-6666-555555555555";

const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
};

function signedJwt(privateKey, kid, claims) {
  const signed = `${encoded({ alg: "RS256", typ: "JWT", kid })}.${encoded(claims)}`;
  return `${signed}.${crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url")}`;
}

async function fakeEnterpriseProvider() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "journey-key";
  let claims = {};
  const server = http.createServer(async (req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    res.setHeader("content-type", "application/json");
    if (req.url.includes(".well-known/openid-configuration")) return res.end(JSON.stringify({
      issuer: `${base}/${tenantId}/v2.0`, authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`, jwks_uri: `${base}/keys`
    }));
    if (req.url === "/keys") return res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] }));
    if (req.url === "/token") return res.end(JSON.stringify({ id_token: signedJwt(privateKey, kid, claims) }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    setClaims(value) { claims = value; },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function enterpriseLogin(baseUrl, provider, profile) {
  const started = await fetch(`${baseUrl}/api/auth/oidc/start`, { redirect: "manual" });
  assert.equal(started.status, 302);
  const authorization = new URL(started.headers.get("location"));
  const now = Math.floor(Date.now() / 1000);
  provider.setClaims({
    iss: `${provider.baseUrl}/${tenantId}/v2.0`, aud: clientId, tid: tenantId,
    oid: profile.subject, name: profile.name, preferred_username: profile.email,
    nonce: authorization.searchParams.get("nonce"), iat: now, nbf: now - 1, exp: now + 300
  });
  const callback = await fetch(`${baseUrl}/api/auth/oidc/callback?state=${encodeURIComponent(authorization.searchParams.get("state"))}&code=test-code`, { redirect: "manual" });
  assert.equal(callback.status, 302);
  const cookie = callback.headers.get("set-cookie");
  assert.ok(cookie?.includes("nmtaskboard_session="));
  const session = await requestJson(`${baseUrl}/api/auth/session`, { headers: { cookie } });
  assert.equal(session.status, 200);
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
    const provider = await fakeEnterpriseProvider();
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
      DATABASE_URL: databaseUrl, DATABASE_SCHEMA: schema, BOOTSTRAP_TOKEN: "journey-bootstrap",
      CREDENTIAL_ENCRYPTION_KEY: "journey-encryption-key"
    });
    const app = await createApp(config, { oidcAuthorityBase: provider.baseUrl });
    const server = await new Promise((resolve) => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
      await provider.close();
      await llm.close();
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    assert.equal((await requestJson(`${baseUrl}/api/auth/bootstrap`, {
      method: "POST", headers: { "content-type": "application/json", "x-bootstrap-token": "journey-bootstrap" },
      body: JSON.stringify({ login: "owner", displayName: "企业所有者", password: "correct-horse-battery" })
    })).status, 201);
    const localLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: "owner", password: "correct-horse-battery" })
    });
    const localOwnerCookie = localLogin.headers.get("set-cookie");
    const configured = await requestJson(`${baseUrl}/api/auth/config`, {
      method: "PUT", headers: { cookie: localOwnerCookie, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "entra", tenantId, clientId, clientSecret: "enterprise-secret",
        redirectUri: `${baseUrl}/api/auth/oidc/callback`, administratorSubject: ownerSubject
      })
    });
    assert.equal(configured.status, 200);
    const health = await requestJson(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body.components.authentication, { ok: true, configured: true, provider: "entra" });

    const owner = await enterpriseLogin(baseUrl, provider, { subject: ownerSubject, name: "企业所有者", email: "owner@example.com" });
    const memberA = await enterpriseLogin(baseUrl, provider, { subject: "10000000-0000-0000-0000-000000000001", name: "成员甲", email: "member-a@example.com" });
    const memberB = await enterpriseLogin(baseUrl, provider, { subject: "10000000-0000-0000-0000-000000000002", name: "成员乙", email: "member-b@example.com" });
    assert.equal(owner.session.actor.isSystemAdmin, true);

    const team = await requestJson(`${baseUrl}/api/workspaces`, {
      method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json", "idempotency-key": "journey-team-create" },
      body: JSON.stringify({ name: "上线协作团队", identifier: "journey-team", timeZone: "Asia/Shanghai" })
    });
    assert.equal(team.status, 201);
    const teamId = team.body.workspace.id;
    for (const email of ["member-a@example.com", "member-b@example.com"]) {
      assert.equal((await requestJson(`${baseUrl}/api/team/members/invite`, {
        method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ identifier: email })
      })).status, 201);
    }
    for (const identity of [memberA, memberB]) {
      assert.equal((await requestJson(`${baseUrl}/api/workspaces/current`, {
        method: "POST", headers: { cookie: identity.cookie, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: teamId })
      })).status, 200);
    }

    const ownerContext = { actor: owner.session.actor, workspace: { id: teamId, type: "team", role: "owner", timeZone: "Asia/Shanghai" } };
    await app.locals.application.persistence.settings.save(ownerContext, {
      providers: [{ id: "stub", name: "Stub", baseUrl: llm.baseUrl, protocol: "openai-chat-completions", apiKey: "test", defaultModelId: "model-a", models: [{ id: "model-a", name: "model-a" }] }],
      defaultProviderId: "stub", temperature: 0.2, tags: [], reportTimeZone: "Asia/Shanghai"
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
