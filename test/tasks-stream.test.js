import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

test("任务变更实时流：写操作向同工作区连接推送事件", async () => {
  const s = await startServer();
  try {
    const controller = new AbortController();
    const response = await fetch(`${s.baseUrl}/api/tasks/stream`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
    const reader = response.body.getReader();
    await reader.read(); // ": connected"
    await fetch(`${s.baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "实时验证任务" })
    });
    let received = "";
    for (let index = 0; index < 10 && !received.includes("event: tasks"); index += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      received += new TextDecoder().decode(value);
    }
    assert.ok(received.includes("event: tasks"), `应收到 tasks 事件，实际：${received.slice(0, 120)}`);
    controller.abort();
  } finally {
    await s.close();
  }
});
