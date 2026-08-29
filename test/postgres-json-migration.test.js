import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { createPostgresPersistence } from "../lib/postgres.js";
import { createApp } from "../server.js";
import { DEFAULT_LOCAL_ACTOR_ID, DEFAULT_PERSONAL_WORKSPACE_ID, defaultRequestContext } from "../lib/application.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaPrefix = `nmtaskboard_import_${process.pid}_${Date.now()}`;

function fixtureDataDir(taskOverrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtaskboard-json-import-"));
  const task = {
    id: "legacy-task-1",
    title: "迁移后的已完成任务",
    description: "保留描述与全部兼容字段",
    status: "done",
    priority: "high",
    tags: ["迁移"],
    creator: "我",
    assignees: ["旧负责人"],
    dueDate: "2026-08-28",
    blockReason: null,
    cancelReason: null,
    subtasks: [],
    comments: [{
      id: "legacy-comment-1",
      text: "迁移评论",
      author: "我",
      createdAt: "2026-08-27T09:00:00.000Z",
      parentId: null
    }],
    history: [
      { id: "h1", action: "created", actor: "我", fromStatus: null, toStatus: "planned", at: "2026-08-24T08:00:00.000Z", recordedAt: "2026-08-24T08:00:00.000Z", reason: null },
      { id: "h2", action: "moved", actor: "我", fromStatus: "planned", toStatus: "todo", at: "2026-08-24T09:00:00.000Z", recordedAt: "2026-08-24T09:00:00.000Z", reason: null },
      { id: "h3", action: "moved", actor: "我", fromStatus: "todo", toStatus: "in_progress", at: "2026-08-25T09:00:00.000Z", recordedAt: "2026-08-25T09:00:00.000Z", reason: null },
      { id: "h4", action: "moved", actor: "我", fromStatus: "in_progress", toStatus: "done", at: "2026-08-27T09:00:00.000Z", recordedAt: "2026-08-27T09:00:00.000Z", reason: null }
    ],
    order: 2,
    createdAt: "2026-08-24T08:00:00.000Z",
    updatedAt: "2026-08-27T09:00:00.000Z",
    startedAt: null,
    completedAt: "2026-08-27T09:00:00.000Z",
    cancelledAt: null,
    ...taskOverrides
  };
  const settings = {
    providers: [],
    defaultProviderId: "",
    temperature: 0.6,
    tags: [{ name: "迁移", color: "#456789", creator: "我", createdAt: "2026-08-24T08:00:00.000Z" }],
    reportTimeZone: "Asia/Shanghai"
  };
  fs.writeFileSync(path.join(dataDir, "tasks.json"), JSON.stringify({ tasks: [task] }, null, 2));
  fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify(settings, null, 2));
  return { dataDir, task, settings };
}

async function dropSchema(schema) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await pool.end();
  }
}

