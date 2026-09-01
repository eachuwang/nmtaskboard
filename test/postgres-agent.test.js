import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { confirmAgentActionDraft, createAgentActionDraft } from "../lib/agent-actions.js";
import { createPostgresPersistence } from "../lib/postgres.js";
import { createTask } from "../lib/tasks.js";
import { createLlmStub } from "./llm-stub.js";
import { startServer } from "./helpers.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function readSse(response) {
  const events = [];
  const text = await response.text();
  for (const block of text.split("\n\n")) {
    const event = block.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
    const raw = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
    if (event && raw) events.push({ event, data: JSON.parse(raw) });
  }
  return events;
}

if (!databaseUrl) {
  test("PostgreSQL Agent 创建：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("Agent 草稿确认在 PostgreSQL 中幂等创建任务、标签与审计", async (t) => {
    const schema = `nmtaskboard_agent_${process.pid}_${Date.now()}`;
    const context = {
      actor: { id: "agent-owner", displayName: "Agent 用户" },
      workspace: { id: "agent-personal", type: "personal", role: "owner", timeZone: "Asia/Shanghai" }
    };
    const llm = await createLlmStub({
      handler: (_body, { calls }) => calls.length === 1
        ? { body: { choices: [{ message: { content: JSON.stringify({ intent: "创建数据库联调任务", tool: "draftTasks", arguments: {} }) } }] } }
        : { body: { choices: [{ message: { content: JSON.stringify({
          tasks: [{ title: "数据库联调", description: "验证 Agent 持久化", priority: "high", tags: ["后端", "联调"] }],
          newTags: [{ name: "联调", color: "#667788" }]
        }) } }] } }
    });
    const persistence = await createPostgresPersistence({ databaseUrl, databaseSchema: schema });
    await persistence.settings.save(context, {
      providers: [{ id: "stub", name: "Stub", baseUrl: llm.baseUrl, protocol: "openai-chat-completions", apiKey: "k", defaultModelId: "stub", models: [{ id: "stub" }] }],
      defaultProviderId: "stub", temperature: 0.2, reportTimeZone: "Asia/Shanghai",
      tags: [{ name: "后端", color: "#445566", creator: "Agent 用户", createdAt: "2026-08-01T00:00:00.000Z" }]
    });
    assert.deepEqual(await persistence.auth.getAgentConfiguration(), { writeToolsEnabled: true });
    await persistence.auth.saveAgentConfiguration({ writeToolsEnabled: false }, context.actor.id);
    assert.deepEqual(await persistence.auth.getAgentConfiguration(), { writeToolsEnabled: false });
    await persistence.auth.saveAgentConfiguration({ writeToolsEnabled: true }, context.actor.id);
    const server = await startServer({ appOptions: { persistence, resolveRequestContext: () => context } });
    t.after(async () => {
      await server.close();
      await llm.close();
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    const created = await fetch(`${server.baseUrl}/api/agent/sessions`, { method: "POST" }).then((response) => response.json());
    const events = await fetch(`${server.baseUrl}/api/agent/sessions/${created.session.id}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "创建一个数据库联调任务" })
    }).then(readSse);
    const draft = events.find(({ event }) => event === "draft").data.draft;
    const confirm = () => fetch(`${server.baseUrl}/api/agent/sessions/${created.session.id}/drafts/${draft.id}/confirm`, {
      method: "POST", headers: { "idempotency-key": "postgres-agent-confirm-1" }
    });
    assert.equal((await confirm()).status, 201);
    const replay = await confirm();
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);

    const tasks = await persistence.tasks.load(context);
    const settings = await persistence.settings.load(context);
    const audits = await persistence.audit.list(context);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, "planned");
    assert.equal(tasks[0].createdSource, "agent");
    assert.deepEqual(settings.tags.map(({ name }) => name), ["后端", "联调"]);
    assert.equal(audits.filter((event) => event.action === "agent.task_batch_create" && event.source === "agent").length, 1);
    assert.equal(audits.find((event) => event.action === "agent.task_batch_create").summary.runId, draft.origin.runId);
    assert.equal(audits.find((event) => event.action === "agent.task_batch_create").summary.turnId, draft.origin.turnId);
    assert.equal(audits.find((event) => event.action === "agent.task_batch_create").summary.toolCallId, draft.origin.toolCallId);

    const actionTask = createTask({ title: "Agent 状态联调", status: "in_progress", priority: "medium" }, tasks, context.actor.displayName);
    await persistence.tasks.save(context, [...tasks, actionTask]);
    const actionDraft = createAgentActionDraft({ actions: [{
      taskId: actionTask.id, targetStatus: "done", progressText: "真实数据库联调通过"
    }] }, await persistence.tasks.load(context), context, "完成任务并记录进展");
    await confirmAgentActionDraft({ persistence }, context, actionDraft);
    const afterAction = await persistence.tasks.load(context);
    const updated = afterAction.find((task) => task.id === actionTask.id);
    assert.equal(updated.status, "done");
    assert.equal(updated.history.at(-1).toStatus, "done");
    assert.equal(updated.progressRecords.at(-1).text, "真实数据库联调通过");
    assert.equal((await persistence.audit.list(context)).filter((event) => event.action === "agent.task_batch_update").length, 1);

    const beforeRollback = await persistence.tasks.load(context);
    const rollbackTarget = beforeRollback.find((task) => task.id === actionTask.id);
    const invalidNext = structuredClone(beforeRollback);
    invalidNext.find((task) => task.id === actionTask.id).status = "blocked";
    await assert.rejects(persistence.tasks.saveWithAudit(context, invalidNext, {
      actor: context.actor, workspace: context.workspace, source: "invalid", action: "should.rollback",
      target: { type: "task", id: actionTask.id }, outcome: "success", summary: {}
    }, [{ taskId: actionTask.id, expectedUpdatedAt: rollbackTarget.updatedAt }]));
    assert.equal((await persistence.tasks.load(context)).find((task) => task.id === actionTask.id).status, "done");
  });

  test("PostgreSQL 助手会话重启后恢复，且跨空间与并发追加受约束", async (t) => {
    const schema = `nmtaskboard_agent_sessions_${process.pid}_${Date.now()}`;
    const context = {
      actor: { id: "agent-owner", displayName: "Agent 用户" },
      workspace: { id: "agent-personal", type: "personal", role: "owner", timeZone: "Asia/Shanghai" }
    };
    const otherSpace = {
      actor: context.actor,
      workspace: { id: "agent-other", type: "personal", role: "owner", timeZone: "Asia/Shanghai" }
    };
    const otherActor = {
      actor: { id: "agent-other", displayName: "另一用户" },
      workspace: context.workspace
    };
    const persistence = await createPostgresPersistence({ databaseUrl, databaseSchema: schema });
    let closed = false;
    t.after(async () => {
      if (!closed) await persistence.close().catch(() => {});
      const pool = new Pool({ connectionString: databaseUrl });
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });
    await persistence.settings.save(context, {
      providers: [], defaultProviderId: "", temperature: 0.2, reportTimeZone: "Asia/Shanghai", tags: []
    });
    await persistence.settings.save(otherSpace, {
      providers: [], defaultProviderId: "", temperature: 0.2, reportTimeZone: "Asia/Shanghai", tags: []
    });

    const created = await persistence.agentSessions.getOrCreate(context);
    await persistence.agentSessions.save(context, {
      ...created.session,
      summary: "联调节奏",
      drafts: [{
        id: "draft-1",
        status: "pending",
        tasks: [{ title: "接口联调" }],
        confirmationPromise: Promise.resolve("authority"),
        apiKey: "secret",
        token: "reusable"
      }]
    });
    await Promise.all([
      persistence.agentSessions.appendMessages(context, created.session.id, [
        { role: "user", content: "第一问" }, { role: "assistant", content: "第一答" }
      ]),
      persistence.agentSessions.appendMessages(context, created.session.id, [
        { role: "user", content: "第二问" }, { role: "assistant", content: "第二答" }
      ])
    ]);

    await assert.rejects(() => persistence.agentSessions.getBound(otherActor, created.session.id), (error) => {
      assert.equal(error.code, "AGENT_SESSION_NOT_FOUND");
      return true;
    });

    await persistence.close();
    closed = true;
    const restarted = await createPostgresPersistence({ databaseUrl, databaseSchema: schema });
    t.after(() => restarted.close());
    const resumed = await restarted.agentSessions.getOrCreate(context);
    assert.equal(resumed.created, false);
    assert.equal(resumed.session.id, created.session.id);
    assert.equal(resumed.session.summary, "联调节奏");
    assert.equal(resumed.session.messages.length, 4);
    assert.deepEqual(resumed.session.messages.map((message) => message.seq), [1, 2, 3, 4]);
    assert.deepEqual(new Set(resumed.session.messages.map((message) => message.content)), new Set(["第一问", "第一答", "第二问", "第二答"]));
    assert.equal(resumed.session.drafts[0].id, "draft-1");
    assert.equal(resumed.session.drafts[0].tasks[0].title, "接口联调");
    assert.equal("confirmationPromise" in resumed.session.drafts[0], false);
    assert.equal("apiKey" in resumed.session.drafts[0], false);
    assert.equal("token" in resumed.session.drafts[0], false);

    const switched = await restarted.agentSessions.getOrCreate(otherSpace);
    assert.equal(switched.created, true);
    assert.equal(switched.session.messages.length, 0);
    assert.equal(switched.session.summary, "");
    await assert.rejects(() => restarted.agentSessions.getBound(context, created.session.id), (error) => {
      assert.equal(error.code, "AGENT_SESSION_ARCHIVED");
      return true;
    });
  });
}
