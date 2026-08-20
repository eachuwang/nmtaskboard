import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson, streamSse } from "./http.js";

afterEach(() => vi.unstubAllGlobals());

describe("requestJson", () => {
  it("returns JSON from a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ ok: true })
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson("/api/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/health", {
      headers: { Accept: "application/json" }
    });
  });

  it("exposes the server error through HttpError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ error: "请求参数不合法" })
    }));

    await expect(requestJson("/api/tasks")).rejects.toMatchObject({
      name: "HttpError",
      status: 400,
      message: "请求参数不合法"
    });
  });
});

describe("streamSse", () => {
  it("emits text from delta events across response chunks", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "event: delta\ndata: {\"text\":\"第一段\"}\n\n",
      "event: delta\ndata: {\"text\":\"第二段\"}\n\n"
    ];
    const body = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body
    }));
    const received = [];
    const events = [];

    await streamSse("/api/report/polish", { draft: "草稿" }, {
      onDelta: (text) => received.push(text),
      onEvent: (name, data) => events.push([name, data])
    });

    expect(received).toEqual(["第一段", "第二段"]);
    expect(events).toEqual([
      ["delta", { text: "第一段" }],
      ["delta", { text: "第二段" }]
    ]);
  });
});