if (!databaseUrl) {
  test("JSON → PostgreSQL 迁移：需要 TEST_DATABASE_URL", {
    skip: process.env.REQUIRE_POSTGRES_TEST !== "1" ? "未配置集成测试数据库" : false
  }, () => assert.fail("请设置 TEST_DATABASE_URL"));
} else {
  test("首次启动将现有 JSON 原样迁入稳定的默认个人空间且可重复启动", async (t) => {
    const schema = `${schemaPrefix}_success`;
    const fixture = fixtureDataDir();
    const sourceTasks = fs.readFileSync(path.join(fixture.dataDir, "tasks.json"), "utf8");
    const sourceSettings = fs.readFileSync(path.join(fixture.dataDir, "settings.json"), "utf8");
    const config = { dataDir: fixture.dataDir, databaseUrl, databaseSchema: schema, persistenceDriver: "postgres" };
    const context = defaultRequestContext({ body: {} });
    t.after(() => dropSchema(schema));

    let persistence = await createPostgresPersistence(config);
    const diagnostics = persistence.diagnostics();
    assert.equal(diagnostics.migrations.status, "applied");
    assert.equal(diagnostics.migrations.failed, null);
    assert.deepEqual(diagnostics.legacyImport, {
      migrated: true,
      digest: diagnostics.legacyImport.digest,
      tasks: 1,
      tags: 1
    });
    const firstLoad = await persistence.tasks.load(context);
    assert.equal(firstLoad.length, 1);
    assert.deepEqual(firstLoad[0].comments, fixture.task.comments);
    assert.deepEqual(firstLoad[0].progressRecords.map(({ id, text, author, createdAt, updatedAt, revisions, deletedAt }) => ({ id, text, author, createdAt, updatedAt, revisions, deletedAt })), [{
      id: "legacy-comment-1",
      text: "迁移评论",
      author: "我",
      createdAt: "2026-08-27T09:00:00.000Z",
      updatedAt: "2026-08-27T09:00:00.000Z",
      revisions: [],
      deletedAt: null
    }]);
    assert.deepEqual(await persistence.settings.load(context), fixture.settings);
    await persistence.close();

    persistence = await createPostgresPersistence(config);
    const secondLoad = await persistence.tasks.load(context);
    assert.equal(secondLoad.length, 1);
    assert.deepEqual(secondLoad[0].progressRecords[0].text, "迁移评论");
    await persistence.close();

    const app = await createApp(config, { auth: false });
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const tasksResponse = await fetch(`${baseUrl}/api/tasks`);
      assert.equal(tasksResponse.status, 200);
      const migratedTask = (await tasksResponse.json()).tasks[0];
      assert.equal(migratedTask.id, fixture.task.id);
      assert.deepEqual(migratedTask.comments, fixture.task.comments);
      assert.deepEqual(migratedTask.progressRecords.map((record) => record.text), ["迁移评论"]);
      assert.deepEqual(migratedTask.history, fixture.task.history);

      const settingsResponse = await fetch(`${baseUrl}/api/settings`);
      assert.equal(settingsResponse.status, 200);
      assert.equal((await settingsResponse.json()).temperature, fixture.settings.temperature);

      const reportResponse = await fetch(`${baseUrl}/api/report/summary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "weekly", range: { start: "2026-08-24", end: "2026-08-28" } })
      });
      assert.equal(reportResponse.status, 200);
      assert.deepEqual((await reportResponse.json()).summary.sections.completed.map((item) => item.id), [fixture.task.id]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.application.persistence.close();
    }

    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const identities = await pool.query(`SELECT id FROM "${schema}".identities ORDER BY id`);
      assert.deepEqual(identities.rows.map((row) => row.id), [DEFAULT_LOCAL_ACTOR_ID]);
      const workspaces = await pool.query(`SELECT id, type FROM "${schema}".workspaces`);
      assert.deepEqual(workspaces.rows, [{ id: DEFAULT_PERSONAL_WORKSPACE_ID, type: "personal" }]);
      const members = await pool.query(`SELECT identity_id FROM "${schema}".workspace_members`);
      assert.deepEqual(members.rows.map((row) => row.identity_id), [DEFAULT_LOCAL_ACTOR_ID]);
      const imports = await pool.query(`SELECT import_key FROM "${schema}".data_imports`);
      assert.deepEqual(imports.rows.map((row) => row.import_key), ["json-personal-v1"]);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}".tasks`)).rows[0].count, 1);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}".task_progress`)).rows[0].count, 0);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}".task_progress_records`)).rows[0].count, 1);
    } finally {
      await pool.end();
    }

    assert.equal(fs.readFileSync(path.join(fixture.dataDir, "tasks.json"), "utf8"), sourceTasks);
    assert.equal(fs.readFileSync(path.join(fixture.dataDir, "settings.json"), "utf8"), sourceSettings);
  });

  test("迁移写入失败时回滚目标数据并保持源 JSON 不变", async (t) => {
    const schema = `${schemaPrefix}_failure`;
    const fixture = fixtureDataDir({ priority: "invalid-priority" });
    const sourceTasks = fs.readFileSync(path.join(fixture.dataDir, "tasks.json"), "utf8");
    const config = { dataDir: fixture.dataDir, databaseUrl, databaseSchema: schema };
    t.after(() => dropSchema(schema));

    await assert.rejects(createPostgresPersistence(config));
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}".tasks`)).rows[0].count, 0);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}".data_imports`)).rows[0].count, 0);
      assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}".identities`)).rows[0].count, 0);
    } finally {
      await pool.end();
    }
    assert.equal(fs.readFileSync(path.join(fixture.dataDir, "tasks.json"), "utf8"), sourceTasks);
  });
}
