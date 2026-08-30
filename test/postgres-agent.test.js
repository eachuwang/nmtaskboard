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
}
