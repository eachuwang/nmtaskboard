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
    /migration failed/
  );

  assert.ok(queries.some(({ sql }) => sql === "BEGIN"));
  assert.ok(queries.some(({ sql }) => sql === "ROLLBACK"));
  assert.equal(queries.some(({ sql }) => sql === "COMMIT"), false);
});
