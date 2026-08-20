export class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

async function readResponseBody(response) {
  const contentType = response.headers?.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json().catch(() => ({}));
  return response.text().catch(() => "");
}

export async function requestJson(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const body = await readResponseBody(response);
  if (!response.ok) {
    const message = typeof body === "object" && body?.error
      ? body.error
      : `请求失败（HTTP ${response.status}）`;
    throw new HttpError(message, response.status, body);
  }
  return body;
}

export async function streamSse(path, body, { onDelta, onEvent, signal } = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorBody = await readResponseBody(response);
    const message = typeof errorBody === "object" && errorBody?.error
      ? errorBody.error
      : `请求失败（HTTP ${response.status}）`;
    throw new HttpError(message, response.status, errorBody);
  }
  if (!response.body?.getReader) throw new Error("当前浏览器不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastEvent = null;
  let eventName = "message";

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      eventName = trimmed.slice(6).trim() || "message";
      return;
    }
    if (!trimmed.startsWith("data:")) return;
    try {
      const event = JSON.parse(trimmed.slice(5).trim());
      lastEvent = { ...event, event: eventName };
      onEvent?.(eventName, event);
      if (eventName === "delta" && event.text) onDelta?.(event.text, event);
      eventName = "message";
    } catch {
      // Ignore keep-alive comments and incomplete non-data lines.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      consumeLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  return lastEvent;
}
