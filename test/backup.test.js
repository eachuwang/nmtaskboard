import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

async function create(s, body) {
  const r = await fetch(s.baseUrl + "/api/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return (await r.json()).task;
}

test("导出：整库 JSON 带导出时间与应用标记", async () => {
  const s = await startServer();
  try {
    await create(s, { title: "A" });
    await create(s, { title: "B", status: "todo" });
    const res = await fetch(s.baseUrl + "/api/export");
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-disposition").includes("attachment"));
    const j = await res.json();
    assert.equal(j.app, "nmtaskboard");
    assert.ok(j.exportedAt);
    assert.equal(j.tasks.length, 2);
  } finally { await s.close(); }
});

test("导入：整库替换、非法条目跳过并报告数量", async () => {
  const s = await startServer();
  try {
    await create(s, { title: "将被替换" });
    const payload = {
      tasks: [
        { id: "keep-1", title: "导入1", status: "in_progress", priority: "high", tags: ["工作"], dueDate: "2026-08-20", order: 0, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", startedAt: "2026-08-02T00:00:00.000Z" },
        { id: "keep-1", title: "重复id", status: "todo" }, // 重复 id → 跳过
        { title: "   " }, // 无标题 → 跳过
        { id: "keep-2", title: "导入2", status: "done", order: 1 }
      ]
    };
    const res = await fetch(s.baseUrl + "/api/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.imported, 2);
    assert.equal(j.skipped, 2);
    const { tasks } = await (await fetch(s.baseUrl + "/api/tasks")).json();
    assert.equal(tasks.length, 2, "整库替换");
    const t1 = tasks.find((t) => t.id === "keep-1");
    assert.equal(t1.status, "in_progress");
    assert.equal(t1.startedAt, "2026-08-02T00:00:00.000Z");
    const t2 = tasks.find((t) => t.id === "keep-2");
    assert.ok(t2.completedAt, "导入 done 无 completedAt 时补当前时间");
  } finally { await s.close(); }
});

test("导入：缺少 tasks 数组返回 400", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/api/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nope: [] })
    });
    assert.equal(res.status, 400);
    assert.ok(/tasks/.test((await res.json()).error));
  } finally { await s.close(); }
});
