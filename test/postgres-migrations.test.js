import test from "node:test";
import assert from "node:assert/strict";
import { runPostgresMigrations } from "../lib/postgres.js";

test("PostgreSQL 迁移失败时回滚且不提交版本", async () => {
  const queries = [];
  const client = {
    async query(input, params) {
      const sql = typeof input === "string" ? input : input.text;
      queries.push({ sql, params });
      if (sql === "BROKEN MIGRATION") throw new Error("migration failed");
      if (sql.includes("SELECT version FROM schema_migrations")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };

  await assert.rejects(
    runPostgresMigrations(pool, "migration_test", [
      { version: 1, name: "first", sql: "SELECT 1" },
      { version: 2, name: "broken", sql: "BROKEN MIGRATION" }
    ]),
    (error) => {
      assert.match(error.message, /migration failed/);
      assert.deepEqual(error.migrationReport, {
        schema: "migration_test",
        status: "rolled_back",
        total: 2,
        skipped: [],
        attempted: ["first", "broken"],
        failed: "broken"
      });
      return true;
    }
  );

  assert.ok(queries.some(({ sql }) => sql === "BEGIN"));
  assert.ok(queries.some(({ sql }) => sql === "ROLLBACK"));
  assert.equal(queries.some(({ sql }) => sql === "COMMIT"), false);
});

test("PostgreSQL 迁移成功时返回已应用与跳过清单", async () => {
  const client = {
    async query(input) {
      const sql = typeof input === "string" ? input : input.text;
      if (sql.includes("SELECT version FROM schema_migrations")) return { rows: [{ version: 1 }] };
      return { rows: [] };
    },
    release() {}
  };
  const report = await runPostgresMigrations({ async connect() { return client; } }, "migration_test", [
    { version: 1, name: "existing", sql: "SELECT 1" },
    { version: 2, name: "new", sql: "SELECT 2" }
  ]);
  assert.deepEqual(report, {
    schema: "migration_test",
    status: "applied",
    total: 2,
    skipped: ["existing"],
    attempted: ["new"],
    failed: null
  });
});
