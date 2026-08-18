import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

const put = async (s, body) => {
  const r = await fetch(s.baseUrl + "/api/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  return { status: r.status, body: await r.json() };
};

test("providers 保存与读取：密钥遮蔽、尾号、模型目录", async () => {
  const s = await startServer();
  try {
    const { status, body } = await put(s, {
      providers: [{
        id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com",
        protocol: "openai-chat-completions", apiKey: "sk-abcdef1234",
        defaultModelId: "deepseek-chat",
        models: [
          { id: "deepseek-chat", name: "deepseek-chat", contextWindow: 64000, maxOutputTokens: 8000 },
          { id: "deepseek-reasoner", name: "deepseek-reasoner" }
        ]
      }],
      defaultProviderId: "deepseek",
      temperature: 0.6
    });
    assert.equal(status, 200);
    assert.equal(body.providers.length, 1);
    const p = body.providers[0];
    assert.equal(p.hasKey, true);
    assert.equal(p.keyTail, "1234");
    assert.equal("apiKey" in p, false);
    assert.equal(p.models.length, 2);
    assert.equal(p.models[0].contextWindow, 64000);
    assert.equal(p.defaultModelId, "deepseek-chat");

    const text = await (await fetch(s.baseUrl + "/api/settings")).text();
    assert.ok(!text.includes("sk-abcdef1234"), "响应不含明文 Key");
  } finally { await s.close(); }
});

test("apiKey 非空才覆盖；clearKey 清除；默认提供方自动回退", async () => {
  const s = await startServer();
  try {
    await put(s, {
      providers: [
        { id: "p1", name: "P1", baseUrl: "http://a", apiKey: "k-1", models: [{ id: "m1" }] },
        { id: "p2", name: "P2", baseUrl: "http://b", apiKey: "k-2", models: [{ id: "m2" }] }
      ],
      defaultProviderId: "p1"
    });
    // apiKey 为空不覆盖
    let { body } = await put(s, {
      providers: [
        { id: "p1", name: "P1 改", baseUrl: "http://a", apiKey: "", models: [{ id: "m1" }] },
        { id: "p2", name: "P2", baseUrl: "http://b", apiKey: "new-k", models: [{ id: "m2" }] }
      ],
      defaultProviderId: "p1"
    });
    assert.equal(body.providers[0].name, "P1 改");
    assert.equal(body.providers[0].hasKey, true, "空 apiKey 保留旧 Key");
    assert.equal(body.providers[1].keyTail, "new-k".slice(-4));

    // clearKey
    ({ body } = await put(s, {
      providers: [{ id: "p1", name: "P1 改", baseUrl: "http://a", clearKey: true, models: [{ id: "m1" }] }],
      defaultProviderId: "p1"
    }));
    assert.equal(body.providers[0].hasKey, false);

    // 默认提供方不存在时回退第一个
    ({ body } = await put(s, {
      providers: [
        { id: "p1", name: "P1", baseUrl: "http://a", models: [{ id: "m1" }] },
        { id: "p2", name: "P2", baseUrl: "http://b", models: [{ id: "m2" }] }
      ],
      defaultProviderId: "不存在"
    }));
    assert.equal(body.defaultProviderId, "p1");
  } finally { await s.close(); }
});

test("旧版单 llm 配置自动迁移为默认提供方", async () => {
  const s = await startServer();
  try {
    // 直接写旧格式文件再读取
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.mkdirSync(s.dataDir, { recursive: true });
    fs.writeFileSync(path.join(s.dataDir, "settings.json"), JSON.stringify({
      llm: { baseUrl: "http://old", model: "old-model", temperature: 0.9, apiKey: "old-k" }
    }), "utf8");
    const r = await fetch(s.baseUrl + "/api/settings");
    const j = await r.json();
    assert.equal(j.providers.length, 1);
    assert.equal(j.providers[0].id, "legacy");
    assert.equal(j.providers[0].baseUrl, "http://old");
    assert.equal(j.providers[0].models[0].id, "old-model");
    assert.equal(j.providers[0].hasKey, true);
    assert.equal(j.defaultProviderId, "legacy");
  } finally { await s.close(); }
});

test("提供方数据校验：非法协议回退、空 id 条目剔除、非法数字置 null", async () => {
  const s = await startServer();
  try {
    const { body } = await put(s, {
      providers: [
        { id: "", name: "空id", baseUrl: "http://a", models: [{ id: "m" }] },
        { id: "ok", name: "正常", baseUrl: "http://b", protocol: "nope-protocol", models: [
          { id: "m1", contextWindow: "abc", maxOutputTokens: 4096 }
        ] }
      ]
    });
    assert.equal(body.providers.length, 1, "空 id 条目被剔除");
    assert.equal(body.providers[0].protocol, "openai-chat-completions");
    assert.equal(body.providers[0].models[0].contextWindow, null);
    assert.equal(body.providers[0].models[0].maxOutputTokens, 4096);
  } finally { await s.close(); }
});
