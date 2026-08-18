import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const api = async (s, path, opts = {}) => {
  const res = await fetch(s.baseUrl + path, { headers: { "Content-Type": "application/json" }, ...opts });
  return { status: res.status, body: await res.json() };
};

test("标签定义：默认空，可新增/去重/截断，非法颜色置空", async () => {
  const s = await startServer();
  try {
    const g0 = await api(s, "/api/tags");
    assert.equal(g0.status, 200);
    assert.deepEqual(g0.body.tags, []);

    const put = await api(s, "/api/tags", {
      method: "PUT",
      body: JSON.stringify({ tags: [
        { name: "运维", color: "#4a90d9" },
        { name: "运维", color: "#111111" },
        { name: "工作", color: "not-a-color" },
        { name: "汇报", color: "#3faa6e" },
        { name: "  ", color: "#000000" }
      ] })
    });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body.tags, [
      { name: "运维", color: "#4a90d9", creator: "", createdAt: "" },
      { name: "工作", color: "", creator: "", createdAt: "" },
      { name: "汇报", color: "#3faa6e", creator: "", createdAt: "" }
    ]);

    const g1 = await api(s, "/api/tags");
    assert.deepEqual(g1.body.tags, put.body.tags);
  } finally { await s.close(); }
});

test("标签保留创建人与创建时间，超长截断", async () => {
  const s = await startServer();
  try {
    await api(s, "/api/tags", {
      method: "PUT",
      body: JSON.stringify({ tags: [{ name: "运维", color: "#4a90d9", creator: "张三", createdAt: "2026-08-18T11:29:45.000Z" }] })
    });
    const g = await api(s, "/api/tags");
    assert.deepEqual(g.body.tags, [{ name: "运维", color: "#4a90d9", creator: "张三", createdAt: "2026-08-18T11:29:45.000Z" }]);

    await api(s, "/api/tags", {
      method: "PUT",
      body: JSON.stringify({ tags: [{ name: "运维", color: "#4a90d9", creator: "x".repeat(80), createdAt: "2026-08-18" }] })
    });
    const g2 = await api(s, "/api/tags");
    assert.equal(g2.body.tags[0].creator.length, 50);
    assert.equal(g2.body.tags[0].createdAt, "2026-08-18");
  } finally { await s.close(); }
});

test("标签保存不破坏 LLM 提供方配置", async () => {
  const s = await startServer();
  try {
    await api(s, "/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        providers: [{ id: "p1", name: "P", baseUrl: "https://x", protocol: "openai-chat-completions", apiKey: "sk-test", models: [{ id: "m1", name: "m1" }], defaultModelId: "m1" }],
        defaultProviderId: "p1"
      })
    });
    await api(s, "/api/tags", { method: "PUT", body: JSON.stringify({ tags: [{ name: "运维", color: "#4a90d9", creator: "我", createdAt: "2026-08-18T11:29:45.000Z" }] }) });

    const s2 = await api(s, "/api/settings");
    assert.equal(s2.body.providers.length, 1);
    assert.equal(s2.body.providers[0].id, "p1");
    assert.equal(s2.body.providers[0].hasKey, true);
    const tags = (await api(s, "/api/tags")).body.tags;
    assert.deepEqual(tags, [{ name: "运维", color: "#4a90d9", creator: "我", createdAt: "2026-08-18T11:29:45.000Z" }]);
  } finally { await s.close(); }
});
