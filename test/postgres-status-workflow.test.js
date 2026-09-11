import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { createPostgresPersistence } from "../lib/postgres.js";
import { localPersonalContext } from "../lib/personal-space.js";
import { createTask } from "../lib/tasks.js";
import { previewWorkflow } from "../lib/status-workflow.js";
import { defaultWorkflow } from "../shared/task-statuses.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
test("PostgreSQL：状态方案迁移、隔离、预览冲突与失败回滚", { skip: !databaseUrl && process.env.REQUIRE_POSTGRES_TEST !== "1" }, async (t) => {
  assert.ok(databaseUrl, "请配置隔离测试数据库");
  const schema = `status_flow_${process.pid}_${Date.now()}`;
  const persistence = await createPostgresPersistence({ databaseUrl, databaseSchema: schema });
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => { await persistence.close(); await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });
  const context = localPersonalContext();
  const task = createTask({ title: "历史任务", status: "in_progress" });
  await persistence.tasks.save(context, [task]);
  const input = { mode: "custom", custom: [
    { id: "cs_dev", value: "dev", name: "开发中", lifecycle: "active", outcome: null, color: "#8b5cf6" },
    { id: "cs_done", value: "shipped", name: "已上线", lifecycle: "terminal", outcome: "completed", color: "#22c55e" }
  ] };
  const oldTasks = await persistence.tasks.load(context);
  const preview = previewWorkflow(defaultWorkflow(), oldTasks, input);
  await persistence.statusWorkflow.save(context, { ...input, previewToken: preview.token });
  let flow = await persistence.statusWorkflow.load(context);
  let tasks = await persistence.tasks.load(context);
  assert.equal(tasks[0].status, "cs_dev"); assert.equal(tasks[0].history.at(-1).source, "workflow");
  await assert.rejects(persistence.tasks.save(context, oldTasks), /状态方案已变化/);
  await assert.rejects(persistence.statusWorkflow.save(context, { ...input, previewToken: preview.token }), /重新预览/);
  const other = { ...context, workspace: { ...context.workspace, id: "other-workspace" } };
  assert.equal((await persistence.statusWorkflow.load(other)).mode, "default");
  // Force a database write error after the workflow row update; both must roll back.
  await pool.query(`CREATE FUNCTION "${schema}".reject_status_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$`);
  await pool.query(`CREATE TRIGGER reject_status_test BEFORE INSERT ON "${schema}".tasks FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_status_test()`);
  const next = { ...input, custom: [input.custom[1]] };
  const before = previewWorkflow(flow, tasks, next);
  await assert.rejects(persistence.statusWorkflow.save(context, { ...next, previewToken: before.token }), /test rollback/);
  assert.equal((await persistence.statusWorkflow.load(context)).revision, flow.revision);
  assert.equal((await persistence.tasks.load(context))[0].status, "cs_dev");
  await pool.query(`DROP TRIGGER reject_status_test ON "${schema}".tasks`);
  await persistence.statusWorkflow.save(context, { ...next, previewToken: before.token });
  flow = await persistence.statusWorkflow.load(context); tasks = await persistence.tasks.load(context);
  assert.equal(tasks[0].status, "cs_done"); assert.equal(flow.deleted[0].name, "开发中");
  const restored = await persistence.backup.export(context);
  await persistence.backup.replace(context, restored);
  assert.equal((await persistence.tasks.load(context))[0].status, "cs_done");
});
