import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const api = async (s, path, opts = {}) => {
  const res = await fetch(s.baseUrl + path, { headers: { "Content-Type": "application/json" }, ...opts });
  return { status: res.status, body: await res.json() };
};

test("标签定义：默认空，可新增/去重/截断，非法颜色置空，服务端补创建信息", async () => {
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
    assert.deepEqual(put.body.tags.map((tag) => ({ ...tag, createdAt: "<动态>" })), [
      { name: "运维", color: "#4a90d9", creator: "我", createdAt: "<动态>", updater: "", updatedAt: "" },
      { name: "工作", color: "", creator: "我", createdAt: "<动态>", updater: "", updatedAt: "" },
      { name: "汇报", color: "#3faa6e", creator: "我", createdAt: "<动态>", updater: "", updatedAt: "" }
    ]);
    assert.ok(put.body.tags.every((tag) => !Number.isNaN(Date.parse(tag.createdAt))));

    const g1 = await api(s, "/api/tags");
    assert.deepEqual(g1.body.tags, put.body.tags);
  } finally { await s.close(); }
});

test("标签创建人/创建时间不可被后续提交覆盖，改色记录更新人与更新时间", async () => {
  const s = await startServer();
  try {
    await api(s, "/api/tags", {
      method: "PUT",
      body: JSON.stringify({ tags: [{ name: "运维", color: "#4a90d9", creator: "张三", createdAt: "2026-08-18T11:29:45.000Z" }] })
    });
    const g = await api(s, "/api/tags");
    assert.deepEqual(g.body.tags, [{ name: "运维", color: "#4a90d9", creator: "张三", createdAt: "2026-08-18T11:29:45.000Z", updater: "", updatedAt: "" }]);

    // 颜色未变：创建信息保留，更新字段不盖章（即使客户端伪造 creator）
    await api(s, "/api/tags", {
      method: "PUT",
      body: JSON.stringify({ tags: [{ name: "运维", color: "#4a90d9", creator: "x".repeat(80), createdAt: "2026-08-18" }] })
    });
    const g2 = await api(s, "/api/tags");
    assert.deepEqual(g2.body.tags, [{ name: "运维", color: "#4a90d9", creator: "张三", createdAt: "2026-08-18T11:29:45.000Z", updater: "", updatedAt: "" }]);

    // 颜色变化：保留创建人/创建时间，盖章更新人/更新时间
    await api(s, "/api/tags", {
      method: "PUT",
      body: JSON.stringify({ tags: [{ name: "运维", color: "#111111" }] })
    });
    const g3 = await api(s, "/api/tags");
    assert.equal(g3.body.tags[0].creator, "张三");
    assert.equal(g3.body.tags[0].createdAt, "2026-08-18T11:29:45.000Z");
    assert.equal(g3.body.tags[0].color, "#111111");
    assert.equal(g3.body.tags[0].updater, "我");
    assert.ok(!Number.isNaN(Date.parse(g3.body.tags[0].updatedAt)));
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
    assert.deepEqual(tags, [{ name: "运维", color: "#4a90d9", creator: "我", createdAt: "2026-08-18T11:29:45.000Z", updater: "", updatedAt: "" }]);
  } finally { await s.close(); }
});
