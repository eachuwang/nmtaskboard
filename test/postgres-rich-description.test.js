import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createPostgresPersistence } from "../lib/postgres.js";
import { CONTRACT_CONTEXT as context } from "./persistence-contract.js";

test("PostgreSQL：描述暂存、历史及不同任务并发保存", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const databaseSchema = "rich_description_" + process.pid + "_" + Date.now();
  const persistence = await createPostgresPersistence({ databaseUrl, databaseSchema });
  try {
    await persistence.tasks.save(context, ["a", "b"].map((id) => ({ id, title: id, description: "初始", status: "todo", priority: "none", updatedAt: "2026-09-01T00:00:00.000Z" })));
    const original = await persistence.tasks.load(context);
    const file = await persistence.richDescriptions.stage(context, { id: "image-test", taskId: "a", objectKey: "test/image", filename: "image.png", contentType: "image/png", size: 32, draftId: "draft-a" });
    assert.equal((await persistence.richDescriptions.find(context, file.id)).state, "staged");
    const changes = ["a", "b"].map((id) => {
      const after = id === "a" ? "![图片](attachment://image-test)" : "并发修改";
      return persistence.richDescriptions.commit(context, { tasks: original.map((task) => task.id === id ? { ...task, description: after, updatedAt: "2026-09-02T00:00:00.000Z", attachments: id === "a" ? [file] : [] } : task), taskId: id, beforeMarkdown: "初始", afterMarkdown: after, expectedUpdatedAt: original.find((task) => task.id === id).updatedAt, draftId: "draft-a", stagedIds: id === "a" ? [file.id] : [] });
    });
    await Promise.all(changes);
    const saved = await persistence.tasks.load(context);
    assert.equal(saved.find((task) => task.id === "a").description, "![图片](attachment://image-test)");
    assert.equal(saved.find((task) => task.id === "b").description, "并发修改");
    assert.equal((await persistence.richDescriptions.find(context, file.id)).state, "active");
    const backup = await persistence.backup.export(context);
    assert.equal(backup.descriptionVersions.length, 4);
  } finally {
    await persistence.close();
    const pool = new Pool({ connectionString: databaseUrl });
    try { await pool.query('DROP SCHEMA "' + databaseSchema + '" CASCADE'); } finally { await pool.end(); }
  }
});
