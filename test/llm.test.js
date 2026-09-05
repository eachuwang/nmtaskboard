import test from "node:test";
import assert from "node:assert/strict";
import { chatCompletion, extractJson, LlmError } from "../lib/llm.js";
import { createLlmStub, sseDelta } from "./llm-stub.js";
import { startServer } from "./helpers.js";

test("非流式调用成功", async () => {
  const stub = await createLlmStub();
  try {
    const { content } = await chatCompletion({
      baseUrl: stub.baseUrl, model: "test-model", apiKey: "k",
      messages: [{ role: "user", content: "hi" }]
    });
    assert.equal(content, "成功");
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].model, "test-model");
    assert.equal(stub.calls[0].messages[0].content, "hi");
  } finally { await stub.close(); }
});

test("jsonMode 带 response_format", async () => {
  const stub = await createLlmStub({
    handler: () => ({ status: 200, body: { choices: [{ message: { content: "{\"tasks\":[]}" } }] } })
  });
  try {
    const { content } = await chatCompletion({
      baseUrl: stub.baseUrl, model: "m", messages: [{ role: "user", content: "x" }], jsonMode: true
    });
    assert.ok(content.includes("tasks"));
    assert.deepEqual(stub.calls[0].response_format, { type: "json_object" });
  } finally { await stub.close(); }
});

test("流式调用增量拼接", async () => {
  const stub = await createLlmStub({
    handler: () => ({ stream: [sseDelta("你"), sseDelta("好"), sseDelta("！")] })
  });
  try {
    const parts = [];
    const { content } = await chatCompletion({
      baseUrl: stub.baseUrl, model: "m", messages: [{ role: "user", content: "x" }],
      stream: true, onDelta: (d) => parts.push(d)
    });
    assert.equal(content, "你好！");
    assert.deepEqual(parts, ["你", "好", "！"]);
    assert.equal(stub.calls[0].stream, true);
  } finally { await stub.close(); }
});

test("未配置时抛中文错误", async () => {
  await assert.rejects(
    () => chatCompletion({ baseUrl: "", model: "m", messages: [] }),
    (e) => e instanceof LlmError && e.code === "not_configured" && /超管台/.test(e.message)
  );
});

test("401 映射为鉴权错误", async () => {
  const stub = await createLlmStub({ handler: () => ({ status: 401, body: { error: "no" } }) });
  try {
    await assert.rejects(
      () => chatCompletion({ baseUrl: stub.baseUrl, model: "m", messages: [] }),
      (e) => e instanceof LlmError && e.code === "auth" && /Key/.test(e.message)
    );
  } finally { await stub.close(); }
});

test("超时映射为 timeout 错误", async () => {
  const stub = await createLlmStub({
    handler: () => new Promise((resolve) => setTimeout(() => resolve({ status: 200, body: { choices: [{ message: { content: "晚到" } }] } }), 1500))
  });
  try {
    await assert.rejects(
      () => chatCompletion({ baseUrl: stub.baseUrl, model: "m", messages: [], timeoutMs: 300 }),
      (e) => e instanceof LlmError && e.code === "timeout"
    );
  } finally { await stub.close(); }
});

test("extractJson 兼容代码围栏", () => {
  assert.deepEqual(extractJson("```json\n{\"a\":1}\n```"), { a: 1 });
  assert.deepEqual(extractJson("前缀 {\"b\": 2} 后缀"), { b: 2 });
  assert.throws(() => extractJson("不是 json"));
});

async function configure(s, baseUrl, models) {
  const response = await fetch(s.baseUrl + "/api/admin/llm", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providers: [{ id: "stub", name: "Stub", baseUrl, protocol: "openai-chat-completions", apiKey: "secret-k", defaultModelId: models[0], models: models.map((id) => ({ id })) }],
      defaultProviderId: "stub"
    })
  });
  if (response.status !== 200) throw new Error(`配置 LLM 失败：${response.status} ${await response.text()}`);
}

test("集成：/api/llm/test 经设置指向 stub 后测试连接成功", async () => {
  const stub = await createLlmStub();
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl, ["stub-model"]);
    const put = true;
    const res = await fetch(s.baseUrl + "/api/llm/test", { method: "POST" });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
    assert.ok(j.latencyMs >= 0);
    assert.equal(j.model, "stub-model");
  } finally { await s.close(); await stub.close(); }
});

test("集成：拉取可用模型列表", async () => {
  const stub = await createLlmStub({ models: ["deepseek-chat", "deepseek-reasoner", "coder"] });
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl, ["deepseek-chat"]);
    const res = await fetch(s.baseUrl + "/api/llm/models?providerId=stub");
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.models, ["coder", "deepseek-chat", "deepseek-reasoner"]);
    // 未配置 Key → 400
    const s2 = await startServer();
    try {
      await fetch(s2.baseUrl + "/api/admin/llm", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: [{ id: "p", name: "P", baseUrl: stub.baseUrl, models: [{ id: "m" }] }], defaultProviderId: "p" })
      });
      const bad = await fetch(s2.baseUrl + "/api/llm/models?providerId=p");
      assert.equal(bad.status, 400);
      assert.ok(/Key/.test((await bad.json()).error));
    } finally { await s2.close(); }
  } finally { await s.close(); await stub.close(); }
});

test("集成：填写完整 chat completions 地址时仍可拉取模型并测试连接", async () => {
  const stub = await createLlmStub({ models: ["manual-model"] });
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl + "/v1/chat/completions", ["manual-model"]);
    const models = await fetch(s.baseUrl + "/api/llm/models?providerId=stub");
    assert.equal(models.status, 200);
    assert.deepEqual((await models.json()).models, ["manual-model"]);
    const testResult = await fetch(s.baseUrl + "/api/llm/test", { method: "POST" });
    assert.equal(testResult.status, 200);
    assert.equal((await testResult.json()).ok, true);
  } finally { await s.close(); await stub.close(); }
});

test("集成：未配置时 /api/llm/test 返回 400 中文错误", async () => {
  const s = await startServer();
  try {
    const res = await fetch(s.baseUrl + "/api/llm/test", { method: "POST" });
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.ok(/超管台/.test(j.error));
  } finally { await s.close(); }
});
