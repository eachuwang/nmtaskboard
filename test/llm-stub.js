import http from "node:http";

// OpenAI 兼容 stub 服务：可编程响应 / 流式 SSE，测试不依赖真实网络与 Key
export async function createLlmStub(options = {}) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://llm-stub").pathname;
    if (req.method === "GET" && (pathname === "/models" || pathname.endsWith("/v1/models"))) {
      const ids = options.models || ["model-a", "model-b", "model-c"];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
      return;
    }
    if (req.method !== "POST" || !pathname.endsWith("/chat/completions")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body;
    try { body = JSON.parse(raw); } catch { body = {}; }
    calls.push(body);
    const handler = options.handler || (() => ({ status: 200, body: { choices: [{ message: { content: "成功" } }] } }));
    const result = await handler(body, { calls });
    const { status = 200, body: outBody, stream } = result || {};
    if (stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
      for (const ev of stream) res.write("data: " + JSON.stringify(ev) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(outBody ?? {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    baseUrl: "http://127.0.0.1:" + port,
    calls,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

// 便捷流式事件构造
export function sseDelta(text) {
  return { choices: [{ delta: { content: text } }] };
}
