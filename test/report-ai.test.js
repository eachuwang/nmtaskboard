import test from "node:test";
import assert from "node:assert/strict";
import { createLlmStub, sseDelta } from "./llm-stub.js";
import { startServer } from "./helpers.js";

async function configure(s, baseUrl) {
  await fetch(s.baseUrl + "/api/settings", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providers: [{ id: "stub", name: "Stub", baseUrl, protocol: "openai-chat-completions", apiKey: "k", defaultModelId: "stub", models: [{ id: "stub" }] }],
      defaultProviderId: "stub"
    })
  });
}

// 解析 SSE 响应为事件数组
async function readSse(res) {
  assert.equal(res.headers.get("content-type").startsWith("text/event-stream"), true);
  const events = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (event === "delta" || event === "error" || event === "done") {
        events.push({ event, data: data ? JSON.parse(data) : {} });
      }
    }
  }
  return events;
}

test("AI 润色：流式返回、空草稿 400", async () => {
  const stub = await createLlmStub({
    handler: () => ({ stream: [sseDelta("润色后"), sseDelta("的周报")] })
  });
  const s = await startServer();
  try {
    await configure(s, stub.baseUrl);
    const res = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: "# 本周工作周报\n- 完成A" })
    });
    const events = await readSse(res);
    const text = events.filter((e) => e.event === "delta").map((e) => e.data.text).join("");
    assert.equal(text, "润色后的周报");
    assert.equal(events[events.length - 1].event, "done");
    // 系统提示要求先学习草稿作者的语气与格式习惯
    const sysMsg = stub.calls[0].messages.find((m) => m.role === "system").content;
    assert.ok(/学习草稿作者/.test(sysMsg) && /语气/.test(sysMsg) && /格式/.test(sysMsg));

    const empty = await fetch(s.baseUrl + "/api/report/polish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: "   " })
    });
    assert.equal(empty.status, 400);
  } finally { await s.close(); await stub.close(); }
});
